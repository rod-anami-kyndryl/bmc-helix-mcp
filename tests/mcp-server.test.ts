import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import axios from 'axios';
import { createMockHelixServer } from './mock-helix-server.ts';

// Configuration
const MOCK_HELIX_PORT = 18081;
const MCP_PORT = 14044;
const MCP_AUTH_TOKEN = 'test-secret-token-1234';

describe('BMC Helix MCP Server Integration Tests', () => {
    let helixServer: http.Server;
    let mcpProcess: ChildProcess;

    before(async () => {
        // 1. Start the mock Helix server
        const helixApp = createMockHelixServer();
        helixServer = http.createServer(helixApp);
        await new Promise<void>((resolve) => {
            helixServer.listen(MOCK_HELIX_PORT, () => {
                console.log(`[Test Setup] Mock Helix Server listening on port ${MOCK_HELIX_PORT}`);
                resolve();
            });
        });

        // 2. Start the MCP server as a subprocess, feeding it the mock environment variables
        // We use the compiled JS file since npm run build is triggered before testing.
        mcpProcess = spawn('node', ['./dist/mcp-server.js'], {
            env: {
                ...process.env,
                HELIX_API_URL: `http://localhost:${MOCK_HELIX_PORT}/api/arsys/v1/entry`,
                HELIX_TOKEN_URL: `http://localhost:${MOCK_HELIX_PORT}/api/jwt/login`,
                HELIX_USERID: 'your_username',
                HELIX_PASSWORD: 'your_password',
                HELIX_CERT_PATH: '/dev/null', // triggers fallback to insecure HTTP
                MCP_PORT: String(MCP_PORT),
                MCP_AUTH_TOKEN: MCP_AUTH_TOKEN,
                MCP_TLS_ENABLED: 'false'
            }
        });

        // Log stdout and stderr from our MCP subprocess to diagnostic terminal
        mcpProcess.stdout?.on('data', (data) => {
            console.log(`[MCP Subprocess] ${data.toString().trim()}`);
        });
        mcpProcess.stderr?.on('data', (data) => {
            console.error(`[MCP Subprocess Error] ${data.toString().trim()}`);
        });

        // 3. Poll the MCP server's health endpoint until it is listening and healthy
        let retries = 15;
        while (retries > 0) {
            try {
                const res = await axios.get(`http://localhost:${MCP_PORT}/health`, { timeout: 500 });
                if (res.status === 200 && res.data.status === 'ok') {
                    console.log('[Test Setup] MCP Server is up and healthy!');
                    break;
                }
            } catch (err) {
                // Ignore and wait
            }
            retries--;
            await new Promise((r) => setTimeout(r, 200));
        }

        if (retries === 0) {
            throw new Error('Failed to start MCP server subprocess or was not healthy in time');
        }
    });

    after(async () => {
        // Clean up processes and close listeners
        if (mcpProcess) {
            console.log('[Test Cleanup] Killing MCP Server subprocess...');
            mcpProcess.kill('SIGTERM');
        }
        if (helixServer) {
            console.log('[Test Cleanup] Closing mock Helix Server...');
            await new Promise<void>((resolve) => {
                helixServer.close(() => resolve());
            });
        }
    });

    // --- Helper function to perform MCP tool calls ---
    async function callMcpTool(toolName: string, args: Record<string, any> = {}) {
        const response = await axios.post(
            `http://localhost:${MCP_PORT}/mcp`,
            {
                jsonrpc: '2.0',
                method: 'tools/call',
                params: {
                    name: toolName,
                    arguments: args
                },
                id: 1
            },
            {
                headers: {
                    'Authorization': `Bearer ${MCP_AUTH_TOKEN}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream'
                }
            }
        );
        return response.data;
    }

    // --- TEST CASES ---

    test('Health endpoint verify status', async () => {
        const res = await axios.get(`http://localhost:${MCP_PORT}/health`);
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(res.data, { status: 'ok', service: 'bmc-helix-mcp' });
    });

    test('Authorization constraints prevent unauthenticated access', async () => {
        // Verify missing authorization header fails
        await assert.rejects(
            async () => {
                await axios.post(`http://localhost:${MCP_PORT}/mcp`, {
                    jsonrpc: '2.0',
                    method: 'tools/list',
                    id: 1
                });
            },
            (err: any) => {
                assert.strictEqual(err.response.status, 401);
                assert.strictEqual(err.response.data.error, 'Unauthorized');
                return true;
            }
        );

        // Verify invalid token fails
        await assert.rejects(
            async () => {
                await axios.post(
                    `http://localhost:${MCP_PORT}/mcp`,
                    { jsonrpc: '2.0', method: 'tools/list', id: 1 },
                    { headers: { 'Authorization': 'Bearer bad-token-xyz' } }
                );
            },
            (err: any) => {
                assert.strictEqual(err.response.status, 403);
                assert.strictEqual(err.response.data.error, 'Forbidden');
                return true;
            }
        );
    });

    test('Access to listing of tools', async () => {
        const response = await axios.post(
            `http://localhost:${MCP_PORT}/mcp`,
            {
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 1
            },
            {
                headers: {
                    'Authorization': `Bearer ${MCP_AUTH_TOKEN}`,
                    'Accept': 'application/json, text/event-stream'
                }
            }
        );

        assert.strictEqual(response.status, 200);
        assert.ok(response.data.result);
        const tools = response.data.result.tools;
        assert.ok(Array.isArray(tools));
        
        const toolNames = tools.map((t: any) => t.name);
        assert.ok(toolNames.includes('helix_get_table_data'));
        assert.ok(toolNames.includes('helix_get_table_data_paginated'));
        assert.ok(toolNames.includes('helix_get_ci_by_id'));
        assert.ok(toolNames.includes('helix_get_ci_by_name'));
        assert.ok(toolNames.includes('helix_get_change_request_tasks'));
        assert.ok(toolNames.includes('helix_get_problem_investigation_id'));
        assert.ok(toolNames.includes('helix_get_change_configuration_items'));
    });

    test('Tool Call: helix_get_table_data with multiple filters', async () => {
        const result = await callMcpTool('helix_get_table_data', {
            form: 'HPD:IncidentInterface',
            fields: ['Incident Number', 'Status', 'Description'],
            filters: ['Status="Assigned"'],
            limit: 5
        });

        assert.ok(!result.error);
        const content = JSON.parse(result.result.content[0].text);
        
        // Should find INC0000000001 and INC0000000003 as they are 'Assigned'
        assert.strictEqual(content.length, 2);
        assert.strictEqual(content[0]['Incident Number'], 'INC0000000001');
        assert.strictEqual(content[1]['Incident Number'], 'INC0000000003');
    });

    test('Tool Call: helix_get_table_data_paginated fetches all records in slices', async () => {
        const result = await callMcpTool('helix_get_table_data_paginated', {
            form: 'HPD:IncidentInterface',
            fields: ['Incident Number', 'Status'],
            filters: [],
            pageSize: 1 // force pagination through pages
        });

        assert.ok(!result.error);
        const content = JSON.parse(result.result.content[0].text);
        
        // Should fetch all 3 test incidents across paginated slices and combine them
        assert.strictEqual(content.length, 3);
        assert.strictEqual(content[0]['Incident Number'], 'INC0000000001');
        assert.strictEqual(content[1]['Incident Number'], 'INC0000000002');
        assert.strictEqual(content[2]['Incident Number'], 'INC0000000003');
    });

    test('Tool Call: helix_get_ci_by_id single record fetch', async () => {
        const result = await callMcpTool('helix_get_ci_by_id', {
            id: 'CI-DB-01',
            fields: ['Name', 'Class', 'Tag']
        });

        assert.ok(!result.error);
        const content = JSON.parse(result.result.content[0].text);
        assert.strictEqual(content['Name'], 'db-server-01');
        assert.strictEqual(content['Class'], 'BMC_ComputerSystem');
        assert.strictEqual(content['Tag'], 'PROD_DB');
    });

    test('Tool Call: helix_get_ci_by_name fetch', async () => {
        const result = await callMcpTool('helix_get_ci_by_name', {
            name: 'web-server-02',
            fields: ['Request ID', 'Status']
        });

        assert.ok(!result.error);
        const content = JSON.parse(result.result.content[0].text);
        assert.strictEqual(content.length, 1);
        assert.strictEqual(content[0]['Request ID'], 'CI-WEB-01');
        assert.strictEqual(content[0]['Status'], 'Deployed');
    });

    test('Tool Call: helix_get_change_request_tasks associations', async () => {
        const result = await callMcpTool('helix_get_change_request_tasks', {
            changeId: 'CRQ0000000001'
        });

        assert.ok(!result.error);
        const content = JSON.parse(result.result.content[0].text);
        assert.strictEqual(content.length, 2);
        assert.strictEqual(content[0]['Task ID'], 'TSK0000000001');
        assert.strictEqual(content[0]['TaskName'], 'Backup Database');
        assert.strictEqual(content[1]['Task ID'], 'TSK0000000002');
        assert.strictEqual(content[1]['TaskName'], 'Apply Patch');
    });

    test('Tool Call: helix_get_problem_investigation_id linkages', async () => {
        const result = await callMcpTool('helix_get_problem_investigation_id', {
            incidentId: 'INC0000000001'
        });

        assert.ok(!result.error);
        const content = JSON.parse(result.result.content[0].text);
        assert.strictEqual(content.incidentId, 'INC0000000001');
        assert.strictEqual(content.problem_investigation_id, 'PBM0000000001');
    });

    test('Tool Call: helix_get_change_configuration_items relationships', async () => {
        const result = await callMcpTool('helix_get_change_configuration_items', {
            changeId: 'CRQ0000000001'
        });

        assert.ok(!result.error);
        const content = JSON.parse(result.result.content[0].text);
        assert.strictEqual(content.length, 1);
        assert.strictEqual(content[0]['Request Description01'], 'db-server-01');
        assert.strictEqual(content[0]['Form Name01'], 'AST:ComputerSystem');
    });
});
