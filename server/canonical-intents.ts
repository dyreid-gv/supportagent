import { storage } from "./storage";
import { INTENT_DEFINITIONS } from "@shared/intents";
import { generateIntentEmbedding } from "./embeddings";
import { refreshIntentIndex } from "./intent-index";

const TEMPLATE_CATEGORY_MAPPING: Record<number, { category: string; subcategory: string; ticketType: string; intent: string }> = {
  50: { category: "ID-søk", subcategory: "Generelt om ID-søk", ticketType: "Generell henvendelse", intent: "IDSearchHelp" },
  51: { category: "Min Side", subcategory: "Generelt om Min Side", ticketType: "Generell henvendelse", intent: "MinSideHelp" },
  53: { category: "ID-søk", subcategory: "Dyret er ikke søkbart", ticketType: "Kjæledyret mitt er ikke søkbart", intent: "PetNotSearchable" },
  54: { category: "Min Side", subcategory: "Kontakt og varsler", ticketType: "Hvorfor har jeg fått sms/e-post?", intent: "WhyContactReceived" },
  55: { category: "Min Side", subcategory: "Opprette Min Side", ticketType: "Har jeg en Min side?", intent: "DoIHaveMinSide" },
  56: { category: "Min Side", subcategory: "Innlogging", ticketType: "Hvorfor får jeg ikke logget meg inn?", intent: "LoginIssue" },
  57: { category: "Min Side", subcategory: "E-post feilmelding", ticketType: "Feilmelding e-postadresse", intent: "EmailError" },
  58: { category: "Min Side", subcategory: "Telefon feilmelding", ticketType: "Feilmelding telefonnummer", intent: "PhoneError" },
  59: { category: "Min Side", subcategory: "Kontaktinfo", ticketType: "Legge til flere telefonnumre/e-poster", intent: "AddContactInfo" },
  61: { category: "Min Side", subcategory: "Feil i registrering", ticketType: "Det er registrert feil på Min side", intent: "RegistrationError" },
  62: { category: "Min Side", subcategory: "Manglende dyr", ticketType: "Det mangler et dyr på Min side", intent: "MissingPet" },
  63: { category: "Eierskifte", subcategory: "Feil eier", ticketType: "Feil eier ved søk på ID-nr", intent: "WrongOwner" },
  64: { category: "Eierskifte", subcategory: "Pris for eierskifte", ticketType: "Hva koster eierskifte?", intent: "OwnershipTransferCost" },
  65: { category: "Eierskifte", subcategory: "Hvordan gjøre eierskifte", ticketType: "Hvordan foreta eierskifte?", intent: "OwnershipTransferProcess" },
  66: { category: "Utenlandsregistrering", subcategory: "Registrering fra utlandet", ticketType: "Hvordan registrere dyr fra utlandet?", intent: "ForeignRegistrationProcess" },
  67: { category: "Utenlandsregistrering", subcategory: "Pris for registrering", ticketType: "Hva koster registrering fra utlandet?", intent: "ForeignRegistrationCost" },
  68: { category: "ID-merking", subcategory: "Hvorfor ID-merke", ticketType: "Hvorfor bør jeg ID-merke?", intent: "WhyChipPet" },
  69: { category: "Min Side", subcategory: "Sletting", ticketType: "Sletting av Min Side", intent: "AccountDeletion" },
  70: { category: "Annet", subcategory: "Generell henvendelse", ticketType: "Generell e-post til DyreID", intent: "GeneralInquiry" },
  71: { category: "Annet", subcategory: "Gjenåpnet sak", ticketType: "Sak gjenåpnet fra Løst", intent: "ReopenedTicket" },
  132: { category: "Annet", subcategory: "Tilbakemelding", ticketType: "Tilbakemelding/survey", intent: "SurveyFeedback" },
};

export { TEMPLATE_CATEGORY_MAPPING };

export function isUncategorized(ticket: { categoryId?: number | null; category?: string | null }): boolean {
  if (!ticket.categoryId) return true;
  const mapping = TEMPLATE_CATEGORY_MAPPING[ticket.categoryId];
  if (!mapping) return true;
  if (mapping.intent === "GeneralInquiry" || mapping.intent === "ReopenedTicket" || mapping.intent === "SurveyFeedback") return true;
  return false;
}

export async function generateAndStoreEmbedding(intentId: string): Promise<void> {
  const intent = await storage.getCanonicalIntentById(intentId);
  if (!intent) return;
  try {
    const embedding = await generateIntentEmbedding({
      intentId: intent.intentId,
      category: intent.category,
      subcategory: intent.subcategory,
      description: intent.description,
      keywords: intent.keywords,
      infoText: intent.infoText,
    });
    await storage.updateCanonicalIntent(intent.id, { embedding } as any);
  } catch (err: any) {
    console.error(`[Embedding] Failed for ${intentId}:`, err.message);
  }
}

