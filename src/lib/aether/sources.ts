import { CHAIN_TO_GOPLUS, GT_NETWORKS, GT_TO_CHAIN, SOURCE_RELIABILITY } from "./config";
import { X_MAX_RESULTS, X_SEARCH_QUERY } from "./xbudget";
import { fetchJson, fetchText } from "./http";
import { num, num0 } from "./math";
import { iso, newsFreshness, nowIso } from "./time";
import type { FreshnessBand } from "./types";
import { parseGoPlus, type TokenSecurity } from "./risk";

export type HealthPing = {
  source: string;
  status: "up" | "degraded" | "down";
  latencyMs: number;
  error: string | null;
};

export type NormalizedAsset = {
  id: string;
  symbol: string;
  name: string;
  kind: "major" | "dex" | "stable" | "unknown";
  chainId: string | null;
  contractAddress: string | null;
  coingeckoId: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  change1hPct: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  pairCreatedAt: string | null;
  sparkline7d: number[] | null;
  source: string;
  sourceReliability: number;
  observedAt: string;
  sourceTimestamp: string | null;
};

export type NormalizedPool = {
  id: string;
  assetId: string;
  chainId: string;
  address: string;
  dex: string | null;
  name: string;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  volume1hUsd: number | null;
  volume5mUsd: number | null;
  txns24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  priceUsd: number | null;
  fdvUsd: number | null;
  createdAt: string | null;
  observedAt: string;
  source: string;
};

export type NormalizedNews = {
  id: string;
  source: string;
  sourceReliability: number;
  title: string;
  url: string | null;
  summary: string | null;
  publishedAt: string | null;
  ingestedAt: string;
  freshness: FreshnessBand;
};

export type NormalizedMarket = {
  id: string;
  eventId: string | null;
  slug: string | null;
  question: string;
  category: string | null;
  endDate: string | null;
  closed: boolean;
  volume: number | null;
  volume24h: number | null;
  liquidity: number | null;
  probability: number | null;
  url: string | null;
  observedAt: string;
};

export type NormalizedSocial = {
  id: string;
  platform: string;
  author: string | null;
  url: string | null;
  body: string;
  engagement: number | null;
  publishedAt: string | null;
  ingestedAt: string;
  sourceReliability: number;
};

export type NormalizedTrade = {
  id: string;
  chainId: string;
  poolId: string;
  txHash: string | null;
  wallet: string | null;
  side: "buy" | "sell" | null;
  priceUsd: number | null;
  notionalUsd: number | null;
  observedAt: string;
  source: string;
};

export type Candle = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const STABLES = new Set(["usdt", "usdc", "dai", "usd1", "usde", "busd", "tusd", "fdusd", "usds"]);

function kindFor(symbol: string, cgId: string | null, dex: boolean): NormalizedAsset["kind"] {
  if (STABLES.has(symbol.toLowerCase())) return "stable";
  if (dex && !cgId) return "dex";
  if (cgId) return "major";
  return dex ? "dex" : "unknown";
}

