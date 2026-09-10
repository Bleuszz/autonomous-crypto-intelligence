/**
 * Duplicate-event protection. The same story arriving via X, RSS, Reddit
 * and official blogs is one cluster, not four independent pieces of evidence.
 */

export type ClusterableEvent = {
  id: string;
  title: string;
  source: string;
  publishedAt: number | null;
  observedAt: number;
  affectedAssets?: string[];
};

export type EventCluster = {
  clusterId: string;
  memberIds: string[];
  sources: string[];
  title: string;
  independentSourceCount: number;
  firstPublishedAt: number | null;
  lastObservedAt: number;
};

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are",
  "as", "by", "at", "from", "after", "over", "its", "it", "this", "that",
]);

export function tokenizeTitle(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

export function sameAssetOverlap(a?: string[], b?: string[]): boolean {
  if (!a?.length || !b?.length) return true;
  const set = new Set(a.map((x) => x.toLowerCase()));
  return b.some((x) => set.has(x.toLowerCase()));
}

export function clusterEvents(events: ClusterableEvent[], opts?: { similarity?: number; windowMs?: number }): EventCluster[] {
  const sim = opts?.similarity ?? 0.55;
  const windowMs = opts?.windowMs ?? 12 * 3600_000;
  const sorted = [...events].sort((a, b) => (a.publishedAt ?? a.observedAt) - (b.publishedAt ?? b.observedAt));
  const tokens = sorted.map((e) => tokenizeTitle(e.title));
  const assigned = new Array(sorted.length).fill(-1);
  const clusters: EventCluster[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (assigned[i] >= 0) continue;
    const seed = sorted[i]!;
    const memberIdx = [i];
    assigned[i] = clusters.length;
    const t0 = seed.publishedAt ?? seed.observedAt;
    for (let j = i + 1; j < sorted.length; j++) {
      if (assigned[j] >= 0) continue;
      const other = sorted[j]!;
      const t1 = other.publishedAt ?? other.observedAt;
      if (Math.abs(t1 - t0) > windowMs) continue;
      if (!sameAssetOverlap(seed.affectedAssets, other.affectedAssets)) continue;
      if (jaccard(tokens[i]!, tokens[j]!) >= sim) {
        assigned[j] = clusters.length;
        memberIdx.push(j);
      }
    }
    const members = memberIdx.map((k) => sorted[k]!);
    const sources = [...new Set(members.map((m) => m.source))];
    const pubs = members.map((m) => m.publishedAt).filter((x): x is number => x != null);
    clusters.push({
      clusterId: `evtcl:${members[0]!.id}`,
      memberIds: members.map((m) => m.id),
      sources,
      title: seed.title,
      independentSourceCount: sources.length,
      firstPublishedAt: pubs.length ? Math.min(...pubs) : null,
      lastObservedAt: Math.max(...members.map((m) => m.observedAt)),
    });
  }
  return clusters;
}

/** Independent confirmation raises confidence; duplicates must not multiply evidence. */
export function clusterConfidenceBoost(cluster: EventCluster): number {
  if (cluster.independentSourceCount <= 1) return 0;
  if (cluster.independentSourceCount === 2) return 0.08;
  if (cluster.independentSourceCount === 3) return 0.14;
  return 0.18;
}
