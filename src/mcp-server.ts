#!/usr/bin/env node

import fs from "fs";
import https from "https";
import http from "http";
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { z } from 'zod';
import axios from 'axios';
// @ts-ignore
import rateLimit from 'axios-rate-limit';

// BMC Helix ITSM Configuration
const HelixApiUrl   = process.env.HELIX_API_URL   || 'https://your-helix-instance.onbmc.com/api/arsys/v1/entry/';
const HelixTokenUrl = process.env.HELIX_TOKEN_URL  || 'https://your-helix-instance.onbmc.com/api/jwt/login';
const HelixUserId   = process.env.HELIX_USERID     || 'your_username';
const HelixPassword = process.env.HELIX_PASSWORD   || 'your_password';
const HelixCertPath = process.env.HELIX_CERT_PATH   || './certs/cert.pem';

// Standard BMC Helix form names
const HELIX_FORMS: Record<string, string> = {
    incident : 'HPD:IncidentInterface',
    change   : 'CHG:Infrastructure Change',
    problem  : 'PBM:Problem Investigation',
    workOrder: 'WOI:WorkOrderInterface',
    alert    : 'BMC.CORE:BMC_BaseEvent',
    cmdb     : 'BMC.CORE:BMC_BaseElement',
};

// Global rate limiting configuration for Helix API calls
const maxRequests = 30;
const maxRPS = 20;

// @ts-ignore
const axiosRateLimited = rateLimit(axios.create(), { maxRequests: maxRequests, perMilliseconds: 1000, maxRPS: maxRPS });

// HTTPS Agent configuration for self-signed certificates
let httpsAgent: https.Agent;
try {
  if (fs.existsSync(HelixCertPath)) {
    httpsAgent = new https.Agent({
      rejectUnauthorized: false, // Disables strict SSL verification as per SRE parser behavior
      ca: fs.readFileSync(HelixCertPath),
      cert: fs.readFileSync(HelixCertPath),
    });
  } else {
    httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }
} catch (e) {
  console.warn(`[Warning] Could not load client cert from ${HelixCertPath}, using insecure HTTP fallback agent.`);
  httpsAgent = new https.Agent({ rejectUnauthorized: false });
}

// Server identity
const MCP_PORT = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT) : 4044;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN; // Bearer token for authentication
const MCP_TLS_KEY = process.env.MCP_TLS_KEY || './certs/mcp-server.key';
const MCP_TLS_CERT = process.env.MCP_TLS_CERT || './certs/mcp-server.crt';
const MCP_TLS_CA = process.env.MCP_TLS_CA || './certs/ca.crt';
const MCP_TLS_ENABLED = process.env.MCP_TLS_ENABLED === "true";

// Helper function to ensure folders exist
function ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// JWT Authentication with BMC Helix ITSM REST API helper
async function getHelixJwtToken(): Promise<string> {
    try {
        const response = await axios({
            url: HelixTokenUrl,
            method: 'post',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            httpsAgent: httpsAgent,
            data: {
                username: HelixUserId,
                password: HelixPassword
            }
        });

        // BMC Helix returns the JWT as a plain-text string in the response body.
        const token = typeof response.data === 'string'
            ? response.data.trim()
            : (response.data.authToken || response.data.token || String(response.data));
        return token;
    } catch (error: any) {
        console.error('Error obtaining BMC Helix JWT token:', error.message);
        if (error.response && error.response.data) {
            console.error('Response data:', error.response.data);
        }
        throw new Error(`Helix Authentication Failed: ${error.message}`);
    }
}

function buildHelixHeaders(jwtToken: string) {
    return {
        'Content-Type': 'application/json',
        'Accept'      : 'application/json',
        'Authorization': `AR-JWT ${jwtToken}`,
    };
}

