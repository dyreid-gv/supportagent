import { db } from "./db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { escalationsOutbox, messages, canonicalIntents } from "@shared/schema";
import { scrubText } from "./gdpr-scrubber";

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const MAX_PER_SESSION = 1;
const MAX_PER_EMAIL_PER_DAY = 3;

export function isEscalationEnabled(): boolean {
  return process.env.ENABLE_CASE_ESCALATION === "true";
}

export function isPureservicePostEnabled(): boolean {
  return process.env.ENABLE_PURESERVICE_POST === "true";
}

export function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

const FRUSTRATION_SIGNALS = [
  /fungerer ikke/i,
  /hjelper ikke/i,
  /ikke riktig/i,
  /forstår ikke/i,
  /feil svar/i,
  /det stemmer ikke/i,
  /prøvd det/i,
  /allerede prøvd/i,
  /dette hjelper ikke/i,
  /kan du ikke bare/i,
  /snakke med menneske/i,
  /ekte person/i,
  /kundeservice/i,
  /support/i,
  /klage/i,
];

export function detectFrustration(message: string): boolean {
  return FRUSTRATION_SIGNALS.some(r => r.test(message));
}

export interface EscalationTrigger {
  type: "post_answer" | "no_progress" | "frustration" | "block";
  reason: string;
}

export function shouldTriggerEscalation(opts: {
  justDeliveredAnswer: boolean;
  justCompletedAction: boolean;
  consecutiveNoProgress: number;
  userMessage: string;
  wasBlocked: boolean;
}): EscalationTrigger | null {
  if (!isEscalationEnabled()) return null;

  if (opts.wasBlocked) {
    return { type: "block", reason: "Bot could not handle query (BLOCK)" };
  }
  if (opts.justDeliveredAnswer) {
    return { type: "post_answer", reason: "Informational answer delivered" };
  }
  if (opts.justCompletedAction) {
    return { type: "post_answer", reason: "Transactional flow completed" };
  }
  if (opts.consecutiveNoProgress >= 3) {
    return { type: "no_progress", reason: `${opts.consecutiveNoProgress} messages without progress` };
  }
  if (detectFrustration(opts.userMessage)) {
    return { type: "frustration", reason: "User frustration detected" };
  }
  return null;
}

export async function checkDedupe(email: string, intentId: string | null): Promise<{ isDuplicate: boolean; existingId?: number }> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const conditions = [
    eq(escalationsOutbox.userEmail, email.toLowerCase().trim()),
    gte(escalationsOutbox.createdAt, twentyFourHoursAgo),
  ];
  if (intentId) {
    conditions.push(eq(escalationsOutbox.intentId, intentId));
  }

  const existing = await db
    .select({ id: escalationsOutbox.id })
    .from(escalationsOutbox)
    .where(and(...conditions))
    .limit(1);

  return existing.length > 0
    ? { isDuplicate: true, existingId: existing[0].id }
    : { isDuplicate: false };
}

export async function checkSessionRateLimit(conversationId: number): Promise<boolean> {
  const existing = await db
    .select({ id: escalationsOutbox.id })
    .from(escalationsOutbox)
    .where(eq(escalationsOutbox.conversationId, conversationId))
    .limit(MAX_PER_SESSION + 1);
  return existing.length >= MAX_PER_SESSION;
}

export async function checkEmailRateLimit(email: string): Promise<boolean> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await db
    .select({ id: escalationsOutbox.id })
    .from(escalationsOutbox)
    .where(and(
      eq(escalationsOutbox.userEmail, email.toLowerCase().trim()),
      gte(escalationsOutbox.createdAt, twentyFourHoursAgo),
    ))
    .limit(MAX_PER_EMAIL_PER_DAY + 1);
  return existing.length >= MAX_PER_EMAIL_PER_DAY;
}

