import OpenAI from "openai";
import { sql } from "drizzle-orm";
import { storage } from "./storage";
import { db } from "./db";
import { scrubbedTickets, playbookEntries } from "@shared/schema";
import { scrubTicket } from "./gdpr-scrubber";
import { getClosedTickets, mapPureserviceToRawTicket } from "./integrations/pureservice-v3";
import { INTENTS, INTENT_DEFINITIONS } from "@shared/intents";
import { log } from "./index";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface BatchMetrics {
  totalTickets: number;
  processedTickets: number;
  apiCalls: number;
  errors: number;
  startTime: number;
  endTime?: number;
  elapsedMs?: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
}

function createMetrics(): BatchMetrics {
  return {
    totalTickets: 0,
    processedTickets: 0,
    apiCalls: 0,
    errors: 0,
    startTime: Date.now(),
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedCostUsd: 0,
  };
}

function finalizeMetrics(m: BatchMetrics): BatchMetrics {
  m.endTime = Date.now();
  m.elapsedMs = m.endTime - m.startTime;
  m.estimatedCostUsd = (m.estimatedInputTokens * 0.0000003) + (m.estimatedOutputTokens * 0.0000012);
  return m;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

const KNOWN_INTENTS = INTENTS;

const INTENT_TO_HELPCENTER_CATEGORY: Record<string, string> = {
  "DyreID-appen": "App",
  "QR-brikke": "Produkter - QR Tag",
  "Smart Tag": "Produkter - Smart Tag",
  "Utenlandsregistrering": "Registrering",
  "Eierskifte": "Eierskifte",
  "Min side": "Min side",
  "Familiedeling": "Familiedeling",
  "Savnet/Funnet": "Savnet/Funnet",
  "ID-søk": "ID-søk",
};

function formatIntentsForPrompt(): string {
  const byCategory: Record<string, typeof INTENT_DEFINITIONS> = {};
  for (const d of INTENT_DEFINITIONS) {
    if (!byCategory[d.category]) byCategory[d.category] = [];
    byCategory[d.category].push(d);
  }
  return Object.entries(byCategory)
    .map(([cat, defs]) =>
      `${cat}:\n${defs.map(d => `  - ${d.intent} (${d.subcategory})`).join("\n")}`
    )
    .join("\n");
}

async function callOpenAI(prompt: string, model: string = "gpt-5-nano", maxTokens: number = 4096, jsonMode: boolean = false): Promise<string> {
  const params: any = {
    model,
    max_completion_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (jsonMode) {
    params.response_format = { type: "json_object" };
  }
  const response = await openai.chat.completions.create(params);
  return response.choices[0]?.message?.content || "";
}

function extractJson(text: string): any {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {}
  }

  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {}
  }

  throw new Error("No valid JSON found in AI response");
}

// ─── WORKFLOW 1: PURESERVICE TICKET INGESTION ─────────────────────────────
export async function runIngestion(
  onProgress?: (msg: string, pct: number) => void,
  maxTickets?: number
): Promise<{ ingested: number; errors: number }> {
  let totalIngested = 0;
  let totalErrors = 0;
  let page = 1;
  const pageSize = 100;
  let hasMore = true;
  const limit = maxTickets || Infinity;

  onProgress?.(`Starter ticket-innhenting fra Pureservice${maxTickets ? ` (maks ${maxTickets})` : ''}...`, 0);

  while (hasMore) {
    try {
      const fetchSize = Math.min(pageSize, limit - totalIngested);
      if (fetchSize <= 0) break;

      const { tickets, total } = await getClosedTickets(page, fetchSize);

      if (tickets.length === 0) {
        hasMore = false;
        break;
      }

      const rawTicketData = tickets.map(mapPureserviceToRawTicket);
      await storage.insertRawTickets(rawTicketData);
      totalIngested += tickets.length;

      const target = maxTickets ? Math.min(total, maxTickets) : total;
      const pct = Math.min(100, Math.round((totalIngested / Math.max(target, 1)) * 100));
      onProgress?.(`Hentet ${totalIngested} av ~${target} tickets (side ${page})`, pct);

      if (totalIngested >= limit || totalIngested >= total || tickets.length < fetchSize) {
        hasMore = false;
      }
      page++;

      await new Promise((r) => setTimeout(r, 200));
    } catch (err: any) {
      totalErrors++;
      log(`Ingestion error page ${page}: ${err.message}`, "training");
      onProgress?.(`Feil på side ${page}: ${err.message}`, -1);
      if (totalErrors > 5) {
        hasMore = false;
      }
      page++;
    }
  }

  onProgress?.(`Innhenting ferdig: ${totalIngested} tickets, ${totalErrors} feil`, 100);
  return { ingested: totalIngested, errors: totalErrors };
}

// ─── WORKFLOW 2: GDPR SCRUBBING ──────────────────────────────────────────
export async function runGdprScrubbing(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ scrubbed: number; errors: number }> {
  const batchSize = 100;
  let totalScrubbed = 0;
  let totalErrors = 0;

  onProgress?.("Starter GDPR-rensing...", 0);

  const totalRaw = await storage.getRawTicketCount();

  while (true) {
    const unprocessed = await storage.getUnprocessedRawTickets(batchSize);
    if (unprocessed.length === 0) break;

    for (const ticket of unprocessed) {
      try {
        const scrubbed = scrubTicket(ticket);
        await storage.insertScrubbedTicket({
          ticketId: ticket.ticketId,
          category: ticket.category,
          categoryId: ticket.categoryId,
          subject: scrubbed.subject,
          customerQuestion: scrubbed.customerQuestion,
          agentAnswer: scrubbed.agentAnswer,
          messages: scrubbed.messages,
          resolution: ticket.resolution,
          tags: ticket.tags,
          autoClosed: ticket.autoClosed,
        });
        await storage.markRawTicketProcessed(ticket.ticketId);
        totalScrubbed++;
      } catch (err: any) {
        totalErrors++;
        log(`Scrub error ticket ${ticket.ticketId}: ${err.message}`, "training");
      }
    }

    const pct = Math.round((totalScrubbed / Math.max(totalRaw, 1)) * 100);
    onProgress?.(`Renset ${totalScrubbed} av ${totalRaw} tickets`, pct);
  }

  onProgress?.(`GDPR-rensing ferdig: ${totalScrubbed} tickets, ${totalErrors} feil`, 100);
  return { scrubbed: totalScrubbed, errors: totalErrors };
}

// ─── WORKFLOW 3: HJELPESENTER CATEGORY MAPPING ───────────────────────────
export async function runCategoryMapping(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ mapped: number; errors: number }> {
  const batchSize = 10;
  let totalMapped = 0;
  let totalErrors = 0;

  onProgress?.("Starter kategorimapping...", 0);

  const categories = await storage.getHjelpesenterCategories();
  const categoryList = categories
    .map((c) => `${c.categoryName} > ${c.subcategoryName}: ${c.description || ""}`)
    .join("\n");

  while (true) {
    const unmapped = await storage.getUnmappedScrubbedTickets(batchSize);
    if (unmapped.length === 0) break;

    for (const ticket of unmapped) {
      try {
        const prompt = `Du er en ekspert på DyreID sin support-struktur.

OPPGAVE: Mapper denne Pureservice-ticketen til riktig kategori i DyreID hjelpesenter.

PURESERVICE TICKET:
- Pureservice Kategori: ${ticket.category || "Ingen"}
- Emne: ${ticket.subject || "Ingen"}
- Kundespørsmål: ${ticket.customerQuestion || "Ingen"}
- Agentsvar: ${ticket.agentAnswer || "Ingen"}

HJELPESENTER KATEGORIER:
${categoryList}

INSTRUKSJONER:
1. Analyser ticket-innholdet
2. Finn beste match i hjelpesenter-struktur
3. Hvis ingen god match: sett category til "Ukategorisert"

SVAR I JSON:
{
  "hjelpesenter_category": "Category name",
  "hjelpesenter_subcategory": "Subcategory name",
  "confidence": 0.0-1.0,
  "reasoning": "Why this mapping?"
}`;

        const text = await callOpenAI(prompt);
        const result = extractJson(text);

        await storage.insertCategoryMapping({
          ticketId: ticket.ticketId,
          pureserviceCategory: ticket.category,
          hjelpesenterCategory: result.hjelpesenter_category,
          hjelpesenterSubcategory: result.hjelpesenter_subcategory,
          confidence: result.confidence,
          reasoning: result.reasoning,
        });
        await storage.updateScrubbedTicketMapping(
          ticket.ticketId,
          result.hjelpesenter_category,
          result.hjelpesenter_subcategory
        );
        totalMapped++;
      } catch (err: any) {
        totalErrors++;
        log(`Category mapping error ticket ${ticket.ticketId}: ${err.message}`, "training");
      }
    }

    const scrubbedCount = await storage.getScrubbedTicketCount();
    const pct = Math.round((totalMapped / Math.max(scrubbedCount, 1)) * 100);
    onProgress?.(`Mappet ${totalMapped} tickets`, pct);
  }

  onProgress?.(`Kategorimapping ferdig: ${totalMapped} mappet, ${totalErrors} feil`, 100);
  return { mapped: totalMapped, errors: totalErrors };
}

// ─── WORKFLOW 4: UNCATEGORIZED TICKET ANALYSIS ───────────────────────────
export async function runUncategorizedAnalysis(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ themes: number; errors: number }> {
  let totalThemes = 0;
  let totalErrors = 0;

  onProgress?.("Starter analyse av ukategoriserte tickets...", 0);

  const uncategorized = await storage.getUncategorizedScrubbedTickets(100);

  if (uncategorized.length === 0) {
    onProgress?.("Ingen ukategoriserte tickets å analysere", 100);
    return { themes: 0, errors: 0 };
  }

  onProgress?.(`Fant ${uncategorized.length} ukategoriserte tickets. Kjører klyngeanalyse...`, 20);

  try {
    const ticketSummaries = uncategorized.map((t, i) =>
      `TICKET ${i + 1} (ID: ${t.ticketId}):\nEmne: ${t.subject || "Ingen"}\nSpørsmål: ${t.customerQuestion || "Ingen"}\nSvar: ${t.agentAnswer || "Ingen"}\n---`
    ).join("\n");

    const prompt = `Du er en ekspert på å analysere support-tickets og finne mønstre.

OPPGAVE: Analyser disse ukategoriserte tickets og identifiser felles temaer/problemtyper.

TICKETS:
${ticketSummaries}

INSTRUKSJONER:
1. Identifiser felles temaer på tvers av tickets
2. Foreslå nye kategorier hvis temaene ikke finnes i hjelpesenter
3. Grupper tickets etter tema
4. Vurder om noen tickets faktisk burde vært i eksisterende kategori

EKSISTERENDE KATEGORIER: ID-søk, DyreID-appen, Min side, Eierskifte, Smart Tag, QR-brikke, Utenlandsregistrering, Savnet/Funnet, Familiedeling

SVAR I JSON:
{
  "identified_themes": [
    {
      "theme_name": "Tema navn",
      "description": "Hva handler dette om?",
      "ticket_ids": [1, 5, 12],
      "should_be_new_category": true,
      "suggested_existing_category": "Kategori hvis det passer eksisterende"
    }
  ]
}`;

    const text = await callOpenAI(prompt, "gpt-5-mini", 8192);
    const result = extractJson(text);

    const themes = result.identified_themes || result;

    for (const theme of themes) {
      try {
        const themeId = await storage.insertUncategorizedTheme({
          themeName: theme.theme_name,
          description: theme.description,
          ticketCount: theme.ticket_ids?.length || 0,
          ticketIds: JSON.stringify(theme.ticket_ids || []),
          shouldBeNewCategory: theme.should_be_new_category || false,
          suggestedExistingCategory: theme.suggested_existing_category || null,
        });

        await storage.insertReviewQueueItem({
          reviewType: "uncategorized_theme",
          referenceId: themeId,
          priority: "medium",
          data: theme,
        });

        totalThemes++;
      } catch (err: any) {
        totalErrors++;
        log(`Theme storage error: ${err.message}`, "training");
      }
    }

    for (const ticket of uncategorized) {
      await storage.updateScrubbedTicketAnalysis(ticket.ticketId, "analyzed");
    }
  } catch (err: any) {
    totalErrors++;
    log(`Cluster analysis error: ${err.message}`, "training");
    onProgress?.(`Feil i klyngeanalyse: ${err.message}`, -1);
  }

  onProgress?.(`Analyse ferdig: ${totalThemes} temaer identifisert, ${totalErrors} feil`, 100);
  return { themes: totalThemes, errors: totalErrors };
}

