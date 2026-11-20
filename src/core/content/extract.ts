import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type { PageContent } from "../types.js";
import { safeGet, type HttpDeps } from "../util/http.js";
import { RobotsChecker } from "../util/robots.js";

export class RobotsDisallowedError extends Error {
  override name = "RobotsDisallowedError";
}
export class NotHtmlError extends Error {
  override name = "NotHtmlError";
}

export interface ExtractOptions {
  respectRobotsTxt?: boolean;
  /** Markdown is cut at this many characters. */
  maxChars?: number;
  /** Share one checker across calls so each origin's robots.txt is fetched once. */
  robots?: RobotsChecker;
}

const DEFAULT_MAX_CHARS = 20_000;

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_",
});
turndown.remove(["script", "style", "noscript", "iframe", "svg", "form", "button"]);
// Image links are noise for text research and cost tokens.
turndown.addRule("dropImages", { filter: ["img", "picture", "figure"], replacement: () => "" });

function tidy(markdown: string, maxChars: number): string {
  const cleaned = markdown
    .replace(/\r\n/g, "\n")
    .replace(/\[\s*\]\([^)]*\)/g, "") // links that only wrapped an image
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^(\s*)([-*+]|\d+\.)\s{2,}/gm, "$1$2 ") // turndown pads list markers with extra spaces
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars).trimEnd()}\n\n[truncated]` : cleaned;
}

/** Converts an HTML document to markdown, keeping the main article when one can be found. */
export function htmlToMarkdown(
  html: string,
  pageUrl: string,
  maxChars: number = DEFAULT_MAX_CHARS,
): { title?: string; markdown: string } {
  const { document } = parseHTML(html);

  if (!document.querySelector("base")) {
    const base = document.createElement("base");
    base.setAttribute("href", pageUrl);
    document.head?.appendChild(base);
  }
  const pageTitle = document.title?.trim() || undefined;

  // Readability mutates the document, so keep the fallback content first.
  // A bare fragment such as "<p>hi</p>" has no <body>, so fall back to the whole document, then the input.
  const root = document.body ?? document.documentElement;
  const fallbackHtml = root?.innerHTML || html;
  const bodyTextLength = (root?.textContent ?? "").trim().length;
  let article: { title?: string | null; content?: string | null; textContent?: string | null } | null = null;
  try {
    article = new Readability(document as never).parse();
  } catch {
    article = null;
  }

  // Trust Readability only when it found a real article. On very short pages it can return
  // almost nothing, and then the whole body is the better answer.
  const articleTextLength = (article?.textContent ?? "").trim().length;
  const useArticle =
    !!article?.content && (articleTextLength >= 140 || articleTextLength >= bodyTextLength * 0.5);
  const source = useArticle ? article!.content! : fallbackHtml;
  const title = article?.title?.trim() || pageTitle;
  return { ...(title && { title }), markdown: tidy(turndown.turndown(source), maxChars) };
}

/**
 * Fetches a page (SSRF-guarded) and returns clean markdown.
 * Checks robots.txt first unless `respectRobotsTxt` is false.
 * Throws RobotsDisallowedError, NotHtmlError, or the errors from `safeGet`.
 */
export async function fetchPageMarkdown(
  url: string,
  options: ExtractOptions,
  deps: HttpDeps,
): Promise<PageContent> {
  const respect = options.respectRobotsTxt ?? true;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const robots = options.robots ?? new RobotsChecker(deps);

  if (respect && !(await robots.isAllowed(url))) {
    throw new RobotsDisallowedError(`robots.txt disallows fetching ${url}`);
  }

  const res = await safeGet(url, {}, deps);

  // A redirect can land on a different path or host with different rules.
  if (respect && res.url !== new URL(url).toString() && !(await robots.isAllowed(res.url))) {
    throw new RobotsDisallowedError(`robots.txt disallows the redirect target ${res.url}`);
  }

  const type = res.contentType.toLowerCase();
  if (type.includes("html")) {
    const { title, markdown } = htmlToMarkdown(res.text, res.url, maxChars);
    return { url: res.url, ...(title && { title }), markdown };
  }
  if (type.startsWith("text/plain") || type.includes("markdown")) {
    return { url: res.url, markdown: tidy(res.text, maxChars) };
  }
  throw new NotHtmlError(`Unsupported content type "${res.contentType || "unknown"}" for ${res.url}`);
}
