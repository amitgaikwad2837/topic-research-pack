import type { FetchLike } from "../types.js";
import { assertSafeUrl, defaultLookup, type Lookup } from "./ssrf.js";

export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
export class HttpTimeoutError extends HttpError {
  override name = "HttpTimeoutError";
}
export class ResponseTooLargeError extends HttpError {
  override name = "ResponseTooLargeError";
}
export class TooManyRedirectsError extends HttpError {
  override name = "TooManyRedirectsError";
}

export interface HttpOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Extra attempts after the first, for network errors, timeouts, 429 and 5xx. */
  retries?: number;
  retryDelayMs?: number;
  userAgent?: string;
  headers?: Record<string, string>;
}

export interface HttpDeps {
  fetch: FetchLike;
  lookup?: Lookup;
}

export interface HttpResult {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  text: string;
}

export const DEFAULT_USER_AGENT =
  "TopicResearchPack/0.1 (research tool; respects robots.txt)";

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 2_000_000,
  maxRedirects: 5,
  retries: 2,
  retryDelayMs: 250,
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

class SkipRetry extends Error {
  constructor(readonly inner: Error) {
    super(inner.message);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new ResponseTooLargeError(`Response too large: ${declared} > ${maxBytes} bytes`);
  }
  if (!res.body) return new Uint8Array();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ResponseTooLargeError(`Response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Decodes using the charset from the Content-Type header, falling back to UTF-8. */
export function decodeBody(bytes: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];
  if (charset) {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // Unknown label: fall through to UTF-8.
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

async function attempt(
  startUrl: string,
  o: Required<Pick<HttpOptions, "timeoutMs" | "maxBytes" | "maxRedirects">> & {
    headers: Record<string, string>;
  },
  fetchFn: FetchLike,
  lookup: Lookup,
): Promise<HttpResult> {
  // One signal covers connecting, redirects and reading the body.
  const signal = AbortSignal.timeout(o.timeoutMs);
  let current = startUrl;

  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    // Re-validated on every hop, so a redirect to a private address is blocked.
    let url: URL;
    try {
      url = await assertSafeUrl(current, lookup);
    } catch (err) {
      throw new SkipRetry(err as Error);
    }

    let res: Response;
    try {
      res = await fetchFn(url, { method: "GET", redirect: "manual", headers: o.headers, signal });
    } catch (err) {
      if (isAbort(err)) throw new HttpTimeoutError(`Timed out after ${o.timeoutMs}ms: ${current}`);
      throw new HttpError(`Network error for ${current}: ${(err as Error).message}`);
    }

    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new SkipRetry(new HttpError("Redirect without Location", res.status));
      current = new URL(location, url).toString();
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      await res.body?.cancel();
      throw new HttpError(`HTTP ${res.status} for ${current}`, res.status);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new SkipRetry(new HttpError(`HTTP ${res.status} for ${current}`, res.status));
    }

    let bytes: Uint8Array;
    try {
      bytes = await readCapped(res, o.maxBytes);
    } catch (err) {
      if (err instanceof ResponseTooLargeError) throw new SkipRetry(err);
      if (isAbort(err)) throw new HttpTimeoutError(`Timed out reading body: ${current}`);
      throw new HttpError(`Read error for ${current}: ${(err as Error).message}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    return {
      url: url.toString(),
      status: res.status,
      contentType,
      text: decodeBody(bytes, contentType),
    };
  }
  throw new SkipRetry(new TooManyRedirectsError(`More than ${o.maxRedirects} redirects: ${startUrl}`));
}

/**
 * SSRF-guarded GET with timeout, size cap, manual redirect handling and retries.
 * Throws SsrfError, HttpError, HttpTimeoutError, ResponseTooLargeError or TooManyRedirectsError.
 */
export async function safeGet(
  url: string,
  options: HttpOptions = {},
  deps: HttpDeps,
): Promise<HttpResult> {
  const opts = { ...DEFAULTS, ...options };
  const headers = {
    "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT,
    ...options.headers,
  };
  const lookup = deps.lookup ?? defaultLookup;

  let lastError: Error | undefined;
  for (let i = 0; i <= opts.retries; i++) {
    try {
      return await attempt(url, { ...opts, headers }, deps.fetch, lookup);
    } catch (err) {
      if (err instanceof SkipRetry) throw err.inner;
      lastError = err as Error;
      if (i < opts.retries && opts.retryDelayMs > 0) {
        await new Promise((r) => setTimeout(r, opts.retryDelayMs * 2 ** i));
      }
    }
  }
  throw lastError ?? new HttpError(`Request failed: ${url}`);
}
