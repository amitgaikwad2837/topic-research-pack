import type { HttpDeps } from "./http.js";
import { safeGet } from "./http.js";

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodes the HTML entities that JSON APIs such as Stack Exchange leave in titles. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const cp = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    if (body.startsWith("#")) {
      const cp = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** Collapses runs of whitespace, including the newlines that Atom titles are wrapped with. */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Unix seconds to an ISO string. */
export function isoFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** GET a URL through the guarded client and parse JSON, with a readable error for non-JSON bodies. */
export async function getJson(url: string, deps: HttpDeps, label: string): Promise<unknown> {
  const res = await safeGet(url, {}, deps);
  try {
    return JSON.parse(res.text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}
