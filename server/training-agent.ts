import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import { scrubTicket } from "./gdpr-scrubber";
import { fetchTicketsFromPureservice, mapPureserviceToRawTicket } from "./pureservice";
import { batchProcess } from "./replit_integrations/batch/utils";
import { log } from "./index";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const HJELPESENTER_CATEGORIES = [
  "Min side",
  "Eierskifte",
  "Registrering",
  "Produkter - QR Tag",
  "Produkter - Smart Tag",
  "Abonnement",
  "Savnet/Funnet",
  "Familiedeling",
  "App",
];

export async function runIngestion(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ ingested: number; errors: number }> {
  let totalIngested = 0;
  let totalErrors = 0;
  let page = 1;
  const pageSize = 50;
  let hasMore = true;

  onProgress?.("Starting ticket ingestion from Pureservice...", 0);

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
      onProgress?.(`Ingested ${totalIngested} of ~${total} tickets`, pct);

      if (totalIngested >= total || tickets.length < pageSize) {
        hasMore = false;
      }
      page++;

      await new Promise((r) => setTimeout(r, 200));
    } catch (err: any) {
      totalErrors++;
      log(`Ingestion error page ${page}: ${err.message}`, "training");
      if (totalErrors > 5) {
        hasMore = false;
      }
      page++;
    }
  }

  onProgress?.(`Ingestion complete: ${totalIngested} tickets, ${totalErrors} errors`, 100);
  return { ingested: totalIngested, errors: totalErrors };
}

export async function runGdprScrubbing(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ scrubbed: number; errors: number }> {
  const batchSize = 100;
  let totalScrubbed = 0;
  let totalErrors = 0;

  onProgress?.("Starting GDPR scrubbing...", 0);

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

    const rawCount = await storage.getRawTicketCount();
    const pct = Math.round((totalScrubbed / Math.max(rawCount, 1)) * 100);
    onProgress?.(`Scrubbed ${totalScrubbed} tickets`, pct);
  }

  onProgress?.(`Scrubbing complete: ${totalScrubbed} tickets, ${totalErrors} errors`, 100);
  return { scrubbed: totalScrubbed, errors: totalErrors };
}

export async function runCategoryMapping(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ mapped: number; errors: number }> {
  const batchSize = 10;
  let totalMapped = 0;
  let totalErrors = 0;

  onProgress?.("Starting category mapping...", 0);

  const categories = await storage.getHjelpesenterCategories();
  const categoryList = categories
    .map((c) => `${c.categoryName} > ${c.subcategoryName}: ${c.description}`)
    .join("\n");

  while (true) {
    const unmapped = await storage.getUnmappedScrubbedTickets(batchSize);
    if (unmapped.length === 0) break;

    const results = await batchProcess(
      unmapped,
      async (ticket) => {
        const prompt = `Du er en AI-assistent for DyreID, Norges nasjonale kjæledyrregister. Klassifiser denne support-ticketen til riktig hjelpesenter-kategori.

TILGJENGELIGE KATEGORIER:
${categoryList}

TICKET:
Emne: ${ticket.subject || "Ingen"}
Kundespørsmål: ${ticket.customerQuestion || "Ingen"}
Agentsvar: ${ticket.agentAnswer || "Ingen"}
Opprinnelig kategori: ${ticket.category || "Ingen"}

Svar i JSON-format:
{
  "hjelpesenter_category": "kategoriNavn",
  "hjelpesenter_subcategory": "underkategoriNavn",
  "confidence": 0.0-1.0,
  "reasoning": "kort begrunnelse"
}`;

        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        });

        const text = response.content[0].type === "text" ? response.content[0].text : "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON in response");

        return JSON.parse(jsonMatch[0]);
      },
      { concurrency: 2, retries: 3 }
    );

    for (let i = 0; i < unmapped.length; i++) {
      const ticket = unmapped[i];
      const result = results[i];
      if (result && result.hjelpesenter_category) {
        try {
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
        }
      } else {
        totalErrors++;
      }
    }

    onProgress?.(`Mapped ${totalMapped} tickets`, 50);
  }

  onProgress?.(`Category mapping complete: ${totalMapped}, ${totalErrors} errors`, 100);
  return { mapped: totalMapped, errors: totalErrors };
}

