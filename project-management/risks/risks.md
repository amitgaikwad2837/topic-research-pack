# Risks

## R1: DNS rebinding gap in the SSRF guard (open)

`assertSafeUrl` resolves the hostname and checks every address, but `fetch` then resolves the name again to connect.
A hostile DNS server could return a public address for the check and a private one for the connection.

Mitigation options, before exposing the MCP server to untrusted callers:
- Use `undici` with a custom `connect.lookup` that rejects blocked addresses at connect time.
- Or run the Actor/MCP server in a network with no route to private ranges.

Redirects are already re-validated on every hop. Non-default ports are allowed.

## R2: Unverified endpoints (open)

All source endpoints in the handoff come from memory. Verify each against a live response and save it as a fixture before writing its parser.

## R3: Response charset (open)

`safeGet` decodes as UTF-8 only. Pages in other encodings will show replacement characters. Revisit in step 5 (content extraction).

## R4: GDELT unverified and rate limited (open)

GDELT DOC 2.0 answered every request from this machine with HTTP 429 (limit: one request per 5 seconds), including calls several minutes apart, so no real response was captured.
No GDELT parser has been written, to avoid guessing the response shape.
When retrying: capture one `mode=ArtList&format=json` response as `test/fixtures/gdelt-artlist.json`, then build the adapter.
At runtime the adapter must make at most one GDELT call per run and treat 429 as a soft failure.

## R5: HTTP transport has no authentication (open)

`--http` binds to 127.0.0.1 and rejects non-loopback Host headers, which is safe for local use. If it is bound elsewhere there is no auth, rate limit or quota, and anyone who can reach it can make the server fetch public URLs.
Before any hosted deployment, put an authenticating proxy in front, or use Apify's hosted MCP (which handles auth and billing).

## R6: Google sources and Google's terms (accepted by owner 2026-11-16: keep, off by default; warnings required)

Verified live on 2026-11-16: the Google News RSS feed carries this notice: "made available solely for the purpose of rendering Google News results within a personal feed reader for personal, non-commercial use. Any other use of the feed is expressly prohibited."
A paid Actor is commercial use, so shipping Google News RSS in a monetised product conflicts with that notice, even though it is opt-in and off by default.
Google Trends RSS and Google Suggest are unofficial endpoints with no published terms we have checked.
Options: (a) ship Google sources off by default with a clear README warning (current state); (b) ship them only in the free/MCP/open-source build, not the paid Actor; (c) drop Google News RSS and keep only the apify/google-search-scraper route, which is a separate paid Actor that carries its own compliance.

### R4 update (2026-11-16, retry)

Retried twice more on the same day, hours after the first attempts, once with the project User-Agent and once with curl's default: both HTTP 429 with the same "one request every 5 seconds" text. Since these were single requests spaced far apart, this looks like a throttle on this machine's network address (shared or NAT), not on our request rate.
Next try: run the one command below from a different network (for example a phone hotspot) and save the result as `test/fixtures/gdelt-artlist.json`; if it is JSON, build the adapter from it.

    curl -sS -A "TopicResearchPack/0.1 (research tool)" -o test/fixtures/gdelt-artlist.json "https://api.gdeltproject.org/api/v2/doc/doc?query=ai%20agents&mode=ArtList&format=json&maxrecords=5&timespan=7d"

R4 note (2026-11-16): https://github.com/gdelt/gdelt.github.io is an unofficial MIT-licensed web front end for the GDELT APIs, not documentation. It confirms the DOC API request parameter names (`query`, `timespan`, `maxrecords`, `sort`, `startdatetime`/`enddatetime` as YYYYMMDDHHmmss, `sourcelang`, `sourcecountry`, `format`) and the `ArtList` mode. Its sort values are DateDesc, DateAsc, ToneDesc, ToneAsc (no `hybridrel`), so the retry command now omits `sort`. It does NOT show the JSON response shape (it never parses ArtList results), so a real response is still needed before writing a parser.

### R4 update (2026-11-20)

GDELT is now built as an EXPERIMENTAL opt-in source (`enableGdelt`, default off) using the response format documented by the gdelt-doc-api client, because a live response still could not be captured (HTTP 429 from this network). Its tests use a labelled client-derived sample, not a real fixture. To close R4: capture one real response as `test/fixtures/gdelt-artlist.json`, switch the tests to it, then consider turning it on by default.

## R7: Unauthenticated GitHub and Stack Exchange limits (open)

Both new reference sources use no key. Per-IP limits are small (GitHub search about 10 requests per minute; Stack Exchange about 300 per day), so busy shared IPs, including Apify's, may get 403/429. These are soft errors in `errors[]` and `excludeSources` can switch them off. Supporting an optional token/key (via Actor secret input or env var) would remove most of the risk.
