import OpenAI from "openai";
import { sql } from "drizzle-orm";
import { storage } from "./storage";
import { db } from "./db";
import { scrubbedTickets } from "@shared/schema";
import { scrubTicket } from "./gdpr-scrubber";
import { fetchTicketsFromPureservice, mapPureserviceToRawTicket } from "./pureservice";
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

const KNOWN_INTENTS = [
  "LoginIssue",
  "ProfileUpdate",
  "MissingPet",
  "PetDeceased",
  "GDPRDelete",
  "GDPRExport",
  "OwnershipTransfer",
  "OwnershipTransferDead",
  "NKKOwnership",
  "OwnershipError",
  "InactiveRegistration",
  "ForeignChip",
  "RegistrationPayment",
  "ActivationIssue",
  "ProductComplaint",
  "QRTagActivation",
  "QRTagLost",
  "TagInactive",
  "ProductReplace",
  "SmartTagIssue",
  "SmartTagConnection",
  "CancelSubscription",
  "UpgradeSubscription",
  "BillingIssue",
  "SubscriptionManagement",
  "LostPetReport",
  "FoundPet",
  "AlertIssue",
  "FamilySharing",
  "FamilyAccessLost",
  "AppLoginIssue",
  "AppSubscriptionInfo",
  "AppSupport",
  "GeneralInquiry",
];

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
  onProgress?: (msg: string, pct: number) => void
): Promise<{ ingested: number; errors: number }> {
  let totalIngested = 0;
  let totalErrors = 0;
  let page = 1;
  const pageSize = 100;
  let hasMore = true;

  onProgress?.("Starter ticket-innhenting fra Pureservice...", 0);

  while (hasMore) {
    try {
      const { tickets, total } = await fetchTicketsFromPureservice(page, pageSize);

      if (tickets.length === 0) {
        hasMore = false;
        break;
      }

      const rawTicketData = tickets.map(mapPureserviceToRawTicket);
      await storage.insertRawTickets(rawTicketData);
      totalIngested += tickets.length;

      const pct = Math.min(100, Math.round((totalIngested / Math.max(total, 1)) * 100));
      onProgress?.(`Hentet ${totalIngested} av ~${total} tickets (side ${page})`, pct);

      if (totalIngested >= total || tickets.length < pageSize) {
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

EKSISTERENDE KATEGORIER: Min side, Eierskifte, Registrering, Produkter - QR Tag, Produkter - Smart Tag, Abonnement, Savnet/Funnet, Familiedeling, App

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

  const intentsStr = KNOWN_INTENTS.map((i) => `- ${i}`).join("\n");

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

KJENTE INTENTS (bruk disse hvis mulig):
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

KJENTE INTENTS (bruk disse hvis mulig):
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

KJENTE INTENTS: ${intentsStr}

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
        const prompt = `Du er en ekspert på å ekstrahere løsningssteg fra support-dialog.

OPPGAVE: Analyser dialogen og ekstraher steg-for-steg løsning.

TICKET:
Intent: ${classification.intent}
Handling: ${classification.requiredAction || "Ukjent"}
Endepunkt: ${classification.actionEndpoint || "Ukjent"}
Nøkkelord: ${classification.keywords || ""}
Runtime-data: ${classification.requiredRuntimeData || ""}
Betaling: ${classification.paymentRequired ? "Ja" : "Nei"}
Begrunnelse: ${classification.reasoning || ""}

INSTRUKSJONER:
1. Identifiser hva kunden trengte
2. Identifiser hva agenten gjorde
3. Ekstraher stegene i løsningen
4. Identifiser hvilke data som ble hentet
5. Identifiser handlinger som ble utført

SVAR I JSON:
{
  "customer_need": "What did customer want to achieve?",
  "data_gathered": "from_customer: mobilnr, dyrenavn; from_system: PetId, PaymentStatus",
  "resolution_steps": "1. Verifiser identitet via OTP; 2. Hent dyrprofil; 3. Utfør handling",
  "success_indicators": "Betaling fullført, Dyr nå søkbart",
  "follow_up_needed": false
}`;

        const text = await callOpenAI(prompt);
        const result = extractJson(text);

        await storage.insertResolutionPattern({
          ticketId: classification.ticketId,
          intent: classification.intent,
          customerNeed: result.customer_need,
          dataGathered: typeof result.data_gathered === "object" ? JSON.stringify(result.data_gathered) : result.data_gathered,
          resolutionSteps: typeof result.resolution_steps === "object" ? JSON.stringify(result.resolution_steps) : result.resolution_steps,
          successIndicators: typeof result.success_indicators === "object" ? JSON.stringify(result.success_indicators) : result.success_indicators,
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
  onProgress?.("Genererer playbook fra klassifiserte intents og løsninger...", 0);

  const categories = await storage.getHjelpesenterCategories();
  const categoryNames = Array.from(new Set(categories.map((c) => c.categoryName))).join(", ");

  const prompt = `Du er en AI-ekspert for DyreID. Basert på dine kunnskaper om kjæledyrregistrering i Norge, generer en komplett Support Playbook med entries for alle kjente support-intents.

For hvert intent, generer en playbook entry med:
- intent: IntentName
- hjelpesenter_category: Kategori
- hjelpesenter_subcategory: Underkategori
- keywords: nøkkelord (kommaseparert)
- required_runtime_data: data som trengs fra MinSide
- primary_action: hovedhandling
- primary_endpoint: API-endepunkt
- resolution_steps: steg-for-steg løsning
- success_indicators: suksessindikatorer
- payment_required_probability: 0.0-1.0
- auto_close_probability: 0.0-1.0

INTENTS:
${KNOWN_INTENTS.join(", ")}

KATEGORIER:
${categoryNames}

Svar som JSON-array av entries.`;

  onProgress?.("Sender forespørsel til AI...", 20);

  const text = await callOpenAI(prompt, "gpt-5-mini", 8192);

  let entries: any[];
  try {
    entries = extractJson(text);
    if (!Array.isArray(entries)) entries = [entries];
  } catch {
    onProgress?.("Feil: Kunne ikke parse playbook fra AI-respons", 100);
    return { entries: 0 };
  }

  onProgress?.(`Mottatt ${entries.length} entries. Lagrer...`, 60);

  let count = 0;
  for (const entry of entries) {
    try {
      await storage.upsertPlaybookEntry({
        intent: entry.intent,
        hjelpesenterCategory: entry.hjelpesenter_category,
        hjelpesenterSubcategory: entry.hjelpesenter_subcategory,
        keywords: entry.keywords,
        requiredRuntimeData: entry.required_runtime_data,
        primaryAction: entry.primary_action,
        primaryEndpoint: entry.primary_endpoint,
        resolutionSteps: entry.resolution_steps,
        successIndicators: entry.success_indicators,
        avgConfidence: entry.avg_confidence || 0.8,
        ticketCount: entry.ticket_count || 0,
        paymentRequiredProbability: entry.payment_required_probability,
        autoCloseProbability: entry.auto_close_probability,
      });
      count++;
    } catch (err: any) {
      log(`Playbook entry error: ${err.message}`, "training");
    }
  }

  onProgress?.(`Playbook generert: ${count} entries`, 100);
  return { entries: count };
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

  await storage.insertResolutionPattern({
    ticketId: ticket.ticketId,
    intent: result.intent || "GeneralInquiry",
    customerNeed: result.customer_need || "",
    dataGathered: typeof result.data_gathered === "object" ? JSON.stringify(result.data_gathered) : (result.data_gathered || ""),
    resolutionSteps: typeof result.resolution_steps === "object" ? JSON.stringify(result.resolution_steps) : (result.resolution_steps || ""),
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

  const intentsStr = KNOWN_INTENTS.join(", ");

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

INTENTS: ${intentsStr}

AUTOSVAR-MALER: ${JSON.stringify(templateSignatures)}

FOR HVER TICKET:
1. KATEGORI: Map til hjelpesenter-kategori/underkategori. "Ukategorisert" hvis ingen passer.
2. INTENT: Klassifiser kundens intent (bruk kjente intents eller foreslå ny).
3. RESOLUSJON: Ekstraher løsningssteg.
4. AUTOSVAR-MATCH: Matcher agentsvaret et autosvar? Oppgi template_id.
5. DIALOG-MØNSTER: "autoresponse_only", "autoresponse_then_resolution", "autoresponse_then_no_resolution", "direct_human_response", eller "no_response"
6. RESOLUSJONS-KVALITET: "high", "medium", "low", eller "none"
7. GENERELL-REKLASSIFISERING: Hvis "Generell e-post", angi egentlig emne.

Svar med JSON: {"tickets": [{"ticket_id":12345,"hjelpesenter_category":"Min Side","hjelpesenter_subcategory":"Innlogging","category_confidence":0.9,"category_reasoning":"...","intent":"LoginIssue","intent_confidence":0.85,"is_new_intent":false,"keywords":"...","required_runtime_data":"","required_action":"","action_endpoint":"","payment_required":false,"auto_close_possible":false,"intent_reasoning":"...","customer_need":"...","resolution_steps":"...","data_gathered":"...","success_indicators":"...","follow_up_needed":false,"matched_template_id":null,"dialog_pattern":"direct_human_response","resolution_quality":"high","original_category_if_general":null}]}`;
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