export async function seedCanonicalIntents(): Promise<{ seeded: number; skipped: number; embedded: number }> {
  let seeded = 0;
  let skipped = 0;
  let embedded = 0;
  const seen = new Set<string>();
  const allIntentIds: string[] = [];

  for (const def of INTENT_DEFINITIONS) {
    if (seen.has(def.intent)) { skipped++; continue; }
    seen.add(def.intent);
    await storage.upsertCanonicalIntent({
      intentId: def.intent,
      category: def.category,
      subcategory: def.subcategory,
      source: "HELPCENTER",
      actionable: false,
      approved: true,
      keywords: def.keywords.join(", "),
      description: def.description,
    });
    allIntentIds.push(def.intent);
    seeded++;
  }

  for (const [templateIdStr, mapping] of Object.entries(TEMPLATE_CATEGORY_MAPPING)) {
    if (seen.has(mapping.intent)) {
      const existing = await storage.getCanonicalIntentById(mapping.intent);
      if (existing && existing.source === "HELPCENTER") {
        await storage.updateCanonicalIntent(existing.id, {
          source: "TEMPLATE",
          subcategory: mapping.subcategory,
        });
      }
      skipped++;
      continue;
    }
    seen.add(mapping.intent);
    await storage.upsertCanonicalIntent({
      intentId: mapping.intent,
      category: mapping.category,
      subcategory: mapping.subcategory,
      source: "TEMPLATE",
      actionable: false,
      approved: true,
      description: mapping.ticketType,
    });
    allIntentIds.push(mapping.intent);
    seeded++;
  }

  const playbookEntries = await storage.getPlaybookEntries();
  for (const entry of playbookEntries) {
    if (seen.has(entry.intent)) {
      const existing = await storage.getCanonicalIntentById(entry.intent);
      if (existing) {
        await storage.updateCanonicalIntent(existing.id, {
          actionable: entry.requiresAction || entry.requiresLogin || false,
          endpoint: entry.apiEndpoint || undefined,
          requiredFields: entry.requiredRuntimeDataArray || undefined,
          infoText: entry.combinedResponse || undefined,
        });
      }
      skipped++;
      continue;
    }
    seen.add(entry.intent);
    await storage.upsertCanonicalIntent({
      intentId: entry.intent,
      category: entry.hjelpesenterCategory || "Ukategorisert",
      subcategory: entry.hjelpesenterSubcategory || undefined,
      source: "MANUAL",
      actionable: entry.requiresAction || entry.requiresLogin || false,
      endpoint: entry.apiEndpoint || undefined,
      requiredFields: entry.requiredRuntimeDataArray || undefined,
      infoText: entry.combinedResponse || undefined,
      approved: entry.isActive || false,
      keywords: entry.keywords || undefined,
      description: entry.combinedResponse?.substring(0, 200) || undefined,
    });
    allIntentIds.push(entry.intent);
    seeded++;
  }

  console.log(`[Seed] Generating embeddings for ${allIntentIds.length} intents...`);
  for (const intentId of allIntentIds) {
    try {
      await generateAndStoreEmbedding(intentId);
      embedded++;
    } catch (err: any) {
      console.error(`[Seed] Embedding failed for ${intentId}:`, err.message);
    }
  }

  await refreshIntentIndex();
  console.log(`[Seed] Complete: ${seeded} seeded, ${embedded} embedded, ${skipped} skipped`);

  return { seeded, skipped, embedded };
}

export function getTemplateCategoryMapping() {
  return TEMPLATE_CATEGORY_MAPPING;
}

export function getTemplateIntentIds(): string[] {
  return Object.values(TEMPLATE_CATEGORY_MAPPING).map(m => m.intent);
}

let approvedIntentCache: Set<string> | null = null;
let approvedIntentCacheTime = 0;
const APPROVED_INTENT_CACHE_TTL = 60_000;

export async function getApprovedIntentSet(): Promise<Set<string>> {
  if (approvedIntentCache && Date.now() - approvedIntentCacheTime < APPROVED_INTENT_CACHE_TTL) {
    return approvedIntentCache;
  }
  const approved = await storage.getApprovedCanonicalIntents();
  approvedIntentCache = new Set(approved.map(i => i.intentId));
  approvedIntentCacheTime = Date.now();
  return approvedIntentCache;
}

export function invalidateApprovedIntentCache(): void {
  approvedIntentCache = null;
  approvedIntentCacheTime = 0;
}

export async function validateIntentId(intentId: string): Promise<boolean> {
  const approved = await getApprovedIntentSet();
  return approved.has(intentId);
}

export async function validateRuntimeIntents(runtimeIntentIds: string[]): Promise<{ valid: string[]; invalid: string[] }> {
  const approved = await getApprovedIntentSet();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const id of runtimeIntentIds) {
    if (approved.has(id)) {
      valid.push(id);
    } else {
      invalid.push(id);
    }
  }
  return { valid, invalid };
}

export async function ensureRuntimeIntentsInCanonical(runtimeIntentIds: string[]): Promise<{ migrated: string[]; alreadyExists: string[] }> {
  const approved = await getApprovedIntentSet();
  const migrated: string[] = [];
  const alreadyExists: string[] = [];

  for (const intentId of runtimeIntentIds) {
    if (approved.has(intentId)) {
      alreadyExists.push(intentId);
      continue;
    }
    const def = INTENT_DEFINITIONS.find(d => d.intent === intentId);
    if (def) {
      await storage.upsertCanonicalIntent({
        intentId: def.intent,
        category: def.category,
        subcategory: def.subcategory,
        source: "RUNTIME",
        actionable: false,
        approved: true,
        keywords: def.keywords.join(", "),
        description: def.description,
      });
      try {
        await generateAndStoreEmbedding(def.intent);
      } catch (err: any) {
        console.error(`[Canonical] Embedding failed for migrated intent ${def.intent}:`, err.message);
      }
      migrated.push(intentId);
    } else {
      console.warn(`[Canonical] Runtime intent ${intentId} has no definition in shared/intents.ts — skipping migration`);
    }
  }

  if (migrated.length > 0) {
    invalidateApprovedIntentCache();
    await refreshIntentIndex();
    console.log(`[Canonical] Migrated ${migrated.length} runtime intents: ${migrated.join(", ")}`);
  }

  return { migrated, alreadyExists };
}
