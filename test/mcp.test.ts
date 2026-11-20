import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHttpServer } from "../src/mcp/http.js";
import { createMcpServer, DEFAULT_MCP_OPTIONS, type McpOptions } from "../src/mcp/server.js";
import { ResearchPackSchema, type Deps } from "../src/core/types.js";

const raw = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const lookup = async () => ["93.184.216.34"];
const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
const article = `<html><head><title>An article</title></head><body><article><h1>An article</h1><p>${"Interesting readable sentence number one. ".repeat(12)}</p></article></body></html>`;

function fakeDeps(): { deps: Deps; calls: string[] } {
  const routes: Array<[string, () => Response]> = [
    ["https://hn.algolia.com/", () => new Response(raw("hn-search.json"))],
    ["https://en.wikipedia.org/w/api.php", () => new Response(raw("wiki-search.json"))],
    ["https://wikimedia.org/", () => new Response(raw("wiki-pageviews.json"))],
    ["https://duckduckgo.com/ac/", () => new Response(raw("ddg-ac.json"))],
    ["https://blocked.example/robots.txt", () => new Response("User-agent: *\nDisallow: /")],
    ["https://blocked.example/", () => html(article)],
    ["https://", () => html(article)],
  ];
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = routes.find(([prefix]) => url.startsWith(prefix));
    return hit ? hit[1]() : new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { deps: { fetch: fn, lookup }, calls };
}

async function connect(deps: Deps, options: McpOptions = DEFAULT_MCP_OPTIONS) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(deps, options);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, close: () => client.close() };
}

type ToolResult = { isError?: boolean; structuredContent?: unknown; content?: Array<{ type: string; text?: string }> };

// ---- in-memory, real MCP client ----

test("lists the three tools with read-only annotations and schemas", async () => {
  const { deps } = fakeDeps();
  const { client, close } = await connect(deps);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["fetch_page_markdown", "keyword_ideas", "research_topic"]);
  for (const t of tools) {
    assert.equal(t.annotations?.readOnlyHint, true, t.name);
    assert.equal(t.annotations?.destructiveHint, false, t.name);
    assert.ok(t.outputSchema, `${t.name} has an output schema`);
    assert.ok(t.description && t.description.length > 20);
  }
  // Operator-only switches must not be visible to the agent.
  const research = tools.find((t) => t.name === "research_topic")!;
  const props = Object.keys((research.inputSchema as { properties: object }).properties);
  assert.ok(props.includes("topic") && props.includes("maxPages"));
  assert.ok(!props.includes("respectRobotsTxt") && !props.includes("enableGoogleSources"));
  assert.ok(!props.includes("useGoogleSearchActor"));
  await close();
});

test("research_topic returns a pack that validates against the output schema", async () => {
  const { deps } = fakeDeps();
  const { client, close } = await connect(deps);
  const res = (await client.callTool({ name: "research_topic", arguments: { topic: "ai agents", maxPages: 1 } })) as ToolResult;
  assert.ok(!res.isError);
  const pack = ResearchPackSchema.parse(res.structuredContent);
  assert.deepEqual([...pack.sourcesUsed].sort(), ["duckduckgo-suggest", "hackernews", "wikipedia"]);
  assert.equal(pack.pages.length, 1);
  assert.ok(pack.keywords.length > 0 && pack.trends.length === 2);
  // The text content mirrors the structured content for clients that only read text.
  assert.deepEqual(JSON.parse(res.content?.[0]?.text ?? "null"), pack);
  await close();
});

test("research_topic: invalid input is rejected", async () => {
  const { deps } = fakeDeps();
  const { client, close } = await connect(deps);
  let rejected = false;
  try {
    const res = (await client.callTool({ name: "research_topic", arguments: { topic: "" } })) as ToolResult;
    rejected = res.isError === true;
  } catch {
    rejected = true;
  }
  assert.ok(rejected);
  await close();
});

test("fetch_page_markdown returns markdown for an allowed page", async () => {
  const { deps } = fakeDeps();
  const { client, close } = await connect(deps);
  const res = (await client.callTool({ name: "fetch_page_markdown", arguments: { url: "https://site.example/post" } })) as ToolResult;
  assert.ok(!res.isError);
  const page = res.structuredContent as { title: string; markdown: string };
  assert.equal(page.title, "An article");
  assert.match(page.markdown, /Interesting readable sentence/);
  await close();
});

