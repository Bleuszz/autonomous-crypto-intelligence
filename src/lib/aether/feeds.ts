import { SOURCE_RELIABILITY } from "./config.ts";
import { fetchJson, fetchText } from "./http.ts";
import { num, num0 } from "./math.ts";
import { iso, newsFreshness, nowIso } from "./time.ts";
import type { HealthPing, NormalizedNews, NormalizedSocial } from "./sources.ts";

export type PriceOverlay = { symbol: string; priceUsd: number; change24hPct: number | null; source: string };

export type MacroTape = {
  dxy: number | null;
  dxyChangePct: number | null;
  spx: number | null;
  spxChangePct: number | null;
  gold: number | null;
  goldChangePct: number | null;
};

export type DeskExtras = {
  health: HealthPing[];
  overlays: PriceOverlay[];
  fundingBtcPct: number | null;
  fundingEthPct: number | null;
  defiTvlUsd: number | null;
  stablecapUsd: number | null;
  mempoolFastSatVb: number | null;
  hashrateEh: number | null;
  paprikaCapUsd: number | null;
  paprikaVolUsd: number | null;
  btcNextHalvingDays: number | null;
  reddit: NormalizedSocial[];
  news: NormalizedNews[];
  macro: MacroTape;
  categories: { name: string; change24hPct: number | null }[];
};

function ping(source: string, ok: boolean, latencyMs: number, error: string | null, degraded = false): HealthPing {
  return {
    source,
    status: ok ? (degraded ? "degraded" : "up") : "down",
    latencyMs,
    error,
  };
}

function rssItems(xml: string, source: string, reliability: number): NormalizedNews[] {
  const chunks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];
  const ingestedAt = nowIso();
  const pick = (block: string, tag: string) => {
    const cdata = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"));
    if (cdata?.[1]) return cdata[1].trim();
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    return m?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
  };
  const pickAttr = (block: string, tag: string, attr: string) => {
    const m = block.match(new RegExp(`<${tag}[^>]*${attr}="([^"]+)"`, "i"));
    return m?.[1] ?? "";
  };
  return chunks.slice(0, 18).map((block, i) => {
    const title = pick(block, "title") || "Untitled";
    const url = pick(block, "link") || pickAttr(block, "link", "href") || null;
    const pub = pick(block, "pubDate") || pick(block, "published") || pick(block, "updated") || pick(block, "dc:date");
    const publishedAt = iso(pub);
    const summary = pick(block, "description") || pick(block, "summary");
    return {
      id: `${source}:${url ?? title}:${i}`,
      source,
      sourceReliability: reliability,
      title: title
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .slice(0, 240),
      url,
      summary: summary ? summary.replace(/&amp;/g, "&").replace(/<[^>]+>/g, "").slice(0, 400) : null,
      publishedAt,
      ingestedAt,
      freshness: newsFreshness(publishedAt),
    };
  });
}

async function fetchKrakenTickers(): Promise<{ overlays: PriceOverlay[]; health: HealthPing }> {
  const pairs = "XBTUSD,ETHUSD,SOLUSD,XRPUSD,ADAUSD,DOTUSD,LINKUSD,AVAXUSD,DOGEUSD,LTCUSD";
  const res = await fetchJson<{ result?: Record<string, { c?: string[]; o?: string | string[]; p?: string[] }> }>(
    `https://api.kraken.com/0/public/Ticker?pair=${pairs}`,
    { retries: 1, timeoutMs: 8_000 },
  );
  const map: Record<string, string> = {
    XXBTZUSD: "BTC",
    XETHZUSD: "ETH",
    SOLUSD: "SOL",
    XXRPZUSD: "XRP",
    ADAUSD: "ADA",
    DOTUSD: "DOT",
    LINKUSD: "LINK",
    AVAXUSD: "AVAX",
    XDGUSD: "DOGE",
    XLTCZUSD: "LTC",
  };
  const overlays: PriceOverlay[] = [];
  const result = res.data?.result ?? {};
  for (const [k, v] of Object.entries(result)) {
    const symbol = map[k] ?? k.replace(/USD$/, "").replace(/^X/, "");
    const px = num(v.c?.[0]);
    if (!px) continue;
    const openRaw = Array.isArray(v.o) ? v.o[0] : v.o;
    const open = num(openRaw);
    const chg = open ? ((px - open) / open) * 100 : null;
    overlays.push({ symbol, priceUsd: px, change24hPct: chg, source: "kraken" });
  }
  return { overlays, health: ping("kraken_ticker", res.ok && overlays.length > 0, res.latencyMs, res.error) };
}

