import { storage } from "./storage";
import { cosineSimilarity, generateEmbedding } from "./embeddings";
import { isPilotEnabled } from "./pilot-stats";

interface IndexedIntent {
  intentId: string;
  category: string;
  subcategory: string | null;
  actionable: boolean | null;
  embedding: number[];
}

let intentIndex: IndexedIntent[] = [];
let indexReady = false;

export async function refreshIntentIndex(): Promise<number> {
  const approved = await storage.getApprovedCanonicalIntents();
  intentIndex = [];
  const nullEmbeddingIntents: string[] = [];

  for (const intent of approved) {
    if (intent.embedding && Array.isArray(intent.embedding)) {
      intentIndex.push({
        intentId: intent.intentId,
        category: intent.category,
        subcategory: intent.subcategory,
        actionable: intent.actionable,
        embedding: intent.embedding as number[],
      });
    } else {
      nullEmbeddingIntents.push(intent.intentId);
    }
  }

  const totalApproved = approved.length;
  const totalLoaded = intentIndex.length;
  const totalMissing = nullEmbeddingIntents.length;
  const ready = totalMissing === 0 && totalLoaded > 0;

  if (totalMissing > 0 && isPilotEnabled()) {
    indexReady = false;
    const errorMsg = `[IntentIndex] FATAL: ${totalMissing} approved intents have null embeddings in PILOT MODE. Intents: ${nullEmbeddingIntents.join(", ")}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  indexReady = true;

  console.log(`[IntentIndex] Approved: ${totalApproved} | Loaded embeddings: ${totalLoaded} | Missing: ${totalMissing} | Ready: ${ready}`);

  if (totalMissing > 0) {
    console.error(`[IntentIndex] CRITICAL: ${totalMissing} approved intents have null embeddings: ${nullEmbeddingIntents.join(", ")}`);
  }

  return totalLoaded;
}

export function isIndexReady(): boolean {
  return indexReady;
}

export function getIndexSize(): number {
  return intentIndex.length;
}

export function getApprovedIntentIds(): string[] {
  return intentIndex.map(i => i.intentId);
}

export interface SemanticMatch {
  intentId: string;
  category: string;
  subcategory: string | null;
  actionable: boolean | null;
  similarity: number;
}

export interface SemanticSearchResult {
  match: SemanticMatch | null;
  bestScore: number;
  bestIntentId: string | null;
}

export async function findSemanticMatch(
  userMessage: string,
  threshold: number = 0.78
): Promise<SemanticSearchResult> {
  if (intentIndex.length === 0) return { match: null, bestScore: 0, bestIntentId: null };

  const messageEmbedding = await generateEmbedding(userMessage);

  let bestMatch: SemanticMatch | null = null;
  let bestScore = -1;

  for (const intent of intentIndex) {
    const score = cosineSimilarity(messageEmbedding, intent.embedding);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        intentId: intent.intentId,
        category: intent.category,
        subcategory: intent.subcategory,
        actionable: intent.actionable,
        similarity: score,
      };
    }
  }

  const bestIntentId = bestMatch?.intentId || null;

  if (bestMatch && bestMatch.similarity >= threshold) {
    return { match: bestMatch, bestScore, bestIntentId };
  }
  return { match: null, bestScore: bestScore > 0 ? bestScore : 0, bestIntentId };
}

export async function findTopNSemanticMatches(
  userMessage: string,
  n: number = 3
): Promise<SemanticMatch[]> {
  if (intentIndex.length === 0) return [];

  const messageEmbedding = await generateEmbedding(userMessage);

  const scored: SemanticMatch[] = intentIndex.map(intent => ({
    intentId: intent.intentId,
    category: intent.category,
    subcategory: intent.subcategory,
    actionable: intent.actionable,
    similarity: cosineSimilarity(messageEmbedding, intent.embedding),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, n);
}
