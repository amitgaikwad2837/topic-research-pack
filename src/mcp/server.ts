import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchPageMarkdown } from "../core/content/extract.js";
import { renderReport, research } from "../core/index.js";
import { runResearch } from "../core/research.js";
import { duckDuckGoSuggestSource } from "../core/sources/ddg.js";
import { wikipediaSource } from "../core/sources/wikipedia.js";
import {
  PageContentSchema,
  ResearchInputSchema,
  ResearchPackSchema,
  SourceErrorSchema,
  KeywordIdeaSchema,
  type Deps,
} from "../core/types.js";

export const SERVER_NAME = "topic-research-pack";
export const SERVER_VERSION = "0.1.0";

/**
 * Operator settings. These are deliberately NOT tool parameters: an agent (or a prompt injected
 * into one) must not be able to switch off robots.txt or turn on Google sources.
 */
export interface McpOptions {
  respectRobotsTxt: boolean;
  enableGoogleSources: boolean;
  enableGdelt: boolean;
}

export const DEFAULT_MCP_OPTIONS: McpOptions = {
  respectRobotsTxt: true,
  enableGoogleSources: false,
  enableGdelt: false,
};

const READ_ONLY_OPEN_WORLD = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const researchTopicInput = ResearchInputSchema.omit({
  respectRobotsTxt: true,
  enableGoogleSources: true,
  useGoogleSearchActor: true,
  enableGdelt: true,
}).shape;

const fetchPageInput = {
  url: z.string().url().describe("http(s) URL of the page to read"),
  maxChars: z
    .number()
    .int()
    .min(500)
    .max(50_000)
    .default(8_000)
    .describe("Cut the markdown at this many characters"),
};

const keywordIdeasInput = {
  topic: ResearchInputSchema.shape.topic,
  maxKeywords: ResearchInputSchema.shape.maxKeywords,
};

function ok(structured: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

/** Builds a fresh MCP server. Cheap enough to create one per HTTP request. */
export function createMcpServer(deps: Deps, options: McpOptions = DEFAULT_MCP_OPTIONS): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "research_topic",
    {
      title: "Research a topic",
      description:
        "Research a topic in one call. Returns recent news, trend signals, keyword ideas and the " +
        "readable text (markdown) of a few top pages. Uses public sources (Hacker News, Wikipedia, " +
        "DuckDuckGo suggestions and any RSS/Atom feeds you pass). Sources that fail are listed in " +
        "`errors` and do not fail the call.",
      inputSchema: researchTopicInput,
      outputSchema: ResearchPackSchema.shape,
      annotations: { title: "Research a topic", ...READ_ONLY_OPEN_WORLD },
    },
    async (args) => {
      try {
        const pack = await research(
          {
            ...args,
            respectRobotsTxt: options.respectRobotsTxt,
            enableGoogleSources: options.enableGoogleSources,
            enableGdelt: options.enableGdelt,
          },
          deps,
        );
        return ok(pack);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "research_report",
    {
      title: "Research a topic as a cited report",
      description:
        "Same research as research_topic, but returns a ready-to-read markdown brief: overview, signals, " +
        "news, papers and code, keyword ideas and page excerpts, with numbered citations and retrieval " +
        "dates. Use it when you want to read or quote the result rather than process it. Sources that fail " +
        "are listed under Limitations.",
      inputSchema: researchTopicInput,
      outputSchema: { markdown: z.string() },
      annotations: { title: "Research a topic as a cited report", ...READ_ONLY_OPEN_WORLD },
    },
    async (args) => {
      try {
        const pack = await research(
          {
            ...args,
            respectRobotsTxt: options.respectRobotsTxt,
            enableGoogleSources: options.enableGoogleSources,
            enableGdelt: options.enableGdelt,
          },
          deps,
        );
        const markdown = renderReport(pack);
        return { content: [{ type: "text" as const, text: markdown }], structuredContent: { markdown } };
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "fetch_page_markdown",
    {
      title: "Fetch a page as markdown",
      description:
        "Fetch one web page and return its main content as clean markdown. Honors robots.txt, " +
        "refuses private/internal addresses, and caps size and time.",
      inputSchema: fetchPageInput,
      outputSchema: PageContentSchema.shape,
      annotations: { title: "Fetch a page as markdown", ...READ_ONLY_OPEN_WORLD },
    },
    async ({ url, maxChars }) => {
      try {
        const page = await fetchPageMarkdown(
          url,
          { respectRobotsTxt: options.respectRobotsTxt, maxChars },
          deps,
        );
        return ok(page);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "keyword_ideas",
    {
      title: "Keyword ideas",
      description:
        "Get keyword and related-topic ideas for a topic from search suggestions and Wikipedia. " +
        "Lighter and faster than research_topic: no news and no page fetching.",
      inputSchema: keywordIdeasInput,
      outputSchema: {
        topic: z.string(),
        keywords: z.array(KeywordIdeaSchema),
        errors: z.array(SourceErrorSchema),
      },
      annotations: { title: "Keyword ideas", ...READ_ONLY_OPEN_WORLD },
    },
    async ({ topic, maxKeywords }) => {
      try {
        const pack = await runResearch({ topic, maxKeywords, maxPages: 0 }, deps, [
          duckDuckGoSuggestSource,
          wikipediaSource,
        ]);
        return ok({ topic: pack.topic, keywords: pack.keywords, errors: pack.errors });
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}
