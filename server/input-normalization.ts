import { db } from "./db";
import { canonicalIntents } from "@shared/schema";
import { eq } from "drizzle-orm";

export function isNormalizationEnabled(): boolean {
  return process.env.ENABLE_INPUT_NORMALIZATION === "true";
}

function isDebug(): boolean {
  return process.env.RUNTIME_DEBUG === "true";
}

// ── 1. Preprocessing Pipeline ──────────────────────────────────────────

export function preprocessMessage(raw: string): string {
  let s = raw;
  s = s.toLowerCase();
  s = s.replace(/<[^>]*>/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/([!?.,;:])\1{2,}/g, "$1");
  s = normalizeNorwegianChars(s);
  return s;
}

const NORWEGIAN_CHAR_MAP: Record<string, string> = {
  "dyreide": "dyreid",
  "eierbytte": "eierbytte",
  "aendre": "endre",
  "aerlig": "ærlig",
  "hoere": "høre",
  "foerste": "første",
  "oensker": "ønsker",
  "aarsak": "årsak",
  "aapen": "åpen",
};

function normalizeNorwegianChars(s: string): string {
  for (const [from, to] of Object.entries(NORWEGIAN_CHAR_MAP)) {
    s = s.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  return s;
}

// ── 2. Domain-Specific Spelling Correction ─────────────────────────────

interface DomainRule {
  pattern: RegExp;
  replacement: string;
}

const DOMAIN_DICTIONARY: DomainRule[] = [
  { pattern: /\bqrkode\b/g, replacement: "qr-brikke" },
  { pattern: /\bqr kode\b/g, replacement: "qr-brikke" },
  { pattern: /\bbrikke qr\b/g, replacement: "qr-brikke" },
  { pattern: /\bqr(?!\s*-?\s*(?:brikke|tag|kode))\b/g, replacement: "qr-brikke" },
  { pattern: /\bvipps funker ikke\b/g, replacement: "vipps betaling feilet" },
  { pattern: /\bvipps fungerer ikke\b/g, replacement: "vipps betaling feilet" },
  { pattern: /\binnlogging funker ikke\b/g, replacement: "innlogging problem" },
  { pattern: /\binnlogging fungerer ikke\b/g, replacement: "innlogging problem" },
  { pattern: /\blogge inn funker ikke\b/g, replacement: "innlogging problem" },
  { pattern: /\bfår ikke logga inn\b/g, replacement: "innlogging problem" },
  { pattern: /\bfår ikke logget inn\b/g, replacement: "innlogging problem" },
  { pattern: /\bminside\b/g, replacement: "min side" },
  { pattern: /\bmin-side\b/g, replacement: "min side" },
  { pattern: /\bfamilie deling\b/g, replacement: "familiedeling" },
  { pattern: /\bfamilie-deling\b/g, replacement: "familiedeling" },
  { pattern: /\bsmarttag\b/g, replacement: "smart tag" },
  { pattern: /\bsmart-tag\b/g, replacement: "smart tag" },
  { pattern: /\beier skifte\b/g, replacement: "eierskifte" },
  { pattern: /\beier-skifte\b/g, replacement: "eierskifte" },
  { pattern: /\beierskfte\b/g, replacement: "eierskifte" },
  { pattern: /\bchip nummer\b/g, replacement: "chipnummer" },
  { pattern: /\bchip-nummer\b/g, replacement: "chipnummer" },
  { pattern: /\bchipnr\b/g, replacement: "chipnummer" },
  { pattern: /\bchip nr\b/g, replacement: "chipnummer" },
  { pattern: /\bid merke\b/g, replacement: "id-merke" },
  { pattern: /\bidmerke\b/g, replacement: "id-merke" },
  { pattern: /\bid merking\b/g, replacement: "id-merking" },
  { pattern: /\bidmerking\b/g, replacement: "id-merking" },
  { pattern: /\babonement\b/g, replacement: "abonnement" },
  { pattern: /\babonnemang\b/g, replacement: "abonnement" },
  { pattern: /\babonnoment\b/g, replacement: "abonnement" },
  { pattern: /\bregistere\b/g, replacement: "registrere" },
  { pattern: /\bregisrere\b/g, replacement: "registrere" },
  { pattern: /\bregistring\b/g, replacement: "registrering" },
  { pattern: /\bregistrerig\b/g, replacement: "registrering" },
  { pattern: /\bfunkerer\b/g, replacement: "fungerer" },
  { pattern: /\bfunger\b/g, replacement: "fungerer" },
  { pattern: /\bfunka\b/g, replacement: "fungerer" },
  { pattern: /\bfunker\b/g, replacement: "fungerer" },
  { pattern: /\bkjæle dyr\b/g, replacement: "kjæledyr" },
  { pattern: /\bkjæle-dyr\b/g, replacement: "kjæledyr" },
  { pattern: /\bkjeledyr\b/g, replacement: "kjæledyr" },
  { pattern: /\bkjæedyr\b/g, replacement: "kjæledyr" },
  { pattern: /\bdyre id\b/g, replacement: "dyreid" },
  { pattern: /\bdyre-id\b/g, replacement: "dyreid" },
  { pattern: /\bpassord\b/g, replacement: "passord" },
  { pattern: /\bpasord\b/g, replacement: "passord" },
  { pattern: /\bveternær\b/g, replacement: "veterinær" },
  { pattern: /\bvetrinær\b/g, replacement: "veterinær" },
  { pattern: /\bveterinæren\b/g, replacement: "veterinær" },
  { pattern: /\bslettet\b/g, replacement: "slettet" },
  { pattern: /\bslette\b/g, replacement: "slette" },
  { pattern: /\boverføre\b/g, replacement: "overføre" },
  { pattern: /\boverfør\b/g, replacement: "overføre" },
  { pattern: /\boverførig\b/g, replacement: "overføring" },
];

export function applyDomainCorrections(input: string): string {
  let result = input;
  for (const rule of DOMAIN_DICTIONARY) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

// ── 3. Fuzzy Label Fallback ────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  let intersection = 0;
  const arrA = Array.from(setA);
  for (const item of arrA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zæøå0-9\s-]/g, "")
    .split(/\s+/)
    .filter(t => t.length > 1);
}

