interface PilotMatchRecord {
  timestamp: number;
  matchedBy: "session" | "regex" | "semantic" | "keyword" | "gpt" | "fuzzy" | "block";
  semanticScore: number;
  gptConfidence: number;
  intentId: string | null;
  userMessage: string;
}

interface PilotStats {
  enabled: boolean;
  totalRequests: number;
  distribution: Record<string, number>;
  unmatchedQueries: { message: string; semanticScore: number; timestamp: number }[];
  records: PilotMatchRecord[];
  startedAt: number;
}

const stats: PilotStats = {
  enabled: false,
  totalRequests: 0,
  distribution: { session: 0, regex: 0, semantic: 0, keyword: 0, gpt: 0, block: 0 },
  unmatchedQueries: [],
  records: [],
  startedAt: 0,
};

export function isPilotEnabled(): boolean {
  return stats.enabled;
}

export function enablePilot(): void {
  stats.enabled = true;
  stats.totalRequests = 0;
  stats.distribution = { session: 0, regex: 0, semantic: 0, keyword: 0, gpt: 0, block: 0 };
  stats.unmatchedQueries = [];
  stats.records = [];
  stats.startedAt = Date.now();
  console.log("[Pilot] Enabled — tracking match distribution");
}

export function disablePilot(): void {
  stats.enabled = false;
  console.log("[Pilot] Disabled");
}

export function recordPilotMatch(
  matchedBy: PilotMatchRecord["matchedBy"],
  semanticScore: number,
  gptConfidence: number,
  intentId: string | null,
  userMessage: string,
): void {
  if (!stats.enabled) return;

  stats.totalRequests++;
  stats.distribution[matchedBy] = (stats.distribution[matchedBy] || 0) + 1;

  if (matchedBy === "block") {
    stats.unmatchedQueries.push({
      message: userMessage.substring(0, 200),
      semanticScore,
      timestamp: Date.now(),
    });
    if (stats.unmatchedQueries.length > 50) {
      stats.unmatchedQueries = stats.unmatchedQueries.slice(-50);
    }
  }

  stats.records.push({
    timestamp: Date.now(),
    matchedBy,
    semanticScore,
    gptConfidence,
    intentId,
    userMessage: userMessage.substring(0, 200),
  });

  if (stats.records.length > 1000) {
    stats.records = stats.records.slice(-1000);
  }

  if (stats.totalRequests % 50 === 0) {
    const pct = (method: string) => {
      const count = stats.distribution[method] || 0;
      return `${method}=${count} (${((count / stats.totalRequests) * 100).toFixed(1)}%)`;
    };
    console.log(`[Pilot] ${stats.totalRequests} requests — ${pct("semantic")} | ${pct("regex")} | ${pct("keyword")} | ${pct("gpt")} | ${pct("block")} | ${pct("session")}`);
  }
}

export function getPilotReport(): {
  enabled: boolean;
  totalRequests: number;
  distribution: Record<string, { count: number; percentage: string }>;
  gptFallbackRate: string;
  blockRate: string;
  semanticMatchRate: string;
  top5Unmatched: { message: string; semanticScore: number }[];
  runtimeSeconds: number;
} {
  const total = stats.totalRequests || 1;
  const dist: Record<string, { count: number; percentage: string }> = {};
  for (const [method, count] of Object.entries(stats.distribution)) {
    dist[method] = { count, percentage: `${((count / total) * 100).toFixed(1)}%` };
  }

  const gptCount = stats.distribution.gpt || 0;
  const blockCount = stats.distribution.block || 0;
  const semanticCount = stats.distribution.semantic || 0;

  const top5 = stats.unmatchedQueries
    .slice(-5)
    .reverse()
    .map(q => ({ message: q.message, semanticScore: parseFloat(q.semanticScore.toFixed(3)) }));

  return {
    enabled: stats.enabled,
    totalRequests: stats.totalRequests,
    distribution: dist,
    gptFallbackRate: `${((gptCount / total) * 100).toFixed(1)}%`,
    blockRate: `${((blockCount / total) * 100).toFixed(1)}%`,
    semanticMatchRate: `${((semanticCount / total) * 100).toFixed(1)}%`,
    top5Unmatched: top5,
    runtimeSeconds: Math.round((Date.now() - stats.startedAt) / 1000),
  };
}