export async function fetchCoinGeckoMarkets(perPage = 100): Promise<{ assets: NormalizedAsset[]; health: HealthPing; dominance: number | null }> {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=true&price_change_percentage=1h,24h,7d`;
  const res = await fetchJson<Array<Record<string, unknown>>>(url, { retries: 2, timeoutMs: 14_000 });
  const health: HealthPing = {
    source: "coingecko",
    status: res.ok ? "up" : "down",
    latencyMs: res.latencyMs,
    error: res.error,
  };
  if (!res.ok || !Array.isArray(res.data)) return { assets: [], health, dominance: null };
  const now = nowIso();
  const assets: NormalizedAsset[] = res.data.map((c) => {
    const symbol = String(c.symbol ?? "").toUpperCase();
    const id = String(c.id ?? symbol);
    const spark = (c.sparkline_in_7d as { price?: number[] } | undefined)?.price ?? null;
    return {
      id: `cg:${id}`,
      symbol,
      name: String(c.name ?? symbol),
      kind: kindFor(symbol, id, false),
      chainId: null,
      contractAddress: null,
      coingeckoId: id,
      imageUrl: typeof c.image === "string" ? c.image : null,
      priceUsd: num(c.current_price),
      marketCapUsd: num(c.market_cap),
      fdvUsd: num(c.fully_diluted_valuation),
      volume24hUsd: num(c.total_volume),
      liquidityUsd: num(c.total_volume),
      change1hPct: num(c.price_change_percentage_1h_in_currency),
      change24hPct: num(c.price_change_percentage_24h_in_currency) ?? num(c.price_change_percentage_24h),
      change7dPct: num(c.price_change_percentage_7d_in_currency),
      pairCreatedAt: null,
      sparkline7d: Array.isArray(spark) ? spark.filter((x) => Number.isFinite(x)).slice(-48) : null,
      source: "coingecko",
      sourceReliability: SOURCE_RELIABILITY.coingecko,
      observedAt: iso(c.last_updated) ?? now,
      sourceTimestamp: iso(c.last_updated),
    };
  });
  return { assets, health, dominance: null };
}

export async function fetchCoinGeckoGlobal(): Promise<{ dominance: number | null; health: HealthPing }> {
  const res = await fetchJson<{ data?: { market_cap_percentage?: { btc?: number } } }>(
    "https://api.coingecko.com/api/v3/global",
    { retries: 1 },
  );
  return {
    dominance: num(res.data?.data?.market_cap_percentage?.btc),
    health: {
      source: "coingecko_global",
      status: res.ok ? "up" : "down",
      latencyMs: res.latencyMs,
      error: res.error,
    },
  };
}

export async function fetchTrending(): Promise<{ items: { id: string; name: string; symbol: string; rank: number }[]; health: HealthPing }> {
  const res = await fetchJson<{ coins?: Array<{ item?: Record<string, unknown> }> }>(
    "https://api.coingecko.com/api/v3/search/trending",
    { retries: 1 },
  );
  const items =
    res.data?.coins?.map((c, i) => ({
      id: String(c.item?.id ?? ""),
      name: String(c.item?.name ?? ""),
      symbol: String(c.item?.symbol ?? "").toUpperCase(),
      rank: i + 1,
    })) ?? [];
  return {
    items: items.filter((x) => x.id),
    health: {
      source: "coingecko_trending",
      status: res.ok ? "up" : "down",
      latencyMs: res.latencyMs,
      error: res.error,
    },
  };
}

type DsPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  url?: string;
  pairCreatedAt?: number;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  volume?: { h24?: number; h1?: number; m5?: number };
  priceChange?: { h1?: number; h24?: number; h6?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
};

function fromDsPair(p: DsPair): { asset: NormalizedAsset; pool: NormalizedPool } | null {
  const base = p.baseToken;
  if (!base?.address || !base.symbol) return null;
  const chain = (p.chainId ?? "unknown").toLowerCase();
  const addr = base.address;
  const id = `${chain}:${addr.toLowerCase()}`;
  const now = nowIso();
  const created = p.pairCreatedAt ? iso(p.pairCreatedAt) : null;
  const liq = num(p.liquidity?.usd);
  const vol = num(p.volume?.h24);
  const asset: NormalizedAsset = {
    id,
    symbol: base.symbol.toUpperCase(),
    name: base.name ?? base.symbol,
    kind: kindFor(base.symbol, null, true),
    chainId: chain,
    contractAddress: addr,
    coingeckoId: null,
    imageUrl: null,
    priceUsd: num(p.priceUsd),
    marketCapUsd: num(p.marketCap),
    fdvUsd: num(p.fdv),
    volume24hUsd: vol,
    liquidityUsd: liq,
    change1hPct: num(p.priceChange?.h1),
    change24hPct: num(p.priceChange?.h24),
    change7dPct: null,
    pairCreatedAt: created,
    sparkline7d: null,
    source: "dexscreener",
    sourceReliability: SOURCE_RELIABILITY.dexscreener,
    observedAt: now,
    sourceTimestamp: now,
  };
  const pool: NormalizedPool = {
    id: `${chain}:${(p.pairAddress ?? addr).toLowerCase()}`,
    assetId: id,
    chainId: chain,
    address: p.pairAddress ?? addr,
    dex: p.dexId ?? null,
    name: `${base.symbol}/${p.quoteToken?.symbol ?? "?"}`,
    liquidityUsd: liq,
    volume24hUsd: vol,
    volume1hUsd: num(p.volume?.h1),
    volume5mUsd: num(p.volume?.m5),
    txns24h: (p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0),
    buys24h: p.txns?.h24?.buys ?? null,
    sells24h: p.txns?.h24?.sells ?? null,
    priceUsd: num(p.priceUsd),
    fdvUsd: num(p.fdv),
    createdAt: created,
    observedAt: now,
    source: "dexscreener",
  };
  return { asset, pool };
}

export async function fetchDexScreenerDiscovery(): Promise<{
  assets: NormalizedAsset[];
  pools: NormalizedPool[];
  social: NormalizedSocial[];
  health: HealthPing;
}> {
  const [boosts, top, profiles] = await Promise.all([
    fetchJson<Array<Record<string, unknown>>>("https://api.dexscreener.com/token-boosts/latest/v1"),
    fetchJson<Array<Record<string, unknown>>>("https://api.dexscreener.com/token-boosts/top/v1"),
    fetchJson<Array<Record<string, unknown>>>("https://api.dexscreener.com/token-profiles/latest/v1"),
  ]);
  const latency = Math.max(boosts.latencyMs, top.latencyMs, profiles.latencyMs);
  const ok = boosts.ok || top.ok || profiles.ok;
  const tokens = new Map<string, { chainId: string; tokenAddress: string; description?: string; url?: string; links?: { type?: string; url?: string }[] }>();
  for (const list of [boosts.data, top.data, profiles.data]) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      const chainId = String(row.chainId ?? "");
      const tokenAddress = String(row.tokenAddress ?? "");
      if (!chainId || !tokenAddress) continue;
      tokens.set(`${chainId}:${tokenAddress.toLowerCase()}`, {
        chainId,
        tokenAddress,
        description: typeof row.description === "string" ? row.description : undefined,
        url: typeof row.url === "string" ? row.url : undefined,
        links: Array.isArray(row.links) ? (row.links as { type?: string; url?: string }[]) : undefined,
      });
    }
  }

  const byChain = new Map<string, string[]>();
  for (const t of tokens.values()) {
    const arr = byChain.get(t.chainId) ?? [];
    arr.push(t.tokenAddress);
    byChain.set(t.chainId, arr);
  }

  const assets: NormalizedAsset[] = [];
  const pools: NormalizedPool[] = [];
  const seen = new Set<string>();

  const chainEntries = [...byChain.entries()].slice(0, 8);
  for (const [chain, addrs] of chainEntries) {
    const chunk = addrs.slice(0, 25);
    const url = `https://api.dexscreener.com/tokens/v1/${chain}/${chunk.join(",")}`;
    const res = await fetchJson<DsPair[] | { pairs?: DsPair[] }>(url, { retries: 1, timeoutMs: 10_000 });
    const pairs: DsPair[] = Array.isArray(res.data) ? res.data : (res.data?.pairs ?? []);
    for (const p of pairs) {
      const parsed = fromDsPair(p);
      if (!parsed) continue;
      if (!seen.has(parsed.asset.id)) {
        assets.push(parsed.asset);
        seen.add(parsed.asset.id);
      }
      pools.push(parsed.pool);
    }
  }

  const social: NormalizedSocial[] = [];
  const ingestedAt = nowIso();
  for (const t of tokens.values()) {
    const twitter = t.links?.find((l) => (l.type ?? "").toLowerCase() === "twitter" || (l.url ?? "").includes("x.com") || (l.url ?? "").includes("twitter.com"));
    if (t.description) {
      social.push({
        id: `ds:${t.chainId}:${t.tokenAddress.toLowerCase()}`,
        platform: "dexscreener",
        author: twitter?.url ?? t.chainId,
        url: t.url ?? twitter?.url ?? null,
        body: t.description.slice(0, 500),
        engagement: null,
        publishedAt: ingestedAt,
        ingestedAt,
        sourceReliability: SOURCE_RELIABILITY.dexscreener,
      });
    }
  }

  return {
    assets,
    pools,
    social,
    health: {
      source: "dexscreener",
      status: ok ? (assets.length ? "up" : "degraded") : "down",
      latencyMs: latency,
      error: ok ? null : boosts.error || top.error,
    },
  };
}

