#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHttpServer } from "./mcp/http.js";
import { createMcpServer, type McpOptions } from "./mcp/server.js";

const USAGE = `Topic Research Pack MCP server

  topic-research-mcp                 stdio (default; for local agents)
  topic-research-mcp --http          Streamable HTTP at http://127.0.0.1:3000/mcp
    --port <n>                       port (default 3000)
    --host <addr>                    bind address (default 127.0.0.1; there is no authentication)
  --no-robots                        do not check robots.txt (operator choice, not available to agents)
  --enable-google                    allow Google sources (off by default; read the README warning first)
  --enable-gdelt                     allow the experimental GDELT source (off by default)
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.error(USAGE);
  process.exit(0);
}

const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const options: McpOptions = {
  respectRobotsTxt: !args.includes("--no-robots"),
  enableGoogleSources: args.includes("--enable-google"),
  enableGdelt: args.includes("--enable-gdelt"),
};
const deps = { fetch };

// stdout belongs to the protocol in stdio mode, so everything human-readable goes to stderr.
if (args.includes("--http")) {
  const port = Number(flag("--port") ?? 3000);
  const host = flag("--host") ?? "127.0.0.1";
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid --port\n${USAGE}`);
    process.exit(1);
  }
  const server = createHttpServer({ deps, options, host });
  server.listen(port, host, () => {
    console.error(`MCP server listening on http://${host}:${port}/mcp`);
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
      console.error("Warning: bound beyond loopback with no authentication. Put an authenticating proxy in front.");
    }
  });
} else {
  const server = createMcpServer(deps, options);
  await server.connect(new StdioServerTransport());
  console.error("MCP server running on stdio");
}
