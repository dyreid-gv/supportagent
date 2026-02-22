import OpenAI from "openai";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { cosineSimilarity } from "./embeddings";
import { storage } from "./storage";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE_EMBED = 100;
const MIN_CLUSTER_SIZE = 5;

interface DiscoveryTicket {
  ticketId: number;
  subject: string;
  customerQuestion: string;
  agentAnswer: string;
  intent: string | null;
  intentConfidence: number;
  isNewIntent: boolean;
  autoClosePossible: boolean;
  keywords: string | null;
  followUpNeeded: boolean;
  dialogPattern: string | null;
}

interface ClusterMember {
  ticketId: number;
  text: string;
  embedding: number[];
  intent: string | null;
  intentConfidence: number;
  autoClosePossible: boolean;
  followUpNeeded: boolean;
}

interface QualityFlag {
  flag: "MIDDLE_ZONE" | "HIGH_RISK" | "HIGH_AUTOMATION_POTENTIAL";
  detail: string;
}

interface CanonicalMatch {
  intentId: string;
  similarity: number;
  category: string;
}

interface DiscoveryCluster {
  clusterId: number;
  clusterSize: number;
  avgSemanticSimilarityToNearest: number;
  nearestCanonical: CanonicalMatch;
  autoCloseablePct: number;
  reopenRate: number;
  avgConfidence: number;
  topKeywords: string[];
  exampleQuestions: string[];
  suggestedLabel: string;
  qualityFlags: QualityFlag[];
  sampleTickets: { ticketId: number; question: string }[];
  dominantIntent: string | null;
}

export interface IntentDiscoveryResult {
  metadata: {
    runAt: string;
    sourceTickets: number;
    eligibleTickets: number;
    embeddedTickets: number;
    totalClusters: number;
    noiseTickets: number;
    processingTimeMs: number;
  };
  proposed_new_intents: DiscoveryCluster[];
  map_to_existing: DiscoveryCluster[];
  ambiguous_clusters: DiscoveryCluster[];
  noise: { ticketId: number; question: string; intent: string | null }[];
}

function buildTicketText(t: DiscoveryTicket): string {
  const parts: string[] = [];
  if (t.subject && t.subject !== "No contents") parts.push(t.subject.trim());
  if (t.customerQuestion) {
    const cleaned = t.customerQuestion.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned && cleaned !== "No contents") parts.push(cleaned.substring(0, 400));
  }
  return parts.join(" | ") || "(tom)";
}