export async function fetchNewPools(): Promise<{ assets: NormalizedAsset[]; pools: NormalizedPool[]; health: HealthPing }> {
  const results = await Promise.all(
    GT_NETWORKS.map((n) =>
      fetchJson<{ data?: Array<{ id: string; attributes?: Record<string, unknown>; relationships?: Record<string, unknown> }> }>(
        `https://api.geckoterminal.com/api/v2/networks/${n}/new_pools?page=1`,
        { retries: 1, timeoutMs: 10_000 },
      ).then((r) => ({ network: n, ...r })),
    ),
  );
  const assets: NormalizedAsset[] = [];
  const pools: NormalizedPool[] = [];
  const now = nowIso();
  let anyOk = false;
  let latency = 0;
  let err: string | null = null;

  for (const r of results) {
    latency = Math.max(latency, r.latencyMs);
    if (!r.ok) {
      err = r.error;
      continue;
    }
    anyOk = true;
    const chain = GT_TO_CHAIN[r.network] ?? r.network;
    for (const row of r.data?.data ?? []) {
      const a = row.attributes ?? {};
      const rel = row.relationships as { base_token?: { data?: { id?: string } } } | undefined;
      const baseId = rel?.base_token?.data?.id ?? "";
      const tokenAddr = baseId.includes("_") ? baseId.split("_").slice(1).join("_") : String(a.address ?? row.id);
      const name = String(a.name ?? "unknown");
      const symbol = name.split("/")[0]?.trim() || name;
      const assetId = `${chain}:${tokenAddr.toLowerCase()}`;
      const created = iso(a.pool_created_at);
      const vol = a.volume_usd as { h24?: unknown; h1?: unknown; m5?: unknown } | undefined;
      const tx = a.transactions as { h24?: { buys?: number; sells?: number } } | undefined;
      const asset: NormalizedAsset = {
        id: assetId,
        symbol: symbol.toUpperCase().slice(0, 16),
        name: symbol,
        kind: "dex",
        chainId: chain,
        contractAddress: tokenAddr,
        coingeckoId: null,
        imageUrl: null,
        priceUsd: num(a.base_token_price_usd),
        marketCapUsd: num(a.market_cap_usd),
        fdvUsd: num(a.fdv_usd),
        volume24hUsd: num(vol?.h24),
        liquidityUsd: num(a.reserve_in_usd),
        change1hPct: num((a.price_change_percentage as { h1?: unknown } | undefined)?.h1),
        change24hPct: num((a.price_change_percentage as { h24?: unknown } | undefined)?.h24),
        change7dPct: null,
        pairCreatedAt: created,
        sparkline7d: null,
        source: "geckoterminal",
        sourceReliability: SOURCE_RELIABILITY.geckoterminal,
        observedAt: now,
        sourceTimestamp: created,
      };
      assets.push(asset);
      pools.push({
        id: `${chain}:${String(a.address ?? row.id).toLowerCase()}`,
        assetId,
        chainId: chain,
        address: String(a.address ?? ""),
        dex: r.network,
        name,
        liquidityUsd: num(a.reserve_in_usd),
        volume24hUsd: num(vol?.h24),
        volume1hUsd: num(vol?.h1),
        volume5mUsd: num(vol?.m5),
        txns24h: (tx?.h24?.buys ?? 0) + (tx?.h24?.sells ?? 0),
        buys24h: tx?.h24?.buys ?? null,
        sells24h: tx?.h24?.sells ?? null,
        priceUsd: num(a.base_token_price_usd),
        fdvUsd: num(a.fdv_usd),
        createdAt: created,
        observedAt: now,
        source: "geckoterminal",
      });
    }
  }

  return {
    assets,
    pools,
    health: {
      source: "geckoterminal",
      status: anyOk ? "up" : "down",
      latencyMs: latency,
      error: anyOk ? null : err,
    },
  };
}