interface FuzzyMatchResult {
  intentId: string;
  fuzzyScore: number;
  matchDetail: string;
}

let cachedCanonicals: Array<{ intentId: string; label: string; keywords: string[] }> = [];
let canonicalCacheTime = 0;
const CANONICAL_CACHE_TTL = 120_000;

async function loadCanonicalIntentsForFuzzy(): Promise<typeof cachedCanonicals> {
  if (Date.now() - canonicalCacheTime < CANONICAL_CACHE_TTL && cachedCanonicals.length > 0) {
    return cachedCanonicals;
  }
  const rows = await db
    .select({
      intentId: canonicalIntents.intentId,
      description: canonicalIntents.description,
      keywords: canonicalIntents.keywords,
    })
    .from(canonicalIntents)
    .where(eq(canonicalIntents.approved, true));

  cachedCanonicals = rows.map(r => ({
    intentId: r.intentId,
    label: r.intentId
      .replace(/([A-Z])/g, " $1")
      .toLowerCase()
      .trim(),
    keywords: (r.keywords || "")
      .split(",")
      .map(k => k.trim().toLowerCase())
      .filter(Boolean),
  }));
  canonicalCacheTime = Date.now();
  return cachedCanonicals;
}

export async function fuzzyLabelFallback(
  normalizedMessage: string,
  semanticScore: number
): Promise<FuzzyMatchResult | null> {
  if (semanticScore < 0.60 || semanticScore >= 0.78) {
    return null;
  }

  const intents = await loadCanonicalIntentsForFuzzy();
  const msgTokens = tokenize(normalizedMessage);
  const msgTokenSet = new Set(msgTokens);

  let bestMatch: FuzzyMatchResult | null = null;

  for (const canonical of intents) {
    let maxScore = 0;
    let detail = "";

    const labelTokens = tokenize(canonical.label);
    for (const lt of labelTokens) {
      for (const mt of msgTokens) {
        if (lt.length <= 5 || mt.length <= 5) {
          const dist = levenshtein(mt, lt);
          if (dist <= 1 && lt.length >= 3) {
            const tokenScore = 1 - dist / Math.max(lt.length, mt.length);
            if (tokenScore > maxScore) {
              maxScore = tokenScore;
              detail = `levenshtein: "${mt}"≈"${lt}" (dist=${dist})`;
            }
          }
        } else {
          const dist = levenshtein(mt, lt);
          if (dist <= 2) {
            const tokenScore = 1 - dist / Math.max(lt.length, mt.length);
            if (tokenScore > maxScore) {
              maxScore = tokenScore;
              detail = `levenshtein: "${mt}"≈"${lt}" (dist=${dist})`;
            }
          }
        }
      }
    }

    if (canonical.keywords.length > 0) {
      const kwSet = new Set(canonical.keywords);
      const jaccard = jaccardSimilarity(msgTokenSet, kwSet);
      const keywordScore = jaccard * 1.2;
      if (keywordScore > maxScore) {
        maxScore = keywordScore;
        detail = `jaccard: msgTokens∩keywords (score=${jaccard.toFixed(3)})`;
      }

      for (const kw of canonical.keywords) {
        for (const mt of msgTokens) {
          const dist = levenshtein(mt, kw);
          if (dist <= 2 && kw.length >= 3) {
            const tokenScore = 1 - dist / Math.max(kw.length, mt.length);
            const boosted = tokenScore * 1.1;
            if (boosted > maxScore) {
              maxScore = boosted;
              detail = `keyword-levenshtein: "${mt}"≈"${kw}" (dist=${dist})`;
            }
          }
        }
      }
    }

    if (maxScore >= 0.75 && (!bestMatch || maxScore > bestMatch.fuzzyScore)) {
      bestMatch = {
        intentId: canonical.intentId,
        fuzzyScore: parseFloat(maxScore.toFixed(3)),
        matchDetail: detail,
      };
    }
  }

  return bestMatch;
}

