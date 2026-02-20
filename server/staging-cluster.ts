import OpenAI from "openai";
import { cosineSimilarity } from "./embeddings";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 256;
const BATCH_SIZE_EMBED = 100;

interface TicketForClustering {
  ticketId: number;
  subject: string | null;
  description: string | null;
  solution: string | null;
}

interface ClusterResult {
  clusterId: number;
  size: number;
  keywords: string[];
  sampleTickets: { ticketId: number; text: string }[];
  centroid: number[];
  suggestedLabel?: string;
}

interface ClusterReport {
  totalTickets: number;
  totalEmbedded: number;
  totalClusters: number;
  noiseBucketSize: number;
  topClusters: {
    clusterId: number;
    size: number;
    keywords: string[];
    samples: { ticketId: number; text: string }[];
    canonicalOverlap: { intentId: string; similarity: number }[];
    suggestedLabel: string;
  }[];
  canonicalOverlapPct: number;
  newCandidateClusters: {
    clusterId: number;
    size: number;
    suggestedLabel: string;
    keywords: string[];
    topTickets: { ticketId: number; text: string }[];
  }[];
}

function buildTicketText(t: TicketForClustering): string {
  const parts: string[] = [];
  if (t.subject && t.subject !== "No contents") parts.push(t.subject.trim());
  if (t.description && t.description !== "No contents") {
    const cleaned = t.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    parts.push(cleaned.substring(0, 500));
  }
  return parts.join(" | ") || "(tom)";
}

async function batchEmbed(texts: string[], onProgress?: (msg: string, pct: number) => void): Promise<number[][]> {
  const allEmbeddings: number[][] = [];
  const totalBatches = Math.ceil(texts.length / BATCH_SIZE_EMBED);

  for (let i = 0; i < texts.length; i += BATCH_SIZE_EMBED) {
    const batch = texts.slice(i, i + BATCH_SIZE_EMBED);
    const batchNum = Math.floor(i / BATCH_SIZE_EMBED) + 1;
    onProgress?.(`Embedding batch ${batchNum}/${totalBatches} (${i + batch.length}/${texts.length})...`, Math.round((i / texts.length) * 40));

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    const sorted = response.data.sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      allEmbeddings.push(item.embedding);
    }
  }

  return allEmbeddings;
}

function kMeansClustering(embeddings: number[][], k: number, maxIter: number = 30): { labels: number[]; centroids: number[][] } {
  const n = embeddings.length;
  const dim = embeddings[0].length;

  const centroids: number[][] = [];
  const usedIndices = new Set<number>();
  centroids.push([...embeddings[0]]);
  usedIndices.add(0);

  for (let c = 1; c < k; c++) {
    let maxDist = -1;
    let bestIdx = 0;
    for (let i = 0; i < n; i++) {
      if (usedIndices.has(i)) continue;
      let minDistToCentroid = Infinity;
      for (const centroid of centroids) {
        const dist = 1 - cosineSimilarity(embeddings[i], centroid);
        if (dist < minDistToCentroid) minDistToCentroid = dist;
      }
      if (minDistToCentroid > maxDist) {
        maxDist = minDistToCentroid;
        bestIdx = i;
      }
    }
    centroids.push([...embeddings[bestIdx]]);
    usedIndices.add(bestIdx);
  }

  const labels = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      let bestCluster = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < k; c++) {
        const sim = cosineSimilarity(embeddings[i], centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = c;
        }
      }
      if (labels[i] !== bestCluster) {
        labels[i] = bestCluster;
        changed++;
      }
    }

    for (let c = 0; c < k; c++) {
      const members = embeddings.filter((_, i) => labels[i] === c);
      if (members.length === 0) continue;
      for (let d = 0; d < dim; d++) {
        centroids[c][d] = members.reduce((sum, m) => sum + m[d], 0) / members.length;
      }
    }

    if (changed === 0) break;
  }

  return { labels, centroids };
}

