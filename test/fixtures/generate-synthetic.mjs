// Generates the SYNTHETIC test fixtures (all content invented, nothing copied from a real site).
// Their structure mirrors real responses that were checked while building the parsers: RSS 2.0 with
// CDATA and namespaces, Atom with alternate links, Google News `<source>` tags, Google Trends `ht:`
// tags, and a robots.txt with per-crawler groups. Run: node test/fixtures/generate-synthetic.mjs
import { writeFileSync } from "node:fs";

const out = (name, text) => writeFileSync(new URL(name, import.meta.url), text);
const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const rfc822 = (d) => d.toUTCString();

// ---- feed-rss.xml: 21 items, a few mention "Nvidia" ----
{
  const titles = [
    "Nvidia chip export probe widens, Example Corp says",
    "City council approves new tram line",
    "Startup unveils battery that charges in minutes",
    "Nvidia earnings beat forecasts as data centre demand grows",
    "Local team wins regional final",
    "Researchers map a new deep-sea ridge",
    "Airline announces winter schedule changes",
    "Open-source database project reaches version 2",
    "Museum reopens after restoration",
    "Chipmaker shares fall on supply worries",
    "New bridge opens to traffic",
    "Weather service warns of early snow",
    "Software update fixes widespread login bug",
    "Cloud provider cuts prices for storage",
    "School launches coding club for teens",
    "Farmers report record apple harvest",
    "Electric bus fleet expands to two more cities",
    "Library adds late-night opening hours",
    "Telescope captures image of distant cluster",
    "Bakery chain recalls seed loaves",
    "Concert tickets sell out in minutes",
  ];
  const base = Date.UTC(2026, 10, 15, 14, 56, 21);
  const items = titles
    .map((t, i) => {
      const when = rfc822(new Date(base - i * 3_600_000 * 2));
      return `        <item>
            <title><![CDATA[${t}]]></title>
            <description><![CDATA[Synthetic summary for item ${i + 1}. This text is invented for tests.]]></description>
            <link>https://news.example.com/articles/a${i + 1}?at_medium=RSS&amp;at_campaign=rss</link>
            <guid isPermaLink="false">https://news.example.com/articles/a${i + 1}#0</guid>
            <pubDate>${when}</pubDate>
            <media:thumbnail width="240" height="135" url="https://img.example.com/t${i + 1}.jpg"/>
        </item>`;
    })
    .join("\n");
  out(
    "feed-rss.xml",
    `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
    <channel>
        <title><![CDATA[Example Tech News]]></title>
        <description><![CDATA[Example Tech News - Technology (synthetic test feed)]]></description>
        <link>https://news.example.com/technology</link>
        <generator>synthetic fixture generator</generator>
        <lastBuildDate>${rfc822(new Date(base))}</lastBuildDate>
        <atom:link href="https://news.example.com/technology/rss.xml" rel="self" type="application/rss+xml"/>
${items}
    </channel>
</rss>
`,
  );
}

// ---- feed-atom.xml: Atom 1.0 with alternate links and escaped HTML summaries ----
{
  const entries = ["Synthetic Comic One", "Synthetic Comic Two", "Synthetic Comic Three"]
    .map((t, i) => {
      const n = 3324 - i;
      const d = `2026-11-${String(13 - i).padStart(2, "0")}T00:00:00Z`;
      return `<entry><title>${t}</title><link href="https://comics.example.com/${n}/" rel="alternate"></link><updated>${d}</updated><id>https://comics.example.com/${n}/</id><summary type="html">${esc(`<img src="https://img.example.com/c${n}.png" alt="invented ${n}">`)}</summary></entry>`;
    })
    .join("");
  out(
    "feed-atom.xml",
    `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en"><title>Example Comics</title><link href="https://comics.example.com/" rel="alternate"></link><id>https://comics.example.com/</id><updated>2026-11-13T00:00:00Z</updated>${entries}</feed>\n`,
  );
}