export async function buildChatTranscript(conversationId: number): Promise<string> {
  const msgs = await db
    .select({ role: messages.role, content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);

  return msgs
    .map(m => {
      const role = m.role === "user" ? "Bruker" : "Bot";
      return `[${role}]: ${m.content}`;
    })
    .join("\n\n");
}

function scrubTranscript(transcript: string): string {
  return scrubText(transcript);
}

export async function getCategoryFromIntent(intentId: string | null): Promise<{
  category1Id: string | null;
  category2Id: string | null;
  category3Id: string | null;
}> {
  if (!intentId) {
    return { category1Id: "GeneralInquiry", category2Id: null, category3Id: null };
  }

  const canonical = await db
    .select({ category: canonicalIntents.category, subcategory: canonicalIntents.subcategory, approved: canonicalIntents.approved })
    .from(canonicalIntents)
    .where(eq(canonicalIntents.intentId, intentId))
    .limit(1);

  if (canonical.length > 0 && canonical[0].approved) {
    return {
      category1Id: canonical[0].category || "GeneralInquiry",
      category2Id: canonical[0].subcategory || null,
      category3Id: null,
    };
  }

  return { category1Id: "GeneralInquiry", category2Id: null, category3Id: null };
}

export interface CreateEscalationParams {
  conversationId: number;
  sessionId?: string;
  intentId: string | null;
  matchedBy: string | null;
  semanticScore: number | null;
  userEmail: string;
  productContext?: string;
}

export async function createEscalation(params: CreateEscalationParams): Promise<{
  success: boolean;
  escalationId?: number;
  error?: string;
  isDuplicate?: boolean;
  existingId?: number;
}> {
  const email = params.userEmail.toLowerCase().trim();

  if (!validateEmail(email)) {
    return { success: false, error: "Ugyldig e-postadresse. Vennligst oppgi en gyldig e-post." };
  }

  const sessionLimited = await checkSessionRateLimit(params.conversationId);
  if (sessionLimited) {
    return { success: false, error: "Du har allerede opprettet en supportsak i denne samtalen." };
  }

  const emailLimited = await checkEmailRateLimit(email);
  if (emailLimited) {
    return { success: false, error: "Du har nådd grensen for antall saker per dag. Prøv igjen i morgen." };
  }

  const dedupe = await checkDedupe(email, params.intentId);
  if (dedupe.isDuplicate) {
    return {
      success: false,
      isDuplicate: true,
      existingId: dedupe.existingId,
      error: "Det finnes allerede en nylig sak om dette temaet. Saken er videresendt til kundeservice.",
    };
  }

  const rawTranscript = await buildChatTranscript(params.conversationId);
  const scrubbedTranscript = scrubTranscript(rawTranscript);

  const categories = await getCategoryFromIntent(params.intentId);

  const shortSummary = params.intentId
    ? params.intentId.replace(/([A-Z])/g, " $1").trim()
    : "Generell henvendelse";

  const subject = `DyreID Support AI – ${params.intentId || "Ukjent"} – ${shortSummary}`;

  const descriptionParts = [
    `--- Automatisk opprettet av DyreID Support AI ---`,
    ``,
    `Intent: ${params.intentId || "Ikke identifisert"}`,
    `Match-metode: ${params.matchedBy || "N/A"}`,
    `Semantisk score: ${params.semanticScore?.toFixed(3) || "N/A"}`,
    `Kategori: ${categories.category1Id || "GeneralInquiry"}${categories.category2Id ? " > " + categories.category2Id : ""}`,
    params.productContext ? `Kontekst: ${params.productContext}` : null,
    ``,
    `--- Samtalelogg (scrubbet) ---`,
    ``,
    scrubbedTranscript,
  ].filter(Boolean).join("\n");

  const metadata = {
    source: "dyreid-ai",
    intentId: params.intentId,
    semanticScore: params.semanticScore,
    matchedBy: params.matchedBy,
    chatSessionId: params.sessionId,
    conversationId: params.conversationId,
    escalatedAt: new Date().toISOString(),
    pureservicePostEnabled: isPureservicePostEnabled(),
  };

  const [inserted] = await db
    .insert(escalationsOutbox)
    .values({
      conversationId: params.conversationId,
      sessionId: params.sessionId || null,
      intentId: params.intentId,
      matchedBy: params.matchedBy,
      semanticScore: params.semanticScore,
      userEmail: email,
      subject,
      description: descriptionParts,
      category1Id: categories.category1Id,
      category2Id: categories.category2Id,
      category3Id: categories.category3Id,
      status: isPureservicePostEnabled() ? "ready_to_post" : "pending",
      chatTranscript: scrubbedTranscript,
      metadata,
    })
    .returning({ id: escalationsOutbox.id });

  console.log(`[Escalation] Created #${inserted.id} for ${email} | intent=${params.intentId} | status=${isPureservicePostEnabled() ? "ready_to_post" : "pending (logs only)"}`);

  return { success: true, escalationId: inserted.id };
}

export async function getEscalationStats(): Promise<{
  total: number;
  pending: number;
  posted: number;
  failed: number;
  today: number;
  featureEnabled: boolean;
  postEnabled: boolean;
}> {
  const stats = await db
    .select({
      total: sql<number>`count(*)`,
      pending: sql<number>`count(*) filter (where ${escalationsOutbox.status} = 'pending')`,
      posted: sql<number>`count(*) filter (where ${escalationsOutbox.status} = 'posted')`,
      failed: sql<number>`count(*) filter (where ${escalationsOutbox.status} = 'failed')`,
      today: sql<number>`count(*) filter (where ${escalationsOutbox.createdAt} >= current_date)`,
    })
    .from(escalationsOutbox);

  return {
    total: Number(stats[0]?.total || 0),
    pending: Number(stats[0]?.pending || 0),
    posted: Number(stats[0]?.posted || 0),
    failed: Number(stats[0]?.failed || 0),
    today: Number(stats[0]?.today || 0),
    featureEnabled: isEscalationEnabled(),
    postEnabled: isPureservicePostEnabled(),
  };
}

export async function getEscalations(limit = 50, offset = 0): Promise<any[]> {
  return db
    .select()
    .from(escalationsOutbox)
    .orderBy(sql`${escalationsOutbox.createdAt} desc`)
    .limit(limit)
    .offset(offset);
}

export async function updateEscalationStatus(id: number, status: string, errorMessage?: string): Promise<void> {
  await db
    .update(escalationsOutbox)
    .set({
      status,
      errorMessage: errorMessage || null,
      ...(status === "posted" ? { postedAt: new Date() } : {}),
    })
    .where(eq(escalationsOutbox.id, id));
}

export interface QCReport {
  generatedAt: string;
  itemCount: number;
  distribution: {
    topIntents: { intentId: string; count: number; pct: number }[];
    topCategories: { category: string; count: number; pct: number }[];
    fallbackCategoryRate: number;
    missingSubcategoryRate: number;
  };
  dedupe: {
    duplicateEmailIntentPairs: number;
    multiplePerSession: number;
    dedupeWorking: boolean;
  };
  contentQuality: {
    samples: {
      id: number;
      subject: string;
      transcriptPreview: string;
      intentId: string | null;
      category: string | null;
      transcriptLength: number;
      isEmpty: boolean;
    }[];
    emptyTranscriptCount: number;
    shortTranscriptCount: number;
  };
  payloadDesign: {
    emailInDedicatedField: boolean;
    transcriptContainsEmail: number;
    subjectIncludesIntent: number;
    subjectMissingIntent: number;
  };
  readinessGates: {
    gate1: { label: string; value: number; threshold: number; pass: boolean };
    gate2: { label: string; dedupeActive: boolean; slippedDuplicates: number; pass: boolean };
    gate3: { label: string; emptyOrShort: number; total: number; pass: boolean };
  };
  overallVerdict: "PASS" | "FAIL";
  blockingIssues: string[];
}

export async function generateQCReport(limit = 200): Promise<QCReport> {
  const rows = await db
    .select()
    .from(escalationsOutbox)
    .orderBy(desc(escalationsOutbox.createdAt))
    .limit(limit);

  const n = rows.length;
  const blockingIssues: string[] = [];

  const intentCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  let fallbackCount = 0;
  let missingSubcatCount = 0;

  for (const row of rows) {
    const intent = row.intentId || "(null)";
    intentCounts.set(intent, (intentCounts.get(intent) || 0) + 1);

    const cat = row.category1Id || "(null)";
    categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);

    if (!row.category1Id || row.category1Id === "GeneralInquiry") fallbackCount++;
    if (!row.category2Id) missingSubcatCount++;
  }

  const topIntents = Array.from(intentCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([intentId, count]) => ({ intentId, count, pct: n > 0 ? Math.round((count / n) * 1000) / 10 : 0 }));

  const topCategories = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([category, count]) => ({ category, count, pct: n > 0 ? Math.round((count / n) * 1000) / 10 : 0 }));

  const sessionCounts = new Map<number, number>();
  const emailIntentPairs = new Map<string, number>();

  for (const row of rows) {
    sessionCounts.set(row.conversationId, (sessionCounts.get(row.conversationId) || 0) + 1);

    const key = `${row.userEmail}||${row.intentId || "null"}`;
    emailIntentPairs.set(key, (emailIntentPairs.get(key) || 0) + 1);
  }

  const multiplePerSession = Array.from(sessionCounts.values()).filter(c => c > 1).length;
  const duplicateEmailIntentPairs = Array.from(emailIntentPairs.values()).filter(c => c > 1).length;

  const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  let transcriptContainsEmail = 0;
  let subjectIncludesIntent = 0;
  let subjectMissingIntent = 0;
  let emptyTranscriptCount = 0;
  let shortTranscriptCount = 0;

  for (const row of rows) {
    if (row.chatTranscript && EMAIL_PATTERN.test(row.chatTranscript)) transcriptContainsEmail++;
    if (row.subject && row.intentId && row.subject.includes(row.intentId)) subjectIncludesIntent++;
    if (row.subject && row.intentId && !row.subject.includes(row.intentId)) subjectMissingIntent++;
    if (!row.chatTranscript || row.chatTranscript.trim().length === 0) emptyTranscriptCount++;
    else if (row.chatTranscript.trim().length < 50) shortTranscriptCount++;
  }

  const shuffled = [...rows].sort(() => Math.random() - 0.5);
  const sampleRows = shuffled.slice(0, Math.min(20, n));
  const samples = sampleRows.map(row => ({
    id: row.id,
    subject: row.subject || "",
    transcriptPreview: (row.chatTranscript || "").slice(0, 300),
    intentId: row.intentId,
    category: row.category1Id,
    transcriptLength: (row.chatTranscript || "").length,
    isEmpty: !row.chatTranscript || row.chatTranscript.trim().length === 0,
  }));

  const validCat1Pct = n > 0 ? Math.round(((n - fallbackCount) / n) * 1000) / 10 : 0;
  const gate1Pass = n === 0 || validCat1Pct >= 90;
  if (!gate1Pass) blockingIssues.push(`Gate 1 FAIL: Valid category1Id rate ${validCat1Pct}% < 90% threshold`);

  const gate2Pass = n === 0 || (multiplePerSession === 0);
  if (!gate2Pass) blockingIssues.push(`Gate 2 FAIL: ${multiplePerSession} sessions have >1 escalation (dedupe bypass)`);
  if (duplicateEmailIntentPairs > 0) blockingIssues.push(`Gate 2 WARNING: ${duplicateEmailIntentPairs} email+intent pairs appear multiple times (may be within different 24h windows)`);

  const emptyOrShort = emptyTranscriptCount + shortTranscriptCount;
  const gate3Pass = n === 0 || emptyOrShort <= Math.ceil(n * 0.1);
  if (!gate3Pass) blockingIssues.push(`Gate 3 FAIL: ${emptyOrShort}/${n} items have empty/too-short transcripts (>${Math.ceil(n * 0.1)} threshold)`);

  if (transcriptContainsEmail > 0) blockingIssues.push(`PAYLOAD ISSUE: ${transcriptContainsEmail} scrubbed transcripts still contain email addresses`);
  if (n > 0 && subjectMissingIntent > 0) blockingIssues.push(`PAYLOAD ISSUE: ${subjectMissingIntent} subjects missing intentId`);

  const overallVerdict = (gate1Pass && gate2Pass && gate3Pass && transcriptContainsEmail === 0) ? "PASS" : "FAIL";

  return {
    generatedAt: new Date().toISOString(),
    itemCount: n,
    distribution: {
      topIntents,
      topCategories,
      fallbackCategoryRate: n > 0 ? Math.round((fallbackCount / n) * 1000) / 10 : 0,
      missingSubcategoryRate: n > 0 ? Math.round((missingSubcatCount / n) * 1000) / 10 : 0,
    },
    dedupe: {
      duplicateEmailIntentPairs,
      multiplePerSession,
      dedupeWorking: multiplePerSession === 0,
    },
    contentQuality: {
      samples,
      emptyTranscriptCount,
      shortTranscriptCount,
    },
    payloadDesign: {
      emailInDedicatedField: true,
      transcriptContainsEmail,
      subjectIncludesIntent,
      subjectMissingIntent,
    },
    readinessGates: {
      gate1: { label: "Valid category1Id >= 90%", value: validCat1Pct, threshold: 90, pass: gate1Pass },
      gate2: { label: "Dedupe prevention working", dedupeActive: multiplePerSession === 0, slippedDuplicates: duplicateEmailIntentPairs, pass: gate2Pass },
      gate3: { label: "Content usefulness (empty/short <= 10%)", emptyOrShort, total: n, pass: gate3Pass },
    },
    overallVerdict,
    blockingIssues,
  };
}