// ─── WORKFLOW 5: INTENT CLASSIFICATION ───────────────────────────────────
export async function runIntentClassification(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ classified: number; errors: number }> {
  const batchSize = 10;
  let totalClassified = 0;
  let totalErrors = 0;

  onProgress?.("Starter intent-klassifisering...", 0);

  const intentsStr = formatIntentsForPrompt();

  while (true) {
    const unclassified = await storage.getUnclassifiedScrubbedTickets(batchSize);
    if (unclassified.length === 0) break;

    const batchPromptSize = 5;
    for (let batchStart = 0; batchStart < unclassified.length; batchStart += batchPromptSize) {
      const batch = unclassified.slice(batchStart, batchStart + batchPromptSize);

      if (batch.length === 1) {
        const ticket = batch[0];
        try {
          const prompt = `Du er en support intent classifier for DyreID.

OPPGAVE: Klassifiser intent for denne ticketen basert på dialog.

TICKET:
Kategori: ${ticket.hjelpesenterCategory || ticket.category || "Ukjent"}
Underkategori: ${ticket.hjelpesenterSubcategory || "Ukjent"}
Emne: ${ticket.subject || "Ingen"}
Kundespørsmål: ${ticket.customerQuestion || "Ingen"}
Agentsvar: ${ticket.agentAnswer || "Ingen"}
Løsning: ${ticket.resolution || "Ingen"}

KJENTE INTENTS (gruppert etter hjelpesenter-kategori, bruk disse hvis mulig):
${intentsStr}

INSTRUKSJONER:
1. Analyser hva kunden faktisk ønsker å oppnå
2. Klassifiser til en av kjente intents ELLER foreslå ny intent
3. Ekstraher nøkkelord som trigger denne intent
4. Identifiser hvilke runtime-data som trengs
5. Identifiser hvilken action som løste saken

SVAR I JSON:
{
  "intent": "Intent name",
  "intent_confidence": 0.0-1.0,
  "is_new_intent": false,
  "keywords": "keyword1, keyword2",
  "required_runtime_data": "PetId, PaymentStatus",
  "required_action": "Send betalingslink",
  "action_endpoint": "POST /Registration/PaymentLink",
  "payment_required": false,
  "auto_close_possible": false,
  "reasoning": "Why this classification?"
}`;

          const text = await callOpenAI(prompt);
          const result = extractJson(text);

          await storage.insertIntentClassification({
            ticketId: ticket.ticketId,
            intent: result.intent,
            intentConfidence: result.intent_confidence,
            isNewIntent: result.is_new_intent || false,
            keywords: result.keywords,
            requiredRuntimeData: result.required_runtime_data,
            requiredAction: result.required_action,
            actionEndpoint: result.action_endpoint,
            paymentRequired: result.payment_required || false,
            autoClosePossible: result.auto_close_possible || false,
            reasoning: result.reasoning,
          });
          await storage.updateScrubbedTicketAnalysis(ticket.ticketId, "classified");

          if (result.is_new_intent) {
            await storage.insertReviewQueueItem({
              reviewType: "new_intent",
              referenceId: ticket.ticketId,
              priority: "high",
              data: result,
            });
          }

          totalClassified++;
        } catch (err: any) {
          totalErrors++;
          log(`Intent classification error ticket ${ticket.ticketId}: ${err.message}`, "training");
        }
      } else {
        try {
          const ticketsBlock = batch.map((ticket, idx) => `
TICKET ${idx + 1} (ID: ${ticket.ticketId}):
Kategori: ${ticket.hjelpesenterCategory || ticket.category || "Ukjent"}
Underkategori: ${ticket.hjelpesenterSubcategory || "Ukjent"}
Emne: ${ticket.subject || "Ingen"}
Kundespørsmål: ${ticket.customerQuestion || "Ingen"}
Agentsvar: ${ticket.agentAnswer || "Ingen"}
Løsning: ${ticket.resolution || "Ingen"}`).join("\n---");

          const batchPrompt = `Du er en support intent classifier for DyreID.

OPPGAVE: Klassifiser intent for ALLE ${batch.length} tickets nedenfor.

${ticketsBlock}

KJENTE INTENTS (gruppert etter hjelpesenter-kategori, bruk disse hvis mulig):
${intentsStr}

INSTRUKSJONER:
1. Analyser hva kunden faktisk ønsker å oppnå i HVER ticket
2. Klassifiser til en av kjente intents ELLER foreslå ny intent
3. Ekstraher nøkkelord som trigger denne intent
4. Identifiser hvilke runtime-data som trengs
5. Identifiser hvilken action som løste saken

SVAR SOM JSON ARRAY med ett objekt per ticket, i SAMME rekkefølge:
[
  {
    "ticket_id": 12345,
    "intent": "Intent name",
    "intent_confidence": 0.0-1.0,
    "is_new_intent": false,
    "keywords": "keyword1, keyword2",
    "required_runtime_data": "PetId, PaymentStatus",
    "required_action": "Send betalingslink",
    "action_endpoint": "POST /Registration/PaymentLink",
    "payment_required": false,
    "auto_close_possible": false,
    "reasoning": "Why this classification?"
  }
]`;

          const text = await callOpenAI(batchPrompt, "gpt-5-nano", 8192);
          const results = extractJson(text);
          const resultsArray = Array.isArray(results) ? results : [results];

          for (let i = 0; i < batch.length; i++) {
            const ticket = batch[i];
            const result = resultsArray[i] || resultsArray.find((r: any) => r.ticket_id === ticket.ticketId);
            if (!result) {
              totalErrors++;
              log(`Batch classification missing result for ticket ${ticket.ticketId}`, "training");
              continue;
            }

            try {
              await storage.insertIntentClassification({
                ticketId: ticket.ticketId,
                intent: result.intent,
                intentConfidence: result.intent_confidence,
                isNewIntent: result.is_new_intent || false,
                keywords: result.keywords,
                requiredRuntimeData: result.required_runtime_data,
                requiredAction: result.required_action,
                actionEndpoint: result.action_endpoint,
                paymentRequired: result.payment_required || false,
                autoClosePossible: result.auto_close_possible || false,
                reasoning: result.reasoning,
              });
              await storage.updateScrubbedTicketAnalysis(ticket.ticketId, "classified");

              if (result.is_new_intent) {
                await storage.insertReviewQueueItem({
                  reviewType: "new_intent",
                  referenceId: ticket.ticketId,
                  priority: "high",
                  data: result,
                });
              }

              totalClassified++;
            } catch (err: any) {
              totalErrors++;
              log(`Intent classification save error ticket ${ticket.ticketId}: ${err.message}`, "training");
            }
          }
        } catch (err: any) {
          log(`Batch intent classification error: ${err.message}, falling back to individual`, "training");
          for (const ticket of batch) {
            try {
              const prompt = `Du er en support intent classifier for DyreID.

OPPGAVE: Klassifiser intent for denne ticketen.

TICKET:
Kategori: ${ticket.hjelpesenterCategory || ticket.category || "Ukjent"}
Emne: ${ticket.subject || "Ingen"}
Kundespørsmål: ${ticket.customerQuestion || "Ingen"}
Agentsvar: ${ticket.agentAnswer || "Ingen"}

KJENTE INTENTS (gruppert etter hjelpesenter-kategori):
${intentsStr}

SVAR I JSON:
{
  "intent": "Intent name",
  "intent_confidence": 0.0-1.0,
  "is_new_intent": false,
  "keywords": "keyword1, keyword2",
  "required_runtime_data": "",
  "required_action": "",
  "action_endpoint": "",
  "payment_required": false,
  "auto_close_possible": false,
  "reasoning": "Why?"
}`;

              const text = await callOpenAI(prompt);
              const result = extractJson(text);

              await storage.insertIntentClassification({
                ticketId: ticket.ticketId,
                intent: result.intent,
                intentConfidence: result.intent_confidence,
                isNewIntent: result.is_new_intent || false,
                keywords: result.keywords,
                requiredRuntimeData: result.required_runtime_data,
                requiredAction: result.required_action,
                actionEndpoint: result.action_endpoint,
                paymentRequired: result.payment_required || false,
                autoClosePossible: result.auto_close_possible || false,
                reasoning: result.reasoning,
              });
              await storage.updateScrubbedTicketAnalysis(ticket.ticketId, "classified");

              if (result.is_new_intent) {
                await storage.insertReviewQueueItem({
                  reviewType: "new_intent",
                  referenceId: ticket.ticketId,
                  priority: "high",
                  data: result,
                });
              }

              totalClassified++;
            } catch (innerErr: any) {
              totalErrors++;
              log(`Fallback classification error ticket ${ticket.ticketId}: ${innerErr.message}`, "training");
            }
          }
        }
      }
    }

    onProgress?.(`Klassifisert ${totalClassified} tickets (batch-modus)`, 50);
  }

  onProgress?.(`Intent-klassifisering ferdig: ${totalClassified}, ${totalErrors} feil`, 100);
  return { classified: totalClassified, errors: totalErrors };
}

// ─── WORKFLOW 6: RESOLUTION EXTRACTION ───────────────────────────────────
export async function runResolutionExtraction(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ extracted: number; errors: number }> {
  const batchSize = 10;
  let totalExtracted = 0;
  let totalErrors = 0;

  onProgress?.("Starter løsningsekstraksjon...", 0);

  while (true) {
    const unextracted = await storage.getClassifiedTicketsWithoutResolution(batchSize);
    if (unextracted.length === 0) break;

    for (const classification of unextracted) {
      try {
        const prompt = `Du er en ekspert på å analysere DyreID support-tickets og ekstrahere STRUKTURERT OPERASJONELL DATA.

VIKTIG: Du skal IKKE ekstrahere agentens svar eller samtalefrasering.
Du skal KUN ekstrahere operasjonell logikk som kan brukes av en handlingsagent.

TICKET:
Intent: ${classification.intent}
Handling: ${classification.requiredAction || "Ukjent"}
Endepunkt: ${classification.actionEndpoint || "Ukjent"}
Nøkkelord: ${classification.keywords || ""}
Runtime-data: ${classification.requiredRuntimeData || ""}
Betaling: ${classification.paymentRequired ? "Ja" : "Nei"}
Begrunnelse: ${classification.reasoning || ""}

OPPGAVE:
1. Hva var kundens OPERASJONELLE MÅL? (f.eks. overføre eierskap, melde savnet, aktivere QR)
2. Ble saken løst ved en AUTENTISERT SYSTEMHANDLING i DyreID/Min Side?
3. Hvis JA (actionable=true): Hvilke DATA trengs for å utføre handlingen? Hvilket ENDEPUNKT brukes?
4. Hvis NEI (actionable=false): Skriv kun et kort informasjonstekst-sammendrag.

KJENTE ENDEPUNKTER:
- OwnershipTransferWeb → /OwnerChange/OwnerSeller/ReportOwnerChange
- LostPetReport → /Pet/LostPet/ReportLostPet
- FoundPetReport → /Pet/FoundPet/ReportFoundPet
- QRTagActivation → /Pet/QR/Activate
- SmartTagActivation → /SmartTag/Activate
- CancelSubscription → /Subscription/Cancel
- ForeignChipRegistration → /Pet/Foreign/Register
- UpdateContactInfo → /Owner/UpdateContact
- PetDeceased → /Pet/Deceased/Report
- NewRegistration → /Pet/Register

KJENTE DATAFELTER:
PetId, NewOwnerMobile, TagId, SubscriptionId, OwnerMobile, ChipNumber, OwnerName, PetName, AnimalId

SVAR I JSON:
{
  "customer_need": "Kort operasjonelt mål (f.eks. 'Overføre eierskap til ny eier')",
  "actionable": true/false,
  "required_data": ["PetId", "NewOwnerMobile"],
  "action_endpoint": "/OwnerChange/OwnerSeller/ReportOwnerChange",
  "guidance_steps": ["Verifiser eierskap via OTP", "Velg dyr", "Oppgi ny eiers mobilnummer", "Bekreft overføring"],
  "info_text": null,
  "success_indicators": "Eierskap overført, bekreftelse sendt",
  "follow_up_needed": false
}`;

        const text = await callOpenAI(prompt);
        const result = extractJson(text);

        const requiredDataStr = Array.isArray(result.required_data) ? result.required_data.join(", ") : (result.required_data || "");
        const guidanceStepsStr = Array.isArray(result.guidance_steps) ? result.guidance_steps.join("; ") : (result.guidance_steps || "");

        await storage.insertResolutionPattern({
          ticketId: classification.ticketId,
          intent: classification.intent,
          customerNeed: result.customer_need || "",
          dataGathered: requiredDataStr,
          resolutionSteps: result.actionable ? guidanceStepsStr : (result.info_text || ""),
          successIndicators: typeof result.success_indicators === "object" ? JSON.stringify(result.success_indicators) : (result.success_indicators || ""),
          followUpNeeded: result.follow_up_needed || false,
        });

        await storage.markResolutionExtracted(classification.ticketId);
        totalExtracted++;
      } catch (err: any) {
        totalErrors++;
        log(`Resolution extraction error: ${err.message}`, "training");
      }
    }

    onProgress?.(`Ekstrahert ${totalExtracted} løsningsmønstre`, 50);
  }

  onProgress?.(`Løsningsekstraksjon ferdig: ${totalExtracted}, ${totalErrors} feil`, 100);
  return { extracted: totalExtracted, errors: totalErrors };
}

