# 0001 Stack: TypeScript on Node 22+

Date: 2026-11-15. Status: accepted.

- TypeScript: Apify SDK, Crawlee and the MCP SDK are TypeScript-first, and one language covers the core, Actor, MCP server and CLI.
- Tests use `node:test` via `tsx`, with `fetch` injected so no test touches the network.
- No hosted API in v1. The Actor runs on Apify and the MCP server runs over stdio (or via Apify's hosted MCP).
- Pricing: pay-per-event only (Apify retired rental in 2026). Unverified: pay-per-result status.
- Google sources stay opt-in and off by default.

## Actor billing (2026-11-16)

- Events live in Apify Console, not in the repo. Code charges `research-pack` (once per successful run) and `page-markdown` (once per page returned).
- `Actor.pushData` is called without an event name so nothing is billed implicitly; remove `apify-default-dataset-item` in Console.
- A run where every source failed is not charged and is marked failed.

## Google sources (2026-11-16, owner decision)

Keep Google News RSS, Trends RSS and Suggest in the product, OFF by default (`enableGoogleSources: false`). Never exposed to agents as a tool argument; the MCP operator enables them with `--enable-google`.
Known conflict: the Google News feed states it is for personal, non-commercial use (risk R6). Accepted on the condition that the README, the Actor input description and the store listing all say so plainly, and that the operator who turns it on is responsible for compliance.
