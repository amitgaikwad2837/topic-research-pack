import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSafeUrl, isBlockedIp, SsrfError } from "../src/core/util/ssrf.js";

const publicLookup = async () => ["93.184.216.34"];

test("blocks private, loopback, link-local and reserved IPv4", () => {
  for (const ip of [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
  ]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
});

test("blocks private and mapped IPv6", () => {
  for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
});

test("allows public addresses", () => {
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"]) {
    assert.equal(isBlockedIp(ip), false, ip);
  }
});

test("treats non-IP strings as blocked", () => {
  assert.equal(isBlockedIp("not-an-ip"), true);
});

test("rejects non-http protocols", async () => {
  for (const u of ["file:///etc/passwd", "ftp://example.com/x", "gopher://example.com", "javascript:alert(1)"]) {
    await assert.rejects(() => assertSafeUrl(u, publicLookup), SsrfError, u);
  }
});

test("rejects invalid URLs and embedded credentials", async () => {
  await assert.rejects(() => assertSafeUrl("not a url", publicLookup), SsrfError);
  await assert.rejects(() => assertSafeUrl("https://user:pw@example.com/", publicLookup), SsrfError);
});

test("rejects IP literals in private ranges, including obfuscated forms", async () => {
  for (const u of [
    "http://127.0.0.1/",
    "http://localhost/",
    "http://[::1]/",
    "http://2130706433/", // decimal form of 127.0.0.1
    "http://0x7f.0.0.1/", // hex octet form
    "http://169.254.169.254/latest/meta-data/",
    "http://[::ffff:10.0.0.1]/",
  ]) {
    await assert.rejects(
      () => assertSafeUrl(u, async (h) => (h === "localhost" ? ["127.0.0.1"] : ["8.8.8.8"])),
      SsrfError,
      u,
    );
  }
});

test("rejects a hostname that resolves to a private address", async () => {
  await assert.rejects(() => assertSafeUrl("https://internal.example.com/", async () => ["10.0.0.5"]), SsrfError);
});

test("rejects when any resolved address is private", async () => {
  await assert.rejects(
    () => assertSafeUrl("https://mixed.example.com/", async () => ["8.8.8.8", "192.168.0.1"]),
    SsrfError,
  );
});

test("rejects a host that does not resolve to anything", async () => {
  await assert.rejects(() => assertSafeUrl("https://nothing.example.com/", async () => []), SsrfError);
});

test("accepts a public hostname", async () => {
  const url = await assertSafeUrl("https://example.com/path?q=1", publicLookup);
  assert.equal(url.hostname, "example.com");
});