// ─── WORKFLOW 7: UNCERTAINTY DETECTOR ────────────────────────────────────
export async function runUncertaintyDetection(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ detected: number; errors: number }> {
  let totalDetected = 0;
  let totalErrors = 0;

  onProgress?.("Starter usikkerhetsdeteksjon...", 0);

  const lowConfidence = await storage.getLowConfidenceClassifications(100);

  if (lowConfidence.length === 0) {
    onProgress?.("Ingen usikre klassifiseringer å analysere", 100);
    return { detected: 0, errors: 0 };
  }

  onProgress?.(`Fant ${lowConfidence.length} usikre klassifiseringer. Analyserer...`, 10);

  for (let i = 0; i < lowConfidence.length; i++) {
    const classification = lowConfidence[i];

    try {
      const prompt = `Du er en kvalitetskontrollør for support intent classification.

OPPGAVE: Analyser hvorfor denne klassifiseringen har lav confidence.

TICKET:
Intent: ${classification.intent}
Confidence: ${classification.intentConfidence}
Er ny intent: ${classification.isNewIntent ? "Ja" : "Nei"}
Nøkkelord: ${classification.keywords || "Ingen"}
Handling: ${classification.requiredAction || "Ingen"}
Begrunnelse: ${classification.reasoning || "Ingen"}

INSTRUKSJONER:
Identifiser hva som gjør denne saken vanskelig:
- Mangler context?
- Flertydig spørsmål?
- Ukjent problemtype?
- Kompleks case?
- Dårlig dokumentert løsning?

SVAR I JSON:
{
  "uncertainty_type": "missing_context | ambiguous | unknown_problem | complex | poor_documentation",
  "missing_information": "What info would help?",
  "suggested_questions_to_ask": "Questions that would clarify",
  "needs_human_review": true,
  "review_priority": "low | medium | high"
}`;

      const text = await callOpenAI(prompt);
      const result = extractJson(text);

      await storage.insertUncertaintyCase({
        ticketId: classification.ticketId,
        uncertaintyType: result.uncertainty_type,
        missingInformation: typeof result.missing_information === "object" ? JSON.stringify(result.missing_information) : result.missing_information,
        suggestedQuestions: typeof result.suggested_questions_to_ask === "object" ? JSON.stringify(result.suggested_questions_to_ask) : result.suggested_questions_to_ask,
        needsHumanReview: result.needs_human_review !== false,
        reviewPriority: result.review_priority || "medium",
      });

      if (result.needs_human_review !== false) {
        await storage.insertReviewQueueItem({
          reviewType: "uncertain_classification",
          referenceId: classification.ticketId,
          priority: result.review_priority || "medium",
          data: { ...result, intent: classification.intent, confidence: classification.intentConfidence },
        });
      }

      totalDetected++;
    } catch (err: any) {
      totalErrors++;
      log(`Uncertainty detection error: ${err.message}`, "training");
    }

    const pct = Math.round(((i + 1) / lowConfidence.length) * 100);
    onProgress?.(`Analysert ${i + 1} av ${lowConfidence.length} usikre cases`, pct);
  }

  onProgress?.(`Usikkerhetsdeteksjon ferdig: ${totalDetected} oppdaget, ${totalErrors} feil`, 100);
  return { detected: totalDetected, errors: totalErrors };
}