export async function fetchPoolTrades(chainGt: string, poolAddress: string): Promise<NormalizedTrade[]> {
  const res = await fetchJson<{
    data?: Array<{ id: string; attributes?: Record<string, unknown> }>;
  }>(`https://api.geckoterminal.com/api/v2/networks/${chainGt}/pools/${poolAddress}/trades?trade_volume_in_usd_greater_than=100`, {
    retries: 0,
    timeoutMs: 8_000,
  });
  const chain = GT_TO_CHAIN[chainGt] ?? chainGt;
  const now = nowIso();
  return (res.data?.data ?? []).map((row) => {
    const a = row.attributes ?? {};
    const kind = String(a.kind ?? "").toLowerCase();
    return {
      id: `gt:${row.id}`,
      chainId: chain,
      poolId: `${chain}:${poolAddress.toLowerCase()}`,
      txHash: typeof a.tx_hash === "string" ? a.tx_hash : null,
      wallet: typeof a.tx_from_address === "string" ? a.tx_from_address : null,
      side: kind === "buy" || kind === "sell" ? (kind as "buy" | "sell") : null,
      priceUsd: num(a.price_to_in_usd) ?? num(a.price_from_in_usd),
      notionalUsd: num(a.volume_in_usd),
      observedAt: iso(a.block_timestamp) ?? now,
      source: "geckoterminal",
    };
  });
}

