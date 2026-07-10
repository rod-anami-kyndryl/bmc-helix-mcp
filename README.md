# BMC Helix MCP Server

The **BMC Helix MCP Server** is a Model Context Protocol (MCP) server for SRE operations using BMC Helix ITSM REST APIs. It is implemented in TypeScript, powered by Express, and optionally configurable with HTTPS/TLS.

## Project Features

- **Model Context Protocol (MCP) Support:** Built with `@modelcontextprotocol/sdk` to seamlessly integrate with LLMs and coding assistants.
- **Form & CI Operations:** Wraps native BMC Helix ITSM REST API calls for fetching and paginating table data, CMDB CI querying by ID or Name, tasks, associations, and relationship checking.
- **Advanced SRE Integrations:** Includes dedicated tools to process, enrich, SRE-classify, and correlate raw incident and alert listings to calculate Mean Time to Detect (MTTD).
- **Express + HTTPS:** Supports standard HTTP as well as secure HTTPS with complete TLS certificate validation configurations.
- **Node v24 and modern ES Module structure.**

---

## Directory Structure

- `src/mcp-server.ts`: Fully-typed, rate-limited MCP Server application featuring express transport and tool mappings.
- `certs/`: Holds local client and server CA keys, configurations, and scripts for secure TLS enablement.
- `data/`: Local storage for configuration details (e.g., `service-mapping.json`) and enriched SRE databases.
- `output/`: Folder for raw JSON extracts.

---

## Registered MCP Tools

The server registers the following high-value tools:

1. **`helix_get_table_data`**: Retrieve SRE records from any BMC Helix form (e.g., `HPD:IncidentInterface`, `CHG:Infrastructure Change`) with optional query filters and record limits.
2. **`helix_get_table_data_paginated`**: Automatically fetches and aggregates multi-page records from a form using offset-based pagination.
3. **`helix_get_ci_by_id`**: Get a configuration item's attributes from `BMC.CORE:BMC_BaseElement` by its unique entry Request ID.
4. **`helix_get_ci_by_name`**: Find CMDB records by name.
5. **`helix_get_change_request_tasks`**: Retrieves children task lists from `TMS:Task` for a given Change ID (`CRQ...`).
6. **`helix_get_problem_investigation_id`**: Finds the associated Problem ID for a given incident ticket.
7. **`helix_get_change_configuration_items`**: Finds AST configuration items associated with a Change ID.
8. **`helix_update_database`**: Processes external BMC extracts, enriches them with calculated ownership rules, mapping details, and template classifiers, and outputs the tables back to `/data/`.
9. **`helix_correlate_incidents_alerts`**: Runs the MTTD measurement across the enriched datasets.

---

## Installation & Setup

1. Copy `.env.example` to `.env` and fill in your details:

```bash
cp .env.example .env
```

1. Configuration Settings in `.env`:

- `HELIX_API_URL`: BMC Helix Entry level URL endpoint.
- `HELIX_TOKEN_URL`: JWT Login payload URL endpoint.
- `HELIX_USERID` / `HELIX_PASSWORD`: Helix API Credentials.
- `MCP_PORT`: Web server running port (defaults to 3000).
- `MCP_AUTH_TOKEN`: Optional API Authorization Bearer token to secure the MCP endpoint from external entities.
- `MCP_TLS_ENABLED`: Set to `true` to enable TLS on the express listener.

1. Install dependencies:

```bash
npm install
```

1. Build the application:

```bash
npm run build
```

1. Start the server (Dev / Production):

- **Production Mode:** `npm run start`
- **Development Mode:** `npm run dev`

---

## License

This project is licensed under the [MIT License](LICENSE).