async function fetchCoinbaseMore(): Promise<{ overlays: PriceOverlay[]; health: HealthPing }> {
  const products = ["XRP-USD", "LINK-USD", "AVAX-USD", "DOGE-USD", "ADA-USD", "LTC-USD"];
  const rows = await Promise.all(
    products.map(async (p) => {
      const r = await fetchJson<{ price?: string }>(`https://api.exchange.coinbase.com/products/${p}/ticker`, {
        retries: 0,
        timeoutMs: 6_000,
      });
      return { p, price: num(r.data?.price), ok: r.ok, latencyMs: r.latencyMs, error: r.error };
    }),
  );
  const overlays: PriceOverlay[] = [];
  for (const row of rows) {
    if (!row.price) continue;
    overlays.push({ symbol: row.p.split("-")[0]!, priceUsd: row.price, change24hPct: null, source: "coinbase" });
  }
  const ok = rows.some((r) => r.ok);
  return {
    overlays,
    health: ping("coinbase_alts", ok, Math.max(...rows.map((r) => r.latencyMs), 0), ok ? null : rows[0]?.error ?? "down"),
  };
}

async function fetchOkx(): Promise<{
  overlays: PriceOverlay[];
  fundingBtcPct: number | null;
  fundingEthPct: number | null;
  health: HealthPing[];
}> {
  const [tick, btcF, ethF] = await Promise.all([
    fetchJson<{ data?: Array<{ instId?: string; last?: string; sodUtc8?: string }> }>(
      "https://www.okx.com/api/v5/market/tickers?instType=SPOT",
      { retries: 1, timeoutMs: 8_000 },
    ),
    fetchJson<{ data?: Array<{ fundingRate?: string }> }>(
      "https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP",
      { retries: 0, timeoutMs: 6_000 },
    ),
    fetchJson<{ data?: Array<{ fundingRate?: string }> }>(
      "https://www.okx.com/api/v5/public/funding-rate?instId=ETH-USDT-SWAP",
      { retries: 0, timeoutMs: 6_000 },
    ),
  ]);
  const want = new Set(["BTC-USDT", "ETH-USDT", "SOL-USDT", "XRP-USDT", "DOGE-USDT", "LINK-USDT"]);
  const overlays: PriceOverlay[] = [];
  for (const row of tick.data?.data ?? []) {
    if (!row.instId || !want.has(row.instId)) continue;
    const px = num(row.last);
    if (!px) continue;
    const open = num(row.sodUtc8);
    const chg = open ? ((px - open) / open) * 100 : null;
    overlays.push({ symbol: row.instId.replace("-USDT", ""), priceUsd: px, change24hPct: chg, source: "okx" });
  }
  return {
    overlays,
    fundingBtcPct: num(btcF.data?.data?.[0]?.fundingRate) != null ? num0(btcF.data?.data?.[0]?.fundingRate) * 100 : null,
    fundingEthPct: num(ethF.data?.data?.[0]?.fundingRate) != null ? num0(ethF.data?.data?.[0]?.fundingRate) * 100 : null,
    health: [
      ping("okx", tick.ok && overlays.length > 0, tick.latencyMs, tick.error),
      ping("okx_funding", btcF.ok || ethF.ok, Math.max(btcF.latencyMs, ethF.latencyMs), btcF.ok ? null : btcF.error),
    ],
  };
}

async function fetchDefiLlama(): Promise<{ tvl: number | null; stables: number | null; health: HealthPing[] }> {
  const [chains, stables] = await Promise.all([
    fetchJson<Array<{ tvl?: number }>>("https://api.llama.fi/v2/chains", { retries: 1, timeoutMs: 10_000 }),
    fetchJson<{ peggedAssets?: Array<{ circulating?: { peggedUSD?: number } }> }>(
      "https://stablecoins.llama.fi/stablecoins?includePrices=true",
      { retries: 0, timeoutMs: 8_000 },
    ),
  ]);
  const tvl = Array.isArray(chains.data) ? chains.data.reduce((a, c) => a + num0(c.tvl), 0) : null;
  const stableSum = (stables.data?.peggedAssets ?? []).reduce((a, s) => a + num0(s.circulating?.peggedUSD), 0);
  return {
    tvl: tvl && tvl > 0 ? tvl : null,
    stables: stableSum > 0 ? stableSum : null,
    health: [
      ping("defillama", chains.ok && !!tvl, chains.latencyMs, chains.error),
      ping("defillama_stables", stables.ok && stableSum > 0, stables.latencyMs, stables.error),
    ],
  };
}