export async function fetchFearGreed(): Promise<{ value: number | null; label: string | null; health: HealthPing }> {
  const res = await fetchJson<{ data?: Array<{ value?: string; value_classification?: string }> }>(
    "https://api.alternative.me/fng/?limit=1",
  );
  const row = res.data?.data?.[0];
  return {
    value: num(row?.value),
    label: row?.value_classification ?? null,
    health: {
      source: "fear_greed",
      status: res.ok ? "up" : "down",
      latencyMs: res.latencyMs,
      error: res.error,
    },
  };
}

export async function fetchKrakenOhlc(pair = "XBTUSD", interval = 1440): Promise<{ candles: Candle[]; health: HealthPing; assetId: string }> {
  const res = await fetchJson<{ result?: Record<string, unknown> }>(
    `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`,
  );
  const result = res.data?.result ?? {};
  const key = Object.keys(result).find((k) => k !== "last");
  const rows = key && Array.isArray(result[key]) ? (result[key] as unknown[][]) : [];
  const candles: Candle[] = rows.map((r) => ({
    t: num0(r[0]) * 1000,
    open: num0(r[1]),
    high: num0(r[2]),
    low: num0(r[3]),
    close: num0(r[4]),
    volume: num0(r[6]),
  }));
  const assetId = pair.startsWith("XBT") || pair.startsWith("BTC") ? "cg:bitcoin" : pair.includes("ETH") ? "cg:ethereum" : `kraken:${pair}`;
  return {
    candles,
    assetId,
    health: {
      source: "kraken",
      status: res.ok && candles.length ? "up" : "down",
      latencyMs: res.latencyMs,
      error: res.error,
    },
  };
}

