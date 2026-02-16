import { storage } from "./storage";
import { INTENT_DEFINITIONS } from "@shared/intents";

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

export async function seedCanonicalIntents(): Promise<{ seeded: number; skipped: number }> {
  let seeded = 0;
  let skipped = 0;
  const seen = new Set<string>();

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
    seeded++;
  }

  return { seeded, skipped };
}

export function getTemplateCategoryMapping() {
  return TEMPLATE_CATEGORY_MAPPING;
}

export function getTemplateIntentIds(): string[] {
  return Object.values(TEMPLATE_CATEGORY_MAPPING).map(m => m.intent);
}
