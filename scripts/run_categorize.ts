import OpenAI from "openai";
import { db } from "../server/db";
import { scrubbedTickets, categoryMappings, hjelpesenterCategories } from "../shared/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const CONCURRENCY = 3;
const LOG_FILE = "/tmp/categorize_output.log";

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

function extractJson(text: string): any {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new Error("No valid JSON");
}

async function processTicket(ticket: any, categoryList: string): Promise<boolean> {
  try {
    const prompt = `Map denne DyreID-ticketen til riktig hjelpesenter-kategori.

Ticket: ${ticket.subject || "?"} | ${ticket.category || "?"}
Spørsmål: ${(ticket.customerQuestion || "").slice(0, 500)}
Svar: ${(ticket.agentAnswer || "").slice(0, 300)}

Kategorier:
${categoryList}

JSON: {"hjelpesenter_category":"...","hjelpesenter_subcategory":"...","confidence":0.0-1.0,"reasoning":"..."}`;

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.choices[0]?.message?.content || "";
    const result = extractJson(text);

    await db.insert(categoryMappings).values({
      ticketId: ticket.ticketId,
      pureserviceCategory: ticket.category,
      hjelpesenterCategory: result.hjelpesenter_category,
      hjelpesenterSubcategory: result.hjelpesenter_subcategory,
      confidence: String(result.confidence),
      reasoning: result.reasoning,
    });
    await db.update(scrubbedTickets).set({
      categoryMappingStatus: "mapped",
      hjelpesenterCategory: result.hjelpesenter_category,
      hjelpesenterSubcategory: result.hjelpesenter_subcategory,
    }).where(eq(scrubbedTickets.ticketId, ticket.ticketId));
    log(`OK ${ticket.ticketId} -> ${result.hjelpesenter_category}`);
    return true;
  } catch (err: any) {
    log(`ERR ${ticket.ticketId}: ${err.message?.slice(0, 100)}`);
    try {
      await db.insert(categoryMappings).values({
        ticketId: ticket.ticketId,
        pureserviceCategory: ticket.category,
        hjelpesenterCategory: "Ukategorisert",
        hjelpesenterSubcategory: "Feil ved mapping",
        confidence: "0",
        reasoning: `Error: ${err.message?.slice(0, 200)}`,
      });
    } catch {}
    await db.update(scrubbedTickets).set({
      categoryMappingStatus: "mapped",
      hjelpesenterCategory: "Ukategorisert",
      hjelpesenterSubcategory: "Feil ved mapping",
    }).where(eq(scrubbedTickets.ticketId, ticket.ticketId));
    return false;
  }
}

async function main() {
  fs.writeFileSync(LOG_FILE, "");
  const categories = await db.select().from(hjelpesenterCategories);
  const categoryList = categories.map(c => `${c.categoryName} > ${c.subcategoryName}`).join("\n");
  log(`Loaded ${categories.length} categories`);

  let totalMapped = 0, totalErrors = 0, batchNum = 0;

  while (true) {
    const unmapped = await db.select().from(scrubbedTickets)
      .where(eq(scrubbedTickets.categoryMappingStatus, "pending"))
      .limit(CONCURRENCY * 5);
    if (unmapped.length === 0) break;

    batchNum++;
    const remaining = unmapped.length;

    for (let i = 0; i < unmapped.length; i += CONCURRENCY) {
      const chunk = unmapped.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map(t => processTicket(t, categoryList)));
      for (const ok of results) { if (ok) totalMapped++; else totalErrors++; }
      log(`Progress: ${totalMapped + totalErrors} done this run, ~${remaining - (i + chunk.length)} remaining in batch`);
      await new Promise(r => setTimeout(r, 200));
    }
    log(`Batch ${batchNum} done. Total: ${totalMapped} ok, ${totalErrors} err`);
  }
  log(`COMPLETE: ${totalMapped} mapped, ${totalErrors} errors`);
  process.exit(0);
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
