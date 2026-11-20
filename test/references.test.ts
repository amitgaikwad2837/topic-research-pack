import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { research } from "../src/core/index.js";
import { mergeDated, mergeReferences, runResearch } from "../src/core/research.js";
import {
  buildArxivUrl,
  buildGithubUrl,
  buildStackExchangeUrl,
  parseArxiv,
  parseGithub,
  parseStackExchange,
} from "../src/core/sources/references.js";
import { parseLobsters, parseMastodonTrends } from "../src/core/sources/trending.js";
import { buildGdeltUrl, gdeltSource, parseGdelt, parseGdeltBody, parseSeenDate } from "../src/core/sources/gdelt.js";
import { collapseWhitespace, decodeEntities, truncate } from "../src/core/util/text.js";
import { ResearchPackSchema, type Deps, type ReferenceItem } from "../src/core/types.js";

const raw = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const json = (name: string): unknown => JSON.parse(raw(name));
const lookup = async () => ["93.184.216.34"];

function fakeDeps(extra: Array<[string, () => Response]> = []): { deps: Deps; calls: string[] } {
  const routes: Array<[string, () => Response]> = [
    ...extra,
    ["https://hn.algolia.com/", () => new Response(raw("hn-search.json"))],
    ["https://en.wikipedia.org/w/api.php", () => new Response(raw("wiki-search.json"))],
    ["https://wikimedia.org/", () => new Response(raw("wiki-pageviews.json"))],
    ["https://duckduckgo.com/ac/", () => new Response(raw("ddg-ac.json"))],
    ["https://export.arxiv.org/", () => new Response(raw("arxiv.xml"))],
    ["https://api.stackexchange.com/", () => new Response(raw("stackexchange.json"))],
    ["https://api.github.com/", () => new Response(raw("github-repos.json"))],
    ["https://mastodon.social/", () => new Response(raw("mastodon-trends.json"))],
    ["https://lobste.rs/", () => new Response(raw("lobsters.json"))],
  ];
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = routes.find(([p]) => url.startsWith(p));
    return hit ? hit[1]() : new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  return { deps: { fetch: fn, lookup }, calls };
}

// ---- text helpers ----

test("text helpers: entities, whitespace and truncation", () => {
  assert.equal(decodeEntities("Is there a user&#39;s &quot;API&quot; &amp; more &lt;b&gt; &#x41;"), `Is there a user's "API" & more <b> A`);
  assert.equal(decodeEntities("&unknown; &#99999999999;"), "&unknown; &#99999999999;");
  assert.equal(collapseWhitespace("  a\n   b\t c "), "a b c");
  assert.equal(truncate("abcdef", 4), "abc…");
  assert.equal(truncate("abc", 4), "abc");
});

// ---- arXiv ----

test("arxiv: parses the live Atom fixture into papers and a total", () => {
  const { papers, total } = parseArxiv(raw("arxiv.xml"));
  assert.equal(papers.length, 5);
  assert.equal(total, 4602);
  const p = papers[0]!;
  assert.equal(p.title, "Who are you? The Personal Imitation Game");
  assert.equal(p.kind, "paper");
  assert.equal(p.source, "arxiv");
  assert.equal(p.url, "https://arxiv.org/abs/2611.24888v1");
  assert.equal(p.publishedAt, "2026-11-18T18:32:14.000Z");
  assert.ok((p.summary ?? "").length <= 280 && (p.summary ?? "").startsWith("Large Language Models"));
  assert.ok(papers.every((x) => !/\n/.test(x.title)));
});

test("arxiv: the url makes a phrase query and strips quotes the caller typed", () => {
  const url = new URL(buildArxivUrl('say "hello" world', 7));
  assert.equal(url.searchParams.get("search_query"), "all:\"say  hello  world\"");
  assert.equal(url.searchParams.get("max_results"), "7");
  assert.equal(url.searchParams.get("sortBy"), "submittedDate");
});

// ---- Stack Exchange ----

