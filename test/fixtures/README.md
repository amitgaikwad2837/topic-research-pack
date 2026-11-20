# Test fixtures

Tests never use the network; they read these files instead.

## Captured API responses (real)

Small responses from public APIs, captured on 2026-11-15/16 so the parsers are built against real formats: Hacker News (Algolia), Wikipedia search, Wikimedia pageviews, DuckDuckGo suggestions, Google Suggest, arXiv, Stack Exchange, GitHub repository search, Mastodon trending links and Lobsters.

The data in them belongs to its original owners. It is included only as small excerpts for testing. Stack Exchange titles are CC BY-SA, Wikipedia text is CC BY-SA 4.0, and arXiv metadata is public.

## Synthetic (invented)

All content is made up, with the structure of real responses that were checked while writing the parsers. They are produced by `generate-synthetic.mjs` (`node test/fixtures/generate-synthetic.mjs`):

| File | Mirrors |
|---|---|
| `feed-rss.xml` | an RSS 2.0 news feed with CDATA titles and namespaces |
| `feed-atom.xml` | an Atom 1.0 feed with alternate links |
| `google-news.xml` | the Google News RSS search format (`<source>` tags, redirect-style links) |
| `google-trends.xml` | the Google Trends daily RSS format (`ht:` tags) |
| `page-article.html` | a news article page surrounded by navigation, scripts and ads |
| `robots-sample.txt` | a robots.txt with a default group and named crawler groups |

Real pages and feeds from news publishers are deliberately not committed.

`page-example.html` is the tiny page served by example.com (reserved for documentation use).

## Not captured

No real GDELT response is included: every request to that API was rate limited. The GDELT tests use an inline sample built from a client library's documentation and say so.