async function fetchMempool(): Promise<{ fast: number | null; hashrateEh: number | null; health: HealthPing[] }> {
  const [fees, hr] = await Promise.all([
    fetchJson<{ fastestFee?: number; halfHourFee?: number }>("https://mempool.space/api/v1/fees/recommended", {
      retries: 1,
      timeoutMs: 8_000,
    }),
    fetchJson<{ currentHashrate?: number }>("https://mempool.space/api/v1/mining/hashrate/3d", {
      retries: 0,
      timeoutMs: 8_000,
    }),
  ]);
  const hs = num(hr.data?.currentHashrate);
  return {
    fast: num(fees.data?.fastestFee) ?? num(fees.data?.halfHourFee),
    hashrateEh: hs != null ? hs / 1e18 : null,
    health: [
      ping("mempool_fees", fees.ok, fees.latencyMs, fees.error),
      ping("mempool_hashrate", hr.ok, hr.latencyMs, hr.error),
    ],
  };
}

async function fetchCoinPaprika(): Promise<{ cap: number | null; vol: number | null; health: HealthPing }> {
  const res = await fetchJson<{ market_cap_usd?: number; volume_24h_usd?: number }>(
    "https://api.coinpaprika.com/v1/global",
    { retries: 1, timeoutMs: 8_000 },
  );
  return {
    cap: num(res.data?.market_cap_usd),
    vol: num(res.data?.volume_24h_usd),
    health: ping("coinpaprika", res.ok, res.latencyMs, res.error),
  };
}

async function fetchBlockchainStats(): Promise<{ days: number | null; health: HealthPing }> {
  const res = await fetchJson<{ n_blocks_total?: number; minutes_between_blocks?: number }>(
    "https://api.blockchain.info/stats",
    { retries: 0, timeoutMs: 8_000 },
  );
  // Halving every 210,000 blocks. Next after 840,000 is 1,050,000.
  const height = num(res.data?.n_blocks_total);
  let days: number | null = null;
  if (height != null) {
    const era = Math.floor(height / 210_000);
    const next = (era + 1) * 210_000;
    const remain = next - height;
    const mins = num(res.data?.minutes_between_blocks) ?? 10;
    days = (remain * mins) / (60 * 24);
  }
  return { days, health: ping("blockchain_info", res.ok, res.latencyMs, res.error) };
}

async function fetchYahooMacro(): Promise<{ macro: MacroTape; health: HealthPing }> {
  const symbols = ["DX-Y.NYB", "%5EGSPC", "GC=F"];
  const rows = await Promise.all(
    symbols.map(async (s) => {
      const r = await fetchJson<{
        chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; previousClose?: number; chartPreviousClose?: number } }> };
      }>(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=1d&range=5d`, { retries: 0, timeoutMs: 7_000 });
      const meta = r.data?.chart?.result?.[0]?.meta;
      const px = num(meta?.regularMarketPrice);
      const prev = num(meta?.previousClose) ?? num(meta?.chartPreviousClose);
      const chg = px != null && prev ? ((px - prev) / prev) * 100 : null;
      return { s, px, chg, ok: r.ok, latencyMs: r.latencyMs, error: r.error };
    }),
  );
  const pick = (i: number) => rows[i];
  const ok = rows.some((r) => r.ok && r.px != null);
  return {
    macro: {
      dxy: pick(0)?.px ?? null,
      dxyChangePct: pick(0)?.chg ?? null,
      spx: pick(1)?.px ?? null,
      spxChangePct: pick(1)?.chg ?? null,
      gold: pick(2)?.px ?? null,
      goldChangePct: pick(2)?.chg ?? null,
    },
    health: ping("yahoo_macro", ok, Math.max(...rows.map((r) => r.latencyMs), 0), ok ? null : rows[0]?.error ?? "down"),
  };
}

async function fetchReddit(): Promise<{ posts: NormalizedSocial[]; health: HealthPing }> {
  const subs = ["CryptoCurrency", "bitcoin", "ethereum", "solana"];
  const ingestedAt = nowIso();
  const results = await Promise.all(
    subs.map((sub) =>
      fetchJson<{ data?: { children?: Array<{ data?: Record<string, unknown> }> } }>(
        `https://www.reddit.com/r/${sub}/hot.json?limit=8&raw_json=1`,
        { retries: 0, timeoutMs: 8_000 },
      ).then((r) => ({ sub, ...r })),
    ),
  );
  const posts: NormalizedSocial[] = [];
  for (const r of results) {
    for (const child of r.data?.data?.children ?? []) {
      const d = child.data ?? {};
      const title = typeof d.title === "string" ? d.title : "";
      if (!title) continue;
      const permalink = typeof d.permalink === "string" ? d.permalink : "";
      const created = num(d.created_utc);
      posts.push({
        id: `reddit:${r.sub}:${String(d.id ?? title).slice(0, 80)}`,
        platform: "reddit",
        author: typeof d.author === "string" ? `u/${d.author}` : r.sub,
        url: permalink ? `https://www.reddit.com${permalink}` : null,
        body: title.slice(0, 500),
        engagement: num(d.score),
        publishedAt: created ? new Date(created * 1000).toISOString() : ingestedAt,
        ingestedAt,
        sourceReliability: SOURCE_RELIABILITY.reddit,
      });
    }
  }
  const ok = results.some((r) => r.ok);
  return { posts, health: ping("reddit", ok && posts.length > 0, Math.max(...results.map((r) => r.latencyMs), 0), ok ? null : results[0]?.error ?? "down") };
}

