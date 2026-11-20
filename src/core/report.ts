import { normalizeUrl } from "./content/pages.js";
import type { ReferenceItem, ResearchPack } from "./types.js";
import { collapseWhitespace, truncate } from "./util/text.js";

export interface ReportOptions {
  /** How many characters of each fetched page to quote. */
  excerptChars?: number;
}

const KIND_HEADINGS: Record<ReferenceItem["kind"], string> = {
  paper: "Papers",
  repo: "Code repositories",
  question: "Questions and answers",
};

const isoDate = (s: string | undefined): string | undefined => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined);

/** 1234567 -> "1,234,567" without depending on the machine's locale. */
const formatNumber = (n: number): string =>
  Number.isInteger(n) ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : String(n);

/** One line of plain text: no newlines, and no characters that would break a markdown list item. */
const oneLine = (s: string): string => collapseWhitespace(s).replace(/([\\`*_[\]])/g, "\\$1");

interface Citation {
  title: string;
  url: string;
  source: string;
  publishedAt?: string | undefined;
}

/**
 * Renders a research pack as a markdown brief with numbered citations and retrieval dates.
 * Deterministic: the same pack always gives the same text. Sections with nothing in them are left out.
 */
export function renderReport(pack: ResearchPack, options: ReportOptions = {}): string {
  const excerptChars = options.excerptChars ?? 600;
  const retrieved = isoDate(pack.generatedAt) ?? pack.generatedAt;

  // Each distinct URL gets one number, in the order it first appears in the report.
  const citations: Citation[] = [];
  const numbers = new Map<string, number>();
  const cite = (c: Citation): string => {
    const key = normalizeUrl(c.url) ?? c.url;
    let n = numbers.get(key);
    if (n === undefined) {
      citations.push(c);
      n = citations.length;
      numbers.set(key, n);
    }
    return `[${n}]`;
  };

  const out: string[] = [];
  out.push(`# Research brief: ${oneLine(pack.topic)}`, "");
  const used = pack.sourcesUsed.length > 0 ? pack.sourcesUsed.join(", ") : "none";
  out.push(`*Generated ${pack.generatedAt}. Sources used: ${used}.*`, "");

  if (pack.overview) {
    const o = pack.overview;
    const label = cite({ title: o.title, url: o.url, source: o.source });
    out.push("## Overview", "", `${collapseWhitespace(o.summary)} ${label}`, "");
  }

  if (pack.trends.length > 0) {
    out.push("## Signals", "");
    for (const t of pack.trends) out.push(`- ${oneLine(t.label)}: ${formatNumber(t.value)} (${t.source})`);
    out.push("");
  }

  if (pack.news.length > 0) {
    out.push("## News", "");
    for (const n of pack.news) {
      const label = cite({ title: n.title, url: n.url, source: n.source, publishedAt: n.publishedAt });
      const date = isoDate(n.publishedAt);
      out.push(`- ${oneLine(n.title)} (${oneLine(n.source)}${date ? `, ${date}` : ""}) ${label}`);
    }
    out.push("");
  }

  const kinds = (["paper", "repo", "question"] as const).filter((k) => pack.references.some((r) => r.kind === k));
  if (kinds.length > 0) {
    out.push("## Papers, code and questions", "");
    for (const kind of kinds) {
      out.push(`### ${KIND_HEADINGS[kind]}`, "");
      for (const r of pack.references.filter((x) => x.kind === kind)) {
        const label = cite({ title: r.title, url: r.url, source: r.source, publishedAt: r.publishedAt });
        const date = isoDate(r.publishedAt);
        const summary = r.summary ? `: ${oneLine(truncate(r.summary, 200))}` : "";
        out.push(`- ${oneLine(r.title)}${date ? ` (${date})` : ""}${summary} ${label}`);
      }
      out.push("");
    }
  }

  if (pack.keywords.length > 0) {
    out.push("## Keyword ideas", "", pack.keywords.map((k) => oneLine(k.keyword)).join("; "), "");
  }

  if (pack.pages.length > 0) {
    out.push("## Page excerpts", "");
    for (const p of pack.pages) {
      const label = cite({ title: p.title ?? p.url, url: p.url, source: new URL(p.url).hostname });
      const excerpt = truncate(collapseWhitespace(p.markdown), excerptChars);
      out.push(`### ${oneLine(p.title ?? p.url)} ${label}`, "", `> ${excerpt}`, "");
    }
  }

  const hasContent =
    pack.overview || pack.trends.length || pack.news.length || pack.references.length || pack.keywords.length || pack.pages.length;
  if (!hasContent) out.push("No results were found for this topic.", "");

  if (pack.errors.length > 0) {
    out.push("## Limitations", "", "Some sources did not answer. This brief is incomplete for them:", "");
    for (const e of pack.errors) out.push(`- ${oneLine(e.source)}: ${oneLine(e.message)}`);
    out.push("");
  }

  if (citations.length > 0) {
    out.push("## Sources", "");
    citations.forEach((c, i) => {
      const date = isoDate(c.publishedAt);
      out.push(`${i + 1}. ${oneLine(c.title)}. ${oneLine(c.source)}${date ? `, published ${date}` : ""}. <${c.url}>. Retrieved ${retrieved}.`);
    });
    out.push("");
  }

  out.push("---", "", "*Assembled automatically from public sources. Check the originals before relying on or quoting them.*", "");
  return out.join("\n");
}
