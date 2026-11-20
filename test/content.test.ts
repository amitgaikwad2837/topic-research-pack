import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fetchPageMarkdown,
  htmlToMarkdown,
  NotHtmlError,
  RobotsDisallowedError,
} from "../src/core/content/extract.js";
import { parseRobots, RobotsChecker } from "../src/core/util/robots.js";
import { decodeBody } from "../src/core/util/http.js";

const raw = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const lookup = async () => ["93.184.216.34"];

function router(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    return key ? routes[key]!() : new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}
const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

// ---- robots.txt parsing ----

test("robots: * group, longest match wins, Allow wins ties", () => {
  const r = parseRobots(`User-agent: *\nDisallow: /private/\nAllow: /private/public/\nDisallow: /tie\nAllow: /tie`);
  assert.equal(r.isAllowed("/"), true);
  assert.equal(r.isAllowed("/private/x"), false);
  assert.equal(r.isAllowed("/private/public/x"), true);
  assert.equal(r.isAllowed("/tie"), true);
});

test("robots: wildcard and end anchors", () => {
  const r = parseRobots(`User-agent: *\nDisallow: /*.pdf$\nDisallow: /a*/b`);
  assert.equal(r.isAllowed("/doc.pdf"), false);
  assert.equal(r.isAllowed("/doc.pdf?x=1"), true);
  assert.equal(r.isAllowed("/axx/b"), false);
  assert.equal(r.isAllowed("/doc.html"), true);
});

test("robots: our own group beats *, and an empty Disallow allows everything", () => {
  const txt = `User-agent: *\nDisallow: /\n\nUser-agent: TopicResearchPack\nDisallow:\n`;
  assert.equal(parseRobots(txt).isAllowed("/anything"), true);
  const blocked = `User-agent: *\nDisallow:\n\nUser-agent: topicresearchpack\nDisallow: /`;
  assert.equal(parseRobots(blocked).isAllowed("/anything"), false);
});

test("robots: stacked user-agent lines share one group; comments are ignored", () => {
  const r = parseRobots(`User-agent: bot-a\nUser-agent: TopicResearchPack # us\nDisallow: /x # no\n`);
  assert.equal(r.isAllowed("/x"), false);
  assert.equal(r.isAllowed("/y"), true);
});

test("robots: no matching group means allowed; /robots.txt is always allowed", () => {
  const r = parseRobots(`User-agent: Googlebot\nDisallow: /`);
  assert.equal(r.isAllowed("/page"), true);
  assert.equal(parseRobots(`User-agent: *\nDisallow: /`).isAllowed("/robots.txt"), true);
});

test("robots: a realistic file (default group plus named crawler groups) is applied correctly", () => {
  const r = parseRobots(raw("robots-sample.txt"));
  assert.equal(r.isAllowed("/news/articles/example-story"), true);
  assert.equal(r.isAllowed("/asset/something"), false);
  assert.equal(r.isAllowed("/search"), false); // "$" anchors the end
  assert.equal(r.isAllowed("/search/more"), true);
  // Named crawlers get their own groups; ours has none, so the * group applies to us.
  const claude = parseRobots(raw("robots-sample.txt"), "ClaudeBot");
  assert.equal(claude.isAllowed("/news/articles/example-story"), false);
  // Stacked user-agent lines share one group.
  assert.equal(parseRobots(raw("robots-sample.txt"), "PerplexityBot").isAllowed("/news/x"), false);
  assert.equal(parseRobots(raw("robots-sample.txt"), "CCBot").isAllowed("/news/x"), false);
});

// ---- robots.txt fetching ----

test("robots checker: caches per origin and applies the rules", async () => {
  const f = router({ "https://a.example/robots.txt": () => new Response("User-agent: *\nDisallow: /no") });
  const rc = new RobotsChecker({ fetch: f.fetch, lookup });
  assert.equal(await rc.isAllowed("https://a.example/yes"), true);
  assert.equal(await rc.isAllowed("https://a.example/no/1"), false);
  assert.equal(f.calls.length, 1);
});

test("robots checker: a missing robots.txt (404) allows everything", async () => {
  const f = router({});
  const rc = new RobotsChecker({ fetch: f.fetch, lookup });
  assert.equal(await rc.isAllowed("https://a.example/anything"), true);
});

test("robots checker: an unreachable robots.txt (503) disallows everything", async () => {
  const f = router({ "https://a.example/robots.txt": () => new Response("down", { status: 503 }) });
  const rc = new RobotsChecker({ fetch: f.fetch, lookup });
  assert.equal(await rc.isAllowed("https://a.example/page"), false);
});

// ---- charset ----

test("decodeBody honours the charset header and falls back to UTF-8", () => {
  const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in latin1
  assert.equal(decodeBody(latin1, "text/html; charset=iso-8859-1"), "café");
  assert.equal(decodeBody(new TextEncoder().encode("café"), "text/html"), "café");
  assert.equal(decodeBody(new TextEncoder().encode("ok"), "text/html; charset=bogus-label"), "ok");
});

// ---- HTML to markdown ----

test("htmlToMarkdown: the tiny live example.com page", () => {
  const { title, markdown } = htmlToMarkdown(raw("page-example.html"), "https://example.com/");
  assert.equal(title, "Example Domain");
  assert.match(markdown, /This domain is for use in documentation examples/);
  assert.doesNotMatch(markdown, /color-scheme|<script|s\.js/);
});

