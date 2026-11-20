# Topic Research Pack

Give it a topic. Get back one JSON object with **recent news, trend signals, keyword ideas and the clean markdown text of the top articles**. Built for AI agents and RAG pipelines.

It runs three ways, all on the same core:

- **MCP server**: any MCP-capable agent can call it as a tool (`research_topic`, `research_report`, `fetch_page_markdown`, `keyword_ideas`).
- **Apify Actor**: run it on Apify, or call it from Apify's own MCP server once published.
- **CLI**: `topic-research "your topic"` for local use and debugging.

## What you get

```json
{
  "topic": "vector databases",
  "generatedAt": "2026-11-20T07:46:14.140Z",
  "overview": {
    "title": "Vector database",
    "summary": "A vector database, vector store or vector search engine is a database that stores and retrieves embeddings of data in vector space. ...",
    "url": "https://en.wikipedia.org/wiki/Vector_database",
    "source": "wikipedia"
  },
  "news": [
    {
      "title": "I tried to beat \"the fastest vector database\" on its own benchmark",
      "url": "https://kividb.io/benchmarks",
      "source": "hackernews",
      "publishedAt": "2026-11-03T22:32:20Z"
    }
  ],
  "trends": [
    { "label": "Wikipedia pageviews, last 7 days: Vector database", "value": 1311, "source": "wikipedia" },
    { "label": "Wikipedia pageviews change vs previous 7 days (%): Vector database", "value": 13.7, "source": "wikipedia" }
  ],
  "keywords": [
    { "keyword": "vector databases list", "source": "duckduckgo-suggest" },
    { "keyword": "Milvus (vector database)", "source": "wikipedia" }
  ],
  "references": [
    {
      "title": "Efficient Privacy-Preserving High-Dimensional Approximate Nearest Neighbor Search",
      "url": "https://arxiv.org/abs/2611.25374v1",
      "source": "arxiv",
      "kind": "paper",
      "publishedAt": "2026-11-19T02:13:01.000Z",
      "summary": "In the AI era, approximate nearest neighbor (ANN) search on vector databases is critical a..."
    },
    {
      "title": "milvus-io/milvus",
      "url": "https://github.com/milvus-io/milvus",
      "source": "github",
      "kind": "repo",
      "publishedAt": "2026-11-20T07:03:19Z",
      "summary": "Milvus is a high-performance, cloud-native vector database built for scalable vector ANN s..."
    }
  ],
  "pages": [
    {
      "url": "https://kividb.io/benchmarks",
      "title": "Benchmarks | KiviDB 1.2.0 against Redis, Valkey, Dragonfly and Garnet",
      "markdown": "KiviDB 1.2.0 against Redis, Redis Cluster, Valkey, Dragonfly, Garnet and kvrocks: ..."
    }
  ],
  "sourcesUsed": ["hackernews", "wikipedia", "duckduckgo-suggest", "mastodon-trends", "lobsters", "arxiv", "stackexchange", "github"],
  "errors": []
}
```

(Trimmed from a real run. Real output has more items; page text is capped per page.)

`overview` is a short neutral description of the topic (the summary of the best-matching Wikipedia article; left out for ambiguous topics such as "Mercury"). `generatedAt` is the retrieval date that citations use. `news` is for news and trending links. `references` is for things to read that are not news: research papers, code repositories and Q&A threads (`kind` is `paper`, `repo` or `question`). `trends` also carries counts such as how many arXiv papers and GitHub repositories match the topic.

One source failing never fails the run. It is listed in `errors` and the rest of the pack is still returned.

## Sources