test("fetch_page_markdown refuses a private address without making a request", async () => {
  const { deps, calls } = fakeDeps();
  const { client, close } = await connect(deps);
  const res = (await client.callTool({ name: "fetch_page_markdown", arguments: { url: "http://169.254.169.254/latest/meta-data/" } })) as ToolResult;
  assert.equal(res.isError, true);
  assert.match(res.content?.[0]?.text ?? "", /Blocked/);
  assert.equal(calls.length, 0);
  await close();
});

test("an agent cannot turn off robots.txt: the extra argument is ignored", async () => {
  const { deps, calls } = fakeDeps();
  const { client, close } = await connect(deps);
  const res = (await client.callTool({
    name: "fetch_page_markdown",
    arguments: { url: "https://blocked.example/page", respectRobotsTxt: false },
  })) as ToolResult;
  assert.equal(res.isError, true);
  assert.match(res.content?.[0]?.text ?? "", /robots\.txt/);
  assert.ok(!calls.includes("https://blocked.example/page"));
  await close();
});

test("the operator can turn robots.txt off at server level", async () => {
  const { deps } = fakeDeps();
  const { client, close } = await connect(deps, { ...DEFAULT_MCP_OPTIONS, respectRobotsTxt: false });
  const res = (await client.callTool({ name: "fetch_page_markdown", arguments: { url: "https://blocked.example/page" } })) as ToolResult;
  assert.ok(!res.isError);
  await close();
});

test("keyword_ideas returns keywords only, with no news or page requests", async () => {
  const { deps, calls } = fakeDeps();
  const { client, close } = await connect(deps);
  const res = (await client.callTool({ name: "keyword_ideas", arguments: { topic: "ai agents", maxKeywords: 5 } })) as ToolResult;
  assert.ok(!res.isError);
  const out = res.structuredContent as { keywords: Array<{ keyword: string }>; topic: string };
  assert.equal(out.topic, "ai agents");
  assert.equal(out.keywords.length, 5);
  assert.ok(!calls.some((c) => c.includes("hn.algolia.com")));
  await close();
});

// ---- Streamable HTTP, real client over a real socket ----

async function withHttp<T>(run: (url: URL, port: number) => Promise<T>): Promise<T> {
  const { deps } = fakeDeps();
  const server = createHttpServer({ deps, options: DEFAULT_MCP_OPTIONS });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    return await run(new URL(`http://127.0.0.1:${port}/mcp`), port);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function rawRequest(port: number, opts: { method: string; path: string; host?: string; body?: string }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      {
        port,
        host: "127.0.0.1",
        method: opts.method,
        path: opts.path,
        headers: {
          ...(opts.host && { host: opts.host }),
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(opts.body);
  });
}

test("http: a real client can list and call tools over Streamable HTTP", async () => {
  await withHttp(async (url) => {
    const client = new Client({ name: "http-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(url));
    const { tools } = await client.listTools();
    assert.equal(tools.length, 3);
    const res = (await client.callTool({ name: "keyword_ideas", arguments: { topic: "ai agents", maxKeywords: 3 } })) as ToolResult;
    assert.ok(!res.isError);
    assert.equal((res.structuredContent as { keywords: unknown[] }).keywords.length, 3);
    await client.close();
  });
});

test("http: rejects a foreign Host header (DNS rebinding), wrong paths and wrong methods", async () => {
  await withHttp(async (_url, port) => {
    const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const rebinding = await rawRequest(port, { method: "POST", path: "/mcp", host: "evil.example", body: init });
    assert.equal(rebinding.status, 403);
    const wrongPath = await rawRequest(port, { method: "POST", path: "/other", body: init });
    assert.equal(wrongPath.status, 404);
    const wrongMethod = await rawRequest(port, { method: "GET", path: "/mcp" });
    assert.equal(wrongMethod.status, 405);
    const badJson = await rawRequest(port, { method: "POST", path: "/mcp", body: "{not json" });
    assert.equal(badJson.status, 400);
  });
});

test("http: an oversized body is rejected", async () => {
  await withHttp(async (_url, port) => {
    const big = JSON.stringify({ pad: "x".repeat(1_100_000) });
    const res = await rawRequest(port, { method: "POST", path: "/mcp", body: big });
    assert.equal(res.status, 413);
  });
});

// ---- stdio, real subprocess ----

test("stdio: the real entry point starts, lists tools and refuses private URLs", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/mcp-server.ts"],
    cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    stderr: "ignore",
  });
  const client = new Client({ name: "stdio-client", version: "1.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 3);
    // No network needed: the SSRF guard rejects this before any request.
    const res = (await client.callTool({ name: "fetch_page_markdown", arguments: { url: "http://127.0.0.1/" } })) as ToolResult;
    assert.equal(res.isError, true);
  } finally {
    await client.close();
  }
});
