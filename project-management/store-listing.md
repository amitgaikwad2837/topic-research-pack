# Store listing text (draft)

Apify's docs give no hard character limits for title or description (checked 2026-11-16); keep both short anyway.

## Title

Topic Research Pack: News, Trends, Keywords and Page Text

## Description (one sentence, shown in search results)

One topic in, one research pack out: recent news, trend signals, keyword ideas and clean markdown from the top articles, ready for AI agents and RAG.

## Longer intro (first paragraph of the Store README)

Topic Research Pack turns a topic or keyword into a single JSON object: recent news from public sources, Wikipedia trend signals, keyword ideas, and the readable text of the top articles as markdown. It also ships as an MCP server so any AI agent can call it as a tool. If a source is down, the rest of the pack is still returned and the problem is listed in `errors`.

## Keywords to work into headings

topic research, news and trends, keyword ideas, web page to markdown, RAG, LLM context, MCP server, AI agent tool.

## Categories

Choose in Console from its own list (names not verified here). Likely fits: AI, SEO tools, News.

## Required honesty points (do not remove)

- Google sources are off by default and subject to Google's terms; the Google News feed is stated to be for personal, non-commercial use.
- robots.txt is respected by default, and passing robots.txt does not mean a site's terms allow automated use.
- Pages that need JavaScript to render may return little text.
- Not included: GDELT.

## FAQ (for the Store README)

**Does it scrape Google?** Not by default. Optional Google sources use unofficial feed endpoints and are off unless you enable them. It never scrapes Google result pages directly.

**Why is a page missing from `pages`?** robots.txt disallowed it, it was not HTML, it failed to load, or it needs JavaScript. The reason is listed in `errors`.

**Am I charged if everything fails?** No. A run where no source returned data is marked failed and is not charged.

**Can an agent turn off robots.txt checking?** No. That is a server setting, not a tool argument.