| Source | Gives | Default |
|---|---|---|
| Hacker News (Algolia API) | news, last 30 days | on |
| Wikipedia search, summary + Wikimedia pageviews | related topics, the topic `overview`, pageview trend (7 days and change vs the 7 before) | on |
| DuckDuckGo suggestions | keyword ideas (unofficial endpoint) | on |
| Your RSS/Atom feeds | news (only items that mention the topic) | on when you pass feeds |
| Mastodon trending links (mastodon.social) | news: trending links that mention the topic | on |
| Lobsters hottest stories | news: stories that mention the topic | on |
| arXiv | `references`: recent papers, plus a count of matching papers in `trends` | on |
| Stack Exchange (Stack Overflow) | `references`: questions | on |
| GitHub repository search | `references`: repositories, plus a count of matching repositories in `trends` | on |
| Google News RSS, Google Trends RSS, Google Suggest | news, trending-now signals, keyword ideas | **off**, see [Google sources](#google-sources-off-by-default) |
| `apify/google-search-scraper` | web search results | **off**, Apify platform only, billed separately |
| GDELT DOC API | news | **off**, experimental (see below) |

All "on" sources are public, need no API key, and make one request per run. Mastodon and Lobsters publish a global "what is trending" list that cannot be queried by topic, so only entries that mention **all** words of your topic are kept (plural-insensitive); for many topics that is nothing. Your own RSS feeds use the looser rule: any word of the topic. The unauthenticated GitHub and Stack Exchange APIs have small per-IP request limits, so on a busy shared network they can answer with a rate-limit error. That is reported in `errors` and does not fail the run. Skip any source with `excludeSources` (names as they appear in `sourcesUsed`), or set `maxReferences` to 0 to turn off arXiv, Stack Exchange and GitHub together.

**GDELT is experimental.** Every request to its API from the development machine was answered with HTTP 429, so its response format could not be checked against a real response. The parser follows the documentation of a maintained client library, and any mismatch shows up as an error in `errors`, not as wrong data. Enable it with `enableGdelt` (CLI `--gdelt`, MCP server `--enable-gdelt`).

How these sources were chosen, and what was rejected and why, is in [`project-management/sources-survey.md`](project-management/sources-survey.md).

## Quick start

Requires Node 22 or later.

```bash
npm install
npm run build
```

### CLI

```bash
npx tsx src/cli.ts "ai agents"
```

```bash
npx tsx src/cli.ts "ai agents" --pages 2 --feed https://example.com/feed.xml
```

Options: `--format json|markdown` (default `json`), `--feed <url>` (repeatable), `--pages <0-10>`, `--references <0-50>`, `--exclude <name,name>`, `--no-robots`, `--google`, `--gdelt`.

`--format markdown` prints a readable brief instead of JSON:

```bash
npx tsx src/cli.ts "vector databases" --format markdown > brief.md
```

The brief has an overview, signals, news, papers/code/questions, keyword ideas and short page excerpts. Every claim carries a numbered citation, and the Sources list gives each URL with its publication date and the retrieval date. It is assembled by fixed rules, not by a language model, and it says so at the end: check the originals before quoting them.

### MCP server

Stdio (for local agents such as Claude Desktop or Claude Code). Use the absolute path to your checkout:

```bash
claude mcp add topic-research -- node /absolute/path/to/ResearcherAgent/dist/mcp-server.js
```

For clients configured with JSON:

```json
{
  "mcpServers": {
    "topic-research": {
      "command": "node",
      "args": ["/absolute/path/to/ResearcherAgent/dist/mcp-server.js"]
    }
  }
}
```

Streamable HTTP (stateless, `POST /mcp`, binds to `127.0.0.1` by default):

```bash
node dist/mcp-server.js --http --port 3000
```

Tools:

| Tool | Use it to | Notes |
|---|---|---|
| `research_report` | the same research as a ready-to-read cited markdown brief | same args as `research_topic`; returns `{ markdown }` |
| `research_topic` | get the full pack for a topic | args: `topic`, `maxNews`, `maxKeywords`, `maxReferences`, `maxPages`, `maxCharsPerPage`, `rssFeeds`, `excludeSources` |
| `fetch_page_markdown` | read one URL as clean markdown | args: `url`, `maxChars` |
| `keyword_ideas` | get keyword and related-topic ideas fast | args: `topic`, `maxKeywords`. No news, no page fetching |

All four are read-only. Safety switches are **server settings, not tool arguments**, so an agent cannot change them: `--no-robots` (stop checking robots.txt), `--enable-google` (turn on Google sources) and `--enable-gdelt` (turn on the experimental GDELT source).

### Apify Actor

Input:

| Field | Default | Meaning |
|---|---|---|
| `topic` (required) | | what to research |
| `maxNews` | 10 | news items to return (1-50) |
| `maxKeywords` | 20 | keyword ideas to return (1-100) |
| `maxReferences` | 10 | papers, repositories and questions to return (0-50, 0 turns those sources off) |
| `maxPages` | 3 | top articles to fetch as markdown (0-10, 0 turns it off) |
| `maxCharsPerPage` | 8000 | markdown is cut at this length |
| `rssFeeds` | none | extra RSS/Atom feeds |
| `excludeSources` | none | source names to skip, for example `github`, `lobsters` |
| `enableGdelt` | false | experimental GDELT news source |
| `respectRobotsTxt` | true | skip pages robots.txt disallows |
| `enableGoogleSources` | false | see below |
| `useGoogleSearchActor` | false | also call `apify/google-search-scraper` (billed to you by that Actor) |

Output: one dataset item per run, shaped as above, plus the same research as a markdown brief in the run's key-value store under the key `REPORT.md` (not billed separately). Table views for the overview, news and keywords are defined in `.actor/dataset_schema.json`.

Run locally with the Apify CLI:

```bash
npx apify-cli run --purge --input-file input.json
```

## Pricing (Apify Actor)

The Actor uses pay-per-event pricing. It charges two events, after the result is stored:

- `research-pack`: once per successful run.
- `page-markdown`: once per page returned in `pages`.

A run in which every source failed is marked failed and is **not charged**. Your maximum-cost setting is respected: the run stops if one pack does not fit, and the number of pages is capped to what you can afford.

Prices are set in Apify Console and shown on the Actor's Pricing tab. <!-- TODO before publishing: state the final prices here. -->

Turning on `useGoogleSearchActor` also runs `apify/google-search-scraper`, which is billed separately to your account.

## Compliance and limits

Please read this before using it on other people's sites.

- **robots.txt is checked by default** before every page fetch (RFC 9309 rules, including for redirect targets). A site with no robots.txt (404) is treated as open; if the file exists but cannot be fetched (server error, timeout), the page is skipped.
- **robots.txt is not permission.** Some sites forbid automated use, scraping or use for AI in their terms of use even where robots.txt allows the page. You are responsible for following the terms of the sites you read.
- **Private addresses are blocked.** Only `http` and `https` are allowed. Every address a host resolves to, and every redirect, must be public. Requests are limited by time (10 s) and size (2 MB).
- **Honest User-Agent.** Requests identify as `TopicResearchPack`.
- **Pages that need JavaScript to render** will come back mostly empty. Only the HTML the server sends is read.
- **Charset:** the `Content-Type` header is honoured; `<meta charset>` is not.

### Google sources (off by default)

Google News RSS, Google Trends RSS and Google Suggest are unofficial endpoints. **Google's terms restrict automated use, and the Google News feed states it is made available "for personal, non-commercial use" and that any other use is prohibited.** Turning these on is your decision and your responsibility: check that your use is allowed before enabling them, especially for commercial use. They are off unless you set `enableGoogleSources` (Actor, CLI `--google`) or start the MCP server with `--enable-google`. This project never scrapes Google result pages directly.

Google News links are Google redirect URLs, so they are not fetched as pages.

### HTTP transport

`--http` has no authentication. It binds to loopback and rejects other `Host` headers. Do not expose it beyond your machine without an authenticating proxy in front.

## Development

```bash
npm run check      # typecheck, lint, tests, build
npm test
npm run mcp        # MCP server from source (stdio)
npm run cli -- "topic"
```

Layout:

```
src/core/            research(), types (zod), sources/, content/ (robots + HTML to markdown), util/ (http, SSRF guard, RSS)
src/mcp/             MCP server and Streamable HTTP wrapper
src/actor/job.ts     Actor logic (testable); src/actor.ts is the thin Apify binding
src/cli.ts           CLI
.actor/              Actor definition, input and dataset schemas, Dockerfile
test/                node:test; the network is mocked with fixtures captured from real responses
project-management/  decisions, risks, progress, handoffs
```

Tests never touch the network. Fixtures in `test/fixtures/` are small real API responses captured on 2026-11-15/16 or clearly labelled synthetic files; real news pages and feeds are deliberately not committed. See `test/fixtures/README.md`. Where a sample comes from documentation instead of a live response (GDELT, the `apify/google-search-scraper` output), the test says so.

Known gaps are tracked in `project-management/risks/risks.md` (DNS rebinding in the SSRF guard, unauthenticated HTTP mode, GDELT, Google terms).

## License

MIT. See [LICENSE](LICENSE). Changes are listed in [CHANGELOG.md](CHANGELOG.md); contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md) and security reporting is in [SECURITY.md](SECURITY.md).

The license covers this project's code. It does not grant any rights to third-party data or to the terms of the sites and APIs the tool reads; see [Compliance and limits](#compliance-and-limits).
