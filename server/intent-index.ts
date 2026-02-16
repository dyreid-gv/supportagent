import { storage } from "./storage";
import { cosineSimilarity, generateEmbedding } from "./embeddings";

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
  let skipped = 0;
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
      skipped++;
      nullEmbeddingIntents.push(intent.intentId);
    }
  }

  indexReady = true;
  console.log(`[IntentIndex] Refreshed: ${intentIndex.length} loaded, ${skipped} skipped (null embedding)`);
  if (nullEmbeddingIntents.length > 0) {
    console.warn(`[IntentIndex] WARNING: ${nullEmbeddingIntents.length} approved intents have null embeddings: ${nullEmbeddingIntents.slice(0, 10).join(", ")}${nullEmbeddingIntents.length > 10 ? "..." : ""}`);
  }
  return intentIndex.length;
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
}

export async function findSemanticMatch(
  userMessage: string,
  threshold: number = 0.78
): Promise<SemanticSearchResult> {
  if (intentIndex.length === 0) return { match: null, bestScore: 0 };

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

  if (bestMatch && bestMatch.similarity >= threshold) {
    return { match: bestMatch, bestScore };
  }
  return { match: null, bestScore: bestScore > 0 ? bestScore : 0 };
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
