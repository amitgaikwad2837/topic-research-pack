# Handoff: Topic Research Pack (Apify Actor + MCP server)

Written 2026-11-15 to move this work from a Claude chat session into Claude Code.
Nothing has been built yet. This file holds every decision and the plan so the next session can start coding without re-asking.

## Current Status

- **Task:** Build one tool that combines three Apify Store niches (news/trend scrapers, SEO scrapers, scrapers for RAG pipelines) into a single product.
- **Progress:** Requirements agreed, architecture planned. No code written.
- **Files modified:** None (this file only).
- **Pending work:** Everything under "Build plan".
- **Blockers:** None. The chat workspace could not install npm packages or reach the web, which is why the build is moving.
- **Next action:** Scaffold the project (step 1 of the build plan), then build the core with tests before any interface.

## What the user decided

| Question | Answer |
|---|---|
| Shape | **Topic research pack.** One input (a topic or keyword) returns trending news, keyword ideas and clean page text. Not three separate scrapers behind a mode switch. |
| Integration | **Must work as an AI agent tool that any agent can call.** Treat this as the top requirement: ship an MCP server, not only an Apify Actor. |
| Data sources | **Both, switchable.** Public feeds and APIs by default. Google sources are opt-in and off by default. |
| Language | Not chosen by the user. Plan assumes TypeScript on Node 22 (Apify's main SDK and Crawlee target it). Confirm or change at the start. |

## Why this product

Evidence from a third-party analysis of the Apify Store (not independently verified):

| Niche | Monthly users | Leader's rating | Leader's share |
|---|---|---|---|
| News and trend scrapers | 1.9K | 3.12 (31 reviews) | 51% |
| SEO and ad-intelligence scrapers | 1.3K | 1.64 (4 reviews) | 8% |
| Scrapers for RAG and LLM pipelines | 27.5K | 3.75 (24 reviews) | 100% |

Source: https://godberrystudios.com/apify-radar/opportunities

Notes:
- The RAG niche leader is "RAG Web Browser", published by Apify itself. Competing head-on is hard; the pitch here is the combined research output, not a better page fetcher.
- Apify pricing: use pay-per-event. The rental model was retired on 2026-10-01. Docs: https://docs.apify.com/actors/monetize.md

## Architecture

One dependency-light core, three thin interfaces on top.

```
src/
  core/
    research.ts        orchestrator: runResearch(input, deps) -> ResearchPack
    types.ts           input/output types, zod schemas
    sources/           one adapter per source, all return the same shape
    content/extract.ts fetch a page, check robots.txt, HTML -> markdown
    util/http.ts       fetch wrapper: timeout, retries, size cap, SSRF guard
    util/rss.ts        RSS/Atom parsing
    util/robots.ts
  actor.ts             Apify Actor entry (batch run, pushes to dataset)
  mcp-server.ts        MCP server: stdio and Streamable HTTP
  cli.ts               local runs and debugging
test/                  node:test, network fully mocked with fixtures
.actor/                actor.json, input_schema.json, Dockerfile
```

Design rules:
- Every source adapter fails soft. One source failing must not fail the run; record it in `errors[]` in the output.
- The core takes `fetch` as an injected dependency so tests never touch the network.
- Output is one JSON object: `topic`, `news[]`, `trends[]`, `keywords[]`, `pages[]` (markdown), `sourcesUsed[]`, `errors[]`.

### Sources

Endpoints below are from memory and were **not** checked against live responses. Verify each one, and save a real response as the test fixture, before writing its parser.

Public (on by default):
- GDELT DOC 2.0 API: global news articles for a query
- Hacker News search (Algolia API): recent stories
- Wikipedia: related topics, plus the Wikimedia pageviews API as a trend signal
- User-supplied RSS/Atom feeds
- DuckDuckGo autocomplete for keyword ideas (unofficial endpoint)

Google (opt-in, `enableGoogleSources: true`):
- Google News RSS search
- Google Trends daily trending RSS
- Google Suggest for keyword ideas (unofficial endpoint)
- Search results: do not scrape Google directly. On Apify, call the existing `apify/google-search-scraper` Actor via `Actor.call` and read its dataset. Verify its input and output fields first.

### Interfaces

- **MCP server** (the "any agent" requirement): tools `research_topic`, `fetch_page_markdown`, `keyword_ideas`. Use the official `@modelcontextprotocol/sdk`. Check the current SDK docs before coding; do not rely on memory of its API.
- **Apify Actor:** same core, input from `.actor/input_schema.json`, results to the default dataset. Once published, Apify's hosted MCP server also exposes it as a tool.
- **CLI:** `topic-research "<topic>" --json` for local testing.

## Requirements that must not be skipped

Security (an agent will pass in arbitrary URLs):
- SSRF guard: allow only http/https, resolve DNS and block private, loopback and link-local ranges, re-check after redirects.
- Response size cap and timeout on every request.
- Validate all input with zod. No secrets in logs or output.

Compliance:
- Respect robots.txt by default when fetching pages for `pages[]`.
- Google sources stay off unless the caller turns them on, and the README must say that scraping Google's pages is against Google's terms.
- Identify with an honest User-Agent.

Quality:
- Tests for every adapter, the orchestrator, the SSRF guard and the HTML-to-markdown step.
- Build, lint and tests must pass before anything is called done.

## Build plan

1. Scaffold: `package.json`, `tsconfig.json`, lint, test runner, `project-management/` folders (context, decisions, progress, tasks, risks, handoffs).
2. `util/http.ts` with SSRF guard and tests.
3. One public source end to end (Hacker News is the simplest) to prove the adapter shape.
4. Remaining public sources, each with a fixture captured from a real response.
5. `content/extract.ts` (robots check, HTML to markdown).
6. Orchestrator and output schema.
7. MCP server, tested with a real MCP client.
8. Apify Actor wrapper, `.actor/` files, local run with the Apify CLI.
9. Google opt-in sources.
10. README, pricing events, store listing text.

## Out of scope for version 1

- Ad intelligence (for example the Meta Ad Library). It needs an access token and was not designed. Add later as an optional source.
- Any direct scraping of Google search result pages.

## Open questions for the user

- Confirm TypeScript, or switch to Python.
- Is there an Apify account to publish under, and should the first release be free or paid?
- Which agents matter most for testing the MCP server (Claude, others)?

## Suggested first prompt in Claude Code

> Read HANDOFF.md. Confirm the open questions with me, then start at step 1 of the build plan. Verify each external endpoint against a live response before writing its parser.
