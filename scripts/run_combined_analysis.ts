import OpenAI from "openai";
import { db } from "../server/db";
import { scrubbedTickets, categoryMappings, intentClassifications, resolutionPatterns, reviewQueue } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import { INTENTS, INTENT_DEFINITIONS } from "../shared/intents";
import * as fs from "fs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const LOG_FILE = "/tmp/combined_analysis.log";
const BATCH_SIZE = 5;

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

function extractJson(text: string): any {
  const cb = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) { try { return JSON.parse(cb[1]); } catch {} }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  const a = text.match(/\[[\s\S]*\]/);
  if (a) { try { return JSON.parse(a[0]); } catch {} }
  throw new Error("No valid JSON");
}

function formatIntentsForPrompt(): string {
  const byCategory: Record<string, string[]> = {};
  for (const [id, def] of Object.entries(INTENT_DEFINITIONS)) {
    const cat = (def as any).category || "Annet";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(id);
  }
  return Object.entries(byCategory).map(([cat, ids]) => `${cat}: ${ids.join(", ")}`).join("\n");
}

function buildPrompt(batch: any[], categoryList: string, intentsStr: string): string {
  const ticketsBlock = batch.map((t, idx) => `
TICKET ${idx + 1} (ID: ${t.ticketId}):
Kategori: ${t.hjelpesenterCategory || t.category || "Ingen"}
Emne: ${t.subject || "Ingen"}
Spørsmål: ${(t.customerQuestion || "Ingen").substring(0, 400)}
Svar: ${(t.agentAnswer || "Ingen").substring(0, 400)}`).join("\n---");

  return `Analyser ${batch.length} DyreID support-tickets. For hver, gi intent-klassifisering og resolusjonsanalyse.

${ticketsBlock}

INTENTS:
${intentsStr}

FOR HVER TICKET, gi JSON:
{"tickets": [{"ticket_id":12345,"intent":"IntentName","intent_confidence":0.85,"is_new_intent":false,"keywords":"nøkkelord","required_runtime_data":"","required_action":"","action_endpoint":"","payment_required":false,"auto_close_possible":false,"intent_reasoning":"...","customer_need":"...","actionable":false,"required_data":[],"guidance_steps":[],"info_text":"kort sammendrag","success_indicators":"","follow_up_needed":false,"dialog_pattern":"direct_human_response","resolution_quality":"medium"}]}`;
}

async function saveResult(ticket: any, result: any) {
  const [existingIntent] = await db.select().from(intentClassifications).where(eq(intentClassifications.ticketId, ticket.ticketId)).limit(1);
  const [existingRes] = await db.select().from(resolutionPatterns).where(eq(resolutionPatterns.ticketId, ticket.ticketId)).limit(1);

  if (existingIntent && existingRes) return;

  if (!existingIntent) {
    await db.insert(intentClassifications).values({
      ticketId: ticket.ticketId,
      intent: result.intent || "GeneralInquiry",
      intentConfidence: result.intent_confidence || 0.5,
      isNewIntent: result.is_new_intent || false,
      keywords: result.keywords || "",
      requiredRuntimeData: result.required_runtime_data || "",
      requiredAction: result.required_action || "",
      actionEndpoint: result.action_endpoint || "",
      paymentRequired: result.payment_required || false,
      autoClosePossible: result.auto_close_possible || false,
      reasoning: result.intent_reasoning || "",
    });
  }

  if (!existingRes) {
    const reqData = Array.isArray(result.required_data) ? result.required_data.join(", ") : (result.required_data || "");
    const steps = Array.isArray(result.guidance_steps) ? result.guidance_steps.join("; ") : "";
    const resolution = result.actionable ? steps : (result.info_text || "");

    await db.insert(resolutionPatterns).values({
      ticketId: ticket.ticketId,
      intent: result.intent || "GeneralInquiry",
      customerNeed: result.customer_need || "",
      dataGathered: reqData,
      resolutionSteps: typeof resolution === "object" ? JSON.stringify(resolution) : (resolution || ""),
      successIndicators: typeof result.success_indicators === "object" ? JSON.stringify(result.success_indicators) : (result.success_indicators || ""),
      followUpNeeded: result.follow_up_needed || false,
    });
  }

  await db.update(scrubbedTickets).set({ analysisStatus: "classified" }).where(eq(scrubbedTickets.ticketId, ticket.ticketId));

  if (result.is_new_intent) {
    await db.insert(reviewQueue).values({
      reviewType: "new_intent",
      referenceId: String(ticket.ticketId),
      priority: "high",
      data: result,
    });
  }
}

async function main() {
  fs.appendFileSync(LOG_FILE, "\n--- NEW RUN ---\n");

  const categories = await db.select().from(scrubbedTickets).where(eq(scrubbedTickets.categoryMappingStatus, "mapped"));
  const intentsStr = formatIntentsForPrompt();
  log(`Intents loaded`);

  let totalProcessed = 0, totalErrors = 0;

  while (true) {
    const unmapped = await db.select().from(scrubbedTickets)
      .where(and(
        eq(scrubbedTickets.categoryMappingStatus, "mapped"),
        eq(scrubbedTickets.analysisStatus, "pending")
      ))
      .limit(BATCH_SIZE);

    if (unmapped.length === 0) break;

    const prompt = buildPrompt(unmapped, "", intentsStr);
    log(`Processing batch of ${unmapped.length} tickets...`);

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.choices[0]?.message?.content || "";
      const parsed = extractJson(text);
      const results = Array.isArray(parsed) ? parsed : (parsed?.tickets || [parsed]);

      for (let i = 0; i < unmapped.length; i++) {
        const ticket = unmapped[i];
        const result = results[i] || results.find((r: any) => r.ticket_id === ticket.ticketId);
        if (!result) {
          log(`No result for ticket ${ticket.ticketId}`);
          totalErrors++;
          await db.update(scrubbedTickets).set({ analysisStatus: "classified" }).where(eq(scrubbedTickets.ticketId, ticket.ticketId));
          continue;
        }
        await saveResult(ticket, result);
        totalProcessed++;
      }
      log(`Batch OK: ${totalProcessed} total processed, ${totalErrors} errors`);
    } catch (err: any) {
      log(`API ERROR: ${err.message?.slice(0, 200)}`);
      totalErrors += unmapped.length;
      for (const t of unmapped) {
        await db.update(scrubbedTickets).set({ analysisStatus: "classified" }).where(eq(scrubbedTickets.ticketId, t.ticketId));
      }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  log(`COMPLETE: ${totalProcessed} processed, ${totalErrors} errors`);
  process.exit(0);
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