// Standard data parsing & flattening SRE operations
function cleanRecord(value: any): any {
    if (typeof value !== 'string') return value;
    return value
        .replace(/"|'/g, '')
        .replace(/,|;/g, '-')
        .replace(/(\r\n|\n|\r)/gm, ' ')
        .trim();
}

function flattenHelixEntry(entry: any): any {
    const record = { ...(entry.values || entry) };
    for (const key in record) {
        if (record[key] !== null && typeof record[key] === 'object' && 'value' in record[key]) {
            record[key] = record[key].value;
        } else if (typeof record[key] === 'string') {
            record[key] = cleanRecord(record[key]);
        }
    }
    return record;
}


// Helix suboperations fetching functions
async function getChangeRequestTasks(changeId: string, jwtToken: string): Promise<any[]> {
    if (!jwtToken) return [];
    const hdrs = buildHelixHeaders(jwtToken);
    
    const filters = `'RootRequestName'="${changeId}"`;
    const fields = 'Sequence,Task ID,TaskName,Summary,Notes,Status,Assignee Group,Scheduled Start Date,Scheduled End Date';
    const params = [
        `q=${encodeURIComponent(filters)}`,
        `fields=values(${encodeURIComponent(fields)})`
    ];
    
    const url = `${HelixApiUrl}/${encodeURIComponent('TMS:Task')}?${params.join('&')}`;

    try {
        const response = await axiosRateLimited({ url, method: 'get', headers: hdrs, httpsAgent: httpsAgent });
        const entries = response.data.entries || [];
        const tasks = entries.map(flattenHelixEntry);
        return tasks;
    } catch (err: any) {
        console.error(`Error fetching tasks for ${changeId}:`, err.message);
        return [];
    }
}

async function getProblemInvestigationId(incidentId: string, jwtToken: string): Promise<string> {
    if (!jwtToken) return 'None';
    const hdrs = buildHelixHeaders(jwtToken);
    
    const filters = `'Request ID02'="${incidentId}" AND 'Form Name01'="PBM:Problem Investigation"`;
    const fields = 'Request ID01,Request ID02,Association Type01';
    
    const params = [
        `fields=values(${fields})`,
        `q=${encodeURIComponent(filters)}`,
        `limit=1`
    ];
    
    const url = `${HelixApiUrl}/${encodeURIComponent('HPD:Associations')}?${params.join('&')}`;

    try {
        const response = await axiosRateLimited({ url, method: 'get', headers: hdrs, httpsAgent: httpsAgent });
        const entries = response.data.entries || [];
        if (entries.length > 0) {
            const record = flattenHelixEntry(entries[0]);
            return record['Request ID01'] || 'None';
        }
        return 'None';
    } catch (err: any) {
        console.error(`Error fetching associations for incident ${incidentId}:`, err.message);
        return 'None';
    }
}

async function getChangeConfigurationItems(changeId: string, jwtToken: string): Promise<any[]> {
    if (!jwtToken) return [];
    const hdrs = buildHelixHeaders(jwtToken);
    
    const filters = `'Request ID02'="${changeId}" AND 'Form Name01' LIKE "AST:%"`;
    const fields = 'Request Description01,Form Name01,Association Type01';
    
    const params = [
        `fields=values(${fields})`,
        `q=${encodeURIComponent(filters)}`
    ];
    
    const url = `${HelixApiUrl}/${encodeURIComponent('CHG:Associations')}?${params.join('&')}`;

    try {
        const response = await axiosRateLimited({ url, method: 'get', headers: hdrs, httpsAgent: httpsAgent });
        const entries = response.data.entries || [];
        const cis = entries.map(flattenHelixEntry);
        return cis;
    } catch (err: any) {
        console.error(`Error fetching configuration items for change ${changeId}:`, err.message);
        return [];
    }
}

// Initialize MCP Server
const server = new McpServer({
    name: 'bmc-helix-mcp-server',
    version: '0.1.0'
});

// Expose Form & CI Retrieval as tools
server.registerTool(
    "helix_get_table_data",
    {
        title: "Get Helix Form Data",
        description: "Fetch SRE data elements from a BMC Helix form in a single rate-limited request with filters and limit.",
        inputSchema: {
            form: z.string().describe("The BMC Helix form name (e.g. 'HPD:IncidentInterface', 'CHG:Infrastructure Change')"),
            fields: z.array(z.string()).describe("List of field names to retrieve. Use ['all'] for all fields."),
            filters: z.array(z.string()).describe("AR query filter expressions (e.g. ['Status=\"Assigned\"']) that will be joined with 'AND'"),
            limit: z.number().optional().describe("Maximum number of records to return (defaults to 100)")
        }
    },
    async ({ form, fields, filters, limit }) => {
        try {
            const jwtToken = await getHelixJwtToken();
            const hdrs = buildHelixHeaders(jwtToken);
            const params = [];
            if (fields.length > 0 && fields[0] !== 'all') {
                params.push(`fields=values(${fields.join(',')})`);
            }
            if (filters.length > 0) {
                params.push(`q=${encodeURIComponent(filters.join(' AND '))}`);
            }
            const recordLimit = limit || 100;
            params.push(`limit=${recordLimit}`);

            const url = `${HelixApiUrl}/${encodeURIComponent(form)}${params.length ? '?' + params.join('&') : ''}`;
            console.log('[Helix Tool] Fetching URL:', url);

            const response = await axiosRateLimited({ url, method: 'get', headers: hdrs, httpsAgent: httpsAgent });
            const entries = response.data.entries || [];
            const records = entries.map(flattenHelixEntry);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(records, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error fetching data from Helix: ${error.message}${error.response?.data ? '\nResponse: ' + JSON.stringify(error.response.data) : ''}`
                    }
                ]
            };
        }
    }
);

server.registerTool(
    "helix_get_table_data_paginated",
    {
        title: "Get Helix Form Data Paginated",
        description: "Fetch all matching data elements from a BMC Helix form using offset-based pagination until all pages are retrieved.",
        inputSchema: {
            form: z.string().describe("The BMC Helix form name (e.g., 'HPD:IncidentInterface')"),
            fields: z.array(z.string()).describe("List of field names to retrieve"),
            filters: z.array(z.string()).describe("AR query filter expressions to be joined with 'AND'"),
            pageSize: z.number().describe("Records per page limit (e.g., 50)")
        }
    },
    async ({ form, fields, filters, pageSize }) => {
        try {
            const jwtToken = await getHelixJwtToken();
            const hdrs = buildHelixHeaders(jwtToken);
            const params = [];
            if (fields.length > 0 && fields[0] !== 'all') {
                params.push(`fields=values(${fields.join(',')})`);
            }
            if (filters.length > 0) {
                params.push(`q=${encodeURIComponent(filters.join(' AND '))}`);
            }
            params.push(`limit=${pageSize}`);

            const baseUrl = `${HelixApiUrl}/${encodeURIComponent(form)}?${params.join('&')}`;

            let offset = 0;
            let hasMore = true;
            let allRecords: any[] = [];

            while (hasMore) {
                const url = `${baseUrl}&offset=${offset}`;
                console.log('[Helix Tool] Fetching paginated URL:', url);
                const response = await axiosRateLimited({ url, method: 'get', headers: hdrs, httpsAgent: httpsAgent });
                const entries = response.data.entries || [];
                const records = entries.map(flattenHelixEntry);
                allRecords = allRecords.concat(records);
                
                if (records.length < pageSize) {
                    hasMore = false;
                } else {
                    offset += pageSize;
                }
            }

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(allRecords, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error fetching paginated data from Helix: ${error.message}`
                    }
                ]
            };
        }
    }
);