async function fetchMoreNews(): Promise<{ articles: NormalizedNews[]; health: HealthPing[] }> {
  const feeds: { source: string; url: string; rel: number }[] = [
    { source: "bitcoinmagazine", url: "https://bitcoinmagazine.com/.rss/full/", rel: 0.74 },
    { source: "cryptoslate", url: "https://cryptoslate.com/feed/", rel: 0.66 },
    { source: "blockworks", url: "https://blockworks.co/feed/", rel: 0.72 },
    { source: "thedefiant", url: "https://thedefiant.io/api/feed", rel: 0.7 },
    { source: "ethereum_blog", url: "https://blog.ethereum.org/en/feed.xml", rel: SOURCE_RELIABILITY.ethereum_blog },
    { source: "solana_status", url: "https://status.solana.com/history.rss", rel: SOURCE_RELIABILITY.solana_status },
  ];
  const results = await Promise.all(
    feeds.map(async (f) => {
      const res = await fetchText(f.url, { retries: 0, timeoutMs: 8_000 });
      const xml = typeof res.data === "string" ? res.data : "";
      const articles = res.ok && xml.includes("<") ? rssItems(xml, f.source, f.rel) : [];
      return {
        articles,
        health: ping(`news:${f.source}`, res.ok && articles.length > 0, res.latencyMs, res.ok ? (articles.length ? null : "empty feed") : res.error, res.ok && !articles.length),
      };
    }),
  );
  return { articles: results.flatMap((r) => r.articles), health: results.map((r) => r.health) };
}

async function fetchCategories(): Promise<{ items: { name: string; change24hPct: number | null }[]; health: HealthPing }> {
  const res = await fetchJson<Array<{ name?: string; market_cap_change_24h?: number }>>(
    "https://api.coingecko.com/api/v3/coins/categories",
    { retries: 0, timeoutMs: 10_000 },
  );
  const items = (Array.isArray(res.data) ? res.data : [])
    .slice(0, 12)
    .map((c) => ({ name: String(c.name ?? ""), change24hPct: num(c.market_cap_change_24h) }))
    .filter((c) => c.name);
  return { items, health: ping("coingecko_categories", res.ok && items.length > 0, res.latencyMs, res.error) };
}