function extractKeywords(texts: string[], topN: number = 8): string[] {
  const stopwords = new Set([
    "og", "i", "på", "til", "for", "er", "det", "en", "et", "av", "med",
    "som", "har", "jeg", "at", "den", "de", "vi", "kan", "ikke", "fra",
    "om", "men", "så", "var", "min", "meg", "seg", "dette", "hei", "hva",
    "skal", "vil", "bli", "ble", "være", "sin", "sitt", "sine", "du",
    "dere", "oss", "dem", "hun", "han", "der", "her", "da", "når",
    "eller", "alle", "noen", "ingen", "annen", "andre", "hvor", "også",
    "bare", "etter", "over", "under", "mellom", "inn", "ut", "opp",
    "ned", "the", "and", "is", "it", "to", "of", "in", "a", "no",
    "contents", "tom", "nbsp", "div", "class", "span", "style", "http",
    "https", "www", "com", "org", "net", "href", "img", "src", "alt",
    "mvh", "vennlig", "hilsen", "takk", "hjelp", "kontakt",
  ]);

  const freq: Record<string, number> = {};
  for (const text of texts) {
    const words = text.toLowerCase().replace(/[^a-zæøå0-9\s-]/g, " ").split(/\s+/);
    const seen = new Set<string>();
    for (const word of words) {
      if (word.length < 3 || stopwords.has(word) || /^\d+$/.test(word)) continue;
      if (!seen.has(word)) {
        freq[word] = (freq[word] || 0) + 1;
        seen.add(word);
      }
    }
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
}

export async function runStagingClustering(
  onProgress?: (msg: string, pct: number) => void
): Promise<ClusterReport> {
  const { db } = await import("./db");
  const { sql } = await import("drizzle-orm");
  const { storage } = await import("./storage");

  onProgress?.("Loading staging tickets...", 0);

  const rows = await db.execute(sql`
    SELECT ticket_id, subject, description, solution
    FROM staging_tickets
    ORDER BY ticket_id DESC
  `);
  const tickets: TicketForClustering[] = (rows.rows as any[]).map(r => ({
    ticketId: r.ticket_id,
    subject: r.subject,
    description: r.description,
    solution: r.solution,
  }));

  onProgress?.(`Loaded ${tickets.length} tickets. Generating embeddings...`, 2);

  const texts = tickets.map(buildTicketText);
  const embeddings = await batchEmbed(texts, onProgress);

  onProgress?.(`Embeddings generated for ${embeddings.length} tickets. Running clustering...`, 45);

  const K = 80;
  const { labels, centroids } = kMeansClustering(embeddings, K);

  const clusterMap = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const arr = clusterMap.get(labels[i]) || [];
    arr.push(i);
    clusterMap.set(labels[i], arr);
  }

  onProgress?.(`Found ${clusterMap.size} clusters. Analyzing...`, 55);

  const NOISE_THRESHOLD = 3;
  const clusters: ClusterResult[] = [];
  let noiseBucket = 0;

  for (const [clusterId, memberIndices] of Array.from(clusterMap.entries())) {
    if (memberIndices.length < NOISE_THRESHOLD) {
      noiseBucket += memberIndices.length;
      continue;
    }

    const clusterTexts = memberIndices.map((i: number) => texts[i]);
    const keywords = extractKeywords(clusterTexts);
    const sampleIndices = memberIndices.slice(0, 5);
    const sampleTickets = sampleIndices.map((i: number) => ({
      ticketId: tickets[i].ticketId,
      text: texts[i].substring(0, 200),
    }));

    clusters.push({
      clusterId,
      size: memberIndices.length,
      keywords,
      sampleTickets,
      centroid: centroids[clusterId],
    });
  }

  clusters.sort((a, b) => b.size - a.size);

  onProgress?.("Loading canonical intents for overlap analysis...", 65);

  const canonicalIntents = await storage.getApprovedCanonicalIntents();
  const canonicalEmbeddings: { intentId: string; embedding: number[] }[] = [];

  const intentTexts = canonicalIntents.map(ci => {
    const parts = [ci.intentId, ci.category || ""];
    if (ci.subcategory) parts.push(ci.subcategory);
    if (ci.description) parts.push(ci.description);
    if (ci.keywords) parts.push(ci.keywords);
    return parts.join(" | ");
  });

  onProgress?.("Generating canonical intent embeddings...", 70);
  const canonEmbeddings = await batchEmbed(intentTexts, (msg, _pct) => {
    onProgress?.(`Canonical: ${msg}`, 70);
  });

  for (let i = 0; i < canonicalIntents.length; i++) {
    canonicalEmbeddings.push({
      intentId: canonicalIntents[i].intentId,
      embedding: canonEmbeddings[i],
    });
  }

  onProgress?.("Computing overlap with canonical intents...", 80);

  const OVERLAP_THRESHOLD = 0.65;
  let overlappingClusters = 0;

  const topClusters = clusters.slice(0, 15).map(cluster => {
    const similarities = canonicalEmbeddings.map(ce => ({
      intentId: ce.intentId,
      similarity: cosineSimilarity(cluster.centroid, ce.embedding),
    }));
    similarities.sort((a, b) => b.similarity - a.similarity);
    const topMatches = similarities.slice(0, 3);

    if (topMatches[0]?.similarity >= OVERLAP_THRESHOLD) {
      overlappingClusters++;
    }

    return {
      clusterId: cluster.clusterId,
      size: cluster.size,
      keywords: cluster.keywords,
      samples: cluster.sampleTickets,
      canonicalOverlap: topMatches,
      suggestedLabel: topMatches[0]?.similarity >= OVERLAP_THRESHOLD
        ? `→ ${topMatches[0].intentId}`
        : `NEW: ${cluster.keywords.slice(0, 3).join("-")}`,
    };
  });

  const allClusterOverlap = clusters.map(cluster => {
    const bestSim = canonicalEmbeddings.reduce((best, ce) => {
      const sim = cosineSimilarity(cluster.centroid, ce.embedding);
      return sim > best ? sim : best;
    }, 0);
    return bestSim >= OVERLAP_THRESHOLD;
  });
  const totalOverlapping = allClusterOverlap.filter(Boolean).length;
  const overlapPct = clusters.length > 0 ? Math.round((totalOverlapping / clusters.length) * 100) : 0;

  onProgress?.("Identifying new candidate clusters...", 90);

  const newCandidates = clusters
    .filter(cluster => {
      const bestSim = canonicalEmbeddings.reduce((best, ce) => {
        const sim = cosineSimilarity(cluster.centroid, ce.embedding);
        return sim > best ? sim : best;
      }, 0);
      return bestSim < OVERLAP_THRESHOLD;
    })
    .slice(0, 10)
    .map(cluster => {
      const memberIndices = [];
      for (let i = 0; i < labels.length; i++) {
        if (labels[i] === cluster.clusterId) memberIndices.push(i);
      }

      const topTickets = memberIndices.slice(0, 10).map(i => ({
        ticketId: tickets[i].ticketId,
        text: texts[i].substring(0, 300),
      }));

      return {
        clusterId: cluster.clusterId,
        size: cluster.size,
        suggestedLabel: cluster.keywords.slice(0, 3).join("-"),
        keywords: cluster.keywords,
        topTickets,
      };
    });

  onProgress?.("Generating cluster labels via GPT...", 92);

  try {
    const clusterSummaries = topClusters.map(c =>
      `Cluster ${c.clusterId} (${c.size} tickets):\nKeywords: ${c.keywords.join(", ")}\nSamples:\n${c.samples.map(s => `- ${s.text}`).join("\n")}`
    ).join("\n\n");

    const labelPrompt = `Du er ekspert på support-tickets for DyreID (Norges kjæledyrregister).

Gi hvert cluster et kort, beskrivende norsk label (3-6 ord).

${clusterSummaries}

Svar i JSON: { "labels": { "clusterId": "label", ... } }`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: labelPrompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const labelResult = JSON.parse(response.choices[0].message.content || "{}");
    const labelsMap = labelResult.labels || {};

    for (const tc of topClusters) {
      const gptLabel = labelsMap[String(tc.clusterId)];
      if (gptLabel && tc.suggestedLabel.startsWith("NEW:")) {
        tc.suggestedLabel = `NEW: ${gptLabel}`;
      } else if (gptLabel && tc.suggestedLabel.startsWith("→")) {
        tc.suggestedLabel = `${tc.suggestedLabel} (${gptLabel})`;
      }
    }
  } catch (err: any) {
    console.log(`[staging-cluster] GPT labeling error (non-fatal): ${err.message}`);
  }

  onProgress?.("Done!", 100);

  return {
    totalTickets: tickets.length,
    totalEmbedded: embeddings.length,
    totalClusters: clusters.length,
    noiseBucketSize: noiseBucket,
    topClusters,
    canonicalOverlapPct: overlapPct,
    newCandidateClusters: newCandidates,
  };
}