server.registerTool(
    "helix_get_ci_by_id",
    {
        title: "Get CMDB CI by ID",
        description: "Retrieve a specific CI from BMC Helix CMDB BMC.CORE:BMC_BaseElement by its unique entry Request ID.",
        inputSchema: {
            id: z.string().describe("The unique Helix entry ID (Request ID)"),
            fields: z.array(z.string()).optional().describe("Field names to retrieve (optional)")
        }
    },
    async ({ id, fields }) => {
        try {
            const jwtToken = await getHelixJwtToken();
            const hdrs = buildHelixHeaders(jwtToken);
            let url = `${HelixApiUrl}/${encodeURIComponent(HELIX_FORMS.cmdb)}/${encodeURIComponent(id)}`;
            if (fields && fields.length > 0 && fields[0] !== 'all') {
                url = `${url}?fields=values(${fields.join(',')})`;
            }
            console.log('[Helix Tool] Fetching CI by ID:', url);

            const response = await axios({ url, method: 'get', headers: hdrs, httpsAgent });
            const record = response.data.values ? flattenHelixEntry(response.data) : response.data;

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(record, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error fetching CI by ID: ${error.message}`
                    }
                ]
            };
        }
    }
);

server.registerTool(
    "helix_get_ci_by_name",
    {
        title: "Get CMDB CIs by Name",
        description: "Retrieve CMDB CI records from BMC.CORE:BMC_BaseElement that match a given name.",
        inputSchema: {
            name: z.string().describe("The service or CI name to search for (e.g. 'router-core-01')"),
            fields: z.array(z.string()).optional().describe("Field names to retrieve (optional)")
        }
    },
    async ({ name, fields }) => {
        try {
            const jwtToken = await getHelixJwtToken();
            const hdrs = buildHelixHeaders(jwtToken);
            let url = `${HelixApiUrl}/${encodeURIComponent(HELIX_FORMS.cmdb)}?q=${encodeURIComponent(`'Name'="${name}"`)}`;
            if (fields && fields.length > 0 && fields[0] !== 'all') {
                url = `${url}&fields=values(${fields.join(',')})`;
            }
            console.log('[Helix Tool] Fetching CI by Name:', url);

            const response = await axios({ url, method: 'get', headers: hdrs, httpsAgent });
            const entries = response.data.entries || [];
            const records = entries.map(flattenHelixEntry);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(records, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error fetching CI by name: ${error.message}`
                    }
                ]
            };
        }
    }
);

