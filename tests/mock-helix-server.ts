import express from 'express';
import type { Request, Response } from 'express';
import http from 'http';

// Define structure for our mocked database
interface MockDatabase {
    [formName: string]: Array<Record<string, any>>;
}

// Populate standard mock data mimicking the BMC Helix ITSM schema
const mockDb: MockDatabase = {
    // Incident Interface mock records (HPD:IncidentInterface)
    'HPD:IncidentInterface': [
        {
            'Incident Number': 'INC0000000001',
            'Status': 'Assigned',
            'Description': 'Database latency high in production environment',
            'Severity': 'High',
            'Urgency': 'High',
            'Assignee': 'DB_Admin_User'
        },
        {
            'Incident Number': 'INC0000000002',
            'Status': 'In Progress',
            'Description': 'CPU throttling on web server',
            'Severity': 'Medium',
            'Urgency': 'Medium',
            'Assignee': 'Sys_Admin_User'
        },
        {
            'Incident Number': 'INC0000000003',
            'Status': 'Assigned',
            'Description': 'Memory leak in user microservice',
            'Severity': 'High',
            'Urgency': 'Medium',
            'Assignee': 'Developer_User'
        }
    ],
    // Change Request records (CHG:Infrastructure Change)
    'CHG:Infrastructure Change': [
        {
            'Infrastructure Change ID': 'CRQ0000000001',
            'Status': 'Scheduled',
            'Description': 'Deploy patch v1.2 updates',
            'Severity': 'Minor',
            'Scheduled Start Date': '2026-07-20T08:00:00Z',
            'Scheduled End Date': '2026-07-20T10:00:00Z'
        }
    ],
    // Problem Investigation records (PBM:Problem Investigation)
    'PBM:Problem Investigation': [
        {
            'Problem Investigation ID': 'PBM0000000001',
            'Status': 'Under Investigation',
            'Description': 'Root cause analysis of high DB latency'
        }
    ],
    // Work Order records (WOI:WorkOrderInterface)
    'WOI:WorkOrderInterface': [
        {
            'Work Order ID': 'WO000001',
            'Status': 'Assigned',
            'Summary': 'Certificate renewal for server'
        }
    ],
    // Task records (TMS:Task)
    'TMS:Task': [
        {
            'Task ID': 'TSK0000000001',
            'RootRequestName': 'CRQ0000000001',
            'Sequence': '1',
            'TaskName': 'Backup Database',
            'Summary': 'Perform DB backup before deployment',
            'Status': 'Closed'
        },
        {
            'Task ID': 'TSK0000000002',
            'RootRequestName': 'CRQ0000000001',
            'Sequence': '2',
            'TaskName': 'Apply Patch',
            'Summary': 'Apply patch v1.2 to DB server',
            'Status': 'Assigned'
        }
    ],
    // Incident - Problem Association entries (HPD:Associations)
    'HPD:Associations': [
        {
            'Request ID01': 'PBM0000000001',
            'Request ID02': 'INC0000000001',
            'Form Name01': 'PBM:Problem Investigation',
            'Association Type01': 'Related To'
        }
    ],
    // Change - CI Association entries (CHG:Associations)
    'CHG:Associations': [
        {
            'Request Description01': 'db-server-01',
            'Form Name01': 'AST:ComputerSystem',
            'Request ID02': 'CRQ0000000001',
            'Association Type01': 'Impacted CI'
        }
    ],
    // CMDB base CIs (BMC.CORE:BMC_BaseElement)
    'BMC.CORE:BMC_BaseElement': [
        {
            'Request ID': 'CI-DB-01',
            'Name': 'db-server-01',
            'Status': 'Deployed',
            'Item': 'Server',
            'Class': 'BMC_ComputerSystem',
            'Tag': 'PROD_DB'
        },
        {
            'Request ID': 'CI-WEB-01',
            'Name': 'web-server-02',
            'Status': 'Deployed',
            'Item': 'Server',
            'Class': 'BMC_ComputerSystem',
            'Tag': 'PROD_WEB'
        }
    ]
};

// Parser to convert Helix query filter conditions (e.g., 'RootRequestName'="CRQ0000000001") into JS filters
function parseHelixQuery(q: string): Record<string, any> {
    const filters: Record<string, any> = {};
    if (!q) return filters;

    // Split filter statements separated by AND
    const segments = q.split(/\s+AND\s+/i);
    for (const segment of segments) {
        // Matches standard equality: 'field'="value" or field="value"
        const eqMatch = segment.trim().match(/^'?([^'=]+)'?\s*=\s*"([^"]*)"$/);
        if (eqMatch) {
            filters[eqMatch[1].trim()] = eqMatch[2];
            continue;
        }

        // Matches LIKE filters: 'field' LIKE "AST:%"
        const likeMatch = segment.trim().match(/^'?([^'=]+)'?\s+LIKE\s+"([^"]*)"$/i);
        if (likeMatch) {
            filters[likeMatch[1].trim()] = { like: likeMatch[2] };
            continue;
        }
    }
    return filters;
}

// Determines if a mock database record matches the parsed filters
function recordMatchesFilters(record: Record<string, any>, filters: Record<string, any>): boolean {
    for (const key in filters) {
        const valueInDb = record[key];
        const filterVal = filters[key];

        if (filterVal && typeof filterVal === 'object' && 'like' in filterVal) {
            const pattern = filterVal.like.replace(/%/g, '.*');
            const regex = new RegExp(`^${pattern}$`, 'i');
            if (!valueInDb || !regex.test(String(valueInDb))) {
                return false;
            }
        } else {
            if (String(valueInDb) !== String(filterVal)) {
                return false;
            }
        }
    }
    return true;
}

