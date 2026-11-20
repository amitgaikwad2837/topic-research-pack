import { XMLParser } from "fast-xml-parser";

export interface FeedItem {
  title: string;
  url: string;
  publishedAt?: string;
  summary?: string;
  /** Publisher name from an RSS <source> element (Google News uses it). */
  sourceName?: string;
}

export interface Feed {
  title?: string;
  items: FeedItem[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
});

/** Raw XML to a plain object, with the same settings as the feed parser. */
export function parseXml(xml: string): Record<string, unknown> {
  return parser.parse(xml) as Record<string, unknown>;
}

export const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Text of a node that may be a string, number, or an object with a #text. */
export function text(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === "string") return node.trim() || undefined;
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in node) return text((node as Record<string, unknown>)["#text"]);
  return undefined;
}

function isoDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** Atom entries have one or more <link>; prefer rel="alternate" (or no rel). */
function atomLink(links: unknown): string | undefined {
  const all = asArray(links as unknown);
  for (const l of all) {
    if (typeof l === "string") return l;
    if (typeof l !== "object" || l === null) continue;
    const attrs = l as Record<string, unknown>;
    const rel = attrs["@_rel"];
    const href = attrs["@_href"];
    if (typeof href === "string" && (rel === undefined || rel === "alternate")) return href;
  }
  return undefined;
}

/** Parses RSS 2.0 and Atom 1.0. Throws if the document is neither. */
export function parseFeed(xml: string): Feed {
  const doc = parser.parse(xml) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  if (doc.rss?.channel) {
    const channel = asArray(doc.rss.channel)[0];
    const items: FeedItem[] = [];
    for (const it of asArray(channel.item) as Array<Record<string, unknown>>) {
      const title = text(it.title);
      const url = text(it.link);
      if (!title || !url) continue;
      const publishedAt = isoDate(text(it.pubDate) ?? text(it["dc:date"]));
      const summary = text(it.description);
      const sourceName = text(it.source);
      items.push({
        title,
        url,
        ...(publishedAt && { publishedAt }),
        ...(summary && { summary }),
        ...(sourceName && { sourceName }),
      });
    }
    const feedTitle = text(channel.title);
    return { ...(feedTitle && { title: feedTitle }), items };
  }

  if (doc.feed) {
    const items: FeedItem[] = [];
    for (const e of asArray(doc.feed.entry) as Array<Record<string, unknown>>) {
      const title = text(e.title);
      const url = atomLink(e.link);
      if (!title || !url) continue;
      const publishedAt = isoDate(text(e.published) ?? text(e.updated));
      const summary = text(e.summary);
      items.push({ title, url, ...(publishedAt && { publishedAt }), ...(summary && { summary }) });
    }
    const feedTitle = text(doc.feed.title);
    return { ...(feedTitle && { title: feedTitle }), items };
  }

  throw new Error("Not an RSS or Atom feed");
}
