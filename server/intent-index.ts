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
  for (const intent of approved) {
    if (intent.embedding && Array.isArray(intent.embedding)) {
      intentIndex.push({
        intentId: intent.intentId,
        category: intent.category,
        subcategory: intent.subcategory,
        actionable: intent.actionable,
        embedding: intent.embedding as number[],
      });
    }
  }
  indexReady = true;
  console.log(`[IntentIndex] Refreshed: ${intentIndex.length} intents with embeddings loaded`);
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

export async function findSemanticMatch(
  userMessage: string,
  threshold: number = 0.78
): Promise<SemanticMatch | null> {
  if (intentIndex.length === 0) return null;

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
    return bestMatch;
  }
  return null;
}