// ─── WORKFLOW 8: PLAYBOOK BUILDER ────────────────────────────────────────
export async function runPlaybookGeneration(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ entries: number }> {
  onProgress?.("Genererer datadrevet playbook fra alle analysedata (A-D + Hjelpesenter)...", 0);

  const intentRows = await db.execute(sql`
    SELECT DISTINCT intent FROM intent_classifications WHERE intent IS NOT NULL ORDER BY intent
  `);
  const intents = intentRows.rows.map((r: any) => r.intent as string);

  if (intents.length === 0) {
    onProgress?.("Ingen intents funnet. Kjor intent-klassifisering forst.", 100);
    return { entries: 0 };
  }

  onProgress?.(`Fant ${intents.length} unike intents. Starter datadrevet analyse...`, 5);

  let count = 0;
  for (let i = 0; i < intents.length; i++) {
    const intent = intents[i];
    const pct = Math.round(5 + ((i / intents.length) * 85));
    onProgress?.(`Behandler intent ${i + 1}/${intents.length}: ${intent}`, pct);

    try {
      const ticketDataRows = await db.execute(sql`
        SELECT 
          st.id, st.subject, st.customer_question, st.agent_answer, st.auto_closed,
          st.has_autoreply, st.autoreply_template_id, st.autoreply_confidence,
          st.dialog_pattern, st.messages_after_autoreply, st.total_message_count,
          ic.intent_confidence, ic.keywords, ic.required_runtime_data, ic.required_action,
          ic.action_endpoint, ic.payment_required, ic.auto_close_possible,
          cm.hjelpesenter_category, cm.hjelpesenter_subcategory,
          cm.needs_reclassification, cm.original_category, cm.reclassified_category, cm.reclassified_subcategory
        FROM scrubbed_tickets st
        JOIN intent_classifications ic ON ic.ticket_id = st.id
        LEFT JOIN category_mappings cm ON cm.ticket_id = st.id
        WHERE ic.intent = ${intent}
      `);
      const tickets = ticketDataRows.rows as any[];

      if (tickets.length === 0) {
        log(`Playbook: skipping ${intent} - no tickets found`, "training");
        continue;
      }

      const mostCommonCategory = getMostCommon(tickets.map(t => t.reclassified_category || t.hjelpesenter_category).filter(Boolean));
      const mostCommonSubcategory = getMostCommon(tickets.map(t => t.reclassified_subcategory || t.hjelpesenter_subcategory).filter(Boolean));
      const allKeywords = tickets.map(t => t.keywords).filter(Boolean).join(", ");
      const avgConfidence = tickets.reduce((sum: number, t: any) => sum + (t.intent_confidence || 0), 0) / tickets.length;
      const paymentProbability = tickets.filter((t: any) => t.payment_required).length / tickets.length;
      const autoCloseProbability = tickets.filter((t: any) => t.auto_close_possible || t.auto_closed).length / tickets.length;

      const mostCommonAction = getMostCommon(tickets.map(t => t.required_action).filter(Boolean));
      const mostCommonEndpoint = getMostCommon(tickets.map(t => t.action_endpoint).filter(Boolean));
      const mostCommonRuntimeData = getMostCommon(tickets.map(t => t.required_runtime_data).filter(Boolean));

      const resolutionRows = await db.execute(sql`
        SELECT resolution_steps, customer_need, success_indicators
        FROM resolution_patterns WHERE intent = ${intent}
      `);
      const resolutions = resolutionRows.rows as any[];
      const bestResolution = resolutions[0];

      const withAutoreply = tickets.filter((t: any) => t.has_autoreply);
      let autoreplyData: any = { hasAutoreplyAvailable: false };
      if (withAutoreply.length > 0) {
        const templateCounts: Record<string, number> = {};
        withAutoreply.forEach((t: any) => {
          if (t.autoreply_template_id) {
            templateCounts[t.autoreply_template_id] = (templateCounts[t.autoreply_template_id] || 0) + 1;
          }
        });
        const topTemplateId = Object.entries(templateCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (topTemplateId) {
          const tmplRows = await db.execute(sql`
            SELECT name, body_text FROM response_templates WHERE template_id = ${parseInt(topTemplateId)}
          `);
          const tmpl = tmplRows.rows[0] as any;
          autoreplyData = {
            hasAutoreplyAvailable: true,
            templateId: parseInt(topTemplateId),
            templateName: tmpl?.name || null,
            autoreplyContent: tmpl?.body_text || null,
          };
        }
      }

      const dialogPatterns: Record<string, number> = {};
      let totalMsgAfterAutoreply = 0;
      let countMsgAfterAutoreply = 0;
      tickets.forEach((t: any) => {
        if (t.dialog_pattern) dialogPatterns[t.dialog_pattern] = (dialogPatterns[t.dialog_pattern] || 0) + 1;
        if (t.messages_after_autoreply != null) {
          totalMsgAfterAutoreply += t.messages_after_autoreply;
          countMsgAfterAutoreply++;
        }
      });
      const typicalDialogPattern = Object.entries(dialogPatterns).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const avgMsgAfterAutoreply = countMsgAfterAutoreply > 0 ? totalMsgAfterAutoreply / countMsgAfterAutoreply : null;
      const dialogDistribution: Record<string, number> = {};
      Object.entries(dialogPatterns).forEach(([p, c]) => { dialogDistribution[p] = c / tickets.length; });

      const reclassified = tickets.filter((t: any) => t.reclassified_category);
      const wasReclassified = reclassified.length > 0;
      const originalCategories = Array.from(new Set(reclassified.map((t: any) => t.original_category).filter(Boolean)));
      const reclassFrom: Record<string, number> = {};
      reclassified.forEach((t: any) => {
        if (t.original_category) reclassFrom[t.original_category] = (reclassFrom[t.original_category] || 0) + 1;
      });

      const ticketIds = tickets.map((t: any) => t.id);
      const ticketIdArray = `{${ticketIds.join(",")}}`;
      const qualityRows = await db.execute(sql`
        SELECT quality_level, COUNT(*)::int as cnt,
          ARRAY_AGG(DISTINCT elem) FILTER (WHERE elem IS NOT NULL) as all_missing,
          ARRAY_AGG(DISTINCT pos) FILTER (WHERE pos IS NOT NULL) as all_positive
        FROM resolution_quality
        LEFT JOIN LATERAL unnest(missing_elements) AS elem ON true
        LEFT JOIN LATERAL unnest(positive_elements) AS pos ON true
        WHERE ticket_id = ANY(${ticketIdArray}::int[])
        GROUP BY quality_level
      `);
      const qualityData = qualityRows.rows as any[];
      const qualityDist: Record<string, number> = {};
      const allMissing: string[] = [];
      const allPositive: string[] = [];
      let qualityTotal = 0;
      qualityData.forEach((r: any) => {
        qualityDist[r.quality_level] = r.cnt;
        qualityTotal += r.cnt;
        if (r.all_missing) allMissing.push(...r.all_missing);
        if (r.all_positive) allPositive.push(...r.all_positive);
      });
      const avgQuality = qualityTotal > 0
        ? Object.entries(qualityDist).sort((a, b) => b[1] - a[1])[0]?.[0] || "medium"
        : null;
      const qualityDistPct: Record<string, number> = {};
      if (qualityTotal > 0) Object.entries(qualityDist).forEach(([k, v]) => { qualityDistPct[k] = v / qualityTotal; });
      const topMissing = getTopItems(allMissing, 5);
      const topPositive = getTopItems(allPositive, 5);
      const lowNone = (qualityDist["low"] || 0) + (qualityDist["none"] || 0);
      const needsImprovement = qualityTotal > 0 && (lowNone / qualityTotal) > 0.3;

      const helpCenterRows = await db.execute(sql`
        SELECT 
          hca.id, hca.title, hca.url, hca.body_text, hca.hjelpesenter_category,
          COUNT(*)::int as match_count,
          AVG(thcm.match_confidence)::real as avg_conf
        FROM help_center_articles hca
        JOIN ticket_help_center_matches thcm ON thcm.article_id = hca.id
        WHERE thcm.ticket_id = ANY(${ticketIdArray}::int[])
        GROUP BY hca.id
        ORDER BY match_count DESC, avg_conf DESC
        LIMIT 1
      `);
      const bestArticle = helpCenterRows.rows[0] as any;

      const feedbackRows = await db.execute(sql`
        SELECT 
          COUNT(*) FILTER (WHERE feedback_result = 'resolved')::int as resolved,
          COUNT(*) FILTER (WHERE feedback_result = 'not_resolved')::int as not_resolved,
          COUNT(*) FILTER (WHERE feedback_result IS NOT NULL)::int as total
        FROM chatbot_interactions
        WHERE matched_intent = ${intent}
      `);
      const feedback = feedbackRows.rows[0] as any;
      const successfulResolutions = feedback?.resolved || 0;
      const failedResolutions = feedback?.not_resolved || 0;
      const totalUses = feedback?.total || 0;
      const successRate = totalUses > 0 ? successfulResolutions / totalUses : 0;

      const isActionable = !!mostCommonAction || !!mostCommonEndpoint;

      let combinedResponse: string | null = null;
      let chatbotStepsArray: string[] | null = null;

      if (isActionable) {
        const guidanceFromResolutions = resolutions
          .map((r: any) => r.resolution_steps)
          .filter(Boolean)
          .slice(0, 3);

        if (guidanceFromResolutions.length > 0) {
          chatbotStepsArray = guidanceFromResolutions[0]
            .split(/;\s*|\n/)
            .map((s: string) => s.trim())
            .filter(Boolean);
        }
      } else {
        const hasMeaningfulData = autoreplyData.autoreplyContent || bestArticle?.body_text || topPositive.length > 0;
        if (hasMeaningfulData) {
          try {
            const articleSummary = bestArticle?.body_text ? bestArticle.body_text.substring(0, 500) : null;
            const prompt = `Generer en kort, faktabasert informasjonstekst for DyreID chatbot.

INTENT: ${intent}
KATEGORI: ${mostCommonCategory || "Ukjent"}

AUTOSVAR-INNHOLD (hvis tilgjengelig):
${autoreplyData.autoreplyContent?.substring(0, 400) || "Ikke tilgjengelig"}

HJELPESENTER-ARTIKKEL:
${articleSummary || "Ikke tilgjengelig"}

REGLER:
- Maks 150 ord
- KUN faktainformasjon fra kildene over
- IKKE finn opp nye prosedyrer eller priser
- IKKE inkluder lenker
- IKKE foreslå å kontakte support med mindre det er siste utvei

Return kun teksten, ingen JSON.`;

            combinedResponse = await callOpenAI(prompt, "gpt-5-nano", 1024);
            combinedResponse = combinedResponse.trim();
          } catch (err: any) {
            log(`Combined response error for ${intent}: ${err.message}`, "training");
            combinedResponse = autoreplyData.autoreplyContent || null;
          }
        }
      }

      await storage.upsertPlaybookEntry({
        intent,
        hjelpesenterCategory: mostCommonCategory || null,
        hjelpesenterSubcategory: mostCommonSubcategory || null,
        keywords: allKeywords || null,
        requiredRuntimeData: mostCommonRuntimeData || null,
        primaryAction: mostCommonAction || null,
        primaryEndpoint: mostCommonEndpoint || null,
        resolutionSteps: bestResolution?.resolution_steps || null,
        successIndicators: bestResolution?.success_indicators || null,
        avgConfidence: avgConfidence || 0.8,
        ticketCount: tickets.length,
        paymentRequiredProbability: paymentProbability,
        autoCloseProbability: autoCloseProbability,
        isActive: true,

        hasAutoreplyAvailable: autoreplyData.hasAutoreplyAvailable,
        autoreplyTemplateId: autoreplyData.templateId || null,
        autoreplyTemplateName: autoreplyData.templateName || null,
        autoreplyContent: autoreplyData.autoreplyContent || null,

        typicalDialogPattern: typicalDialogPattern,
        avgMessagesAfterAutoreply: avgMsgAfterAutoreply,
        dialogPatternDistribution: Object.keys(dialogDistribution).length > 0 ? dialogDistribution : null,

        wasReclassified,
        originalCategories: originalCategories.length > 0 ? originalCategories : null,
        reclassifiedFrom: Object.keys(reclassFrom).length > 0 ? reclassFrom : null,

        avgResolutionQuality: avgQuality,
        qualityDistribution: Object.keys(qualityDistPct).length > 0 ? qualityDistPct : null,
        commonMissingElements: topMissing.length > 0 ? topMissing : null,
        commonPositiveElements: topPositive.length > 0 ? topPositive : null,
        needsImprovement,

        helpCenterArticleId: bestArticle?.id || null,
        helpCenterArticleUrl: bestArticle?.url || null,
        helpCenterArticleTitle: bestArticle?.title || null,
        officialProcedure: null,
        helpCenterContentSummary: bestArticle?.body_text?.substring(0, 500) || null,

        requiresLogin: isActionable,
        requiresAction: isActionable,
        actionType: isActionable ? "API_CALL" : "INFO_ONLY",
        apiEndpoint: mostCommonEndpoint || null,
        httpMethod: mostCommonEndpoint ? "POST" : null,
        requiredRuntimeDataArray: mostCommonRuntimeData ? mostCommonRuntimeData.split(",").map((s: string) => s.trim()) : null,
        paymentRequired: paymentProbability > 0.5,
        paymentAmount: null,

        chatbotSteps: chatbotStepsArray,
        combinedResponse: isActionable ? null : combinedResponse,

        successfulResolutions,
        failedResolutions,
        totalUses,
        successRate,
      });

      count++;
    } catch (err: any) {
      log(`Playbook entry error for ${intent}: ${err.message}`, "training");
    }
  }

  onProgress?.(`Datadrevet playbook generert: ${count} entries med A-D + Hjelpesenter data`, 100);
  return { entries: count };
}

function getMostCommon(arr: string[]): string | null {
  if (arr.length === 0) return null;
  const counts: Record<string, number> = {};
  arr.forEach(item => { counts[item] = (counts[item] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function getTopItems(arr: string[], limit: number): string[] {
  const counts: Record<string, number> = {};
  arr.forEach(item => { counts[item] = (counts[item] || 0) + 1; });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([item]) => item);
}

// ─── WORKFLOW 9: MANUAL REVIEW HANDLER ───────────────────────────────────
export async function submitManualReview(
  queueId: number,
  reviewerEmail: string,
  decision: {
    approved: boolean;
    correctIntent?: string;
    correctCategory?: string;
    notes?: string;
    addToPlaybook?: boolean;
  }
): Promise<{ success: boolean; message: string }> {
  try {
    const decisionStr = JSON.stringify(decision);
    await storage.submitReview(queueId, reviewerEmail, decisionStr);

    if (decision.approved && decision.correctIntent) {
      const reviewItems = await storage.getPendingReviewItems();
      const item = reviewItems.find((r) => r.id === queueId);

      if (item && item.referenceId) {
        await storage.updateIntentClassificationReview(item.referenceId, {
          intent: decision.correctIntent,
          manuallyReviewed: true,
          reviewerEmail,
          reviewNotes: decision.notes || "",
          uncertaintyReviewed: true,
        });
      }
    }

    return { success: true, message: "Review lagret" };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

async function saveCombinedResult(ticket: any, result: any, metrics: BatchMetrics): Promise<void> {
  const existingCat = await storage.getCategoryMappingByTicketId(ticket.ticketId);
  const existingIntent = await storage.getIntentClassificationByTicketId(ticket.ticketId);
  const existingRes = await storage.getResolutionPatternByTicketId(ticket.ticketId);

  if (existingCat || existingIntent || existingRes) {
    log(`Skipping ticket ${ticket.ticketId}: already has results (cat=${!!existingCat}, intent=${!!existingIntent}, res=${!!existingRes})`, "training");
    metrics.processedTickets++;
    return;
  }

  if (result.hjelpesenter_category) {
    await storage.insertCategoryMapping({
      ticketId: ticket.ticketId,
      pureserviceCategory: ticket.category,
      hjelpesenterCategory: result.hjelpesenter_category || "Ukategorisert",
      hjelpesenterSubcategory: result.hjelpesenter_subcategory || "",
      confidence: result.category_confidence || 0.5,
      reasoning: result.category_reasoning || "",
    });
    await storage.updateScrubbedTicketMapping(
      ticket.ticketId,
      result.hjelpesenter_category || "Ukategorisert",
      result.hjelpesenter_subcategory || ""
    );
  }

  await storage.insertIntentClassification({
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
    reasoning: result.intent_reasoning || result.reasoning || "",
  });

  const requiredDataStr = Array.isArray(result.required_data) ? result.required_data.join(", ") : (result.required_runtime_data || result.required_data || "");
  const guidanceStepsStr = Array.isArray(result.guidance_steps) ? result.guidance_steps.join("; ") : "";
  const resolutionContent = result.actionable ? guidanceStepsStr : (result.info_text || result.resolution_steps || "");

  await storage.insertResolutionPattern({
    ticketId: ticket.ticketId,
    intent: result.intent || "GeneralInquiry",
    customerNeed: result.customer_need || "",
    dataGathered: requiredDataStr,
    resolutionSteps: typeof resolutionContent === "object" ? JSON.stringify(resolutionContent) : (resolutionContent || ""),
    successIndicators: typeof result.success_indicators === "object" ? JSON.stringify(result.success_indicators) : (result.success_indicators || ""),
    followUpNeeded: result.follow_up_needed || false,
  });

  await storage.updateScrubbedTicketAnalysis(ticket.ticketId, "classified");
  await storage.markResolutionExtracted(ticket.ticketId);

  if (result.is_new_intent) {
    await storage.insertReviewQueueItem({
      reviewType: "new_intent",
      referenceId: ticket.ticketId,
      priority: "high",
      data: result,
    });
  }

  metrics.processedTickets++;
}

// ─── WORKFLOW 3C: HELP CENTER MATCHING ────────────────────────────────
export async function runHelpCenterMatching(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ matched: number; noMatch: number; errors: number }> {
  let totalMatched = 0;
  let totalNoMatch = 0;
  let totalErrors = 0;

  onProgress?.("Starter hjelpesenter artikkel-matching...", 0);

  const articles = await storage.getHelpCenterArticles();
  if (articles.length === 0) {
    onProgress?.("Ingen hjelpesenter-artikler funnet. Kjør scraping først.", 100);
    return { matched: 0, noMatch: 0, errors: 0 };
  }
  onProgress?.(`Lastet ${articles.length} hjelpesenter-artikler`, 5);

  const alreadyMatchedIds = new Set(await storage.getMatchedTicketIds());

  const mappedTickets: any[] = [];
  let offset = 0;
  const fetchSize = 200;
  while (true) {
    const batch = await db
      .select()
      .from(scrubbedTickets)
      .where(sql`${scrubbedTickets.categoryMappingStatus} = 'mapped'`)
      .limit(fetchSize)
      .offset(offset);
    if (batch.length === 0) break;
    mappedTickets.push(...batch);
    offset += fetchSize;
  }

  const tickets = mappedTickets.filter(t => !alreadyMatchedIds.has(t.id));

  if (tickets.length === 0) {
    onProgress?.("Alle tickets er allerede matchet mot artikler.", 100);
    return { matched: 0, noMatch: 0, errors: 0 };
  }

  onProgress?.(`Fant ${tickets.length} tickets å matche (${alreadyMatchedIds.size} allerede matchet)`, 10);

  const articlesByCategory = new Map<string, typeof articles>();
  for (const a of articles) {
    const cat = a.hjelpesenterCategory || "Ukjent";
    if (!articlesByCategory.has(cat)) articlesByCategory.set(cat, []);
    articlesByCategory.get(cat)!.push(a);
  }

  const BATCH_SIZE = 5;
  const batches = chunk(tickets, BATCH_SIZE);

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];

    try {
      const ticketsBlock = batch.map((ticket, idx) => {
        const cat = ticket.hjelpesenterCategory || "Ukjent";
        const relevantArts = articlesByCategory.get(cat) || articles;
        const artList = relevantArts.slice(0, 15).map((a: any, i: number) =>
          `  ${i + 1}. [ID:${a.id}] ${a.title}\n     Sammendrag: ${(a.bodyText || "").substring(0, 200)}`
        ).join("\n");

        return `TICKET ${idx + 1} (DB-ID: ${ticket.id}):
Kategori: ${cat}
Underkategori: ${ticket.hjelpesenterSubcategory || "Ukjent"}
Spørsmål: ${(ticket.customerQuestion || "Ingen").substring(0, 400)}
Agentsvar: ${(ticket.agentAnswer || "Ingen").substring(0, 400)}

RELEVANTE ARTIKLER FOR DENNE TICKET:
${artList}`;
      }).join("\n---\n");

      const prompt = `Du er en ekspert på DyreID kundesupport. Match HVER ticket mot den mest relevante hjelpesenter-artikkelen, og sammenlign agent-svar mot offisiell prosedyre.

${ticketsBlock}

FOR HVER TICKET:
1. MATCH: Velg den mest relevante artikkelen (bruk article ID). Hvis ingen passer godt (confidence < 0.5), sett articleId til null.
2. SAMMENLIGNING: Sammenlign agentens svar mot den offisielle artikkelen.

Svar med JSON:
{"results": [
  {
    "db_id": 123,
    "articleId": 45,
    "confidence": 0.85,
    "matchReason": "Kort forklaring på hvorfor denne artikkelen matcher",
    "followsOfficialProcedure": true,
    "alignmentQuality": "high",
    "missingFromAgent": ["Punkt som mangler"],
    "addedByAgent": ["Ekstra info agenten la til"]
  }
]}

alignmentQuality: "high" (fullt samsvar), "medium" (delvis), "low" (lite samsvar), "contradicts" (motstridende).
Hvis articleId er null, sett confidence til 0 og alignment til null.`;

      const text = await callOpenAI(prompt, "gpt-5-nano", 4096, true);
      const parsed = extractJson(text);
      const results = parsed.results || parsed;
      const resultsArray = Array.isArray(results) ? results : [results];

      for (let i = 0; i < batch.length; i++) {
        const ticket = batch[i];
        const result = resultsArray[i] || resultsArray.find((r: any) => r.db_id === ticket.id);

        if (!result || !result.articleId || result.confidence < 0.5) {
          totalNoMatch++;
          continue;
        }

        try {
          await storage.insertTicketHelpCenterMatch({
            ticketId: ticket.id,
            articleId: result.articleId,
            matchConfidence: result.confidence,
            matchReason: result.matchReason || null,
            followsOfficialProcedure: result.followsOfficialProcedure ?? null,
            alignmentQuality: result.alignmentQuality || null,
            missingFromAgent: result.missingFromAgent || null,
            addedByAgent: result.addedByAgent || null,
          });
          totalMatched++;
        } catch (err: any) {
          totalErrors++;
          log(`Help center match save error ticket ${ticket.id}: ${err.message}`, "training");
        }
      }
    } catch (err: any) {
      totalErrors += batch.length;
      log(`Help center matching batch error: ${err.message}`, "training");
    }

    const pct = Math.min(95, 10 + Math.round((bi / batches.length) * 85));
    onProgress?.(`Matchet ${totalMatched} tickets, ${totalNoMatch} uten match, ${totalErrors} feil (batch ${bi + 1}/${batches.length})`, pct);

    await new Promise(r => setTimeout(r, 200));
  }

  onProgress?.(`Ferdig! ${totalMatched} matchet, ${totalNoMatch} uten match, ${totalErrors} feil`, 100);
  return { matched: totalMatched, noMatch: totalNoMatch, errors: totalErrors };
}

// ─── WORKFLOW 2B: AUTOREPLY DETECTION ─────────────────────────────────────────

function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  if (len1 === 0) return len2;
  if (len2 === 0) return len1;
  const matrix: number[][] = [];
  for (let i = 0; i <= len2; i++) matrix[i] = [i];
  for (let j = 0; j <= len1; j++) matrix[0][j] = j;
  for (let i = 1; i <= len2; i++) {
    for (let j = 1; j <= len1; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
  }
  return matrix[len2][len1];
}

function stringSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  if (longer.length === 0) return 1.0;
  const editDist = levenshteinDistance(longer, shorter);
  return (longer.length - editDist) / longer.length;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\wæøå\s]/g, " ").split(/\s+/).filter(w => w.length > 2);
}

interface AutoReplyMatch {
  hasAutoReply: boolean;
  templateId: number | null;
  confidence: number;
  position: number;
  humanResponseStartsAt: number | null;
}

function detectAutoReplyInDialog(ticket: any, templates: any[]): AutoReplyMatch {
  const messages = ticket.messages || [];
  const firstAgentIndex = messages.findIndex((m: any) => m.from === "agent");
  if (firstAgentIndex === -1) {
    return { hasAutoReply: false, templateId: null, confidence: 0, position: -1, humanResponseStartsAt: null };
  }
  const firstAgentMsg = messages[firstAgentIndex];
  const msgBody = (firstAgentMsg.body || firstAgentMsg.content || "").toString();
  if (!msgBody || msgBody.length < 10) {
    return { hasAutoReply: false, templateId: null, confidence: 0, position: firstAgentIndex, humanResponseStartsAt: null };
  }

  let bestMatch = { templateId: null as number | null, confidence: 0 };
  for (const template of templates) {
    const templateBody = template.bodyText || template.body_text || "";
    const templateKeywords: string[] = template.keywords || [];
    const templateSubject = template.subject || "";

    const similarity = stringSimilarity(
      msgBody.substring(0, 200).toLowerCase(),
      templateBody.substring(0, 200).toLowerCase()
    );

    let keywordScore = 0;
    if (templateKeywords.length > 0) {
      const msgWords = tokenize(msgBody.toLowerCase());
      const keywordMatches = templateKeywords.filter((kw: string) =>
        msgWords.some(word => word.includes(kw.toLowerCase()) || kw.toLowerCase().includes(word))
      ).length;
      keywordScore = keywordMatches / templateKeywords.length;
    }

    const subjectMatch = ticket.subject && templateSubject &&
      ticket.subject.toLowerCase().includes(templateSubject.toLowerCase()) ? 0.3 : 0;

    const score = (similarity * 0.4) + (keywordScore * 0.4) + subjectMatch;
    if (score > bestMatch.confidence) {
      bestMatch = { templateId: template.templateId || template.template_id, confidence: score };
    }
  }

  const secondAgentIndex = messages.findIndex((m: any, i: number) => i > firstAgentIndex && m.from === "agent");

  return {
    hasAutoReply: bestMatch.confidence > 0.6,
    templateId: bestMatch.confidence > 0.6 ? bestMatch.templateId : null,
    confidence: bestMatch.confidence,
    position: firstAgentIndex,
    humanResponseStartsAt: secondAgentIndex !== -1 ? secondAgentIndex : null,
  };
}

export async function generateTemplateKeywords(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ updated: number }> {
  onProgress?.("Henter templates...", 0);
  const templates = await storage.getResponseTemplates();
  onProgress?.(`Genererer keywords for ${templates.length} templates...`, 10);

  const prompt = `
Ekstraher 5-10 trigger keywords for hver av disse e-post-templates.
Fokuser på unike termer som identifiserer hvert emne.

TEMPLATES:
${templates.map((t, i) => `
Template ${i + 1} (ID: ${t.templateId}, ${t.name}):
Subject: ${t.subject || "N/A"}
Innhold: ${(t.bodyText || "").substring(0, 300)}
`).join("\n")}

For hver template, identifiser keywords som:
- Er unike for det temaet
- Ville forekomme i kundens spørsmål eller agents svar
- Ikke er generiske ("hei", "takk", etc.)

Return ONLY a JSON array, no other text:
[
  { "templateId": <original template_id>, "keywords": ["keyword1", "keyword2", ...] },
  ...
]
  `;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content || "{}";
  let keywordData: { templateId: number; keywords: string[] }[] = [];
  try {
    const parsed = JSON.parse(content);
    keywordData = Array.isArray(parsed) ? parsed : parsed.templates || parsed.data || parsed.result || [];
  } catch {
    onProgress?.("Feil ved parsing av keywords JSON", 50);
    return { updated: 0 };
  }

  let updated = 0;
  for (const item of keywordData) {
    if (item.templateId && item.keywords && item.keywords.length > 0) {
      await storage.updateTemplateKeywords(item.templateId, item.keywords);
      updated++;
      onProgress?.(`Oppdatert template ${item.templateId} med ${item.keywords.length} keywords`, 10 + (updated / templates.length) * 80);
    }
  }

  onProgress?.(`Ferdig! ${updated} templates oppdatert med keywords`, 100);
  return { updated };
}

export async function runAutoReplyDetection(
  onProgress?: (msg: string, pct: number) => void,
  ticketLimit: number = 1000
): Promise<{ total: number; withAutoReply: number; withoutAutoReply: number }> {
  onProgress?.("Starter autosvar-gjenkjenning...", 0);

  const templates = await storage.getResponseTemplates();
  const templatesWithKeywords = templates.filter(t => t.keywords && t.keywords.length > 0);
  onProgress?.(`Lastet ${templates.length} templates (${templatesWithKeywords.length} med keywords)`, 5);

  if (templatesWithKeywords.length === 0) {
    onProgress?.("Ingen templates har keywords - kjor keyword-generering forst!", 100);
    return { total: 0, withAutoReply: 0, withoutAutoReply: 0 };
  }

  const tickets = await storage.getScrubbedTicketsForAutoreply(ticketLimit);
  onProgress?.(`Fant ${tickets.length} uanalyserte tickets`, 10);

  if (tickets.length === 0) {
    onProgress?.("Ingen uanalyserte tickets funnet", 100);
    return { total: 0, withAutoReply: 0, withoutAutoReply: 0 };
  }

  let stats = { total: 0, withAutoReply: 0, withoutAutoReply: 0 };

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    try {
      const match = detectAutoReplyInDialog(ticket, templatesWithKeywords);
      await storage.updateScrubbedTicketAutoreply(ticket.ticketId, {
        hasAutoreply: match.hasAutoReply,
        autoreplyTemplateId: match.templateId,
        autoreplyConfidence: match.confidence,
        humanResponseStartsAt: match.humanResponseStartsAt,
      });

      stats.total++;
      if (match.hasAutoReply) stats.withAutoReply++;
      else stats.withoutAutoReply++;

      if ((i + 1) % 50 === 0 || i === tickets.length - 1) {
        const pct = 10 + ((i + 1) / tickets.length) * 85;
        onProgress?.(`Prosessert ${i + 1}/${tickets.length} - ${stats.withAutoReply} med autosvar`, pct);
      }
    } catch (err: any) {
      log(`Error processing ticket ${ticket.ticketId}: ${err.message}`, "training");
    }
  }

  onProgress?.(`Ferdig! ${stats.total} analysert: ${stats.withAutoReply} med autosvar (${stats.total > 0 ? Math.round(stats.withAutoReply / stats.total * 100) : 0}%), ${stats.withoutAutoReply} uten`, 100);
  return stats;
}

