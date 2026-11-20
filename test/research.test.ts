import { test } from "node:test";
import assert from "node:assert/strict";
import { runResearch } from "../src/core/research.js";

const deps = {
  fetch: (() => {
    throw new Error("network must not be used in tests");
  }) as unknown as typeof fetch,
};

test("rejects an empty topic", async () => {
  await assert.rejects(() => runResearch({ topic: "  " }, deps));
});

test("returns an empty pack when there are no adapters", async () => {
  const pack = await runResearch({ topic: "ai agents" }, deps);
  assert.equal(pack.topic, "ai agents");
  assert.deepEqual(pack.news, []);
  assert.deepEqual(pack.errors, []);
});

test("one failing adapter is recorded and does not fail the run", async () => {
  const ok = {
    name: "ok",
    run: async () => ({
      source: "ok",
      keywords: [{ keyword: "ai agents tools", source: "ok" }],
    }),
  };
  const bad = {
    name: "bad",
    run: async () => {
      throw new Error("boom");
    },
  };
  const pack = await runResearch({ topic: "ai agents" }, deps, [ok, bad]);
  assert.deepEqual(pack.sourcesUsed, ["ok"]);
  assert.equal(pack.keywords.length, 1);
  assert.equal(pack.errors.length, 1);
  assert.equal(pack.errors[0]?.source, "bad");
  assert.equal(pack.errors[0]?.message, "boom");
});