test("htmlToMarkdown: a news-style page keeps the article and drops scripts, styles, nav and markup", () => {
  const { title, markdown } = htmlToMarkdown(raw("page-article.html"), "https://news.example.com/articles/a1");
  assert.match(title ?? "", /Nvidia/);
  assert.ok(markdown.length > 1000, `markdown too short: ${markdown.length}`);
  assert.match(markdown, /Nvidia/);
  assert.match(markdown, /\[our chip coverage\]\(https:\/\/news\.example\.com\/technology\/chips\)/);
  assert.doesNotMatch(markdown, /<script|<style|<div|window\.__|Advertisement|__INITIAL_STATE__/);
});

test("htmlToMarkdown: headings, lists, links and code; relative links become absolute", () => {
  const page = `<html><head><title>T</title></head><body><article>
    <h1>Heading</h1>
    <p>${"Some body text that is long enough to read as an article. ".repeat(12)}</p>
    <ul><li>one</li><li>two</li></ul>
    <p>See <a href="/docs/page">the docs</a>.</p>
    <pre><code>const x = 1;</code></pre>
    <script>alert(1)</script>
  </article></body></html>`;
  const { markdown } = htmlToMarkdown(page, "https://site.example/blog/post");
  assert.match(markdown, /^#{1,2} Heading/m); // Readability demotes h1 to h2
  assert.match(markdown, /^- one$/m);
  assert.match(markdown, /\[the docs\]\(https:\/\/site\.example\/docs\/page\)/);
  assert.match(markdown, /```[\s\S]*const x = 1;[\s\S]*```/);
  assert.doesNotMatch(markdown, /alert\(1\)/);
});

test("htmlToMarkdown: truncates at maxChars", () => {
  const page = `<html><body><p>${"word ".repeat(2000)}</p></body></html>`;
  const { markdown } = htmlToMarkdown(page, "https://site.example/", 100);
  assert.ok(markdown.endsWith("[truncated]"));
  assert.ok(markdown.length < 130);
});

// ---- fetchPageMarkdown ----

test("fetchPageMarkdown: fetches robots.txt first, then converts the page", async () => {
  const f = router({
    "https://site.example/robots.txt": () => new Response("User-agent: *\nDisallow: /secret"),
    "https://site.example/post": () => html(raw("page-example.html")),
  });
  const page = await fetchPageMarkdown("https://site.example/post", {}, { fetch: f.fetch, lookup });
  assert.equal(page.title, "Example Domain");
  assert.deepEqual(f.calls, ["https://site.example/robots.txt", "https://site.example/post"]);
});

test("fetchPageMarkdown: a disallowed page is never requested", async () => {
  const f = router({
    "https://site.example/robots.txt": () => new Response("User-agent: *\nDisallow: /secret"),
    "https://site.example/secret": () => html("<p>secret</p>"),
  });
  await assert.rejects(
    () => fetchPageMarkdown("https://site.example/secret/1", {}, { fetch: f.fetch, lookup }),
    RobotsDisallowedError,
  );
  assert.deepEqual(f.calls, ["https://site.example/robots.txt"]);
});

test("fetchPageMarkdown: respectRobotsTxt:false skips the robots fetch", async () => {
  const f = router({ "https://site.example/secret": () => html("<p>hello there</p>") });
  const page = await fetchPageMarkdown("https://site.example/secret", { respectRobotsTxt: false }, { fetch: f.fetch, lookup });
  assert.match(page.markdown, /hello there/);
  assert.deepEqual(f.calls, ["https://site.example/secret"]);
});

test("fetchPageMarkdown: a redirect to a disallowed path is rejected", async () => {
  const f = router({
    "https://site.example/robots.txt": () => new Response("User-agent: *\nDisallow: /private"),
    "https://site.example/go": () => new Response(null, { status: 302, headers: { location: "/private/x" } }),
    "https://site.example/private/x": () => html("<p>private</p>"),
  });
  await assert.rejects(
    () => fetchPageMarkdown("https://site.example/go", {}, { fetch: f.fetch, lookup }),
    RobotsDisallowedError,
  );
});

test("fetchPageMarkdown: rejects non-HTML content and blocks private hosts", async () => {
  const f = router({
    "https://site.example/robots.txt": () => new Response("", { status: 404 }),
    "https://site.example/file.pdf": () =>
      new Response("%PDF-1.4", { headers: { "content-type": "application/pdf" } }),
  });
  await assert.rejects(
    () => fetchPageMarkdown("https://site.example/file.pdf", {}, { fetch: f.fetch, lookup }),
    NotHtmlError,
  );
  const calls = f.calls.length;
  await assert.rejects(() => fetchPageMarkdown("http://169.254.169.254/", {}, { fetch: f.fetch, lookup }), /Blocked/);
  assert.equal(f.calls.length, calls);
});

test("htmlToMarkdown: images and empty image links are dropped", () => {
  const page = `<html><body><article><p>${"Readable article text goes here. ".repeat(10)}</p>
    <a href="/big"><img src="/x.png" alt="pic"></a><figure><img src="/y.png"><figcaption>cap</figcaption></figure></article></body></html>`;
  const { markdown } = htmlToMarkdown(page, "https://site.example/");
  assert.doesNotMatch(markdown, /x\.png|y\.png|!\[|\[\]\(/);
});
