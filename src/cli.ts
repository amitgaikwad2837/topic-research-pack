#!/usr/bin/env node
import { research } from "./core/index.js";

const USAGE =
  'Usage: topic-research "<topic>" [--feed <rss-or-atom-url>]... [--pages <0-10>] [--references <0-50>] ' +
  "[--exclude <name,name>] [--no-robots] [--google] [--gdelt] [--json]";

const args = process.argv.slice(2);
const feeds: string[] = [];
const words: string[] = [];
const excludeSources: string[] = [];
let maxPages: number | undefined;
let maxReferences: number | undefined;
let respectRobotsTxt = true;
let enableGoogleSources = false;
let enableGdelt = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--feed") feeds.push(args[++i] ?? "");
  else if (a === "--pages") maxPages = Number(args[++i]);
  else if (a === "--references") maxReferences = Number(args[++i]);
  else if (a === "--exclude") {
    excludeSources.push(
      ...(args[++i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  } else if (a === "--no-robots") respectRobotsTxt = false;
  else if (a === "--google") enableGoogleSources = true;
  else if (a === "--gdelt") enableGdelt = true;
  else if (!a.startsWith("--")) words.push(a);
}
const topic = words.join(" ");

if (!topic) {
  console.error(USAGE);
  process.exit(1);
}

try {
  const pack = await research(
    {
      topic,
      rssFeeds: feeds,
      excludeSources,
      respectRobotsTxt,
      enableGoogleSources,
      enableGdelt,
      ...(maxPages !== undefined && { maxPages }),
      ...(maxReferences !== undefined && { maxReferences }),
    },
    { fetch },
  );
  console.log(JSON.stringify(pack, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  console.error(USAGE);
  process.exit(1);
}