server.registerTool(
    "helix_get_change_request_tasks",
    {
        title: "Get Change Request Tasks",
        description: "Fetch SRE change request tasks from TMS:Task associated with a specific Change (CRQ ID).",
        inputSchema: {
            changeId: z.string().describe("The Infrastructure Change ID (e.g., 'CRQ000000123456')")
        }
    },
    async ({ changeId }) => {
        try {
            const jwtToken = await getHelixJwtToken();
            const tasks = await getChangeRequestTasks(changeId, jwtToken);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(tasks, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error fetching tasks: ${error.message}`
                    }
                ]
            };
        }
    }
);

server.registerTool(
    "helix_get_problem_investigation_id",
    {
        title: "Get Problem Investigation ID for Incident",
        description: "Explore incident relationships to locate the related Problem Investigation ID from HPD:Associations.",
        inputSchema: {
            incidentId: z.string().describe("The unique Helix Incident Number (e.g., 'INC000000456123')")
        }
    },
    async ({ incidentId }) => {
        try {
            const jwtToken = await getHelixJwtToken();
            const problemId = await getProblemInvestigationId(incidentId, jwtToken);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ incidentId, problem_investigation_id: problemId }, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error finding problem association: ${error.message}`
                    }
                ]
            };
        }
    }
);

server.registerTool(
    "helix_get_change_configuration_items",
    {
        title: "Get Change Request CIs",
        description: "Explore change relationships to find all impacted Configuration Items associated with a Change Request.",
        inputSchema: {
            changeId: z.string().describe("The unique Infrastructure Change ID")
        }
    },
    async ({ changeId }) => {
        try {
            const jwtToken = await getHelixJwtToken();
            const cis = await getChangeConfigurationItems(changeId, jwtToken);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(cis, null, 2),
                    },
                ],
            };
        } catch (error: any) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Error finding change associations: ${error.message}`
                    }
                ]
            };
        }
    }
);

// Web Server Express Integration
const app = express();
app.use(cors({
    origin: '*',
    exposedHeaders: ['Mcp-Session-Id'],
    allowedHeaders: ['Accept', 'Content-Type', 'mcp-session-id', 'Authorization']
}));
app.use(express.json());

// Basic SRE verification endpoint
app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "bmc-helix-mcp" });
});

// Authentication middleware
const authenticate = (req: Request, res: Response, next: NextFunction) => {
    if (!MCP_AUTH_TOKEN) {
        console.log('[Auth] Authentication disabled (MCP_AUTH_TOKEN not set)');
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Missing Authorization header' });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ error: 'Unauthorized', message: 'Expected Bearer Auth format' });
    }

    if (parts[1] !== MCP_AUTH_TOKEN) {
        return res.status(403).json({ error: 'Forbidden', message: 'Invalid token' });
    }

    next();
};

app.all('/mcp', authenticate, async (req: Request, res: Response) => {
    try {
        console.log(`[MCP Server] ${req.method} request from ${req.ip}`);
        
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true
        });

        res.on('close', () => {
            console.log('[MCP Server] Client disconnected');
            transport.close();
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (error: any) {
        console.error('[MCP Server] Error handling request:', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : 'Internal server error'
                },
                id: null
            });
        }
    }
});

let webServer: http.Server | https.Server;

if (MCP_TLS_ENABLED && MCP_TLS_CERT && MCP_TLS_KEY) {
    let tlsOptions: any = {};
    try {
        tlsOptions = {
          key: fs.readFileSync(MCP_TLS_KEY),
          cert: fs.readFileSync(MCP_TLS_CERT)
        };
        if (fs.existsSync(MCP_TLS_CA)) {
            tlsOptions.ca = fs.readFileSync(MCP_TLS_CA);
        }
    } catch(err: any) {
        console.error('Failed to load certificates for TLS/HTTPS mode:', err.message);
        process.exit(1);
    }

    webServer = https.createServer(tlsOptions, app);
    webServer.listen(MCP_PORT, () => {
        console.log(`[HTTPS] BMC Helix MCP Server listening on https://localhost:${MCP_PORT}`);
    });
} else {
    webServer = http.createServer(app);
    webServer.listen(MCP_PORT, () => {
        console.log(`[HTTP] BMC Helix MCP Server listening on http://localhost:${MCP_PORT}`);
    });
}