async function fetchBinance(): Promise<{
  overlays: PriceOverlay[];
  fundingBtcPct: number | null;
  fundingEthPct: number | null;
  health: HealthPing[];
}> {
  const symbols = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "BNBUSDT",
    "DOGEUSDT",
    "ADAUSDT",
    "AVAXUSDT",
    "LINKUSDT",
    "DOTUSDT",
    "LTCUSDT",
    "SUIUSDT",
    "NEARUSDT",
    "APTUSDT",
    "ATOMUSDT",
  ];
  const qs = encodeURIComponent(JSON.stringify(symbols));
  const [spot, btcP, ethP] = await Promise.all([
    fetchJson<Array<{ symbol?: string; lastPrice?: string; priceChangePercent?: string }>>(
      `https://api.binance.com/api/v3/ticker/24hr?symbols=${qs}`,
      { retries: 0, timeoutMs: 8_000 },
    ),
    fetchJson<{ markPrice?: string; lastFundingRate?: string }>(
      "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT",
      { retries: 0, timeoutMs: 6_000 },
    ),
    fetchJson<{ markPrice?: string; lastFundingRate?: string }>(
      "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=ETHUSDT",
      { retries: 0, timeoutMs: 6_000 },
    ),
  ]);
  const overlays: PriceOverlay[] = [];
  const rows = Array.isArray(spot.data) ? spot.data : [];
  for (const row of rows) {
    const px = num(row.lastPrice);
    if (!px || !row.symbol) continue;
    overlays.push({
      symbol: row.symbol.replace(/USDT$/, ""),
      priceUsd: px,
      change24hPct: num(row.priceChangePercent),
      source: "binance",
    });
  }
  const fund = (raw: string | undefined) => (num(raw) != null ? num0(raw) * 100 : null);
  return {
    overlays,
    fundingBtcPct: fund(btcP.data?.lastFundingRate),
    fundingEthPct: fund(ethP.data?.lastFundingRate),
    health: [
      ping("binance", spot.ok && overlays.length > 0, spot.latencyMs, spot.error),
      ping("binance_funding", btcP.ok || ethP.ok, Math.max(btcP.latencyMs, ethP.latencyMs), btcP.ok ? null : btcP.error),
    ],
  };
}

async function fetchCoinCap(): Promise<{ overlays: PriceOverlay[]; health: HealthPing }> {
  const res = await fetchJson<{
    data?: Array<{ symbol?: string; priceUsd?: string; changePercent24Hr?: string; volumeUsd24Hr?: string }>;
  }>("https://api.coincap.io/v2/assets?limit=40", { retries: 0, timeoutMs: 8_000 });
  const overlays: PriceOverlay[] = [];
  for (const row of res.data?.data ?? []) {
    const px = num(row.priceUsd);
    if (!px || !row.symbol) continue;
    overlays.push({
      symbol: String(row.symbol).toUpperCase(),
      priceUsd: px,
      change24hPct: num(row.changePercent24Hr),
      source: "coincap",
    });
  }
  return { overlays, health: ping("coincap", res.ok && overlays.length > 0, res.latencyMs, res.error) };
}

export async function fetchDeskExtras(): Promise<DeskExtras> {
  const [kraken, cb, okx, llama, mempool, paprika, chain, yahoo, reddit, news, cats, binance, coincap] = await Promise.all([
    fetchKrakenTickers(),
    fetchCoinbaseMore(),
    fetchOkx(),
    fetchDefiLlama(),
    fetchMempool(),
    fetchCoinPaprika(),
    fetchBlockchainStats(),
    fetchYahooMacro(),
    fetchReddit(),
    fetchMoreNews(),
    fetchCategories(),
    fetchBinance(),
    fetchCoinCap(),
  ]);

  return {
    health: [
      kraken.health,
      cb.health,
      ...okx.health,
      ...llama.health,
      ...mempool.health,
      paprika.health,
      chain.health,
      yahoo.health,
      reddit.health,
      ...news.health,
      cats.health,
      ...binance.health,
      coincap.health,
    ],
    // Later overlays win. CoinCap is an aggregator; CEX last-prints are preferred.
    overlays: [...coincap.overlays, ...kraken.overlays, ...cb.overlays, ...okx.overlays, ...binance.overlays],
    fundingBtcPct: okx.fundingBtcPct ?? binance.fundingBtcPct,
    fundingEthPct: okx.fundingEthPct ?? binance.fundingEthPct,
    defiTvlUsd: llama.tvl,
    stablecapUsd: llama.stables,
    mempoolFastSatVb: mempool.fast,
    hashrateEh: mempool.hashrateEh,
    paprikaCapUsd: paprika.cap,
    paprikaVolUsd: paprika.vol,
    btcNextHalvingDays: chain.days,
    reddit: reddit.posts,
    news: news.articles,
    macro: yahoo.macro,
    categories: cats.items,
  };
}
