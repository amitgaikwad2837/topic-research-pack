# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting: on the repository page choose **Security**, then **Report a vulnerability**.

Include what you found, how to reproduce it, and the version. You should get a reply within a few days.

## What is in scope

This tool fetches URLs that callers (including AI agents) supply, so the most relevant areas are:

- The SSRF guard (`src/core/util/ssrf.ts`) and the HTTP client (`src/core/util/http.ts`).
- robots.txt handling (`src/core/util/robots.ts`).
- The MCP server and its HTTP transport (`src/mcp/`).

Known gaps are listed in `project-management/risks/risks.md` (for example DNS rebinding in the SSRF guard and the unauthenticated HTTP transport). A report that adds detail to one of them is still welcome.
