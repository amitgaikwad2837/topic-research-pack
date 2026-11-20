import { renderReport, research } from "../core/index.js";
import { ResearchInputSchema, type Deps, type ResearchPack } from "../core/types.js";

/** Billable events. Define them (names must match) under Monetization in Apify Console. */
export const EVENT_RESEARCH_PACK = "research-pack";
export const EVENT_PAGE_MARKDOWN = "page-markdown";

/** Everything the job needs from the Apify platform, so the logic is testable without it. */
export interface ActorIO {
  /** Adds the pack to the default dataset. Must NOT charge by itself. */
  pushPack(pack: ResearchPack): Promise<void>;
  /** Stores a result that should not be billed (for example when every source failed). */
  saveOutput(pack: ResearchPack): Promise<void>;
  /** Stores the readable markdown report next to the dataset. Not billed; failures must not fail the run. */
  saveReport(markdown: string): Promise<void>;
  charge(eventName: string, count: number): Promise<void>;
  /** How many more events of this type the user's spending limit allows. Infinity when unlimited. */
  maxCharges(eventName: string): number;
  setStatus(message: string): Promise<void>;
}

export type JobResult =
  | { ok: true; pack: ResearchPack; message: string }
  | { ok: false; message: string; pack?: ResearchPack };

/** The input form can send blank list entries. Drop them, and drop unknown keys. */
function cleanInput(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const input = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(input.rssFeeds)) {
    input.rssFeeds = input.rssFeeds
      .map((f) => (typeof f === "string" ? f.trim() : f))
      .filter((f) => f !== "");
  }
  return input;
}

function describeInputError(raw: unknown): string | undefined {
  const parsed = ResearchInputSchema.safeParse(cleanInput(raw));
  if (parsed.success) return undefined;
  const issues = parsed.error.issues
    .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
    .join("; ");
  return `Invalid input. ${issues}`;
}

export async function runActorJob(rawInput: unknown, deps: Deps, io: ActorIO): Promise<JobResult> {
  const inputError = describeInputError(rawInput);
  if (inputError) return { ok: false, message: inputError };
  const input = ResearchInputSchema.parse(cleanInput(rawInput));

  // Respect the user's spending limit before doing any work.
  if (io.maxCharges(EVENT_RESEARCH_PACK) < 1) {
    return {
      ok: false,
      message: "The run's maximum cost is too low to produce a research pack. Raise the limit and run again.",
    };
  }
  const affordablePages = io.maxCharges(EVENT_PAGE_MARKDOWN);
  if (affordablePages < input.maxPages) {
    input.maxPages = Number.isFinite(affordablePages) ? Math.max(0, Math.floor(affordablePages)) : input.maxPages;
  }

  await io.setStatus(`Researching "${input.topic}"...`);
  const pack = await research(input, deps);

  const hasContent =
    pack.news.length > 0 || pack.keywords.length > 0 || pack.trends.length > 0 || pack.pages.length > 0;
  if (!hasContent) {
    // Nothing useful: keep the errors for the user, but do not bill.
    await io.saveOutput(pack);
    const why = pack.errors.map((e) => `${e.source}: ${e.message}`).join("; ") || "no source returned data";
    return { ok: false, message: `No results for "${input.topic}" (${why}). Not charged.`, pack };
  }

  await io.pushPack(pack);
  await io.saveReport(renderReport(pack));
  await io.charge(EVENT_RESEARCH_PACK, 1);
  if (pack.pages.length > 0) await io.charge(EVENT_PAGE_MARKDOWN, pack.pages.length);

  const message =
    `Done: ${pack.news.length} news, ${pack.trends.length} trends, ${pack.keywords.length} keywords, ` +
    `${pack.pages.length} pages` +
    (pack.errors.length ? `, ${pack.errors.length} source issue(s) (see "errors")` : "");
  await io.setStatus(message);
  return { ok: true, pack, message };
}