export async function runIntentClassification(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ classified: number; errors: number }> {
  const batchSize = 10;
  let totalClassified = 0;
  let totalErrors = 0;

  onProgress?.("Starting intent classification...", 0);

  while (true) {
    const unclassified = await storage.getUnclassifiedScrubbedTickets(batchSize);
    if (unclassified.length === 0) break;

    const results = await batchProcess(
      unclassified,
      async (ticket) => {
        const prompt = `Du er en AI-ekspert for DyreID support. Analyser denne ticketen og identifiser kundens intent, nødvendig handling, og om saken kan løses automatisk.

TICKET:
Kategori: ${ticket.hjelpesenterCategory || ticket.category || "Ukjent"}
Underkategori: ${ticket.hjelpesenterSubcategory || "Ukjent"}
Emne: ${ticket.subject || "Ingen"}
Kundespørsmål: ${ticket.customerQuestion || "Ingen"}
Agentsvar: ${ticket.agentAnswer || "Ingen"}
Løsning: ${ticket.resolution || "Ingen"}

KJENTE INTENTS:
- OwnershipTransfer (eierskifte)
- RegistrationPayment (registreringsbetaling)
- RegistrationInactive (registrering ikke aktiv)
- QRTagActivation (aktivere QR-brikke)
- QRTagLost (mistet QR-brikke)
- SmartTagConnection (Smart Tag tilkobling)
- LostPetReport (melde dyr savnet)
- FoundPet (dyr funnet igjen)
- ProfileUpdate (oppdatere profil)
- LoginHelp (hjelp med innlogging)
- SubscriptionManagement (abonnement)
- FamilySharing (familiedeling)
- ForeignRegistration (utenlandsregistrering)
- AnimalDeceased (dyr død)
- GDPRRequest (GDPR forespørsel)
- AppSupport (app-hjelp)
- GeneralInquiry (generelt spørsmål)

Svar i JSON:
{
  "intent": "IntentName",
  "intent_confidence": 0.0-1.0,
  "is_new_intent": false,
  "keywords": "nøkkelord1, nøkkelord2",
  "required_runtime_data": "owner_profile, animals, tags",
  "required_action": "kort beskrivelse av handling",
  "action_endpoint": "/api/endpoint",
  "payment_required": false,
  "auto_close_possible": false,
  "reasoning": "kort begrunnelse"
}`;

        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        });

        const text = response.content[0].type === "text" ? response.content[0].text : "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON in response");

        return JSON.parse(jsonMatch[0]);
      },
      { concurrency: 2, retries: 3 }
    );

    for (let i = 0; i < unclassified.length; i++) {
      const ticket = unclassified[i];
      const result = results[i];
      if (result && result.intent) {
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
          totalClassified++;
        } catch (err: any) {
          totalErrors++;
        }
      } else {
        totalErrors++;
      }
    }

    onProgress?.(`Classified ${totalClassified} tickets`, 50);
  }

  onProgress?.(`Intent classification complete: ${totalClassified}, ${totalErrors} errors`, 100);
  return { classified: totalClassified, errors: totalErrors };
}

export async function runResolutionExtraction(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ extracted: number; errors: number }> {
  const batchSize = 10;
  let totalExtracted = 0;
  let totalErrors = 0;

  onProgress?.("Starting resolution extraction...", 0);

  while (true) {
    const unextracted = await storage.getClassifiedTicketsWithoutResolution(batchSize);
    if (unextracted.length === 0) break;

    for (const classification of unextracted) {
      try {
        const prompt = `Du er en AI-ekspert for DyreID. Basert på denne klassifiserte ticketen, ekstraher løsningsmønsteret.

TICKET:
Intent: ${classification.intent}
Handling: ${classification.requiredAction || "Ukjent"}
Endepunkt: ${classification.actionEndpoint || "Ukjent"}
Betaling: ${classification.paymentRequired ? "Ja" : "Nei"}
Auto-lukking: ${classification.autoClosePossible ? "Ja" : "Nei"}
Begrunnelse: ${classification.reasoning || ""}

Svar i JSON:
{
  "customer_need": "kort beskrivelse av kundens behov",
  "data_gathered": "hvilke data som trengs fra kunde/system",
  "resolution_steps": "steg 1, steg 2, steg 3",
  "success_indicators": "hvordan vet vi at saken er løst",
  "follow_up_needed": false
}`;

        const response = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        });

        const text = response.content[0].type === "text" ? response.content[0].text : "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) continue;

        const result = JSON.parse(jsonMatch[0]);

        await storage.insertResolutionPattern({
          ticketId: classification.ticketId,
          intent: classification.intent,
          customerNeed: result.customer_need,
          dataGathered: result.data_gathered,
          resolutionSteps: result.resolution_steps,
          successIndicators: result.success_indicators,
          followUpNeeded: result.follow_up_needed || false,
        });

        totalExtracted++;
      } catch (err: any) {
        totalErrors++;
        log(`Resolution extraction error: ${err.message}`, "training");
      }
    }

    onProgress?.(`Extracted ${totalExtracted} resolution patterns`, 50);
  }

  onProgress?.(`Resolution extraction complete: ${totalExtracted}, ${totalErrors} errors`, 100);
  return { extracted: totalExtracted, errors: totalErrors };
}

export async function runPlaybookGeneration(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ entries: number }> {
  onProgress?.("Generating playbook from classified intents and resolutions...", 0);

  const prompt = `Du er en AI-ekspert for DyreID. Basert på dine kunnskaper om kjæledyrregistrering i Norge, generer en Support Playbook med entries for alle kjente support-intents.

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
OwnershipTransfer, RegistrationPayment, RegistrationInactive, QRTagActivation, QRTagLost, SmartTagConnection, LostPetReport, FoundPet, ProfileUpdate, LoginHelp, SubscriptionManagement, FamilySharing, ForeignRegistration, AnimalDeceased, GDPRRequest, AppSupport, GeneralInquiry

KATEGORIER:
Min side, Eierskifte, Registrering, Produkter - QR Tag, Produkter - Smart Tag, Abonnement, Savnet/Funnet, Familiedeling, App

Svar som JSON-array av entries.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    onProgress?.("Failed to generate playbook", 100);
    return { entries: 0 };
  }

  const entries = JSON.parse(jsonMatch[0]);
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

  onProgress?.(`Playbook generated: ${count} entries`, 100);
  return { entries: count };
}