// ─── DIALOG PATTERN ANALYSIS (Oppgave B) ─────────────────────────────────────

type DialogPattern = 
  | 'autosvar_only'
  | 'autosvar_quick_resolution'
  | 'autosvar_extended_dialog'
  | 'direct_human_response';

interface DialogAnalysis {
  pattern: DialogPattern;
  totalMessages: number;
  messagesAfterAutoreply: number;
}

function analyzeDialogPattern(ticket: any): DialogAnalysis {
  const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
  const totalMessages = messages.length;
  const hasAutoReply = ticket.hasAutoreply || ticket.has_autoreply;
  const humanResponseStartsAt = ticket.humanResponseStartsAt ?? ticket.human_response_starts_at;

  if (!hasAutoReply) {
    return {
      pattern: 'direct_human_response',
      totalMessages,
      messagesAfterAutoreply: 0,
    };
  }

  if (humanResponseStartsAt === null || humanResponseStartsAt === undefined || humanResponseStartsAt === -1) {
    return {
      pattern: 'autosvar_only',
      totalMessages,
      messagesAfterAutoreply: 0,
    };
  }

  const messagesAfterAutoreply = Math.max(0, totalMessages - humanResponseStartsAt);

  if (messagesAfterAutoreply <= 2) {
    return {
      pattern: 'autosvar_quick_resolution',
      totalMessages,
      messagesAfterAutoreply,
    };
  }

  return {
    pattern: 'autosvar_extended_dialog',
    totalMessages,
    messagesAfterAutoreply,
  };
}

export async function runDialogPatternAnalysis(
  onProgress?: (msg: string, pct: number) => void,
  ticketLimit: number = 5000
): Promise<{ total: number; patterns: Record<DialogPattern, number> }> {
  onProgress?.("Starter dialog-mønster analyse...", 0);

  const tickets = await storage.getScrubbedTicketsForDialogPattern(ticketLimit);
  onProgress?.(`Fant ${tickets.length} uanalyserte tickets`, 5);

  if (tickets.length === 0) {
    onProgress?.("Ingen uanalyserte tickets funnet", 100);
    return { total: 0, patterns: { autosvar_only: 0, autosvar_quick_resolution: 0, autosvar_extended_dialog: 0, direct_human_response: 0 } };
  }

  const stats = {
    total: 0,
    patterns: {
      autosvar_only: 0,
      autosvar_quick_resolution: 0,
      autosvar_extended_dialog: 0,
      direct_human_response: 0,
    } as Record<DialogPattern, number>,
  };

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    try {
      const analysis = analyzeDialogPattern(ticket);

      await storage.updateScrubbedTicketDialogPattern(ticket.ticketId, {
        dialogPattern: analysis.pattern,
        messagesAfterAutoreply: analysis.messagesAfterAutoreply,
        totalMessageCount: analysis.totalMessages,
      });

      stats.total++;
      stats.patterns[analysis.pattern]++;

      if ((i + 1) % 100 === 0 || i === tickets.length - 1) {
        const pct = 5 + ((i + 1) / tickets.length) * 90;
        onProgress?.(`Analysert ${i + 1}/${tickets.length} - ${stats.patterns.autosvar_only} kun autosvar, ${stats.patterns.autosvar_quick_resolution} rask, ${stats.patterns.autosvar_extended_dialog} utvidet, ${stats.patterns.direct_human_response} direkte`, pct);
      }
    } catch (err: any) {
      log(`Error analyzing dialog pattern for ticket ${ticket.ticketId}: ${err.message}`, "training");
    }
  }

  const pctOnly = stats.total > 0 ? ((stats.patterns.autosvar_only / stats.total) * 100).toFixed(1) : '0';
  const pctQuick = stats.total > 0 ? ((stats.patterns.autosvar_quick_resolution / stats.total) * 100).toFixed(1) : '0';
  const pctExtended = stats.total > 0 ? ((stats.patterns.autosvar_extended_dialog / stats.total) * 100).toFixed(1) : '0';
  const pctDirect = stats.total > 0 ? ((stats.patterns.direct_human_response / stats.total) * 100).toFixed(1) : '0';

  onProgress?.(`Ferdig! ${stats.total} analysert: Kun autosvar ${pctOnly}%, Rask ${pctQuick}%, Utvidet ${pctExtended}%, Direkte ${pctDirect}%`, 100);
  return stats;
}

