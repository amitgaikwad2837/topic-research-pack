import type { HttpDeps } from "./http.js";
import { HttpError, safeGet } from "./http.js";
import { SsrfError } from "./ssrf.js";

/** Product token matched against `User-agent:` lines. Must match the start of our User-Agent header. */
export const ROBOTS_TOKEN = "TopicResearchPack";

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

export interface RobotsRules {
  /** `pathAndQuery` looks like "/a/b?x=1". */
  isAllowed(pathAndQuery: string): boolean;
}

const ALLOW_ALL: RobotsRules = { isAllowed: () => true };
const DISALLOW_ALL: RobotsRules = { isAllowed: (p) => p === "/robots.txt" };

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}

/**
 * Parses robots.txt per RFC 9309: the group naming our token wins over `*`,
 * the longest matching rule wins, and Allow wins a tie.
 */
export function parseRobots(text: string, token: string = ROBOTS_TOKEN): RobotsRules {
  type Group = { agents: string[]; rules: Rule[] };
  const groups: Group[] = [];
  let current: Group | undefined;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current) continue;
      // An empty Disallow means "allow everything"; an empty Allow has no effect.
      if (!value) continue;
      current.rules.push({ allow: key === "allow", pattern: value, regex: patternToRegex(value) });
    } else {
      lastWasAgent = false;
    }
  }

  const mine = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.includes(mine));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);

  return {
    isAllowed(pathAndQuery) {
      if (pathAndQuery === "/robots.txt") return true;
      let best: Rule | undefined;
      for (const r of rules) {
        if (!r.regex.test(pathAndQuery)) continue;
        if (
          !best ||
          r.pattern.length > best.pattern.length ||
          (r.pattern.length === best.pattern.length && r.allow && !best.allow)
        ) {
          best = r;
        }
      }
      return best ? best.allow : true;
    },
  };
}

/**
 * Fetches and caches robots.txt per origin.
 * Per RFC 9309: missing (4xx) means allow everything; unreachable (5xx, 429, network, timeout,
 * too large) means disallow everything.
 */
export class RobotsChecker {
  private readonly cache = new Map<string, Promise<RobotsRules>>();

  constructor(
    private readonly deps: HttpDeps,
    private readonly token: string = ROBOTS_TOKEN,
  ) {}

  private load(origin: string): Promise<RobotsRules> {
    let p = this.cache.get(origin);
    if (!p) {
      p = this.fetchRules(origin);
      this.cache.set(origin, p);
    }
    return p;
  }

  private async fetchRules(origin: string): Promise<RobotsRules> {
    try {
      const res = await safeGet(`${origin}/robots.txt`, { maxBytes: 512 * 1024 }, this.deps);
      return parseRobots(res.text, this.token);
    } catch (err) {
      if (err instanceof SsrfError) throw err;
      if (err instanceof HttpError && err.status !== undefined && err.status >= 400 && err.status < 500 && err.status !== 429) {
        return ALLOW_ALL;
      }
      return DISALLOW_ALL;
    }
  }

  async isAllowed(rawUrl: string): Promise<boolean> {
    const url = new URL(rawUrl);
    const rules = await this.load(url.origin);
    return rules.isAllowed(`${url.pathname}${url.search}`);
  }
}