// Creates the Express app for the mock Helix server
export function createMockHelixServer(): express.Express {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Mock Login Endpoint -> Returns flat string token as specified in docs
    app.post('/api/jwt/login', (req: Request, res: Response) => {
        const { username, password } = req.body;
        
        // Log authentication request details
        console.log(`[Mock Helix] Authentication request: username=${username}`);

        if (!username || !password) {
            return res.status(400).send('Missing username or password');
        }

        if (password === 'invalid_password') {
            return res.status(401).send('Authentication Failed: Invalid user or password');
        }

        // Return a mock token signed or flat string e.g. 'mock-jwt-token-sre-2026'
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send('mock-jwt-token-sre-2026');
    });

    // Mock Form Entry Endpoint (Fetch / Search resources)
    app.get('/api/arsys/v1/entry/:form', (req: Request, res: Response) => {
        const formName = req.params.form;
        const authHeader = req.headers.authorization;

        console.log(`[Mock Helix] GET Form data requested: form=${formName}`);

        // Validate AR-JWT token
        if (!authHeader || !authHeader.startsWith('AR-JWT ')) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Missing or malformed JWT token'
            });
        }

        const token = authHeader.substring(7);
        if (token !== 'mock-jwt-token-sre-2026') {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid JWT token supplied'
            });
        }

        // Get matching form datasets
        const dataset = mockDb[formName];
        if (!dataset) {
            return res.status(404).json({
                error: 'Form Not Found',
                message: `Form '${formName}' is not defined in mock server`
            });
        }

        const q = req.query.q as string;
        const fieldsQuery = req.query.fields as string;
        const limitParam = req.query.limit ? parseInt(req.query.limit as string) : 100;
        const offsetParam = req.query.offset ? parseInt(req.query.offset as string) : 0;

        console.log(`[Mock Helix] Params: q=${q}, fields=${fieldsQuery}, limit=${limitParam}, offset=${offsetParam}`);

        // Parse query filters
        const filters = parseHelixQuery(q);

        // Filter dataset
        let records = dataset.filter(rec => recordMatchesFilters(rec, filters));

        // Handle field projection (values(field1,field2,...))
        let selectFields: string[] = [];
        if (fieldsQuery && fieldsQuery.startsWith('values(') && fieldsQuery.endsWith(')')) {
            const rawFieldsList = fieldsQuery.slice(7, -1);
            selectFields = rawFieldsList.split(',').map(f => f.trim());
        }

        // Map and project records inside the envelope representation
        let entries = records.map(rec => {
            const values: Record<string, any> = {};
            if (selectFields.length > 0 && !selectFields.includes('all')) {
                for (const field of selectFields) {
                    if (field in rec) {
                        values[field] = rec[field];
                    }
                }
            } else {
                Object.assign(values, rec);
            }
            return { values };
        });

        // Paginate using offset and limit
        const totalCount = entries.length;
        entries = entries.slice(offsetParam, offsetParam + limitParam);

        return res.status(200).json({
            entries
        });
    });

    // Mock Single Entry Endpoint
    app.get('/api/arsys/v1/entry/:form/:id', (req: Request, res: Response) => {
        const { form, id } = req.params;
        const authHeader = req.headers.authorization;

        console.log(`[Mock Helix] GET Single entry: form=${form}, id=${id}`);

        if (!authHeader || !authHeader.startsWith('AR-JWT ')) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Missing or malformed JWT token'
            });
        }

        const dataset = mockDb[form];
        if (!dataset) {
            return res.status(404).json({
                error: 'Form Not Found',
                message: `Form '${form}' is not mocked`
            });
        }

        // Determine if ID field matches.
        // It could map to 'Request ID', 'Incident Number', 'Infrastructure Change ID', 'Task ID', etc.
        const record = dataset.find(rec => {
            return rec['Request ID'] === id ||
                rec['Incident Number'] === id ||
                rec['Infrastructure Change ID'] === id ||
                rec['Task ID'] === id ||
                rec['Problem Investigation ID'] === id;
        });

        if (!record) {
            return res.status(404).json({
                error: 'Not Found',
                message: `Record with id '${id}' not found in form '${form}'`
            });
        }

        // Project fields if requested
        const fieldsQuery = req.query.fields as string;
        const values: Record<string, any> = {};
        if (fieldsQuery && fieldsQuery.startsWith('values(') && fieldsQuery.endsWith(')')) {
            const selectFields = fieldsQuery.slice(7, -1).split(',').map(f => f.trim());
            for (const field of selectFields) {
                if (field in record) {
                    values[field] = record[field];
                }
            }
        } else {
            Object.assign(values, record);
        }

        return res.status(200).json({
            values
        });
    });

    return app;
}

// Start Mock Server Helper for manual script usage/debugging
if (process.argv[1] && process.argv[1].endsWith('mock-helix-server.ts')) {
    const app = createMockHelixServer();
    const port = process.env.MOCK_HELIX_PORT ? parseInt(process.env.MOCK_HELIX_PORT) : 8081;
    const server = http.createServer(app);
    server.listen(port, () => {
        console.log(`[Mock Helix Server] Running on http://localhost:${port}`);
    });
}