// ─── COMBINED BATCH ANALYSIS (Category + Intent + Resolution in ONE call) ─────
export async function runCombinedBatchAnalysis(
  onProgress?: (msg: string, pct: number) => void,
  ticketLimit?: number
): Promise<{ metrics: BatchMetrics }> {
  const metrics = createMetrics();
  const BATCH_SIZE = 10;

  onProgress?.("Starter kombinert batch-analyse...", 0);

  const categories = await storage.getHjelpesenterCategories();
  const categoryList = categories
    .map((c) => `${c.categoryName} > ${c.subcategoryName}`)
    .join("\n");

  const intentsStr = formatIntentsForPrompt();

  const templates = await storage.getActiveResponseTemplates();
  const templateSignatures = templates.map((t) => ({
    id: t.templateId,
    name: t.name,
    subject: t.subject || "",
    category: t.hjelpesenterCategory,
    bodySnippet: (t.bodyText || "").substring(0, 100),
  }));

  const PARALLEL_CONCURRENCY = 5;
  let totalToProcess = 0;

  function buildCombinedPrompt(batch: any[], categoryList: string, intentsStr: string, templateSignatures: any[]): string {
    const ticketsBlock = batch.map((t, idx) => `
TICKET ${idx + 1} (ID: ${t.ticketId}):
Pureservice-kategori: ${t.category || "Ingen"}
Emne: ${t.subject || "Ingen"}
Kundespørsmål: ${(t.customerQuestion || "Ingen").substring(0, 500)}
Agentsvar: ${(t.agentAnswer || "Ingen").substring(0, 500)}
Meldinger: ${t.messages ? JSON.stringify(t.messages).substring(0, 300) : "Ingen"}`).join("\n---");

    return `Du er en ekspert-analysator for DyreID support-tickets. Analyser ALLE ${batch.length} tickets og gi en KOMBINERT analyse for hver.

${ticketsBlock}

KATEGORIER:
${categoryList}

INTENTS (gruppert etter hjelpesenter-kategori):
${intentsStr}

AUTOSVAR-MALER: ${JSON.stringify(templateSignatures)}

FOR HVER TICKET:
1. KATEGORI: Map til hjelpesenter-kategori/underkategori. "Ukategorisert" hvis ingen passer.
2. INTENT: Klassifiser kundens intent (bruk kjente intents eller foreslå ny).
3. OPERASJONELL ANALYSE: Bestem om saken krever en SYSTEMHANDLING (actionable=true) eller kun er INFORMASJONELL (actionable=false).
   - Hvis actionable=true: Ekstraher required_data (datafelter som trengs) og action_endpoint (Min Side endepunkt).
   - Hvis actionable=false: Skriv kun et kort info_text sammendrag.
4. AUTOSVAR-MATCH: Matcher agentsvaret et autosvar? Oppgi template_id.
5. DIALOG-MØNSTER: "autoresponse_only", "autoresponse_then_resolution", "autoresponse_then_no_resolution", "direct_human_response", eller "no_response"
6. RESOLUSJONS-KVALITET: "high", "medium", "low", eller "none"
7. GENERELL-REKLASSIFISERING: Hvis "Generell e-post", angi egentlig emne.

VIKTIG: Du skal IKKE ekstrahere agentens svar eller samtalefrasering. Ekstraher KUN strukturert operasjonell data.

KJENTE ENDEPUNKTER:
- OwnershipTransferWeb → /OwnerChange/OwnerSeller/ReportOwnerChange
- LostPetReport → /Pet/LostPet/ReportLostPet
- FoundPetReport → /Pet/FoundPet/ReportFoundPet
- QRTagActivation → /Pet/QR/Activate
- SmartTagActivation → /SmartTag/Activate
- CancelSubscription → /Subscription/Cancel
- ForeignChipRegistration → /Pet/Foreign/Register
- UpdateContactInfo → /Owner/UpdateContact
- PetDeceased → /Pet/Deceased/Report
- NewRegistration → /Pet/Register

KJENTE DATAFELTER: PetId, NewOwnerMobile, TagId, SubscriptionId, OwnerMobile, ChipNumber, OwnerName, PetName, AnimalId

Svar med JSON: {"tickets": [{"ticket_id":12345,"hjelpesenter_category":"Min Side","hjelpesenter_subcategory":"Innlogging","category_confidence":0.9,"category_reasoning":"...","intent":"LoginIssue","intent_confidence":0.85,"is_new_intent":false,"keywords":"...","required_runtime_data":"","required_action":"","action_endpoint":"","payment_required":false,"auto_close_possible":false,"intent_reasoning":"...","customer_need":"...","actionable":true,"required_data":["PetId"],"guidance_steps":["Steg 1","Steg 2"],"info_text":null,"success_indicators":"...","follow_up_needed":false,"matched_template_id":null,"dialog_pattern":"direct_human_response","resolution_quality":"high","original_category_if_general":null}]}`;
  }

  async function processSingleBatch(batch: any[], categoryList: string, intentsStr: string, templateSignatures: any[], metrics: BatchMetrics): Promise<void> {
    const prompt = buildCombinedPrompt(batch, categoryList, intentsStr, templateSignatures);
    
    const inputTokens = estimateTokens(prompt);
    metrics.estimatedInputTokens += inputTokens;

    let text: string;
    try {
      text = await callOpenAI(prompt, "gpt-5-mini", 8192, true);
    } catch (err: any) {
      metrics.errors += batch.length;
      metrics.apiCalls++;
      log(`API call failed: ${err.message}`, "training");
      return;
    }
    metrics.apiCalls++;

    const outputTokens = estimateTokens(text);
    metrics.estimatedOutputTokens += outputTokens;

    let resultsArray: any[];
    try {
      const results = extractJson(text);
      resultsArray = Array.isArray(results)
        ? results
        : results?.tickets
          ? results.tickets
          : [results];
    } catch (err: any) {
      metrics.errors += batch.length;
      log(`JSON parse failed for batch: ${err.message}`, "training");
      return;
    }

    for (let i = 0; i < batch.length; i++) {
      const ticket = batch[i];
      const result = resultsArray[i] || resultsArray.find((r: any) => r.ticket_id === ticket.ticketId);

      if (!result) {
        metrics.errors++;
        log(`Combined analysis: missing result for ticket ${ticket.ticketId}`, "training");
        continue;
      }

      try {
        await saveCombinedResult(ticket, result, metrics);
      } catch (err: any) {
        metrics.errors++;
        log(`Combined save error ticket ${ticket.ticketId}: ${err.message}`, "training");
      }
    }
  }

  async function processInParallel(batches: any[][], categoryList: string, intentsStr: string, templateSignatures: any[], metrics: BatchMetrics, onProgress?: (msg: string, pct: number) => void, pctBase: number = 0, pctRange: number = 95): Promise<void> {
    let completedBatches = 0;
    
    for (let i = 0; i < batches.length; i += PARALLEL_CONCURRENCY) {
      const parallelBatches = batches.slice(i, i + PARALLEL_CONCURRENCY);
      
      const promises = parallelBatches.map(async (batch) => {
        try {
          await processSingleBatch(batch, categoryList, intentsStr, templateSignatures, metrics);
        } catch (err: any) {
          metrics.errors += batch.length;
          log(`Combined batch error: ${err.message}`, "training");
        }
      });

      await Promise.all(promises);
      completedBatches += parallelBatches.length;
      
      const pct = Math.min(pctBase + pctRange, pctBase + Math.round((completedBatches / batches.length) * pctRange));
      onProgress?.(`Kombinert analyse: ${metrics.processedTickets}/${metrics.totalTickets} tickets (${metrics.apiCalls} API-kall, ${PARALLEL_CONCURRENCY}x parallell)`, pct);
    }
  }

  const unmapped = await storage.getUnmappedScrubbedTickets(ticketLimit || 50000);
  if (unmapped.length > 0) {
    totalToProcess += unmapped.length;
    metrics.totalTickets += unmapped.length;
    onProgress?.(`Fant ${unmapped.length} umappede tickets. Kjører kombinert analyse (${PARALLEL_CONCURRENCY}x parallell)...`, 5);

    const batches = chunk(unmapped, BATCH_SIZE);
    await processInParallel(batches, categoryList, intentsStr, templateSignatures, metrics, onProgress, 5, 45);
  }

  const alreadyMapped = await storage.getUnclassifiedScrubbedTickets(ticketLimit || 50000);
  if (alreadyMapped.length > 0) {
    metrics.totalTickets += alreadyMapped.length;
    onProgress?.(`Fant ${alreadyMapped.length} mappede men uklassifiserte tickets. Kjører intent + resolusjon (${PARALLEL_CONCURRENCY}x parallell)...`, 50);

    const batches = chunk(alreadyMapped, BATCH_SIZE);
    await processInParallel(batches, categoryList, intentsStr, templateSignatures, metrics, onProgress, 50, 45);
  }

  finalizeMetrics(metrics);
  const elapsedSec = (metrics.elapsedMs || 0) / 1000;
  const est40k = metrics.processedTickets > 0
    ? ((40000 / metrics.processedTickets) * elapsedSec / 3600).toFixed(1)
    : "N/A";

  onProgress?.(`Ferdig! ${metrics.processedTickets} tickets, ${metrics.apiCalls} API-kall, ${elapsedSec.toFixed(1)}s, est. 40K: ${est40k}t, est. kostnad: $${metrics.estimatedCostUsd.toFixed(4)}`, 100);

  return { metrics };
}

export async function runReclassification(
  onProgress?: (message: string, percent: number) => void,
  ticketLimit?: number
): Promise<{ metrics: BatchMetrics }> {
  const metrics = createMetrics();

  onProgress?.("Identifiserer generelle tickets...", 5);
  const generalCount = await storage.identifyGeneralTickets();
  onProgress?.(`Fant ${generalCount} generelle tickets. Henter ubehandlede...`, 10);

  const limit = ticketLimit || 1000;
  const tickets = await storage.getTicketsForReclassification(limit);
  metrics.totalTickets = tickets.length;

  if (tickets.length === 0) {
    onProgress?.("Ingen tickets trenger reklassifisering (alle er allerede behandlet).", 100);
    finalizeMetrics(metrics);
    return { metrics };
  }

  onProgress?.(`Reklassifiserer ${tickets.length} tickets med AI...`, 15);

  const BATCH_SIZE = 5;
  const batches: any[][] = [];
  for (let i = 0; i < tickets.length; i += BATCH_SIZE) {
    batches.push(tickets.slice(i, i + BATCH_SIZE));
  }

  let processed = 0;
  let reclassified = 0;
  let remainGeneral = 0;

  for (const batch of batches) {
    const results = await Promise.all(
      batch.map(async (ticket: any) => {
        const prompt = `Denne support-saken kom inn som "${ticket.originalCategory || 'Generell e-post'}", men handler kanskje om noe mer spesifikt.

SAKEN:
Subject: ${ticket.subject || 'Ingen subject'}
Kundens spørsmål: ${(ticket.customerQuestion || '').substring(0, 1500)}
Agentens svar: ${(ticket.agentAnswer || 'Ingen svar').substring(0, 1500)}

TILGJENGELIGE KATEGORIER (velg én):
1. ID-søk - ID-merking, kontaktdata, søkbarhet
2. DyreID-appen - Tilgang, innlogging, abonnement, funksjoner
3. Min side - Innlogging, profil, kontaktdata, GDPR, kjæledyr
4. Eierskifte - Overføring via app/web, NKK, dødsfall
5. Smart Tag - Aktivering, kobling, posisjon, lyd, flere tagger
6. QR-brikke - Aktivering, skanning, kontaktinfo, abonnement
7. Utenlandsregistrering - Registrering i Norge, priser, stamtavle
8. Savnet/Funnet - Melde savnet/funnet, Søkbar på 1-2-3
9. Familiedeling - Dele tilgang, rettigheter, forespørsler

VIKTIG:
- Analyser både spørsmål OG svar for å finne riktig kategori
- Hvis saken tydelig handler om én kategori, sett confidence høyt (0.8-1.0)
- Hvis usikker mellom 2-3 kategorier, sett confidence lavt (0.5-0.7)
- Hvis VIRKELIG generell/ikke-spesifikk, sett actualCategory til null (confidence < 0.5)

Return JSON: {"actualCategory":"kategori-navn eller null","actualSubcategory":"underkategori eller null","confidence":0.0-1.0,"reasoning":"Kort forklaring"}`;

        try {
          const text = await callOpenAI(prompt, "gpt-5-nano", 1024, true);
          metrics.apiCalls++;
          metrics.estimatedInputTokens += prompt.length / 4;
          metrics.estimatedOutputTokens += 100;
          metrics.estimatedCostUsd += 0.0002;

          const parsed = JSON.parse(text);
          return {
            mappingId: ticket.mappingId,
            actualCategory: parsed.actualCategory || null,
            actualSubcategory: parsed.actualSubcategory || null,
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
            reasoning: parsed.reasoning || 'Ukjent',
          };
        } catch (e) {
          metrics.errors++;
          return {
            mappingId: ticket.mappingId,
            actualCategory: null,
            actualSubcategory: null,
            confidence: 0,
            reasoning: 'Parsing error',
          };
        }
      })
    );

    for (const result of results) {
      const isReclassified = result.actualCategory && result.confidence >= 0.6;
      await storage.updateReclassification(result.mappingId, {
        reclassifiedCategory: isReclassified ? result.actualCategory : null,
        reclassifiedSubcategory: isReclassified ? result.actualSubcategory : null,
        reclassificationConfidence: result.confidence,
        reclassificationReasoning: result.reasoning,
      });

      if (isReclassified) reclassified++;
      else remainGeneral++;
      processed++;
      metrics.processedTickets = processed;
    }

    const pct = Math.min(95, 15 + Math.round((processed / tickets.length) * 80));
    onProgress?.(`Behandlet ${processed}/${tickets.length} (${reclassified} reklassifisert, ${remainGeneral} forblir generell)`, pct);

    await new Promise((r) => setTimeout(r, 100));
  }

  finalizeMetrics(metrics);
  const pctReclass = tickets.length > 0 ? ((reclassified / tickets.length) * 100).toFixed(1) : '0';
  onProgress?.(`Ferdig! ${processed} tickets analysert. ${reclassified} reklassifisert (${pctReclass}%), ${remainGeneral} forblir generell. ${metrics.apiCalls} API-kall.`, 100);

  return { metrics };
}

// ─── OPPGAVE D: RESOLUSJONS-KVALITET VURDERING ────────────────────────────
export async function runQualityAssessment(
  onProgress?: (message: string, percent: number) => void,
  ticketLimit?: number
): Promise<{ metrics: BatchMetrics }> {
  const metrics = createMetrics();

  onProgress?.("Henter tickets som ikke er kvalitetsvurdert...", 5);
  const limit = ticketLimit || 1000;
  const tickets = await storage.getTicketsForQualityAssessment(limit);
  metrics.totalTickets = tickets.length;

  if (tickets.length === 0) {
    onProgress?.("Ingen tickets trenger kvalitetsvurdering (alle er allerede vurdert).", 100);
    finalizeMetrics(metrics);
    return { metrics };
  }

  onProgress?.(`Vurderer kvalitet på ${tickets.length} tickets med AI...`, 10);

  const BATCH_SIZE = 5;
  const batches = chunk(tickets, BATCH_SIZE);
  let processed = 0;
  const qualityCounts: Record<string, number> = { high: 0, medium: 0, low: 0, none: 0 };

  for (const batch of batches) {
    const results = await Promise.all(
      batch.map(async (ticket: any) => {
        const messagesText = Array.isArray(ticket.messages)
          ? ticket.messages.slice(0, 10).map((m: any, i: number) => `${i + 1}. ${m.from || m.role || 'Ukjent'}: ${(m.body || m.content || '').substring(0, 500)}`).join('\n')
          : 'Ingen dialog';

        const prompt = `Vurder om kunden fikk en god løsning i denne support-saken.

SAKEN:
Subject: ${ticket.subject || 'Ingen subject'}
Kundens spørsmål: ${(ticket.customerQuestion || '').substring(0, 1500)}
Agentens svar: ${(ticket.agentAnswer || 'Ingen svar').substring(0, 1500)}

Dialog (hvis flere meldinger):
${messagesText}

KONTEKST:
- Hadde autosvar: ${ticket.hasAutoreply ? 'Ja' : 'Nei'}
- Dialog-mønster: ${ticket.dialogPattern || 'Ukjent'}
- Auto-lukket: ${ticket.autoClosed ? 'Ja' : 'Nei'}

KVALITETSKRITERIER:
HIGH: Konkrete steg, kunden fikk alt de trengte, priser/lenker/kontaktinfo, profesjonell tone, bekreftet løsning
MEDIUM: Løsning gitt men vag/ufullstendig, mangler detaljer, kunden må følge opp, generell veiledning
LOW: Kun informasjon uten handling, agent ba kunden selv finne løsning, vag "prøv dette", gjentatte spørsmål
NONE: Kun autosvar uten oppfølging, agent kunne ikke hjelpe, saken lukket uten løsning

VIKTIGE SIGNALER:
- Kun autosvar + auto-lukket = sannsynligvis NONE
- "Jeg skal undersøke" uten oppfølging = LOW/NONE
- Konkrete steg + priser/lenker = HIGH
- Veiledning + "kontakt oss hvis..." = MEDIUM

Return JSON:
{
  "qualityLevel": "high" | "medium" | "low" | "none",
  "confidence": 0.0-1.0,
  "missingElements": ["array av mangler"],
  "positiveElements": ["array av positive aspekter"],
  "reasoning": "Kort forklaring"
}`;

        try {
          const text = await callOpenAI(prompt, "gpt-5-nano", 1024, true);
          metrics.apiCalls++;
          metrics.estimatedInputTokens += estimateTokens(prompt);
          metrics.estimatedOutputTokens += 150;

          const parsed = JSON.parse(text);
          return {
            ticketId: ticket.id,
            qualityLevel: parsed.qualityLevel || 'none',
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
            missingElements: Array.isArray(parsed.missingElements) ? parsed.missingElements : [],
            positiveElements: Array.isArray(parsed.positiveElements) ? parsed.positiveElements : [],
            reasoning: parsed.reasoning || 'Ukjent',
            hadAutoreply: ticket.hasAutoreply || false,
            dialogPattern: ticket.dialogPattern || null,
          };
        } catch (e) {
          metrics.errors++;
          return {
            ticketId: ticket.id,
            qualityLevel: 'none',
            confidence: 0,
            missingElements: ['Parsing error'],
            positiveElements: [],
            reasoning: 'Error in assessment',
            hadAutoreply: ticket.hasAutoreply || false,
            dialogPattern: ticket.dialogPattern || null,
          };
        }
      })
    );

    for (const result of results) {
      await storage.insertResolutionQuality(result);
      qualityCounts[result.qualityLevel] = (qualityCounts[result.qualityLevel] || 0) + 1;
      processed++;
      metrics.processedTickets = processed;
    }

    const pct = Math.min(95, 10 + Math.round((processed / tickets.length) * 85));
    onProgress?.(`Vurdert ${processed}/${tickets.length} (H:${qualityCounts.high} M:${qualityCounts.medium} L:${qualityCounts.low} N:${qualityCounts.none})`, pct);

    await new Promise((r) => setTimeout(r, 100));
  }

  finalizeMetrics(metrics);
  const total = processed;
  const highPct = total > 0 ? ((qualityCounts.high / total) * 100).toFixed(1) : '0';
  const nonePct = total > 0 ? ((qualityCounts.none / total) * 100).toFixed(1) : '0';
  onProgress?.(`Ferdig! ${total} vurdert. HIGH: ${qualityCounts.high} (${highPct}%), MEDIUM: ${qualityCounts.medium}, LOW: ${qualityCounts.low}, NONE: ${qualityCounts.none} (${nonePct}%). ${metrics.apiCalls} API-kall.`, 100);

  return { metrics };
}