async function batchEmbed(texts: string[], onProgress?: (msg: string, pct: number) => void): Promise<number[][]> {
  const allEmbeddings: number[][] = [];
  const totalBatches = Math.ceil(texts.length / BATCH_SIZE_EMBED);

  for (let i = 0; i < texts.length; i += BATCH_SIZE_EMBED) {
    const batch = texts.slice(i, i + BATCH_SIZE_EMBED);
    const batchNum = Math.floor(i / BATCH_SIZE_EMBED) + 1;
    onProgress?.(`Embedding batch ${batchNum}/${totalBatches}...`, Math.round((i / texts.length) * 40) + 10);

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

function extractKeywords(texts: string[], topN: number = 10): string[] {
  const stopwords = new Set([
    "og", "i", "på", "til", "for", "er", "det", "en", "et", "av", "med",
    "som", "har", "jeg", "at", "den", "de", "vi", "kan", "ikke", "fra",
    "om", "men", "så", "var", "min", "meg", "seg", "dette", "hei", "hva",
    "skal", "vil", "bli", "ble", "være", "sin", "sitt", "sine", "du",
    "dere", "oss", "dem", "hun", "han", "der", "her", "da", "når",
    "eller", "alle", "noen", "ingen", "annen", "andre", "hvor", "også",
    "bare", "etter", "over", "under", "mellom", "inn", "ut", "opp",
    "ned", "the", "and", "is", "it", "to", "of", "in", "a", "no",
    "contents", "tom", "nbsp", "div", "class", "span", "style",
    "mvh", "vennlig", "hilsen", "takk", "hjelp", "kontakt", "dyreid",
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

function hdbscanLikeClustering(
  embeddings: number[][],
  minClusterSize: number
): { labels: number[]; centroids: Map<number, number[]> } {
  const n = embeddings.length;
  const labels = new Array(n).fill(-1);

  const simMatrix: { i: number; j: number; sim: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      if (sim > 0.5) {
        simMatrix.push({ i, j, sim });
      }
    }
  }
  simMatrix.sort((a, b) => b.sim - a.sim);

  const parent = new Array(n).fill(0).map((_, i) => i);
  const rank = new Array(n).fill(0);

  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }

  function union(x: number, y: number): void {
    const px = find(x);
    const py = find(y);
    if (px === py) return;
    if (rank[px] < rank[py]) parent[px] = py;
    else if (rank[px] > rank[py]) parent[py] = px;
    else { parent[py] = px; rank[px]++; }
  }

  const SIM_THRESHOLD = 0.65;
  for (const edge of simMatrix) {
    if (edge.sim < SIM_THRESHOLD) break;
    union(edge.i, edge.j);
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const arr = groups.get(root) || [];
    arr.push(i);
    groups.set(root, arr);
  }

  let clusterId = 0;
  const centroids = new Map<number, number[]>();

  for (const [, members] of Array.from(groups.entries())) {
    if (members.length >= minClusterSize) {
      const dim = embeddings[0].length;
      const centroid = new Array(dim).fill(0);
      for (const idx of members) {
        labels[idx] = clusterId;
        for (let d = 0; d < dim; d++) {
          centroid[d] += embeddings[idx][d];
        }
      }
      for (let d = 0; d < dim; d++) {
        centroid[d] /= members.length;
      }
      centroids.set(clusterId, centroid);
      clusterId++;
    }
  }

  return { labels, centroids };
}

export async function runIntentDiscovery(
  onProgress?: (msg: string, pct: number) => void
): Promise<IntentDiscoveryResult> {
  const startTime = Date.now();

  onProgress?.("Loading source tickets...", 0);

  const sourceRows = await db.execute(sql`
    SELECT 
      st.ticket_id as ticket_id,
      st.subject,
      st.customer_question,
      st.agent_answer,
      st.auto_closed,
      st.dialog_pattern,
      ic.intent,
      ic.intent_confidence,
      ic.is_new_intent,
      ic.auto_close_possible,
      ic.keywords,
      rp.follow_up_needed
    FROM scrubbed_tickets st
    JOIN intent_classifications ic ON ic.ticket_id = st.ticket_id
    LEFT JOIN resolution_patterns rp ON rp.ticket_id = st.ticket_id
    LEFT JOIN canonical_intents ci ON ci.intent_id = ic.intent AND ci.approved = true
    WHERE ci.id IS NULL
      AND st.auto_closed = false
      AND st.customer_question IS NOT NULL
      AND st.customer_question != ''
      AND st.customer_question != 'No contents'
    ORDER BY st.ticket_id DESC
    LIMIT 5000
  `);

  const sourceTickets = sourceRows.rows as any[];
  onProgress?.(`Found ${sourceTickets.length} eligible tickets (no canonical match, not auto-closed)`, 5);

  const tickets: DiscoveryTicket[] = sourceTickets
    .filter((r: any) => {
      const q = (r.customer_question || "").toLowerCase();
      if (q.includes("bekreftelse") && q.length < 30) return false;
      if (q.includes("automatisk svar") || q.includes("auto-svar")) return false;
      return true;
    })
    .map((r: any) => ({
      ticketId: r.ticket_id,
      subject: r.subject || "",
      customerQuestion: r.customer_question || "",
      agentAnswer: r.agent_answer || "",
      intent: r.intent,
      intentConfidence: parseFloat(r.intent_confidence) || 0,
      isNewIntent: r.is_new_intent === true,
      autoClosePossible: r.auto_close_possible === true,
      keywords: r.keywords,
      followUpNeeded: r.follow_up_needed === true,
      dialogPattern: r.dialog_pattern,
    }));

  onProgress?.(`After filtering: ${tickets.length} tickets eligible for clustering`, 8);

  if (tickets.length === 0) {
    return {
      metadata: {
        runAt: new Date().toISOString(),
        sourceTickets: sourceTickets.length,
        eligibleTickets: 0,
        embeddedTickets: 0,
        totalClusters: 0,
        noiseTickets: 0,
        processingTimeMs: Date.now() - startTime,
      },
      proposed_new_intents: [],
      map_to_existing: [],
      ambiguous_clusters: [],
      noise: [],
    };
  }

  const texts = tickets.map(buildTicketText);
  const embeddings = await batchEmbed(texts, onProgress);

  onProgress?.(`Embeddings generated for ${embeddings.length} tickets. Running HDBSCAN clustering...`, 50);

  const { labels, centroids } = hdbscanLikeClustering(embeddings, MIN_CLUSTER_SIZE);

  const clusterMap = new Map<number, number[]>();
  const noiseIndices: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === -1) {
      noiseIndices.push(i);
    } else {
      const arr = clusterMap.get(labels[i]) || [];
      arr.push(i);
      clusterMap.set(labels[i], arr);
    }
  }

  onProgress?.(`Found ${clusterMap.size} clusters, ${noiseIndices.length} noise points. Loading canonical intents...`, 60);

  const canonicalIntents = await storage.getApprovedCanonicalIntents();
  const canonicalData: { intentId: string; category: string; embedding: number[] }[] = [];

  if (canonicalIntents.length > 0) {
    const canonTexts = canonicalIntents.map(ci => {
      const parts = [`Intent: ${ci.intentId}`, `Kategori: ${ci.category || ""}`];
      if (ci.subcategory) parts.push(`Underkategori: ${ci.subcategory}`);
      if (ci.description) parts.push(`Beskrivelse: ${ci.description}`);
      if (ci.keywords) parts.push(`Nøkkelord: ${ci.keywords}`);
      return parts.join(" | ");
    });

    onProgress?.("Embedding canonical intents for comparison...", 65);
    const canonEmbeddings = await batchEmbed(canonTexts);

    for (let i = 0; i < canonicalIntents.length; i++) {
      canonicalData.push({
        intentId: canonicalIntents[i].intentId,
        category: canonicalIntents[i].category || "",
        embedding: canonEmbeddings[i],
      });
    }
  }

  onProgress?.("Analyzing clusters and computing quality flags...", 75);

  const proposed_new_intents: DiscoveryCluster[] = [];
  const map_to_existing: DiscoveryCluster[] = [];
  const ambiguous_clusters: DiscoveryCluster[] = [];

  for (const [clusterId, memberIndices] of Array.from(clusterMap.entries())) {
    const centroid = centroids.get(clusterId)!;
    const members: ClusterMember[] = memberIndices.map((i: number) => ({
      ticketId: tickets[i].ticketId,
      text: texts[i],
      embedding: embeddings[i],
      intent: tickets[i].intent,
      intentConfidence: tickets[i].intentConfidence,
      autoClosePossible: tickets[i].autoClosePossible,
      followUpNeeded: tickets[i].followUpNeeded,
    }));

    let nearestCanonical: CanonicalMatch = { intentId: "NONE", similarity: 0, category: "" };
    if (canonicalData.length > 0) {
      for (const cd of canonicalData) {
        const sim = cosineSimilarity(centroid, cd.embedding);
        if (sim > nearestCanonical.similarity) {
          nearestCanonical = { intentId: cd.intentId, similarity: sim, category: cd.category };
        }
      }
    }

    const autoCloseCount = members.filter(m => m.autoClosePossible).length;
    const autoCloseablePct = Math.round((autoCloseCount / members.length) * 100);

    const followUpCount = members.filter(m => m.followUpNeeded).length;
    const reopenRate = Math.round((followUpCount / members.length) * 100);

    const avgConfidence = members.reduce((sum, m) => sum + m.intentConfidence, 0) / members.length;

    const clusterTexts = members.map(m => m.text);
    const topKeywords = extractKeywords(clusterTexts, 10);

    const exampleQuestions = members.slice(0, 3).map(m => {
      const q = m.text.split(" | ")[0];
      return q.substring(0, 150);
    });

    const intentCounts = new Map<string, number>();
    for (const m of members) {
      if (m.intent) {
        intentCounts.set(m.intent, (intentCounts.get(m.intent) || 0) + 1);
      }
    }
    let dominantIntent: string | null = null;
    let maxCount = 0;
    for (const [intent, count] of Array.from(intentCounts.entries())) {
      if (count > maxCount) { maxCount = count; dominantIntent = intent; }
    }

    const qualityFlags: QualityFlag[] = [];
    if (nearestCanonical.similarity >= 0.65 && nearestCanonical.similarity < 0.78) {
      qualityFlags.push({
        flag: "MIDDLE_ZONE",
        detail: `Similarity ${nearestCanonical.similarity.toFixed(3)} to ${nearestCanonical.intentId} — needs manual verification`,
      });
    }
    if (reopenRate > 15) {
      qualityFlags.push({
        flag: "HIGH_RISK",
        detail: `Reopen/follow-up rate ${reopenRate}% — indicates unresolved issues`,
      });
    }
    if (autoCloseablePct > 70) {
      qualityFlags.push({
        flag: "HIGH_AUTOMATION_POTENTIAL",
        detail: `${autoCloseablePct}% auto-closeable — strong candidate for automation`,
      });
    }

    const cluster: DiscoveryCluster = {
      clusterId,
      clusterSize: members.length,
      avgSemanticSimilarityToNearest: Math.round(nearestCanonical.similarity * 1000) / 1000,
      nearestCanonical,
      autoCloseablePct,
      reopenRate,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      topKeywords,
      exampleQuestions,
      suggestedLabel: dominantIntent || topKeywords.slice(0, 3).join("-"),
      qualityFlags,
      sampleTickets: members.slice(0, 5).map(m => ({
        ticketId: m.ticketId,
        question: m.text.substring(0, 200),
      })),
      dominantIntent,
    };

    if (nearestCanonical.similarity >= 0.78) {
      map_to_existing.push(cluster);
    } else if (nearestCanonical.similarity >= 0.65) {
      ambiguous_clusters.push(cluster);
    } else {
      proposed_new_intents.push(cluster);
    }
  }

  proposed_new_intents.sort((a, b) => b.clusterSize - a.clusterSize);
  map_to_existing.sort((a, b) => b.clusterSize - a.clusterSize);
  ambiguous_clusters.sort((a, b) => b.clusterSize - a.clusterSize);

  const noiseItems = noiseIndices.slice(0, 50).map(i => ({
    ticketId: tickets[i].ticketId,
    question: texts[i].substring(0, 200),
    intent: tickets[i].intent,
  }));

  onProgress?.("Intent discovery complete!", 100);

  return {
    metadata: {
      runAt: new Date().toISOString(),
      sourceTickets: sourceTickets.length,
      eligibleTickets: tickets.length,
      embeddedTickets: embeddings.length,
      totalClusters: clusterMap.size,
      noiseTickets: noiseIndices.length,
      processingTimeMs: Date.now() - startTime,
    },
    proposed_new_intents,
    map_to_existing,
    ambiguous_clusters,
    noise: noiseItems,
  };
}