// ── 4. Full Normalization Pipeline ─────────────────────────────────────

export interface NormalizationResult {
  original: string;
  normalized: string;
  changed: boolean;
  corrections: string[];
}

export function normalizeInput(raw: string): NormalizationResult {
  const original = raw;
  const preprocessed = preprocessMessage(raw);
  const corrected = applyDomainCorrections(preprocessed);

  const corrections: string[] = [];
  if (preprocessed !== corrected) {
    const preTokens = preprocessed.split(/\s+/);
    const corrTokens = corrected.split(/\s+/);
    if (preTokens.join(" ") !== corrTokens.join(" ")) {
      corrections.push(`domain_correction: "${preprocessed}" → "${corrected}"`);
    }
  }

  const changed = original.toLowerCase().trim() !== corrected;

  if (isDebug() && changed) {
    console.log(`[Normalization] original="${original}" | normalized="${corrected}" | corrections=${corrections.length > 0 ? corrections.join("; ") : "preprocessing-only"}`);
  }

  return {
    original,
    normalized: corrected,
    changed,
    corrections,
  };
}

export function logFuzzyMatch(
  original: string,
  normalized: string,
  fuzzyResult: FuzzyMatchResult | null
): void {
  if (!isDebug()) return;
  if (fuzzyResult) {
    console.log(
      `[Normalization] original="${original}" | normalized="${normalized}" | fuzzyMatched="${fuzzyResult.intentId}" | fuzzyScore=${fuzzyResult.fuzzyScore} | detail=${fuzzyResult.matchDetail}`
    );
  }
}
