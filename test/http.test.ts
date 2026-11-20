import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HttpError,
  HttpTimeoutError,
  ResponseTooLargeError,
  safeGet,
  TooManyRedirectsError,
} from "../src/core/util/http.js";
import { SsrfError } from "../src/core/util/ssrf.js";

const lookup = async (host: string) => (host === "internal.test" ? ["10.0.0.1"] : ["93.184.216.34"]);
const fast = { retryDelayMs: 0 };

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

test("returns text, final url and content type", async () => {
  const f = fakeFetch(() => new Response("hello", { headers: { "content-type": "text/plain" } }));
  const res = await safeGet("https://example.com/a", fast, { fetch: f.fetch, lookup });
  assert.equal(res.text, "hello");
  assert.equal(res.status, 200);
  assert.equal(res.contentType, "text/plain");
  assert.equal(res.url, "https://example.com/a");
});

test("sends the honest User-Agent and uses manual redirects", async () => {
  let seen: RequestInit | undefined;
  const f = fakeFetch((_u, init) => {
    seen = init;
    return new Response("ok");
  });
  await safeGet("https://example.com/", fast, { fetch: f.fetch, lookup });
  assert.match(String((seen?.headers as Record<string, string>)["user-agent"]), /TopicResearchPack/);
  assert.equal(seen?.redirect, "manual");
});

test("blocks a private target before any request is made", async () => {
  const f = fakeFetch(() => new Response("secret"));
  await assert.rejects(() => safeGet("http://internal.test/", fast, { fetch: f.fetch, lookup }), SsrfError);
  assert.equal(f.calls.length, 0);
});

test("follows a redirect to a public host", async () => {
  const f = fakeFetch((url) =>
    url === "https://example.com/start"
      ? new Response(null, { status: 302, headers: { location: "/final" } })
      : new Response("done"),
  );
  const res = await safeGet("https://example.com/start", fast, { fetch: f.fetch, lookup });
  assert.equal(res.text, "done");
  assert.equal(res.url, "https://example.com/final");
});

test("blocks a redirect to a private address and never requests it", async () => {
  const f = fakeFetch(() => new Response(null, { status: 302, headers: { location: "http://internal.test/admin" } }));
  await assert.rejects(() => safeGet("https://example.com/", fast, { fetch: f.fetch, lookup }), SsrfError);
  assert.deepEqual(f.calls, ["https://example.com/"]);
});

test("blocks a redirect to a metadata IP literal", async () => {
  const f = fakeFetch(() => new Response(null, { status: 301, headers: { location: "http://169.254.169.254/" } }));
  await assert.rejects(() => safeGet("https://example.com/", fast, { fetch: f.fetch, lookup }), SsrfError);
});

test("stops redirect loops", async () => {
  const f = fakeFetch(() => new Response(null, { status: 302, headers: { location: "/again" } }));
  await assert.rejects(
    () => safeGet("https://example.com/", { ...fast, maxRedirects: 3 }, { fetch: f.fetch, lookup }),
    TooManyRedirectsError,
  );
  assert.equal(f.calls.length, 4);
});

test("rejects when content-length exceeds the cap", async () => {
  const f = fakeFetch(() => new Response("x", { headers: { "content-length": "5000" } }));
  await assert.rejects(
    () => safeGet("https://example.com/", { ...fast, maxBytes: 100 }, { fetch: f.fetch, lookup }),
    ResponseTooLargeError,
  );
});

test("rejects when the streamed body exceeds the cap with no content-length", async () => {
  const f = fakeFetch(() => new Response("x".repeat(5000)));
  await assert.rejects(
    () => safeGet("https://example.com/", { ...fast, maxBytes: 100 }, { fetch: f.fetch, lookup }),
    ResponseTooLargeError,
  );
});

test("retries 5xx and then succeeds", async () => {
  let n = 0;
  const f = fakeFetch(() => (++n < 3 ? new Response("err", { status: 503 }) : new Response("fine")));
  const res = await safeGet("https://example.com/", { ...fast, retries: 2 }, { fetch: f.fetch, lookup });
  assert.equal(res.text, "fine");
  assert.equal(f.calls.length, 3);
});

test("gives up after the retry budget on persistent 5xx", async () => {
  const f = fakeFetch(() => new Response("err", { status: 500 }));
  await assert.rejects(
    () => safeGet("https://example.com/", { ...fast, retries: 1 }, { fetch: f.fetch, lookup }),
    (e: unknown) => e instanceof HttpError && e.status === 500,
  );
  assert.equal(f.calls.length, 2);
});

test("does not retry a 404", async () => {
  const f = fakeFetch(() => new Response("nope", { status: 404 }));
  await assert.rejects(
    () => safeGet("https://example.com/", { ...fast, retries: 3 }, { fetch: f.fetch, lookup }),
    (e: unknown) => e instanceof HttpError && e.status === 404,
  );
  assert.equal(f.calls.length, 1);
});

test("times out a request that never answers", async () => {
  const f = fakeFetch(
    (_u, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
  await assert.rejects(
    () => safeGet("https://example.com/", { ...fast, timeoutMs: 30, retries: 0 }, { fetch: f.fetch, lookup }),
    HttpTimeoutError,
  );
});

test("wraps network failures as HttpError after retries", async () => {
  const f = fakeFetch(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(
    () => safeGet("https://example.com/", { ...fast, retries: 1 }, { fetch: f.fetch, lookup }),
    HttpError,
  );
  assert.equal(f.calls.length, 2);
});