// ---- google-news.xml: RSS with <source url> and redirect-style links, 12 items ----
{
  const items = Array.from({ length: 12 }, (_, i) => {
    const publisher = i === 0 ? "Sample Source" : `Publisher ${i}`;
    const title = i === 0 ? "Example Corp and Sample Inc announce a new AI agent platform" : `Synthetic headline number ${i}`;
    const when = rfc822(new Date(Date.UTC(2026, 10, 10, 13, 9, 26) - i * 3_600_000));
    return `<item><title>${title} - ${publisher}</title><link>https://news.google.com/rss/articles/SYNTHETIC${i}?oc=5</link><guid isPermaLink="false">SYNTHETIC${i}</guid><pubDate>${when}</pubDate><description>Synthetic description ${i}</description><source url="https://${i === 0 ? "source" : `pub${i}`}.example.com">${publisher}</source></item>`;
  }).join("");
  out(
    "google-news.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><generator>synthetic fixture generator</generator><title>"ai agents when:7d" - synthetic</title><link>https://news.example.com/search</link><language>en-US</language><copyright>Synthetic test data, not a real feed.</copyright><lastBuildDate>${rfc822(new Date(Date.UTC(2026, 10, 15, 20, 51, 51)))}</lastBuildDate>${items}</channel></rss>\n`,
  );
}

// ---- google-trends.xml: ht: namespace, traffic strings, nested news items ----
{
  const rows = [
    ["zorblax conference", "1000+"],
    ["river festival", "2000+"],
    ["city marathon", "500+"],
    ["harvest moon", "200+"],
    ["tram line opening", "5000+"],
    ["winter schedule", "1000+"],
  ];
  const items = rows
    .map(
      ([title, traffic], i) => `\t\t<item>
\t\t\t<title>${title}</title>
\t\t\t<ht:approx_traffic>${traffic}</ht:approx_traffic>
\t\t\t<description/>
\t\t\t<link>https://trends.example.com/trending/rss?geo=US</link>
\t\t\t<pubDate>Sun, 15 Nov 2026 12:${String(30 - i).padStart(2, "0")}:00 -0800</pubDate>
\t\t\t<ht:news_item>
\t\t\t\t<ht:news_item_title>Synthetic story about the ${title}</ht:news_item_title>
\t\t\t\t<ht:news_item_snippet/>
\t\t\t\t<ht:news_item_url>https://news.example.com/stories/t${i}</ht:news_item_url>
\t\t\t\t<ht:news_item_source>Example Wire</ht:news_item_source>
\t\t\t</ht:news_item>
\t\t</item>`,
    )
    .join("\n");
  out(
    "google-trends.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:ht="https://trends.example.com/trending/rss" version="2.0">\n\t<channel>\n\t\t<title>Daily Search Trends (synthetic)</title>\n\t\t<description>Synthetic test data</description>\n${items}\n\t</channel>\n</rss>\n`,
  );
}

// ---- page-article.html: a news-style page with noise around one article ----
{
  const para = (n) =>
    `<p>Paragraph ${n}: analysts said the market for accelerator chips remained tight this quarter, with Nvidia and its rivals reporting strong orders from data centre customers. Suppliers warned that packaging capacity and memory supply could limit shipments into next year, while buyers continued to sign multi-year contracts to secure hardware. None of the people or companies in this synthetic article exist.</p>`;
  out(
    "page-article.html",
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Nvidia supply update shows tight chip market - Example Tech News</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>.nav{display:flex}.ad{height:90px}</style><script>window.__INITIAL_STATE__={"user":null,"flags":["a","b"]};</script></head><body><div id="root"><header><nav class="nav"><a href="/">Home</a><a href="/technology">Technology</a><a href="/business">Business</a></nav></header><div class="ad">Advertisement</div><main><article><h1>Nvidia supply update shows tight chip market</h1><p class="byline">By A. Writer, Example Tech News</p>${[1, 2, 3, 4, 5].map(para).join("")}<ul><li>Orders remain strong</li><li>Memory supply is limited</li></ul><p>Read more in <a href="/technology/chips">our chip coverage</a>.</p></article></main><aside><h2>Most read</h2><ul><li><a href="/a">Tram line approved</a></li><li><a href="/b">Apple harvest record</a></li></ul></aside><footer><p>Example Tech News is a fictional site. <a href="/terms">Terms</a></p><script>window.track&&window.track('view')</script></footer></div></body></html>\n`,
  );
}

// ---- robots-sample.txt: * group plus per-crawler groups, comments, sitemaps ----
out(
  "robots-sample.txt",
  `# Synthetic robots.txt for tests (not copied from a real site).
# Mirrors the structure of real files: a default group, then named crawler groups.

User-agent: *
Sitemap: https://news.example.com/sitemap.xml
Disallow: /asset/
Disallow: /backstage/login-help/
Disallow: /search$
Allow: /news/

User-agent: ClaudeBot
Disallow: /

User-agent: GPTBot
Disallow: /

User-agent: CCBot
User-agent: PerplexityBot
Disallow: /
`,
);
console.log("synthetic fixtures written");
