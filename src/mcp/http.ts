import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Deps } from "../core/types.js";
import { createMcpServer, type McpOptions } from "./server.js";

const MAX_BODY_BYTES = 1_000_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export interface HttpServerConfig {
  deps: Deps;
  options: McpOptions;
  /** Defaults to loopback. There is no authentication, so only bind elsewhere behind a proxy that adds it. */
  host?: string;
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

class BodyTooLargeError extends Error {
  override name = "BodyTooLargeError";
}

/** If a client keeps sending this much, stop being polite and cut the connection. */
const DRAIN_LIMIT_BYTES = 8 * MAX_BODY_BYTES;

/**
 * Reads and parses a JSON body of at most MAX_BODY_BYTES.
 *
 * When the body is too large this rejects immediately but keeps the request flowing and discards
 * the rest of the upload. Leaving the stream early (for example by throwing out of `for await`)
 * would destroy the socket, so the client could get a connection reset instead of the 413.
 */
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (tooLarge) {
        if (size > DRAIN_LIMIT_BYTES) req.destroy();
        return;
      }
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new BodyTooLargeError("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** Host header without the port, lowercased. */
function hostName(header: string | undefined): string {
  if (!header) return "";
  const h = header.toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0] ?? "";
}

/**
 * Streamable HTTP endpoint at POST /mcp, stateless (a new server and transport per request).
 * When bound to loopback it rejects other Host headers, which blocks DNS-rebinding attacks from web pages.
 */
export function createHttpServer(config: HttpServerConfig): Server {
  const bindHost = config.host ?? "127.0.0.1";
  const loopbackOnly = LOOPBACK_HOSTS.has(bindHost) || bindHost === "127.0.0.1";

  return createServer(async (req, res) => {
    try {
      if (loopbackOnly && !LOOPBACK_HOSTS.has(hostName(req.headers.host))) {
        return jsonRpcError(res, 403, -32000, "Forbidden: unexpected Host header");
      }
      const path = (req.url ?? "").split("?")[0];
      if (path !== "/mcp") return jsonRpcError(res, 404, -32000, "Not found. The endpoint is POST /mcp");
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        return jsonRpcError(res, 405, -32000, "Method not allowed. This server is stateless: use POST");
      }

      let body: unknown;
      try {
        body = await readJson(req);
      } catch (err) {
        if (err instanceof BodyTooLargeError) {
          // Tell the client we will close after this response; the rest of its upload is discarded.
          res.setHeader("connection", "close");
          return jsonRpcError(res, 413, -32000, "Request body too large");
        }
        return jsonRpcError(res, 400, -32700, "Parse error");
      }

      const server = createMcpServer(config.deps, config.options);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error("MCP request failed:", err instanceof Error ? err.message : err);
      if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error");
    }
  });
}
