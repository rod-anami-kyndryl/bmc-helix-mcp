# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-07-15

- Fixed `server.json` that had a nasty GitHub repository address typo in the `repository` field.

## [0.1.0] - 2026-07-15

### Added

- **MCP Server for BMC Helix ITSM REST API:** Initial release supporting the Model Context Protocol (MCP) to interface with LLMs and coding assistants.
- **BMC Helix High-Value Tools:** Added custom-mapped, rate-limited MCP tools:
  - `helix_get_table_data`: Fetches record data from arbitrary BMC Helix forms with custom filtering/limiting.
  - `helix_get_table_data_paginated`: Handles automatic offset-based pagination.
  - `helix_get_ci_by_id`: Fetches configuration items (CIs) from `BMC CORE:BMC_BaseElement` by entry ID.
  - `helix_get_ci_by_name`: Finds CMDB CIs matching a given name.
  - `helix_get_change_request_tasks`: Fetches children tasks from `TMS:Task` for a given Change ID.
  - `helix_get_problem_investigation_id`: Finds associated Problem ID for an Incident ticket.
  - `helix_get_change_configuration_items`: Finds associated configuration items for a Change ID.
- **Express & HTTPS Support:** Implemented dual transport support for HTTP and secure HTTPS with TLS/CA certificate configurations.
- **Automated TLS setup helper:** Added `certs/helix-certs.sh` script to streamline importing customer/internal CA certificate chains from remote Helix services.
- **Integration Test Suite:** Built a comprehensive integration test suite utilizing Node's native test runner (`--test`) against a mock Helix Server.
- **DCO Configuration:** Integrated Developer Certificate of Origin (DCO) sign-off policy for secure and compliant open-source contributions.

## End
