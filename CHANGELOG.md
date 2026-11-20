# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-11-20

First version.

### Added
- `research()` core: one topic in, one JSON pack out (`news`, `trends`, `keywords`, `references`, `pages`, `sourcesUsed`, `errors`). A failing source never fails the run.
- Sources, all public and keyless: Hacker News, Wikipedia (search and pageviews), DuckDuckGo suggestions, user RSS/Atom feeds, Mastodon trending links, Lobsters, arXiv, Stack Exchange, GitHub repository search.
- Opt-in sources: Google News RSS, Google Trends RSS, Google Suggest, search results through `apify/google-search-scraper` (Apify platform only), and an experimental GDELT source.
- Page text as markdown: robots.txt checking (RFC 9309), HTML to markdown with Readability, per-page size cap.
- Safety: SSRF guard (public addresses only, re-checked on every redirect), request timeout, response size cap, honest User-Agent.
- MCP server (stdio and stateless Streamable HTTP) with tools `research_topic`, `fetch_page_markdown` and `keyword_ideas`. Safety switches are server settings, not tool arguments.
- Apify Actor: input and dataset schemas, pay-per-event billing (`research-pack`, `page-markdown`), spending-limit handling, Dockerfile.
- CLI: `topic-research "<topic>"`.
- Inputs `maxReferences`, `excludeSources`, `enableGoogleSources`, `useGoogleSearchActor`, `enableGdelt`.

### Known gaps
- DNS rebinding is not fully closed in the SSRF guard (see `project-management/risks/risks.md`).
- The HTTP transport has no authentication; bind it to loopback only.
- GDELT could not be verified against a live response.
- The Google News feed states it is for personal, non-commercial use; Google sources are off by default.
