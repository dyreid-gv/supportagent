import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

export interface IntentEmbeddingInput {
  intentId: string;
  category: string;
  subcategory?: string | null;
  description?: string | null;
  keywords?: string | null;
  infoText?: string | null;
}

export function buildIntentEmbeddingText(intent: IntentEmbeddingInput): string {
  const parts: string[] = [];
  parts.push(`Intent: ${intent.intentId}`);
  parts.push(`Kategori: ${intent.category}`);
  if (intent.subcategory) parts.push(`Underkategori: ${intent.subcategory}`);
  if (intent.description) parts.push(`Beskrivelse: ${intent.description}`);
  if (intent.keywords) parts.push(`Nøkkelord: ${intent.keywords}`);
  if (intent.infoText) parts.push(`Info: ${intent.infoText.substring(0, 500)}`);
  return parts.join(" | ");
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data[0].embedding;
}

export async function generateIntentEmbedding(intent: IntentEmbeddingInput): Promise<number[]> {
  const text = buildIntentEmbeddingText(intent);
  return generateEmbedding(text);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
