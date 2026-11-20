import { z } from "zod";
import type { SourceAdapter } from "../research.js";
import type { KeywordIdea } from "../types.js";
import { safeGet } from "../util/http.js";

export const DDG_SOURCE = "duckduckgo-suggest";
// Unofficial endpoint. It can change or disappear without notice.
const ENDPOINT = "https://duckduckgo.com/ac/";

/** `type=list` returns [query, [suggestion, ...]] (verified live, see test/fixtures/ddg-ac.json). */
const DdgSchema = z.tuple([z.string(), z.array(z.string())]);

export function buildDdgUrl(topic: string): string {
  return `${ENDPOINT}?${new URLSearchParams({ q: topic, type: "list" }).toString()}`;
}

export function parseDdgResponse(json: unknown, topic: string, max: number): KeywordIdea[] {
  const [, suggestions] = DdgSchema.parse(json);
  const seen = new Set<string>([topic.trim().toLowerCase()]);
  const out: KeywordIdea[] = [];
  for (const s of suggestions) {
    const keyword = s.trim();
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    out.push({ keyword, source: DDG_SOURCE });
    if (out.length >= max) break;
  }
  return out;
}

export const duckDuckGoSuggestSource: SourceAdapter = {
  name: DDG_SOURCE,
  async run(input, deps) {
    const res = await safeGet(buildDdgUrl(input.topic), {}, deps);
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new Error("DuckDuckGo suggest returned invalid JSON");
    }
    return { source: DDG_SOURCE, keywords: parseDdgResponse(json, input.topic, input.maxKeywords) };
  },
};