// ─── INFORMATIONAL PLAYBOOK POPULATION ──────────────────────────────────────
// Matches each informational intent to Help Center articles and generates
// conversational infoText (combinedResponse) from article content.
// This ensures informational responses answer directly instead of linking.
export async function runInfoTextPopulation(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ populated: number; skipped: number; noArticle: number; errors: number }> {
  let populated = 0;
  let skipped = 0;
  let noArticle = 0;
  let errors = 0;

  onProgress?.("Starter informasjonstekst-populering fra Hjelpesenter-artikler...", 0);

  const articles = await storage.getHelpCenterArticles();
  if (articles.length === 0) {
    onProgress?.("Ingen hjelpesenter-artikler funnet. Kjør scraping først.", 100);
    return { populated: 0, skipped: 0, noArticle: 0, errors: 0 };
  }
  onProgress?.(`Lastet ${articles.length} hjelpesenter-artikler`, 5);

  const informationalIntents = INTENT_DEFINITIONS.filter(d => {
    const isTransactional = [
      "OwnershipTransferWeb", "OwnershipTransferApp",
      "ReportLostPet", "ReportFoundPet",
      "SmartTagActivation", "SmartTagQRActivation",
      "QRTagActivation", "QRUpdateContact",
      "ForeignRegistration",
      "GDPRDelete", "GDPRExport",
      "LoginIssue", "LoginProblem",
      "PetDeceased", "MissingPetProfile",
      "WrongInfo", "AddContactInfo",
      "FamilySharing", "FamilySharingRequest",
      "ViewMyPets",
    ].includes(d.intent);
    return !isTransactional;
  });

  onProgress?.(`${informationalIntents.length} informasjons-intents å behandle`, 10);

  for (let i = 0; i < informationalIntents.length; i++) {
    const intentDef = informationalIntents[i];
    const pct = Math.round(10 + ((i / informationalIntents.length) * 80));
    onProgress?.(`Behandler ${i + 1}/${informationalIntents.length}: ${intentDef.intent}`, pct);

    try {
      const hcCategory = INTENT_TO_HELPCENTER_CATEGORY[intentDef.category] || intentDef.category;

      const matchingArticles = articles.filter(a => {
        if (!a.hjelpesenterCategory) return false;
        const catMatch = a.hjelpesenterCategory === hcCategory;
        if (!catMatch) return false;

        if (a.hjelpesenterSubcategory) {
          const subNorm = a.hjelpesenterSubcategory.toLowerCase().trim();
          const intentSubNorm = intentDef.subcategory.toLowerCase().trim();
          if (subNorm === intentSubNorm) return true;
          if (subNorm.includes(intentSubNorm) || intentSubNorm.includes(subNorm)) return true;
          const intentKeywords = intentDef.keywords || [];
          const keywordMatch = intentKeywords.some(kw => subNorm.includes(kw.toLowerCase()));
          if (keywordMatch) return true;
        }
        return false;
      });

      if (matchingArticles.length === 0) {
        const fallbackArticles = articles.filter(a =>
          a.hjelpesenterCategory === hcCategory && a.bodyText && a.bodyText.length > 50
        );
        const bestFallback = fallbackArticles.find(a => {
          const titleLower = (a.title || "").toLowerCase();
          return intentDef.keywords.some(kw => titleLower.includes(kw.toLowerCase()));
        });

        if (!bestFallback) {
          log(`InfoText: Ingen artikkel funnet for ${intentDef.intent} (kategori: ${hcCategory})`, "training");
          noArticle++;
          continue;
        }
        matchingArticles.push(bestFallback);
      }

      const combinedBodyText = matchingArticles
        .map(a => a.bodyText || "")
        .filter(t => t.length > 20)
        .join("\n\n---\n\n")
        .substring(0, 3000);

      if (!combinedBodyText || combinedBodyText.length < 20) {
        log(`InfoText: Tom artikkeltekst for ${intentDef.intent}`, "training");
        noArticle++;
        continue;
      }

      const prompt = `Du er en informasjonsassistent for DyreID (Norges nasjonale kjæledyrregister).

OPPGAVE: Generer en klar, faktabasert informasjonstekst som svarer direkte på spørsmål om "${intentDef.subcategory}".

INTENT: ${intentDef.intent}
KATEGORI: ${intentDef.category}
BESKRIVELSE: ${intentDef.description}

KILDE (Hjelpesenter-artikkeltekst):
${combinedBodyText}

STRENGE REGLER:
- Skriv en konsis, vennlig tekst som forklarer temaet DIREKTE
- Bruk KUN informasjon fra kildeteksten over
- IKKE inkluder lenker eller URL-er
- IKKE foreslå å kontakte support
- IKKE beskriv register-endrende prosedyrer (som å logge inn og trykke knapper steg-for-steg)
- IKKE nevn veterinær eller chipinnsetting
- IKKE finn opp priser som ikke står i kilden
- Teksten skal kunne omformuleres av en chatbot basert på brukerens spørsmål
- Maks 150 ord
- Skriv på norsk bokmål

Returner KUN teksten, ingen JSON eller formatering.`;

      const rawResponse = await callOpenAI(prompt, "gpt-4o", 512);
      const infoText = rawResponse.replace(/^["'\s]+|["'\s]+$/g, "").trim();

      if (!infoText || infoText.length < 15) {
        log(`InfoText: For kort GPT-respons for ${intentDef.intent} (${infoText?.length || 0} tegn): "${(infoText || '').substring(0, 80)}"`, "training");
        errors++;
        continue;
      }

      if (infoText.includes("http") || infoText.includes("www.")) {
        log(`InfoText: GPT inkluderte URL for ${intentDef.intent}, filtrerer bort`, "training");
        errors++;
        continue;
      }

      const existingEntries = await db.execute(sql`
        SELECT intent, combined_response FROM playbook_entries WHERE intent = ${intentDef.intent}
      `);
      const existing = existingEntries.rows[0] as any;

      if (existing) {
        await db.execute(sql`
          UPDATE playbook_entries
          SET combined_response = ${infoText},
              action_type = 'INFO_ONLY',
              help_center_article_url = ${matchingArticles[0]?.url || null},
              help_center_article_title = ${matchingArticles[0]?.title || null},
              help_center_content_summary = ${combinedBodyText.substring(0, 500)},
              last_updated = CURRENT_TIMESTAMP
          WHERE intent = ${intentDef.intent}
        `);
      } else {
        await storage.upsertPlaybookEntry({
          intent: intentDef.intent,
          hjelpesenterCategory: intentDef.category,
          hjelpesenterSubcategory: intentDef.subcategory,
          keywords: intentDef.keywords.join(", "),
          requiredRuntimeData: null,
          primaryAction: null,
          primaryEndpoint: null,
          resolutionSteps: null,
          successIndicators: null,
          avgConfidence: 0.9,
          ticketCount: 0,
          paymentRequiredProbability: 0,
          autoCloseProbability: 0,
          isActive: true,
          hasAutoreplyAvailable: false,
          autoreplyTemplateId: null,
          autoreplyTemplateName: null,
          autoreplyContent: null,
          typicalDialogPattern: null,
          avgMessagesAfterAutoreply: null,
          dialogPatternDistribution: null,
          wasReclassified: false,
          originalCategories: null,
          reclassifiedFrom: null,
          avgResolutionQuality: null,
          qualityDistribution: null,
          commonMissingElements: null,
          commonPositiveElements: null,
          needsImprovement: false,
          helpCenterArticleId: matchingArticles[0]?.articleId || null,
          helpCenterArticleUrl: matchingArticles[0]?.url || null,
          helpCenterArticleTitle: matchingArticles[0]?.title || null,
          officialProcedure: null,
          helpCenterContentSummary: combinedBodyText.substring(0, 500),
          requiresLogin: false,
          requiresAction: false,
          actionType: "INFO_ONLY",
          apiEndpoint: null,
          httpMethod: null,
          requiredRuntimeDataArray: null,
          paymentRequired: false,
          paymentAmount: null,
          chatbotSteps: null,
          combinedResponse: infoText,
          successfulResolutions: 0,
          failedResolutions: 0,
          totalUses: 0,
          successRate: 0,
        });
      }

      populated++;
      log(`InfoText: Generert for ${intentDef.intent} (${infoText.length} tegn, ${matchingArticles.length} artikler)`, "training");

    } catch (err: any) {
      log(`InfoText error for ${intentDef.intent}: ${err.message}`, "training");
      errors++;
    }
  }

  onProgress?.(`Ferdig! ${populated} populert, ${skipped} hoppet over, ${noArticle} uten artikkel, ${errors} feil`, 100);
  return { populated, skipped, noArticle, errors };
}

// ─── INTENT NORMALIZATION ──────────────────────────────────────────────────
interface NormalizationResult {
  normalizedIntent: string;
  isNewIntentCandidate: boolean;
  similarityScore: number;
  matchedExistingIntent: string | null;
}

async function normalizeDiscoveredIntent(
  suggestedIntent: string,
  description: string,
  keywords: string[],
  existingIntents: { intent: string; category: string; description: string; keywords: string[] }[],
  playbookIntents: { intent: string; hjelpesenterCategory: string | null; requiredRuntimeData: string | null; apiEndpoint: string | null; requiresLogin: boolean | null; requiresAction: boolean | null; paymentRequired: boolean | null }[]
): Promise<NormalizationResult> {
  const allExistingNames = existingIntents.map(i => i.intent);
  const allPlaybookNames = playbookIntents.map(p => p.intent);
  const combinedIntents = Array.from(new Set([...allExistingNames, ...allPlaybookNames]));

  const existingDetails = existingIntents.map(i =>
    `${i.intent} (${i.category}): ${i.description} [${i.keywords.join(", ")}]`
  ).join("\n");

  const playbookDetails = playbookIntents.map(p =>
    `${p.intent} (${p.hjelpesenterCategory || "ukjent"})${p.requiresLogin ? " [krever innlogging]" : ""}${p.requiresAction ? " [transaksjonell]" : ""}${p.paymentRequired ? " [betaling]" : ""}`
  ).join("\n");

  const prompt = `Du er en intent-normaliseringsekspert for DyreID support-systemet.

OPPGAVE: Sammenlign den foreslåtte intenten med eksisterende intents og avgjør om den er semantisk lik noen av dem.

FORESLÅTT INTENT:
Navn: ${suggestedIntent}
Beskrivelse: ${description}
Nøkkelord: ${keywords.join(", ")}

HJELPESENTER-INTENTS:
${existingDetails}

PLAYBOOK-INTENTS:
${playbookDetails}

INSTRUKSJONER:
1. Sammenlign den foreslåtte intenten mot BÅDE Hjelpesenter-intents og Playbook-intents
2. Finn den mest semantisk like intenten fra begge kildene
3. Vurder semantisk likhet (0.0 til 1.0):
   - 1.0 = identisk formål
   - 0.75+ = samme underliggende behov, kan slås sammen
   - 0.5-0.74 = relatert men distinkt nok til å være separat
   - <0.5 = helt forskjellig
4. Hvis likhet >= 0.75: Map til eksisterende intent (returner matchedExistingIntent)
5. Hvis likhet < 0.75: Marker som ny intent-kandidat
6. Foretrekk Playbook-treff over Hjelpesenter-treff ved lik likhetsscore

VIKTIG: Vurder formål og brukerens underliggende behov, ikke bare ordlikhet.
F.eks. "TransferPetOwnershipToFamily" og "OwnershipTransferWeb" handler begge om eierskifte.

SVAR I JSON:
{
  "most_similar_intent": "ExistingIntentName eller null",
  "similarity_score": 0.0-1.0,
  "reasoning": "Kort forklaring",
  "normalized_intent": "Enten eksisterende intent-navn (hvis mapped) eller det foreslåtte navnet (hvis nytt)"
}`;

  try {
    const text = await callOpenAI(prompt, "gpt-4o", 1024, true);
    const result = extractJson(text);

    const score = result.similarity_score || 0;
    const isNew = score < 0.75;
    const matchedIntent = !isNew && result.most_similar_intent ? result.most_similar_intent : null;
    const normalizedName = isNew ? suggestedIntent : (result.most_similar_intent || suggestedIntent);

    return {
      normalizedIntent: normalizedName,
      isNewIntentCandidate: isNew,
      similarityScore: score,
      matchedExistingIntent: matchedIntent,
    };
  } catch (err: any) {
    log(`Normalization error for "${suggestedIntent}": ${err.message}`, "training");
    return {
      normalizedIntent: suggestedIntent,
      isNewIntentCandidate: true,
      similarityScore: 0,
      matchedExistingIntent: null,
    };
  }
}

// ─── CANONICAL INTENT NORMALIZATION ─────────────────────────────────────────
async function normalizeAgainstCanonical(
  suggestedIntent: string,
  description: string,
  keywords: string[],
  canonicalIntents: { intentId: string; category: string; subcategory?: string | null; description?: string | null; keywords?: string | null; actionable?: boolean | null }[]
): Promise<NormalizationResult> {
  const canonicalDetails = canonicalIntents.map(ci =>
    `${ci.intentId} (${ci.category}${ci.subcategory ? "/" + ci.subcategory : ""}): ${ci.description || ""} [${ci.keywords || ""}]`
  ).join("\n");

  const prompt = `Du er en intent-normaliseringsekspert for DyreID support-systemet.

OPPGAVE: Sammenlign den foreslåtte intenten med eksisterende canonical intents og avgjør om den er semantisk lik noen av dem.

FORESLÅTT INTENT:
Navn: ${suggestedIntent}
Beskrivelse: ${description}
Nøkkelord: ${keywords.join(", ")}

CANONICAL INTENTS:
${canonicalDetails}

INSTRUKSJONER:
1. Finn den mest semantisk like canonical intenten
2. Vurder semantisk likhet (0.0 til 1.0):
   - 1.0 = identisk formål
   - 0.75+ = samme underliggende behov, kan slås sammen
   - 0.5-0.74 = relatert men distinkt nok til å være separat
   - <0.5 = helt forskjellig
3. Hvis likhet >= 0.75: Map til eksisterende intent
4. Hvis likhet < 0.75: Marker som ny intent-kandidat

VIKTIG: Vurder formål og brukerens underliggende behov, ikke bare ordlikhet.

SVAR I JSON:
{
  "most_similar_intent": "ExistingIntentName eller null",
  "similarity_score": 0.0-1.0,
  "reasoning": "Kort forklaring",
  "normalized_intent": "Enten eksisterende intent-navn (hvis mapped) eller det foreslåtte navnet (hvis nytt)"
}`;

  try {
    const text = await callOpenAI(prompt, "gpt-4o", 1024, true);
    const result = extractJson(text);

    const score = result.similarity_score || 0;
    const isNew = score < 0.75;
    const matchedIntent = !isNew && result.most_similar_intent ? result.most_similar_intent : null;
    const normalizedName = isNew ? suggestedIntent : (result.most_similar_intent || suggestedIntent);

    return {
      normalizedIntent: normalizedName,
      isNewIntentCandidate: isNew,
      similarityScore: score,
      matchedExistingIntent: matchedIntent,
    };
  } catch (err: any) {
    log(`Canonical normalization error for "${suggestedIntent}": ${err.message}`, "training");
    return {
      normalizedIntent: suggestedIntent,
      isNewIntentCandidate: true,
      similarityScore: 0,
      matchedExistingIntent: null,
    };
  }
}

// ─── DOMAIN DISCOVERY PIPELINE (Steps 2A-2E) ──────────────────────────────

function buildClusterText(ticket: { subject?: string | null; customerQuestion?: string | null; agentAnswer?: string | null }): string {
  const parts: string[] = [];
  if (ticket.subject) parts.push(ticket.subject.trim());
  if (ticket.customerQuestion) parts.push(ticket.customerQuestion.trim());
  if (ticket.agentAnswer) parts.push(ticket.agentAnswer.substring(0, 300).trim());
  return parts.join(" | ");
}

export async function runDomainDiscovery(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ discovered: number; errors: number }> {
  const { isUncategorized } = await import("./canonical-intents");
  let totalDiscovered = 0;
  let totalErrors = 0;

  onProgress?.("Starter Domain Discovery Pipeline...", 0);

  const allScrubbed = await db.select().from(scrubbedTickets).limit(1000);

  const genericTickets = allScrubbed.filter(t => isUncategorized({
    categoryId: t.categoryId,
    category: t.hjelpesenterCategory || t.category || "",
  }));

  if (genericTickets.length === 0) {
    onProgress?.("Ingen ukategoriserte tickets funnet", 100);
    return { discovered: 0, errors: 0 };
  }

  onProgress?.(`Fant ${genericTickets.length} ukategoriserte tickets. Laster canonical intents...`, 5);

  const canonicalIntentRows = await storage.getApprovedCanonicalIntents();

  onProgress?.(`${canonicalIntentRows.length} canonical intents lastet. Kjører klyngeanalyse (Steg 2A)...`, 10);

  // ── STEP 2A: CLUSTERING (GPT-based, HDBSCAN reserved for future via env toggle) ──
  const ticketSummaries = genericTickets.map((t, i) =>
    `TICKET ${i + 1} (ID: ${t.ticketId}):\n${buildClusterText(t)}\n---`
  ).join("\n");

  const existingIntentNames = canonicalIntentRows.map(ci => ci.intentId);

  let clusters: any[] = [];
  try {
    const clusterPrompt = `Du er en ekspert på å analysere support-tickets for DyreID (Norges nasjonale kjæledyrregister).

OPPGAVE: Grupper disse ukategoriserte tickets i semantiske klynger basert på:
- Hva kunden faktisk spør om
- Lignende problemtyper
- Lignende løsningsmetoder

TICKETS:
${ticketSummaries}

EKSISTERENDE INTENTS (ikke gjenta disse):
${existingIntentNames.join(", ")}

INSTRUKSJONER:
1. Identifiser klynger av lignende saker
2. Hvert cluster må ha minst 2 tickets
3. Foreslå et PascalCase intent-navn for hvert cluster (f.eks. SmartTagSyncIssue, PaymentLinkFailure)
4. IKKE foreslå intents som allerede finnes i listen over
5. Gi en kort norsk beskrivelse av hva clusteret handler om

SVAR I JSON:
{
  "clusters": [
    {
      "cluster_name": "Kort navn på klyngen",
      "suggested_intent": "PascalCaseIntentNavn",
      "description": "Hva disse sakene handler om",
      "category": "Foreslått hjelpesenter-kategori",
      "ticket_ids": [1, 5, 12],
      "sample_messages": ["Eksempel på kundemelding 1", "Eksempel 2"],
      "keywords": ["nøkkelord1", "nøkkelord2"]
    }
  ]
}`;

    const clusterText = await callOpenAI(clusterPrompt, "gpt-4o", 8192, true);
    const clusterResult = extractJson(clusterText);
    clusters = clusterResult.clusters || [];
    onProgress?.(`Fant ${clusters.length} klynger. Kjører analyse per klynge...`, 30);
  } catch (err: any) {
    log(`Domain Discovery clustering error: ${err.message}`, "training");
    totalErrors++;
    onProgress?.(`Feil i klyngeanalyse: ${err.message}`, -1);
    return { discovered: 0, errors: 1 };
  }

  const discoveryRunId = Date.now();

  // ── STEP 2B-2E: Analysis, normalization, storage per cluster ──
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const pct = 30 + Math.round((i / clusters.length) * 60);
    onProgress?.(`Analyserer klynge ${i + 1}/${clusters.length}: ${cluster.suggested_intent}...`, pct);

    try {
      const clusterTicketIds = (cluster.ticket_ids || []).map((idx: number) => {
        const ticket = genericTickets[idx - 1];
        return ticket?.ticketId;
      }).filter(Boolean);

      const clusterTickets = genericTickets.filter(t =>
        clusterTicketIds.includes(t.ticketId) ||
        (cluster.ticket_ids || []).includes(genericTickets.indexOf(t) + 1)
      );

      const dialogSummaries = clusterTickets.slice(0, 5).map(t =>
        `Kunde: ${t.customerQuestion || "?"}\nAgent: ${(t.agentAnswer || "?").substring(0, 400)}`
      ).join("\n---\n");

      const analysisPrompt = `Du er en ekspert på DyreID support-analyse.

OPPGAVE: Analyser dette clusteret av support-saker og besvar to ting:

1. RESOLUTION: Hva gjorde agentene faktisk for å løse disse sakene? List konkrete steg.
2. ACTIONABILITY: Er dette transaksjonelt (krever innlogging/endring i register) eller informasjonelt?

CLUSTER: ${cluster.suggested_intent}
BESKRIVELSE: ${cluster.description}

EKSEMPLER FRA DIALOGER:
${dialogSummaries}

SVAR I JSON:
{
  "resolution_steps": "Steg 1: ...\\nSteg 2: ...\\nSteg 3: ...",
  "agent_actions": "Hva agenten konkret utførte (kort)",
  "actionable": true/false,
  "requires_otp": true/false,
  "affects_register": true/false,
  "affects_ownership": true/false,
  "affects_payment": true/false,
  "confidence": 0.0-1.0,
  "required_fields": "felt1, felt2",
  "action_endpoint": "/api/relevant-endpoint eller null"
}`;

      const analysisText = await callOpenAI(analysisPrompt, "gpt-4o", 2048, true);
      const analysis = extractJson(analysisText);

      // STEP 2D: INTENT NORMALIZATION against canonical_intents
      const normalization = await normalizeAgainstCanonical(
        cluster.suggested_intent,
        cluster.description || "",
        cluster.keywords || [],
        canonicalIntentRows
      );

      let finalCategory = cluster.category || null;
      let finalActionable = analysis.actionable || false;
      let finalRequiresOtp = analysis.requires_otp || false;
      let finalAffectsRegister = analysis.affects_register || false;
      let finalAffectsOwnership = analysis.affects_ownership || false;
      let finalAffectsPayment = analysis.affects_payment || false;
      let finalRequiredFields = analysis.required_fields || null;
      let finalActionEndpoint = analysis.action_endpoint || null;
      let finalStatus = "pending";

      if (!normalization.isNewIntentCandidate && normalization.matchedExistingIntent) {
        const matched = canonicalIntentRows.find(ci => ci.intentId === normalization.matchedExistingIntent);
        if (matched) {
          finalCategory = matched.category || finalCategory;
          finalActionable = matched.actionable || finalActionable;
          finalRequiredFields = matched.requiredFields ? JSON.stringify(matched.requiredFields) : finalRequiredFields;
          finalActionEndpoint = matched.endpoint || finalActionEndpoint;
        }
        finalStatus = "auto_mapped";
      }

      await storage.insertDiscoveredCluster({
        clusterId: `${discoveryRunId}-${i}`,
        clusterName: cluster.cluster_name || cluster.suggested_intent,
        suggestedIntent: cluster.suggested_intent,
        description: cluster.description || "",
        category: finalCategory,
        ticketCount: clusterTicketIds.length || cluster.ticket_ids?.length || 0,
        ticketIds: clusterTicketIds,
        sampleMessages: cluster.sample_messages || [],
        topKeywords: cluster.keywords || [],
        actionable: finalActionable,
        confidence: analysis.confidence || 0,
        normalizedIntent: normalization.normalizedIntent,
        isNewCandidate: normalization.isNewIntentCandidate,
        similarityScore: normalization.similarityScore,
        matchedCanonicalIntent: normalization.matchedExistingIntent,
        status: finalStatus,
        discoveryRunId,
      });

      // Also store in legacy discovered_intents for backward compat
      await storage.insertDiscoveredIntent({
        clusterName: cluster.cluster_name || cluster.suggested_intent,
        suggestedIntent: cluster.suggested_intent,
        description: cluster.description || "",
        category: finalCategory,
        ticketCount: clusterTicketIds.length || cluster.ticket_ids?.length || 0,
        ticketIds: JSON.stringify(clusterTicketIds),
        sampleMessages: cluster.sample_messages || [],
        resolutionSteps: analysis.resolution_steps || null,
        agentActions: analysis.agent_actions || null,
        actionable: finalActionable,
        requiresOtp: finalRequiresOtp,
        affectsRegister: finalAffectsRegister,
        affectsOwnership: finalAffectsOwnership,
        affectsPayment: finalAffectsPayment,
        confidence: analysis.confidence || 0,
        keywords: (cluster.keywords || []).join(", "),
        requiredFields: finalRequiredFields,
        actionEndpoint: finalActionEndpoint,
        normalizedIntent: normalization.normalizedIntent,
        isNewIntentCandidate: normalization.isNewIntentCandidate,
        similarityScore: normalization.similarityScore,
        matchedExistingIntent: normalization.matchedExistingIntent,
        status: finalStatus,
      });

      const mappedLabel = normalization.isNewIntentCandidate
        ? "NEW CANDIDATE (requires review)"
        : `MAPPED → ${normalization.matchedExistingIntent} (${Math.round(normalization.similarityScore * 100)}%)`;
      totalDiscovered++;
      log(`Discovery: "${cluster.suggested_intent}" → ${mappedLabel} (${finalActionable ? "transactional" : "informational"})`, "training");

    } catch (err: any) {
      totalErrors++;
      log(`Discovery error for cluster "${cluster.suggested_intent}": ${err.message}`, "training");
    }
  }

  onProgress?.(`Domain Discovery ferdig! ${totalDiscovered} nye intents oppdaget, ${totalErrors} feil. Venter på godkjenning.`, 100);
  return { discovered: totalDiscovered, errors: totalErrors };
}