test("stackexchange: parses the live fixture and decodes HTML entities in titles", () => {
  const items = parseStackExchange(json("stackexchange.json"));
  assert.equal(items.length, 5);
  assert.ok(items.every((i) => i.kind === "question" && i.url.startsWith("https://stackoverflow.com/")));
  assert.ok(items.every((i) => !/&#\d+;|&quot;|&amp;/.test(i.title)), "titles are decoded");
  assert.ok(items.every((i) => /^\d{4}-\d{2}-\d{2}T/.test(i.publishedAt ?? "")));
  assert.ok(buildStackExchangeUrl("a b", 5).includes("site=stackoverflow"));
  assert.throws(() => parseStackExchange({ nope: 1 }));
});

// ---- GitHub ----

test("github: parses the live fixture into repos and a total", () => {
  const { repos, total } = parseGithub(json("github-repos.json"));
  assert.equal(repos.length, 5);
  assert.ok((total ?? 0) > 1000);
  assert.ok(repos.every((r) => r.kind === "repo" && r.url.startsWith("https://github.com/")));
  assert.ok(repos.every((r) => r.title.includes("/")));
  assert.ok(repos.every((r) => (r.summary ?? "").length <= 280));
  assert.equal(new URL(buildGithubUrl("ai agents", 5)).searchParams.get("q"), "ai agents");
});

test("github: tolerates null descriptions and dates", () => {
  const { repos } = parseGithub({ items: [{ full_name: "a/b", html_url: "https://github.com/a/b", description: null, pushed_at: null }] });
  assert.deepEqual(repos, [{ title: "a/b", url: "https://github.com/a/b", source: "github", kind: "repo" }]);
});

// ---- Mastodon and Lobsters ----

test("mastodon: keeps only trending links that mention the topic", () => {
  const all = json("mastodon-trends.json") as Array<{ title: string }>;
  const topic = all[0]!.title.split(" ").find((w) => w.length > 5)!;
  const hits = parseMastodonTrends(all, topic);
  assert.ok(hits.length >= 1);
  assert.ok(hits.every((h) => h.url.startsWith("http") && h.source.length > 0));
  assert.deepEqual(parseMastodonTrends(all, "zzzz nothing matches"), []);
});

test("lobsters: keeps only stories that mention the topic, with ISO dates", () => {
  const all = json("lobsters.json") as Array<{ title: string }>;
  const topic = all[0]!.title.split(" ").find((w) => w.length > 5)!;
  const hits = parseLobsters(all, topic);
  assert.ok(hits.length >= 1);
  assert.ok(hits.every((h) => h.source === "lobsters" && /^\d{4}-\d{2}-\d{2}T/.test(h.publishedAt ?? "")));
  assert.deepEqual(parseLobsters(all, "zzzz nothing matches"), []);
});

test("lobsters: a text post without a url falls back to its comments page", () => {
  const out = parseLobsters(
    [{ title: "Ask about rust", url: "", comments_url: "https://lobste.rs/s/x/ask", created_at: "2026-11-01T10:00:00.000-06:00", tags: ["rust"] }],
    "rust",
  );
  assert.equal(out[0]?.url, "https://lobste.rs/s/x/ask");
  assert.equal(out[0]?.publishedAt, "2026-11-01T16:00:00.000Z");
});

// ---- GDELT (format from the gdelt-doc-api client docs, NOT a live response) ----

const gdeltSample = {
  articles: [
    {
      url: "https://news.example/a",
      url_mobile: "",
      title: "Story A",
      seendate: "20261115T120000Z",
      socialimage: "https://img.example/a.jpg",
      domain: "news.example",
      language: "English",
      sourcecountry: "United States",
    },
    { url: "https://news.example/a", title: "Dupe" },
    { url: "https://news.example/b", title: "  " },
    { url: "https://other.example/c", title: "Story C" },
  ],
};

test("gdelt: parses the documented format, skips duplicates and blank titles", () => {
  const items = parseGdelt(gdeltSample);
  assert.deepEqual(items, [
    { title: "Story A", url: "https://news.example/a", source: "news.example", publishedAt: "2026-11-15T12:00:00.000Z" },
    { title: "Story C", url: "https://other.example/c", source: "gdelt" },
  ]);
  assert.deepEqual(parseGdelt({}), []);
  assert.equal(parseSeenDate("not a date"), undefined);
});

test("gdelt: rate-limit text and HTML errors become readable errors; control characters are tolerated", () => {
  assert.throws(() => parseGdeltBody("Please limit requests to one every 5 seconds or contact ..."), /did not return JSON: Please limit requests/);
  assert.throws(() => parseGdeltBody("<html>Your query was too short</html>"), /did not return JSON/);
  const withControl = `{"articles":[{"url":"https://x.example/1","title":"bad\u0001char"}]}`;
  assert.equal((parseGdelt(parseGdeltBody(withControl))[0]?.title ?? "").startsWith("bad"), true);
});

test("gdelt: the request uses verified parameter names and sort value", () => {
  const u = new URL(buildGdeltUrl("ai agents", 500));
  assert.equal(u.searchParams.get("mode"), "ArtList");
  assert.equal(u.searchParams.get("format"), "json");
  assert.equal(u.searchParams.get("sort"), "DateDesc");
  assert.equal(u.searchParams.get("maxrecords"), "250");
});

test("gdelt: off by default; when on, a 429 is reported as an error and does not fail the run", async () => {
  const { deps, calls } = fakeDeps([["https://api.gdeltproject.org/", () => new Response("Please limit requests", { status: 429 })]]);
  const off = await research({ topic: "ai agents", maxPages: 0 }, deps);
  assert.ok(!calls.some((c) => c.includes("gdeltproject")));
  assert.ok(!off.sourcesUsed.includes("gdelt"));

  const on = await research({ topic: "ai agents", maxPages: 0, enableGdelt: true }, deps);
  assert.ok(on.errors.some((e) => e.source === "gdelt" && /429/.test(e.message)));
  assert.ok(on.sourcesUsed.includes("hackernews"));

  const ok = fakeDeps([["https://api.gdeltproject.org/", () => new Response(JSON.stringify(gdeltSample), { headers: { "content-type": "application/json" } })]]);
  const pack = await runResearch({ topic: "ai agents", maxPages: 0, enableGdelt: true }, ok.deps, [gdeltSource]);
  assert.equal(pack.news.length, 2);
});

// ---- merging references ----

test("mergeDated / mergeReferences: fair share across sources, de-duplicated, newest first", () => {
  const ref = (n: string, source: string, d?: string): ReferenceItem => ({
    title: n,
    url: `https://${source}.example/${n}`,
    source,
    kind: "repo",
    ...(d && { publishedAt: d }),
  });
  const gh = ["g1", "g2", "g3", "g4"].map((n, i) => ref(n, "gh", `2026-11-1${i}T00:00:00Z`));
  const ax = [ref("a1", "ax", "2026-11-01T00:00:00Z"), ref("a2", "ax", "2026-11-02T00:00:00Z")];
  const out = mergeReferences([gh, ax], 4);
  assert.equal(out.length, 4);
  assert.equal(out.filter((r) => r.source === "ax").length, 2);
  assert.deepEqual(out.map((r) => r.publishedAt), [...out.map((r) => r.publishedAt)].sort().reverse());
  assert.equal(mergeDated([[{ url: "https://x.example/1" }], [{ url: "https://x.example/1/" }]], 5).length, 1);
});

// ---- the whole pipeline with the new sources ----

test("research(): references, trends and news from all default sources, valid against the schema", async () => {
  const { deps } = fakeDeps();
  const pack = await research({ topic: "ai agents", maxPages: 0 }, deps);
  assert.ok(ResearchPackSchema.safeParse(pack).success);
  for (const s of ["arxiv", "stackexchange", "github", "mastodon-trends", "lobsters"]) {
    assert.ok(pack.sourcesUsed.includes(s), `${s} used`);
  }
  assert.equal(pack.errors.length, 0, JSON.stringify(pack.errors));
  assert.equal(pack.references.length, 10);
  assert.deepEqual([...new Set(pack.references.map((r) => r.kind))].sort(), ["paper", "question", "repo"]);
  assert.ok(pack.trends.some((t) => t.source === "arxiv") && pack.trends.some((t) => t.source === "github"));
  // References never leak into news.
  assert.ok(pack.news.every((n) => !["arxiv", "github", "stackexchange"].includes(n.source)));
});

test("maxReferences 0 turns the three reference sources off (no requests are made)", async () => {
  const { deps, calls } = fakeDeps();
  const pack = await research({ topic: "ai agents", maxPages: 0, maxReferences: 0 }, deps);
  assert.deepEqual(pack.references, []);
  assert.ok(!calls.some((c) => /arxiv|stackexchange|api\.github/.test(c)));
});

test("excludeSources skips a source by name, case-insensitively, without a request", async () => {
  const { deps, calls } = fakeDeps();
  const pack = await research({ topic: "ai agents", maxPages: 0, excludeSources: ["GitHub", "lobsters"] }, deps);
  assert.ok(!pack.sourcesUsed.includes("github") && !pack.sourcesUsed.includes("lobsters"));
  assert.ok(!calls.some((c) => /api\.github|lobste\.rs/.test(c)));
  assert.ok(pack.sourcesUsed.includes("arxiv"));
});

test("a rate-limited GitHub is a soft error and the other references still arrive", async () => {
  const { deps } = fakeDeps([["https://api.github.com/", () => new Response("rate limit", { status: 403 })]]);
  const pack = await research({ topic: "ai agents", maxPages: 0 }, deps);
  assert.ok(pack.errors.some((e) => e.source === "github"));
  assert.ok(pack.references.some((r) => r.source === "arxiv"));
});
