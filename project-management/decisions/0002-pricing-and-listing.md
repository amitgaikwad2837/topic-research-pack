# 0002 Pricing and store listing (PROPOSAL, owner decides)

Date: 2026-11-16. Status: proposed. Nothing here has been set in Apify Console.

## Events (names are fixed by the code)

| Event | Charged | Proposed price (USD) |
|---|---|---|
| `research-pack` | once per successful run | 0.02 |
| `page-markdown` | once per page returned | 0.005 |
| `apify-actor-start` | automatic, compute for first 5 s | leave at the platform default |
| `apify-default-dataset-item` | must be REMOVED in Console, or each run is billed twice | n/a |

A default run (3 pages) would cost about $0.035. A pages-off run costs $0.02.

## Reasoning and what is not known

- Reference point: competing Google Trends scrapers on the Store list around $1.50 per 1,000 keywords ($0.0015 each). One pack bundles news, trends, about 20 keywords and page text, so $0.02 to $0.04 is in a plausible range. This is a judgement, not market research.
- Our own compute cost per run has NOT been measured on the platform. Locally a run takes a few seconds at a few hundred MB, which should be a very small fraction of a cent. Measure a real Apify run before fixing prices.
- Apify's docs state profit is `0.8 * revenue - platform costs`. Memory is capped at 1024 MB in `actor.json` to bound cost.
- Changing a pricing model is a "significant change": 14 days' notice, once per month per Actor. Pick the first prices carefully.
- Pay-per-result was described as deprecated on one preview docs page and as supported by a third-party guide; unresolved, so do not use it.
- Apify's built-in `apify-actor-start` charge is automatic. Do not charge it manually.

## Publishing checklist (Console, cannot be done from this repo)

1. Apify account, accept the Store Publishing Terms.
2. Build and run the Actor once on the platform (not done: only local `apify run` and a local Docker build so far).
3. Logo and display information (text in `project-management/store-listing.md`).
4. Monetization: create the two events above with titles and prices; remove `apify-default-dataset-item`.
5. Sample output (taken from the input schema prefill or a first run) and the dataset schema (done in `.actor/dataset_schema.json`).
6. Actor permissions: this Actor needs **limited** permissions only (own storages; calling `apify/google-search-scraper` is a user-opted run billed to the caller). Confirm the level Console proposes.
7. Identity verification only if Console requires it.
8. Fill the README pricing placeholder (`<!-- TODO -->` in README.md) with the final prices.
9. Decide whether to publish source code (hidden by default).
