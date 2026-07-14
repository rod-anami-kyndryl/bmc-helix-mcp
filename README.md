# BMC Helix MCP Server

The **BMC Helix MCP Server** is a Model Context Protocol (MCP) server for SRE operations using BMC Helix ITSM REST APIs. It is implemented in TypeScript, powered by Express, and optionally configurable with HTTPS/TLS.

## Project Features

- **Model Context Protocol (MCP) Support:** Built with `@modelcontextprotocol/sdk` to seamlessly integrate with LLMs and coding assistants.
- **Form & CI Operations:** Wraps native BMC Helix ITSM REST API calls for fetching and paginating table data, CMDB CI querying by ID or Name, tasks, associations, and relationship checking.
- **Express + HTTPS:** Supports standard HTTP as well as secure HTTPS with complete TLS certificate validation configurations.
- **Node v24 and modern ES Module structure.**

---

## Directory Structure

- `src/mcp-server.ts`: Fully-typed, rate-limited MCP Server application featuring express transport and tool mappings.
- `certs/`: Holds local client and server CA keys, configurations, and scripts for secure TLS enablement.
- `tests/`: Integration tests using a mock Helix Server to validate server endpoints, authorization, and tool schemas.

---

## Registered MCP Tools

The server registers the following high-value tools:

1. **`helix_get_table_data`**: Retrieve records from any BMC Helix form (e.g., `HPD:IncidentInterface`, `CHG:Infrastructure Change`) with optional query filters and record limits.
2. **`helix_get_table_data_paginated`**: Automatically fetches and aggregates multi-page records from a form using offset-based pagination.
3. **`helix_get_ci_by_id`**: Get a configuration item's attributes from `BMC.CORE:BMC_BaseElement` by its unique entry Request ID.
4. **`helix_get_ci_by_name`**: Find CMDB records by name.
5. **`helix_get_change_request_tasks`**: Retrieves children task lists from `TMS:Task` for a given Change ID (`CRQ...`).
6. **`helix_get_problem_investigation_id`**: Finds the associated Problem ID for a given incident ticket.
7. **`helix_get_change_configuration_items`**: Finds AST configuration items associated with a Change ID.

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

## Testing

The project includes an integration test suite implemented with Node's native test runner (via `--test`). It runs against a mock BMC Helix server environment to validate:

- Server initialization & health status checks.
- API authentication and security authorization filters (e.g., verifying `MCP_AUTH_TOKEN` behavior).
- Tool definitions and structural query capability.
- Exact end-to-end flow execution for tool retrievals (`helix_get_table_data`, `helix_get_table_data_paginated`, CI queries, and Change/Problem relationships).

To execute the test suite:

```bash
npm test
```

This command will compile the TypeScript codebase into the production output directory, launch the integrated mock server, spawn the MCP Server as an isolated subprocess, and execute all validation assertions.

---

## Contributing

We welcome contributions to this project! To contribute, please make sure your commits are signed off to certify compliance with the Developer Certificate of Origin (DCO).

### Developer Certificate of Origin 1.1

DCO is a lightweight legal framework that ensures contributors have the right to submit their code under the project's open source license. By signing off your commits, you certify that you have the right to contribute the code and that it complies with the project's licensing terms.

[DCO](DCO.md)

### How to Sign Off

To certify your agreement with the DCO, add a `Signed-off-by` line to every commit message. You can do this automatically by signing off your commit with the `-s` or `--signoff` flag:

```bash
git commit -s -m "Your commit message"
```

This will append a line like the following to your commit message:

```text
Signed-off-by: Jane Doe <jane.doe@example.com>
```

---

## License

This project is licensed under the [MIT License](LICENSE).
