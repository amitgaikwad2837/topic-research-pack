import { z } from "zod";
import type { SourceAdapter } from "../research.js";
import type { NewsItem } from "../types.js";
import { safeGet } from "../util/http.js";

/**
 * GDELT DOC 2.0 article search. EXPERIMENTAL and off unless `enableGdelt` is set.
 *
 * The response format below comes from the documentation of the maintained client library
 * alex9smith/gdelt-doc-api (top-level `articles`, each with url, title, seendate, domain, ...),
 * NOT from a live response: every request to the API from the development machine was answered
 * with HTTP 429. Parse failures are therefore reported as a soft error. Flip this to on by
 * default only after a real response has been captured as a fixture and the tests use it.
 */
export const GDELT_SOURCE = "gdelt";

const GdeltSchema = z.object({
  articles: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().nullish(),
        seendate: z.string().nullish(),
        domain: z.string().nullish(),
      }),
    )
    .optional(),
});

export function buildGdeltUrl(topic: string, max: number): string {
  const params = new URLSearchParams({
    query: topic,
    mode: "ArtList",
    format: "json",
    maxrecords: String(Math.min(max, 250)),
    timespan: "7d",
    sort: "DateDesc",
  });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;
}

/** "20261115T120000Z" to an ISO string. */
export function parseSeenDate(raw: string | null | undefined): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : undefined;
}

/**
 * The client library notes that the API sometimes returns JSON with illegal control characters
 * inside strings. Replace them with spaces and parse again.
 */
export function parseGdeltBody(body: string): unknown {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) {
    // Rate-limit and query errors arrive as plain text or HTML, sometimes with HTTP 200.
    throw new Error(`GDELT did not return JSON: ${trimmed.slice(0, 120).replace(/\s+/g, " ")}`);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // eslint-disable-next-line no-control-regex
    return JSON.parse(trimmed.replace(/[\u0000-\u001f]/g, " "));
  }
}

export function parseGdelt(json: unknown): NewsItem[] {
  const out: NewsItem[] = [];
  const seen = new Set<string>();
  for (const a of GdeltSchema.parse(json).articles ?? []) {
    const title = a.title?.trim();
    if (!title || seen.has(a.url)) continue;
    seen.add(a.url);
    const publishedAt = parseSeenDate(a.seendate);
    out.push({
      title,
      url: a.url,
      source: a.domain?.trim() || GDELT_SOURCE,
      ...(publishedAt && { publishedAt }),
    });
  }
  return out;
}

export const gdeltSource: SourceAdapter = {
  name: GDELT_SOURCE,
  enabled: (input) => input.enableGdelt,
  async run(input, deps) {
    // One request per run: the API allows one request every 5 seconds.
    const res = await safeGet(buildGdeltUrl(input.topic, input.maxNews), {}, deps);
    return { source: GDELT_SOURCE, news: parseGdelt(parseGdeltBody(res.text)) };
  },
};
