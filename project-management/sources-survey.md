# Sources survey (GitHub sweep)

Date: 2026-11-20. Method: `gh search repos` with several queries, the `public-apis/public-apis` catalogue (README parsed for entries marked no-auth and HTTPS), plus a look at GDELT client repos. Every candidate that looked usable was then called live; only endpoints that returned a real, parseable response were built.

**This is not exhaustive.** GitHub has far more repos than a few searches can cover, free-text repo search returned little for several queries, and catalogues are mostly niche. Treat it as a first pass and a record of decisions.

## Repos looked at

| Repo | What it is | Use |
|---|---|---|
| public-apis/public-apis (500k stars, MIT) | catalogue of free APIs | main source of candidates; about 135 no-auth HTTPS entries in news/social/open-data/science categories, most niche |
| alex9smith/gdelt-doc-api | Python client for the GDELT DOC API | its docs list the `ArtList` fields and note that the API can return JSON with illegal characters and `200` with an HTML error; used for the GDELT parser |
| gdelt/gdelt.github.io | unofficial web front end for GDELT | confirmed request parameter names and sort values (`DateDesc`, ...); no response samples |
| GDELT-API (org) | one profile README, no code | not useful; its download link goes to an unrelated personal site, so it was not followed |
| plenaryapp/awesome-rss-feeds, tuan3w/awesome-tech-rss | curated RSS/OPML lists | not built in; usable as feed lists for the `rssFeeds` input (idea: ship an optional curated pack later) |
| GeneralMills/pytrends and other Google Trends scrapers | unofficial Google Trends clients | not used: they scrape Google; Google Trends RSS is already an opt-in source |
| dev3tools/NewsAPI ("news API without any API key") | scraper-style news API | not used: unclear provenance and terms |

## Included (live-verified, no key, one request per run)

| Source | Goes to | Why |
|---|---|---|
| arXiv API | `references` (papers) + a total in `trends` | official API, Atom, good for technical and science topics |
| Stack Exchange API | `references` (questions) | official API; titles are HTML-escaped and are decoded |
| GitHub repository search | `references` (repos) + a total in `trends` | official API; strong developer-interest signal |
| Mastodon trending links (mastodon.social) | `news`, filtered to the topic | real publisher links, so pages can be fetched from them |
| Lobsters hottest | `news`, filtered to the topic | tech news links; no search endpoint, so filtered |
| GDELT DOC API | `news`, opt-in, experimental | format from the client docs only; API returned 429 every time here |

Design decision: papers, repos and questions are not news, so they go in a new `references[]` array instead of crowding `news[]`.

## Rejected after testing

| Candidate | Result | Reason |
|---|---|---|
| OpenAlex (`/works`) | 200 | without an API key all requests on one IP share a $0.10/day budget, which shared Apify IPs would exhaust. Revisit with an optional user-supplied key |
| Bluesky `searchPosts` | 403 | needs authentication |
| dev.to API | 200 | only filters by tag, so a free-text topic does not map to it |

## Known limits of the included sources

- GitHub and Stack Exchange allow few unauthenticated requests per IP (GitHub search about 10 per minute, 60 per hour for the core API; Stack Exchange about 300 per day). On a shared network they may answer 403/429; this is reported in `errors`. Optional tokens or keys would raise the limits but are not supported yet.
- Mastodon and Lobsters return a global trending list, so many topics get no matches.
- All sources are public APIs, but each has its own terms; none was legally reviewed here. Google sources remain opt-in (see risk R6).

## Not checked / future candidates

- OpenAlex and Semantic Scholar with an optional key (scholarly counts by year as a trend signal).
- Reddit (terms and rate limits make it risky), Bing and Amazon suggest endpoints (unofficial, terms unclear).
- Curated RSS packs from the awesome-rss lists.
- GDELT via BigQuery or raw files (heavier than this product needs; not verified).
