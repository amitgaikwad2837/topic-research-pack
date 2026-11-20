import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EVENT_PAGE_MARKDOWN, EVENT_RESEARCH_PACK, runActorJob, type ActorIO } from "../src/actor/job.js";
import { ResearchPackSchema, type Deps, type ResearchPack } from "../src/core/types.js";

const raw = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const lookup = async () => ["93.184.216.34"];
const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
const article = `<html><head><title>An article</title></head><body><article><h1>An article</h1><p>${"Interesting readable sentence number one. ".repeat(12)}</p></article></body></html>`;

function deps(opts: { allDown?: boolean } = {}): Deps {
  const routes: Array<[string, () => Response]> = opts.allDown
    ? []
    : [
        ["https://hn.algolia.com/", () => new Response(raw("hn-search.json"))],
        ["https://en.wikipedia.org/w/api.php", () => new Response(raw("wiki-search.json"))],
        ["https://wikimedia.org/", () => new Response(raw("wiki-pageviews.json"))],
        ["https://en.wikipedia.org/api/rest_v1/", () => new Response(raw("wiki-summary.json"))],
        ["https://duckduckgo.com/ac/", () => new Response(raw("ddg-ac.json"))],
        ["https://", () => html(article)],
      ];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    const hit = routes.find(([p]) => url.startsWith(p));
    return hit ? hit[1]() : new Response("down", { status: 500 });
  }) as unknown as typeof fetch;
  return { fetch: fn, lookup };
}

function fakeIO(limits: Record<string, number> = {}) {
  const log = {
    pushed: [] as ResearchPack[],
    saved: [] as ResearchPack[],
    reports: [] as string[],
    charges: [] as Array<[string, number]>,
    status: [] as string[],
  };
  const io: ActorIO = {
    pushPack: async (p) => void log.pushed.push(p),
    saveOutput: async (p) => void log.saved.push(p),
    saveReport: async (m) => void log.reports.push(m),
    charge: async (e, n) => void log.charges.push([e, n]),
    maxCharges: (e) => limits[e] ?? Infinity,
    setStatus: async (m) => void log.status.push(m),
  };
  return { io, log };
}

test("success: pushes exactly one valid pack, then charges the pack and each page", async () => {
  const { io, log } = fakeIO();
  const res = await runActorJob({ topic: "ai agents", maxPages: 2 }, deps(), io);
  assert.ok(res.ok);
  assert.equal(log.pushed.length, 1);
  assert.ok(ResearchPackSchema.safeParse(log.pushed[0]).success);
  assert.equal(log.pushed[0]?.pages.length, 2);
  assert.deepEqual(log.charges, [
    [EVENT_RESEARCH_PACK, 1],
    [EVENT_PAGE_MARKDOWN, 2],
  ]);
  assert.deepEqual(log.saved, []);
  assert.equal(log.reports.length, 1);
  assert.match(log.reports[0] ?? "", /^# Research brief: ai agents/);
  assert.match(res.message, /Done: .* 2 pages/);
});

test("no pages: only the pack event is charged", async () => {
  const { io, log } = fakeIO();
  const res = await runActorJob({ topic: "ai agents", maxPages: 0 }, deps(), io);
  assert.ok(res.ok);
  assert.deepEqual(log.charges, [[EVENT_RESEARCH_PACK, 1]]);
});

test("every source down: nothing is pushed or charged, the result is kept as OUTPUT, and the run fails", async () => {
  const { io, log } = fakeIO();
  const res = await runActorJob({ topic: "ai agents" }, deps({ allDown: true }), io);
  assert.equal(res.ok, false);
  assert.match(res.message, /Not charged/);
  assert.deepEqual(log.pushed, []);
  assert.deepEqual(log.charges, []);
  assert.deepEqual(log.reports, []);
  assert.equal(log.saved.length, 1);
  assert.ok(log.saved[0]!.errors.length >= 3);
});

test("invalid input fails with a readable message and does no work", async () => {
  const { io, log } = fakeIO();
  const res = await runActorJob({ topic: "" }, deps(), io);
  assert.equal(res.ok, false);
  assert.match(res.message, /Invalid input.*topic/);
  const missing = await runActorJob(null, deps(), io);
  assert.equal(missing.ok, false);
  assert.deepEqual(log.status, []);
  assert.deepEqual(log.charges, []);
});

test("blank entries in the feed list are ignored instead of failing the run", async () => {
  const { io } = fakeIO();
  const res = await runActorJob({ topic: "ai agents", maxPages: 0, rssFeeds: ["", "  "] }, deps(), io);
  assert.ok(res.ok);
});

test("a spending limit too low for one pack stops the run before any work", async () => {
  const { io, log } = fakeIO({ [EVENT_RESEARCH_PACK]: 0 });
  const res = await runActorJob({ topic: "ai agents" }, deps(), io);
  assert.equal(res.ok, false);
  assert.match(res.message, /maximum cost is too low/);
  assert.deepEqual(log.status, []);
});

test("the spending limit caps how many pages are fetched", async () => {
  const { io, log } = fakeIO({ [EVENT_PAGE_MARKDOWN]: 1 });
  const res = await runActorJob({ topic: "ai agents", maxPages: 3 }, deps(), io);
  assert.ok(res.ok);
  assert.equal(log.pushed[0]?.pages.length, 1);
  assert.deepEqual(log.charges.at(-1), [EVENT_PAGE_MARKDOWN, 1]);

  const zero = fakeIO({ [EVENT_PAGE_MARKDOWN]: 0 });
  const r2 = await runActorJob({ topic: "ai agents", maxPages: 3 }, deps(), zero.io);
  assert.ok(r2.ok);
  assert.equal(zero.log.pushed[0]?.pages.length, 0);
  assert.deepEqual(zero.log.charges, [[EVENT_RESEARCH_PACK, 1]]);
});

test("the dataset schema describes exactly the fields of the research pack", () => {
  const ds = JSON.parse(readFileSync(new URL("../.actor/dataset_schema.json", import.meta.url), "utf8")) as {
    fields: { properties: Record<string, unknown> };
    views: Record<string, { transformation: { fields: string[] } }>;
  };
  const actorJson = JSON.parse(readFileSync(new URL("../.actor/actor.json", import.meta.url), "utf8")) as {
    storages: { dataset: string };
  };
  assert.equal(actorJson.storages.dataset, "./dataset_schema.json");
  assert.deepEqual(Object.keys(ds.fields.properties).sort(), Object.keys(ResearchPackSchema.shape).sort());
  // Every column a view shows must be a real top-level field.
  for (const [name, view] of Object.entries(ds.views)) {
    for (const f of view.transformation.fields) {
      assert.ok(f.split(".")[0]! in ds.fields.properties, `view ${name}: unknown field ${f}`);
    }
  }
});

test("the input schema file matches the zod input: every property is known and defaults agree", async () => {
  const schema = JSON.parse(readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8")) as {
    properties: Record<string, { type: string; title: string; description: string; default?: unknown }>;
    required: string[];
  };
  const { ResearchInputSchema } = await import("../src/core/types.js");
  const zodDefaults = ResearchInputSchema.parse({ topic: "x" }) as Record<string, unknown>;
  for (const [key, def] of Object.entries(schema.properties)) {
    assert.ok(key in zodDefaults, `unknown input property ${key}`);
    assert.ok(def.title && def.description, `${key} needs a title and description`);
    if (def.default !== undefined) assert.deepEqual(def.default, zodDefaults[key], `default for ${key}`);
  }
  assert.deepEqual(schema.required, ["topic"]);
});