export async function fetchCoinbaseSpot(): Promise<{ btc: number | null; eth: number | null; sol: number | null; health: HealthPing }> {
  const tick = async (p: string) => {
    const r = await fetchJson<{ price?: string }>(`https://api.exchange.coinbase.com/products/${p}/ticker`);
    return { price: num(r.data?.price), ...r };
  };
  const [btc, eth, sol] = await Promise.all([tick("BTC-USD"), tick("ETH-USD"), tick("SOL-USD")]);
  const ok = btc.ok || eth.ok;
  return {
    btc: btc.price,
    eth: eth.price,
    sol: sol.price,
    health: {
      source: "coinbase",
      status: ok ? "up" : "down",
      latencyMs: Math.max(btc.latencyMs, eth.latencyMs, sol.latencyMs),
      error: ok ? null : btc.error,
    },
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
  return chunks.slice(0, 25).map((block, i) => {
    const title = pick(block, "title") || "Untitled";
    const url = pick(block, "link") || pickAttr(block, "link", "href") || null;
    const pub = pick(block, "pubDate") || pick(block, "published") || pick(block, "updated") || pick(block, "dc:date");
    const publishedAt = iso(pub);
    const summary = pick(block, "description") || pick(block, "summary");
    return {
      id: `${source}:${url ?? title}:${i}`,
      source,
      sourceReliability: reliability,
      title: title.replace(/&/g, "&").replace(/</g, "<").slice(0, 240),
      url,
      summary: summary ? summary.replace(/&/g, "&").slice(0, 400) : null,
      publishedAt,
      ingestedAt,
      freshness: newsFreshness(publishedAt),
    };
  });
}

export async function fetchNews(): Promise<{ articles: NormalizedNews[]; health: HealthPing[] }> {
  const feeds: { source: string; url: string; rel: number }[] = [
    { source: "coindesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", rel: SOURCE_RELIABILITY.coindesk },
    { source: "cointelegraph", url: "https://cointelegraph.com/rss", rel: SOURCE_RELIABILITY.cointelegraph },
    { source: "decrypt", url: "https://decrypt.co/feed", rel: SOURCE_RELIABILITY.decrypt },
    { source: "theblock", url: "https://www.theblock.co/rss.xml", rel: SOURCE_RELIABILITY.theblock },
  ];
  const results = await Promise.all(
    feeds.map(async (f) => {
      const res = await fetchText(f.url, { retries: 1, timeoutMs: 10_000 });
      const xml = typeof res.data === "string" ? res.data : "";
      const articles = res.ok && xml.includes("<") ? rssItems(xml, f.source, f.rel) : [];
      const health: HealthPing = {
        source: `news:${f.source}`,
        status: res.ok && articles.length ? "up" : res.ok ? "degraded" : "down",
        latencyMs: res.latencyMs,
        error: res.ok ? null : res.error,
      };
      return { articles, health };
    }),
  );
  return {
    articles: results.flatMap((r) => r.articles),
    health: results.map((r) => r.health),
  };
}

export async function fetchPolymarket(): Promise<{ markets: NormalizedMarket[]; health: HealthPing }> {
  const [vol, search] = await Promise.all([
    fetchJson<Array<Record<string, unknown>>>(
      "https://gamma-api.polymarket.com/events?closed=false&limit=30&order=volume24hr&ascending=false",
      { timeoutMs: 12_000 },
    ),
    fetchJson<{ events?: Array<Record<string, unknown>> }>(
      "https://gamma-api.polymarket.com/public-search?q=crypto",
      { timeoutMs: 10_000 },
    ),
  ]);
  const events = [
    ...(Array.isArray(vol.data) ? vol.data : []),
    ...((search.data?.events ?? []) as Array<Record<string, unknown>>),
  ];
  const now = nowIso();
  const seen = new Set<string>();
  const markets: NormalizedMarket[] = [];
  for (const ev of events) {
    const nested = Array.isArray(ev.markets) ? (ev.markets as Array<Record<string, unknown>>) : [];
    const list = nested.length ? nested : [ev];
    for (const m of list) {
      const id = String(m.id ?? ev.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const prices = m.outcomePrices ?? m.outcome_prices;
      let probability: number | null = null;
      if (typeof prices === "string") {
        try {
          const arr = JSON.parse(prices) as unknown[];
          probability = num(arr[0]);
        } catch {
          probability = null;
        }
      } else if (Array.isArray(prices)) probability = num(prices[0]);
      else probability = num(m.lastTradePrice) ?? num(m.bestBid);
      const slug = String(m.slug ?? ev.slug ?? "");
      markets.push({
        id,
        eventId: String(ev.id ?? id),
        slug,
        question: String(m.question ?? ev.title ?? ev.ticker ?? "Market"),
        category: typeof ev.category === "string" ? ev.category : "prediction",
        endDate: iso(m.endDate ?? ev.endDate),
        closed: Boolean(m.closed ?? ev.closed),
        volume: num(m.volume ?? ev.volume),
        volume24h: num(m.volume24hr ?? ev.volume24hr),
        liquidity: num(m.liquidity ?? ev.liquidity),
        probability,
        url: slug ? `https://polymarket.com/event/${slug}` : "https://polymarket.com",
        observedAt: now,
      });
    }
  }
  const ok = vol.ok || search.ok;
  return {
    markets,
    health: {
      source: "polymarket",
      status: ok ? "up" : "down",
      latencyMs: Math.max(vol.latencyMs, search.latencyMs),
      error: ok ? null : vol.error,
    },
  };
}

export async function fetchTokenSecurity(chainId: string, address: string): Promise<{ security: TokenSecurity | null; health: HealthPing }> {
  const gp = CHAIN_TO_GOPLUS[chainId] ?? CHAIN_TO_GOPLUS[chainId.toLowerCase()];
  if (!gp) {
    return {
      security: null,
      health: { source: "goplus", status: "degraded", latencyMs: 0, error: `unsupported chain ${chainId}` },
    };
  }
  const url = `https://api.gopluslabs.io/api/v1/token_security/${gp}?contract_addresses=${encodeURIComponent(address)}`;
  const res = await fetchJson<{ result?: Record<string, Record<string, unknown>> }>(url, { retries: 1, timeoutMs: 10_000 });
  const result = res.data?.result ?? {};
  const first = Object.values(result)[0];
  return {
    security: first ? parseGoPlus(first) : null,
    health: {
      source: "goplus",
      status: res.ok ? "up" : "down",
      latencyMs: res.latencyMs,
      error: res.error,
    },
  };
}

export function extractEntities(text: string, symbols: string[]): string[] {
  const found = new Set<string>();
  const upper = text.toUpperCase();
  for (const s of symbols) {
    if (s.length < 3) continue;
    const re = new RegExp(`(?:^|[^A-Z0-9])\\$?${s}(?:[^A-Z0-9]|$)`);
    if (re.test(upper)) found.add(s);
  }
  const names: [string, string][] = [
    ["BITCOIN", "BTC"],
    ["ETHEREUM", "ETH"],
    ["SOLANA", "SOL"],
    ["DOGECOIN", "DOGE"],
    ["RIPPLE", "XRP"],
  ];
  for (const [n, s] of names) if (upper.includes(n)) found.add(s);
  return [...found];
}

export async function fetchXRecent(query: string, bearer: string): Promise<{ posts: NormalizedSocial[]; health: HealthPing; status: number }> {
  const params = new URLSearchParams({
    query,
    max_results: String(X_MAX_RESULTS),
    "tweet.fields": "created_at,public_metrics,lang,author_id",
    expansions: "author_id",
    "user.fields": "username",
  });
  const url = `https://api.twitter.com/2/tweets/search/recent?${params.toString()}`;
  const res = await fetchJson<{
    data?: Array<Record<string, unknown>>;
    includes?: { users?: Array<{ id?: string; username?: string }> };
    title?: string;
    detail?: string;
  }>(url, {
    retries: 0,
    timeoutMs: 12_000,
    headers: { Authorization: `Bearer ${bearer}` },
  });
  const ingestedAt = nowIso();
  const users = new Map(
    (res.data?.includes?.users ?? []).map((u) => [String(u.id ?? ""), String(u.username ?? "")]),
  );
  const posts: NormalizedSocial[] = (res.data?.data ?? []).map((t) => {
    const authorId = typeof t.author_id === "string" ? t.author_id : null;
    const handle = authorId ? users.get(authorId) : null;
    return {
      id: `x:${String(t.id)}`,
      platform: "x",
      author: handle ? `@${handle}` : authorId,
      url: t.id ? `https://x.com/i/web/status/${t.id}` : null,
      body: String(t.text ?? ""),
      engagement: num((t.public_metrics as { like_count?: unknown } | undefined)?.like_count),
      publishedAt: iso(t.created_at),
      ingestedAt,
      sourceReliability: SOURCE_RELIABILITY.x,
    };
  });
  const err = res.ok ? null : res.error || res.data?.detail || res.data?.title || `http ${res.status}`;
  return {
    posts,
    status: res.status,
    health: {
      source: "x",
      status: res.ok ? "up" : "down",
      latencyMs: res.latencyMs,
      error: err,
    },
  };
}

export { X_SEARCH_QUERY };

