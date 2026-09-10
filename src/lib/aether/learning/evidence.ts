/**
 * Source-trust weights for learning. X/Twitter is noisy and low-trust.
 * Events outrank tweets. Wallets count when they have a verified track record.
 * News only if timestamped and entity-linked. Polymarket is information, not a venue.
 *
 * Independent sources may confirm; duplicates must not multiply evidence.
 */

export type EvidenceKind =
  | "event"
  | "wallet_verified"
  | "wallet_unverified"
  | "news_timestamped_entity"
  | "news_untimestamped"
  | "polymarket_info"
  | "x"
  | "reddit"
  | "social_other";

export const EVIDENCE_TRUST: Record<EvidenceKind, number> = {
  event: 1,
  wallet_verified: 0.9,
  wallet_unverified: 0.35,
  news_timestamped_entity: 0.7,
  news_untimestamped: 0,
  polymarket_info: 0.6,
  x: 0.25,
  reddit: 0.2,
  social_other: 0.2,
};

export type EvidencePiece = {
  kind: EvidenceKind;
  clusterId?: string | null;
  source?: string | null;
  timestamped?: boolean;
  entityLinked?: boolean;
  walletTrackRecord?: boolean;
};

export function classifyNews(opts: { publishedAt: string | null | undefined; entityLinked: boolean }): EvidenceKind {
  if (!opts.publishedAt) return "news_untimestamped";
  const t = Date.parse(opts.publishedAt);
  if (!Number.isFinite(t)) return "news_untimestamped";
  return opts.entityLinked ? "news_timestamped_entity" : "news_untimestamped";
}

export function classifyWallet(verifiedTrackRecord: boolean): EvidenceKind {
  return verifiedTrackRecord ? "wallet_verified" : "wallet_unverified";
}

export function trustOf(kind: EvidenceKind): number {
  return EVIDENCE_TRUST[kind];
}

/**
 * Combine pieces of evidence. Same cluster / same kind is confirmation, not
 * multiplication. X never outranks an event.
 */
export function combineEvidence(pieces: EvidencePiece[]): {
  weight: number;
  kinds: EvidenceKind[];
  xDownweighted: boolean;
  notes: string;
} {
  if (!pieces.length) {
    return { weight: 0, kinds: [], xDownweighted: false, notes: "No evidence pieces." };
  }
  const byCluster = new Map<string, EvidencePiece[]>();
  for (const p of pieces) {
    const key = p.clusterId ?? `solo:${p.kind}:${p.source ?? "na"}`;
    const cur = byCluster.get(key) ?? [];
    cur.push(p);
    byCluster.set(key, cur);
  }
  let weight = 0;
  const kinds: EvidenceKind[] = [];
  for (const group of byCluster.values()) {
    const best = Math.max(...group.map((g) => trustOf(g.kind)));
    const extraSources = new Set(group.map((g) => g.source ?? g.kind)).size;
    const confirm = extraSources > 1 ? Math.min(0.18, 0.06 * (extraSources - 1)) : 0;
    weight += best + confirm * best;
    kinds.push(...group.map((g) => g.kind));
  }
  const xDownweighted = pieces.some((p) => p.kind === "x") && pieces.some((p) => p.kind === "event");
  return {
    weight: Math.min(1.4, weight),
    kinds,
    xDownweighted,
    notes: xDownweighted
      ? "X is treated as noisy confirmation of the event cluster, not independent alpha."
      : "Evidence combined without multiplying duplicates.",
  };
}

export function socialVsEventPriority(): { event: number; x: number; walletVerified: number } {
  return {
    event: EVIDENCE_TRUST.event,
    x: EVIDENCE_TRUST.x,
    walletVerified: EVIDENCE_TRUST.wallet_verified,
  };
}
