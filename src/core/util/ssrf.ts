import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

export class SsrfError extends Error {
  override name = "SsrfError";
}

/** Resolves a hostname to all of its IP addresses. Injected so tests never use DNS. */
export type Lookup = (hostname: string) => Promise<string[]>;

export const defaultLookup: Lookup = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

// Separate lists: Node's BlockList matches IPv4 against IPv6 rules as if IPv4-mapped,
// so the ::ffff:0:0/96 rule would otherwise block every IPv4 address.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();

const V4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
];

const V6_RANGES: Array<[string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::ffff:0:0", 96], // IPv4-mapped: blocked outright so mapped private IPs cannot slip through
  ["64:ff9b::", 96], // NAT64
  ["100::", 64], // discard-only
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

for (const [net, prefix] of V4_RANGES) blockedV4.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of V6_RANGES) blockedV6.addSubnet(net, prefix, "ipv6");

/** True when the address is private, loopback, link-local, reserved, or not a valid IP. */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return blockedV4.check(ip, "ipv4");
  if (version === 6) return blockedV6.check(ip, "ipv6");
  return true;
}

/**
 * Validates a URL for outbound fetching: http/https only, no embedded credentials,
 * and every resolved address must be public. Returns the parsed URL.
 */
export async function assertSafeUrl(
  rawUrl: string | URL,
  lookup: Lookup = defaultLookup,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Invalid URL: ${String(rawUrl)}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Blocked protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new SsrfError("Blocked URL with embedded credentials");
  }

  // URL keeps brackets around IPv6 literals.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new SsrfError("Blocked URL with empty host");

  const addresses = isIP(host) ? [host] : await lookup(host);
  if (addresses.length === 0) {
    throw new SsrfError(`Host did not resolve: ${host}`);
  }
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new SsrfError(`Blocked address for ${host}: ${address}`);
    }
  }
  return url;
}
