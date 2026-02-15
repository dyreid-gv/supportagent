import OpenAI from "openai";
import { INTENTS, INTENT_DEFINITIONS, INTENT_BY_NAME } from "@shared/intents";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { getMinSideContext, performAction, lookupOwnerByPhone } from "./minside-sandbox";
import { getStoredSession } from "./minside-client";
import { messages, type PlaybookEntry, type ServicePrice, type ResponseTemplate } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface SessionState {
  intent?: string;
  playbook?: PlaybookEntry;
  collectedData: Record<string, any>;
  awaitingInput?: string;
  selectedPetId?: string;
  selectedPetName?: string;
}

const sessionStates = new Map<number, SessionState>();

function getOrCreateSession(conversationId: number): SessionState {
  if (!sessionStates.has(conversationId)) {
    sessionStates.set(conversationId, { collectedData: {} });
  }
  return sessionStates.get(conversationId)!;
}

function clearSession(conversationId: number) {
  sessionStates.delete(conversationId);
}

interface IntentQuickMatch {
  intent: string;
  regex: RegExp;
}

const INTENT_PATTERNS: IntentQuickMatch[] = [
  // ── ID-søk ──────────────────────────────────────────────
  { intent: "WhyIDMark", regex: /hvorfor.*id.?merk|bør.*merke|fordel.*chip/i },
  { intent: "CheckContactData", regex: /kontrollere.*kontaktdata|kontaktdata.*riktig|sjekke.*chip/i },
  { intent: "InactiveRegistration", regex: /ikke søkbar|søkbar|inaktiv.*registr/i },

  // ── DyreID-appen ────────────────────────────────────────
  { intent: "AppAccess", regex: /laste ned.*app|installere.*app|tilgang.*app/i },
  { intent: "AppLoginIssue", regex: /app.*logg inn|innlogging.*app|login.*app/i },
  { intent: "AppBenefits", regex: /hvorfor.*app|fordeler.*app|app.*funksjoner/i },
  { intent: "AppTargetAudience", regex: /hvem.*passer.*app|app.*for meg|passer.*appen/i },
  { intent: "SubscriptionComparison", regex: /basis.*plus|dyreID\+|forskjell.*abonnement|sammenlign/i },
  { intent: "AppCost", regex: /koster.*app|app.*gratis|pris.*app/i },
  { intent: "AppMinSide", regex: /min side.*app|app.*min side|profil.*appen/i },

  // ── Min side ────────────────────────────────────────────
  { intent: "LoginIssue", regex: /logg inn|passord|bankid|innlogg/i },
  { intent: "SMSEmailNotification", regex: /hvorfor.*sms|hvorfor.*e-?post|fått melding|fått varsel/i },
  { intent: "ProfileVerification", regex: /har jeg.*min side|finnes.*profil|eksisterer.*konto/i },
  { intent: "LoginProblem", regex: /får ikke logget|kan ikke logge|innlogging feiler/i },
  { intent: "EmailError", regex: /feilmelding.*e-?post|ugyldig.*e-?post|feil.*epost/i },
  { intent: "PhoneError", regex: /feilmelding.*telefon|ugyldig.*nummer|feil.*telefon/i },
  { intent: "AddContactInfo", regex: /legge til.*telefon|legge til.*e-?post|flere.*nummer|flere.*kontakt/i },
  { intent: "WrongInfo", regex: /feil informasjon|feil.*registrert|korrigere|endre.*opplysning/i },
  { intent: "MissingPetProfile", regex: /mangler.*dyr|mangler.*kjæledyr|vises ikke.*min side|dyr.*borte.*profil/i },
  { intent: "PetDeceased", regex: /dødt|avdød|avlivet|bortgang|kjæledyr.*død/i },
  { intent: "GDPRDelete", regex: /slett meg|slette.*konto|gdpr.*slett|fjerne.*profil/i },
  { intent: "GDPRExport", regex: /eksporter.*data|mine data|gdpr.*eksport|personvern.*data/i },
  { intent: "ViewMyPets", regex: /mine dyr|se dyr|dyrene mine|hvilke dyr|vis dyr/i },

  // ── Eierskifte ──────────────────────────────────────────
  { intent: "OwnershipTransferApp", regex: /eierskifte.*app|app.*eierskift/i },
  { intent: "OwnershipTransferCost", regex: /kost.*eierskift|pris.*eierskift|eierskift.*kost/i },
  { intent: "OwnershipTransferWeb", regex: /eierskift|selge|solgt|ny eier|overfør|kjøpt/i },
  { intent: "OwnershipTransferDead", regex: /eier.*død|dødsfall.*eier|arv.*dyr/i },
  { intent: "NKKOwnership", regex: /nkk|norsk kennel|stambokført|rasehund.*eierskift/i },

  // ── Smart Tag ───────────────────────────────────────────
  { intent: "SmartTagActivation", regex: /aktivere.*smart.?tag|smart.?tag.*aktivere|sette opp.*smart/i },
  { intent: "SmartTagQRActivation", regex: /qr.*smart.?tag|smart.?tag.*qr.*aktiver/i },
  { intent: "SmartTagConnection", regex: /koble.*smart.?tag|smart.?tag.*kobl|bluetooth.*tag|kan ikke koble/i },
  { intent: "SmartTagMissing", regex: /finner ikke.*smart.?tag|smart.?tag.*forsvunnet|tag.*borte/i },
  { intent: "SmartTagPosition", regex: /posisjon.*oppdater|gps.*smart.?tag|sporing.*fungerer/i },
  { intent: "SmartTagSound", regex: /tag.*lyd|lyder.*tag|piper.*tag|smart.?tag.*bråk/i },
  { intent: "SmartTagMultiple", regex: /flere.*tag|bare.*en.*tag|smart.?tag.*flere/i },

  // ── QR-brikke ───────────────────────────────────────────
  { intent: "QRCompatibility", regex: /qr.*hund.*katt|passer.*qr.*brikke|kompatib.*qr/i },
  { intent: "QRRequiresIDMark", regex: /må.*id.?merk.*qr|qr.*krav.*chip|id.?merket.*brikke/i },
  { intent: "QRPricingModel", regex: /qr.*abonnement.*engang|engangskostnad.*qr|qr.*prismodell/i },
  { intent: "QRTagActivation", regex: /aktivere.*qr|qr.?brikke.*aktiver|skann.*brikke/i },
  { intent: "QRTagContactInfo", regex: /kontaktinfo.*qr|synlig.*kontakt.*skann|hvem ser.*qr/i },
  { intent: "QRScanResult", regex: /hva skjer.*skann|skanne.*qr.*resultat|skann.*kode/i },
  { intent: "QRUpdateContact", regex: /oppdatere.*kontakt.*qr|endre.*info.*brikke|qr.*kontakt.*endre/i },
  { intent: "QRBenefits", regex: /fordel.*qr|qr.*brikke.*nytte|hvorfor.*qr/i },
  { intent: "QRTagLost", regex: /mistet.*tag|mistet.*brikke|tapt.*qr|erstatte.*brikke/i },
  { intent: "TagSubscriptionExpiry", regex: /utløper.*abonnement|abonnement.*utløp|tag.*inaktiv/i },

  // ── Utenlandsregistrering ───────────────────────────────
  { intent: "ForeignRegistration", regex: /registrere.*norge|utenlands.*registrer|importert.*dyr/i },
  { intent: "ForeignRegistrationCost", regex: /kost.*registrer|pris.*registrer|registrer.*kost|676/i },
  { intent: "ForeignPedigree", regex: /stamtavle.*utenlandsk|utenlandsk.*stamtavle|pedigree/i },

  // ── Savnet/Funnet ───────────────────────────────────────
  { intent: "ReportLostPet", regex: /savnet|mistet.*dyr|borte|forsvunnet|melde.*savnet/i },
  { intent: "ReportFoundPet", regex: /funnet.*dyr|kommet til rette|funnet.*kjæledyr/i },
  { intent: "LostFoundInfo", regex: /savnet.*funnet.*fungerer|hvordan.*savnet.*funnet/i },
  { intent: "SearchableInfo", regex: /søkbar.*1-?2-?3|hvordan.*søkbar/i },
  { intent: "SearchableMisuse", regex: /misbruk.*søkbar|søkbar.*misbruk|sikkerhet.*søkbar/i },

  // ── Familiedeling ───────────────────────────────────────
  { intent: "FamilySharingBenefits", regex: /hvorfor.*familiedeling|fordel.*familiedeling/i },
  { intent: "FamilySharingNonFamily", regex: /dele.*andre.*enn.*familie|venner.*dele|ikke.*familie.*dele/i },
  { intent: "FamilySharingRequirement", regex: /trenger.*dyreID\+.*familie|krav.*familiedeling/i },
  { intent: "FamilySharingRequest", regex: /forespørsel.*akseptert|invitasjon.*familie|venter.*familie/i },
  { intent: "FamilySharing", regex: /familie.*del|del.*tilgang|familiemedlem/i },
  { intent: "FamilySharingPermissions", regex: /rettigheter.*deling|kan.*deling.*endre|tillatelser.*familie/i },
  { intent: "FamilyAccessLost", regex: /ser ikke.*delt|mistet.*tilgang.*deling|familie.*borte/i },
  { intent: "FamilySharingExisting", regex: /familiedeling.*eksisterende|deling.*allerede.*kjæledyr/i },

  // ── Generell ────────────────────────────────────────────
  { intent: "GeneralInquiry", regex: /generell|hjelp med|lurer på|spørsmål om/i },
];

function quickIntentMatch(message: string): string | null {
  for (const p of INTENT_PATTERNS) {
    if (p.regex.test(message)) return p.intent;
  }
  return null;
}

function extractDataFromMessage(message: string, requiredFields: string[] | null): Record<string, any> {
  if (!requiredFields || requiredFields.length === 0) return {};
  const extracted: Record<string, any> = {};

  const phoneMatch = message.match(/\b(\d{8})\b/);
  if (phoneMatch && (requiredFields.includes("newOwnerPhone") || requiredFields.includes("phone"))) {
    extracted["newOwnerPhone"] = phoneMatch[1];
    extracted["phone"] = phoneMatch[1];
  }

  const tagMatch = message.match(/TAG-(\d+)/i);
  if (tagMatch && requiredFields.includes("tagId")) {
    extracted["tagId"] = `TAG-${tagMatch[1]}`;
  }

  return extracted;
}

function hasAllRequiredData(extractedData: Record<string, any>, requiredFields: string[] | null): boolean {
  if (!requiredFields || requiredFields.length === 0) return true;
  return requiredFields.every(field => extractedData[field]);
}

interface ChatbotResponse {
  text: string;
  suggestions?: { label: string; action: string; data?: any }[];
  actionExecuted?: boolean;
  actionType?: string;
  actionSuccess?: boolean;
  requiresLogin?: boolean;
  model: string;
  requestFeedback?: boolean;
  helpCenterLink?: string | null;
}

async function executePlaybookAction(
  playbook: PlaybookEntry,
  ownerId: string,
  collectedData: Record<string, any>,
  ownerContext: any
): Promise<ChatbotResponse> {
  const intent = playbook.intent;

  if (intent === "OwnershipTransfer") {
    const animalId = collectedData.petId || collectedData.animalId;
    const newOwnerPhone = collectedData.newOwnerPhone;
    if (!animalId || !newOwnerPhone) {
      return { text: "Mangler data for eierskifte.", model: "action-error" };
    }
    const result = performAction(ownerId, "initiate_transfer", { animalId, newOwnerPhone });
    if (result.success) {
      const petName = collectedData.petName || animalId;
      const paymentNote = playbook.paymentRequired
        ? ` Betalingslink${playbook.paymentAmount ? ` (${playbook.paymentAmount})` : ""} sendes til ny eier.`
        : "";
      return {
        text: `Eierskifte er startet for ${petName}!\n\nNy eier (${newOwnerPhone}) far SMS med bekreftelseslenke.${paymentNote}\n\nNar begge bekrefter, fulleres eierskiftet. Tidslinje: 1-2 virkedager.`,
        actionExecuted: true,
        actionType: "OWNERSHIP_TRANSFER",
        actionSuccess: true,
        requestFeedback: true,
        model: "action-execution",
      };
    }
    return {
      text: `Kunne ikke starte eierskifte: ${result.message}. Prv igjen eller kontakt support pa support@dyreid.no.`,
      actionExecuted: true,
      actionSuccess: false,
      model: "action-execution-failed",
    };
  }

  if (intent === "ReportLostPet") {
    const animalId = collectedData.petId || collectedData.animalId;
    if (!animalId) {
      return { text: "Mangler dyre-ID for a melde savnet.", model: "action-error" };
    }
    const result = performAction(ownerId, "mark_lost", { animalId });
    if (result.success) {
      return {
        text: `${collectedData.petName || "Dyret"} er na meldt savnet! SMS-varsling og push-varsler er aktivert. Naboer i omradet vil ogsa bli varslet.\n\nTips: Del gjerne savnet-oppslaget pa sosiale medier for ekstra rekkevidde.`,
        actionExecuted: true,
        actionType: "MARK_LOST",
        actionSuccess: true,
        requestFeedback: true,
        model: "action-execution",
      };
    }
    return {
      text: `Kunne ikke melde savnet: ${result.message}`,
      actionExecuted: true,
      actionSuccess: false,
      model: "action-execution-failed",
    };
  }

  if (intent === "ReportFoundPet") {
    const animalId = collectedData.petId || collectedData.animalId;
    if (!animalId) {
      return { text: "Mangler dyre-ID.", model: "action-error" };
    }
    const result = performAction(ownerId, "mark_found", { animalId });
    if (result.success) {
      return {
        text: `${collectedData.petName || "Dyret"} er markert som funnet! Savnet-varslingen er deaktivert. Sa flott at dere fant hverandre igjen!`,
        actionExecuted: true,
        actionType: "MARK_FOUND",
        actionSuccess: true,
        requestFeedback: true,
        model: "action-execution",
      };
    }
    return {
      text: `Kunne ikke markere som funnet: ${result.message}`,
      actionExecuted: true,
      actionSuccess: false,
      model: "action-execution-failed",
    };
  }

  if (intent === "QRTagActivation" || intent === "ActivateQRTag") {
    const tagId = collectedData.tagId;
    if (!tagId) {
      return { text: "Mangler tag-ID for aktivering.", model: "action-error" };
    }
    const result = performAction(ownerId, "activate_qr", { tagId });
    if (result.success) {
      return {
        text: `QR Tag (${tagId}) er na aktivert! Taggen er koblet til dyret ditt og abonnementet er startet.\n\nDu kan na skanne taggen med DyreID-appen eller et vanlig kamera.`,
        actionExecuted: true,
        actionType: "ACTIVATE_QR",
        actionSuccess: true,
        requestFeedback: true,
        model: "action-execution",
      };
    }
    return {
      text: `Kunne ikke aktivere tag: ${result.message}`,
      actionExecuted: true,
      actionSuccess: false,
      model: "action-execution-failed",
    };
  }

  if (intent === "SubscriptionManagement" || intent === "RenewSubscription") {
    const tagId = collectedData.tagId;
    if (!tagId) {
      return { text: "Mangler tag-ID for fornyelse.", model: "action-error" };
    }
    const result = performAction(ownerId, "renew_subscription", { tagId });
    if (result.success) {
      return {
        text: `Abonnement for tag ${tagId} er fornyet! Betalingslink er sendt via SMS.`,
        actionExecuted: true,
        actionType: "RENEW_SUBSCRIPTION",
        actionSuccess: true,
        requestFeedback: true,
        model: "action-execution",
      };
    }
    return {
      text: `Kunne ikke fornye abonnement: ${result.message}`,
      actionExecuted: true,
      actionSuccess: false,
      model: "action-execution-failed",
    };
  }

  return {
    text: playbook.combinedResponse || playbook.resolutionSteps || "Jeg kan hjelpe deg med dette, men denne handlingen er ikke tilgjengelig automatisk enna. Kontakt support pa support@dyreid.no.",
    model: "playbook-fallback",
  };
}

function guideDataCollection(
  playbook: PlaybookEntry,
  session: SessionState,
  ownerContext: any | null,
  storedUserContext: any | null,
  isAuthenticated: boolean
): ChatbotResponse | null {
  if (playbook.requiresLogin && !isAuthenticated) {
    return {
      text: `For a hjelpe deg med ${playbook.primaryAction || playbook.intent}, ma du logge inn forst. Trykk pa "Logg inn (OTP)"-knappen overst for a identifisere deg.`,
      requiresLogin: true,
      suggestions: [{ label: "Logg inn med OTP", action: "REQUEST_LOGIN" }],
      model: "playbook-guide-login",
    };
  }

  const requiredFields = playbook.requiredRuntimeDataArray || [];
  const missingFields = requiredFields.filter(f => !session.collectedData[f]);

  if (missingFields.includes("petId") || missingFields.includes("animalId")) {
    const animals = ownerContext?.animals || storedUserContext?.Pets || [];
    if (animals.length > 1) {
      const suggestions = animals.map((a: any) => ({
        label: `${a.name || a.Name} (${a.species || a.Species || ""})`,
        action: "SELECT_PET",
        data: { petId: a.animalId || a.AnimalId || a.PetId || a.petId, petName: a.name || a.Name },
      }));
      return {
        text: "Hvilket dyr gjelder dette?",
        suggestions,
        model: "playbook-guide-select-pet",
      };
    } else if (animals.length === 1) {
      const pet = animals[0];
      const petId = pet.animalId || pet.AnimalId || pet.PetId || pet.petId;
      session.collectedData["petId"] = petId;
      session.collectedData["animalId"] = petId;
      session.collectedData["petName"] = pet.name || pet.Name;
    }
  }

  if (missingFields.includes("newOwnerPhone") && !session.collectedData["newOwnerPhone"]) {
    session.awaitingInput = "newOwnerPhone";
    return {
      text: "Hva er ny eiers mobilnummer? (8 siffer)",
      model: "playbook-guide-collect-phone",
    };
  }

  if (missingFields.includes("tagId") && !session.collectedData["tagId"]) {
    const tags = ownerContext?.tags || [];
    if (tags.length > 0) {
      const suggestions = tags.map((t: any) => ({
        label: `${t.type.toUpperCase()} Tag (${t.tagId})${t.assignedAnimalName ? ` - ${t.assignedAnimalName}` : ""}`,
        action: "SELECT_TAG",
        data: { tagId: t.tagId },
      }));
      return {
        text: "Hvilken tag gjelder det?",
        suggestions,
        model: "playbook-guide-select-tag",
      };
    }
    session.awaitingInput = "tagId";
    return {
      text: "Hva er tag-IDen? (f.eks. TAG-001)",
      model: "playbook-guide-collect-tag",
    };
  }

  return null;
}

function generateSuggestions(playbook: PlaybookEntry): { label: string; action: string; data?: any }[] {
  const suggestions: { label: string; action: string; data?: any }[] = [];
  if (playbook.requiresLogin) {
    suggestions.push({ label: "Logg inn", action: "REQUEST_LOGIN" });
  }
  if (playbook.helpCenterArticleUrl) {
    suggestions.push({ label: "Les mer", action: "OPEN_ARTICLE", data: { url: playbook.helpCenterArticleUrl } });
  }
  return suggestions;
}

function buildSystemPrompt(
  playbook: PlaybookEntry[],
  ownerContext: any | null,
  storedUserContext: any | null,
  prices: ServicePrice[] = [],
  templates: ResponseTemplate[] = [],
  matchedPlaybook?: PlaybookEntry | null
): string {
  const isAuthenticated = !!(ownerContext || storedUserContext);

  let prompt = `Du er DyreID sin intelligente support-assistent. DyreID er Norges nasjonale kjaeledyrregister.

VIKTIG FILOSOFI:
- UTFOR handlinger for kunden nar mulig (beste!)
- VEILED gjennom prosessen steg-for-steg
- Gi KONKRETE instruksjoner fra playbook
- INFORMER kun som siste utvei
- ALDRI: "Les denne artikkelen" - ALLTID: Gi konkret hjelp direkte

REGLER:
- Svar ALLTID pa norsk
- Vaer hjelpsom, profesjonell og vennlig
- Ikke avslor personlig informasjon som ikke tilhorer den innloggede brukeren
- Nar handlinger krever autentisering, be kunden logge inn via OTP
- Forklar tydelig hva du gjor og hvorfor
- Bruk informasjon fra playbook-entries til a gi presise svar

KUNDEN ER ${isAuthenticated ? "INNLOGGET" : "IKKE INNLOGGET"}

HANDLINGER DU KAN UTFORE (etter autentisering):
- Vise kundens dyr og profil
- Melde dyr savnet/funnet
- Aktivere QR-brikke
- Starte eierskifte
- Sende betalingslink
- Oppdatere profilinformasjon
- Fornye abonnement

Nar du identifiserer at en handling er nodvendig, inkluder en ACTION-blokk i svaret ditt:
[ACTION: action_name | param1=value1 | param2=value2]

Gyldige actions:
- [ACTION: request_auth] - Be kunden logge inn
- [ACTION: mark_lost | animalId=X]
- [ACTION: mark_found | animalId=X]
- [ACTION: activate_qr | tagId=X]
- [ACTION: initiate_transfer | animalId=X | newOwnerPhone=X]
- [ACTION: send_payment_link | paymentType=X]
- [ACTION: update_profile | field=value]
- [ACTION: renew_subscription | tagId=X]
`;

  if (matchedPlaybook) {
    prompt += "\n\nMATCHET PLAYBOOK ENTRY (bruk dette som primaerkilde for svaret):\n";
    prompt += `Intent: ${matchedPlaybook.intent}\n`;
    prompt += `Kategori: ${matchedPlaybook.hjelpesenterCategory || ""} > ${matchedPlaybook.hjelpesenterSubcategory || ""}\n`;
    if (matchedPlaybook.combinedResponse) {
      prompt += `Anbefalt svar: ${matchedPlaybook.combinedResponse}\n`;
    }
    if (matchedPlaybook.resolutionSteps) {
      prompt += `Losningssteg: ${matchedPlaybook.resolutionSteps}\n`;
    }
    if (matchedPlaybook.officialProcedure && matchedPlaybook.officialProcedure.length > 0) {
      prompt += `Offisiell prosedyre: ${matchedPlaybook.officialProcedure.join(" -> ")}\n`;
    }
    if (matchedPlaybook.actionType && matchedPlaybook.actionType !== "INFO_ONLY") {
      prompt += `Handlingstype: ${matchedPlaybook.actionType}\n`;
    }
    if (matchedPlaybook.paymentRequired) {
      prompt += `Betaling pakrevd: Ja${matchedPlaybook.paymentAmount ? ` (${matchedPlaybook.paymentAmount})` : ""}\n`;
    }
    if (matchedPlaybook.helpCenterArticleTitle) {
      prompt += `Relevant artikkel: ${matchedPlaybook.helpCenterArticleTitle}\n`;
    }
    prompt += "\nBRUK DENNE INFORMASJONEN til a gi et presist, hjelpsomt svar. Ikke bare referer til artikkelen - gi svaret direkte.\n";
  } else if (playbook.length > 0) {
    prompt += "\n\nSUPPORT PLAYBOOK (oversikt over kjente intents):\n";
    for (const entry of playbook.slice(0, 20)) {
      prompt += `\n- ${entry.intent}: ${entry.primaryAction || ""}`;
      if (entry.keywords) prompt += ` [${entry.keywords}]`;
    }
  }

  if (prices.length > 0) {
    prompt += "\n\nGJELDENDE PRISER (oppdatert av admin, bruk ALLTID disse prisene i svar):\n";
    for (const p of prices) {
      prompt += `- ${p.serviceName}: ${p.price === 0 ? "Gratis" : `${p.price} ${p.currency}`}`;
      if (p.description) prompt += ` (${p.description})`;
      prompt += "\n";
    }
    prompt += "\nVIKTIG: Bruk KUN prisene listet over. Ikke oppgi priser du er usikker pa.\n";
  }

  if (templates.length > 0) {
    prompt += "\n\nAUTOSVAR-MALER (bruk disse som grunnlag for svar):\n";
    for (const t of templates.slice(0, 15)) {
      prompt += `- ${t.name}`;
      if (t.intent) prompt += ` [${t.intent}]`;
      if (t.keyPoints && Array.isArray(t.keyPoints) && (t.keyPoints as string[]).length > 0) {
        prompt += `: ${(t.keyPoints as string[]).slice(0, 3).join("; ")}`;
      }
      prompt += "\n";
    }
  }

  if (ownerContext) {
    prompt += "\n\nINNLOGGET BRUKER KONTEKST (fra sandbox):\n";
    prompt += `Eier: ${ownerContext.owner.firstName} ${ownerContext.owner.lastName}\n`;
    prompt += `Telefon: ${ownerContext.owner.phone}\n`;
    prompt += `E-post: ${ownerContext.owner.email}\n`;

    if (ownerContext.animals.length > 0) {
      prompt += "\nDyr:\n";
      for (const animal of ownerContext.animals) {
        prompt += `- ${animal.name} (${animal.species}, ${animal.breed}) - ID: ${animal.animalId}, Status: ${animal.status}, Betaling: ${animal.paymentStatus}, Chip: ${animal.chipNumber}\n`;
      }
    }

    if (ownerContext.ownerships.length > 0) {
      prompt += "\nEierskap:\n";
      for (const o of ownerContext.ownerships) {
        prompt += `- ${o.animalName}: ${o.role}${o.pendingTransfer ? " (eierskifte pagar)" : ""}\n`;
      }
    }

    if (ownerContext.tags.length > 0) {
      prompt += "\nTags:\n";
      for (const tag of ownerContext.tags) {
        prompt += `- ${tag.type.toUpperCase()} Tag (${tag.tagId}): ${tag.activated ? "Aktiv" : "Ikke aktivert"}, Abonnement: ${tag.subscriptionStatus}${tag.assignedAnimalName ? `, Tildelt: ${tag.assignedAnimalName}` : ""}\n`;
      }
    }

    if (ownerContext.lostStatuses.some((l: any) => l.lost)) {
      prompt += "\nSavnede dyr:\n";
      for (const l of ownerContext.lostStatuses.filter((l: any) => l.lost)) {
        prompt += `- ${l.animalName}: Meldt savnet ${l.lostDate}\n`;
      }
    }

    if (ownerContext.pendingActions) {
      const pa = ownerContext.pendingActions;
      if (pa.pendingPayments > 0 || pa.pendingTransfers > 0 || pa.inactiveTags > 0 || pa.missingProfileData.length > 0) {
        prompt += "\nVentende handlinger:\n";
        if (pa.pendingPayments > 0) prompt += `- ${pa.pendingPayments} ubetalte registreringer\n`;
        if (pa.pendingTransfers > 0) prompt += `- ${pa.pendingTransfers} pagaende eierskifter\n`;
        if (pa.inactiveTags > 0) prompt += `- ${pa.inactiveTags} ikke-aktiverte tags\n`;
        if (pa.missingProfileData.length > 0) prompt += `- Manglende data: ${pa.missingProfileData.join(", ")}\n`;
      }
    }
  } else if (storedUserContext) {
    prompt += "\n\nINNLOGGET BRUKER KONTEKST (fra Min Side):\n";
    prompt += `Eier: ${storedUserContext.FirstName || ""} ${storedUserContext.LastName || ""}\n`;
    prompt += `Telefon: ${storedUserContext.Phone || ""}\n`;
    prompt += `Eier-ID: ${storedUserContext.OwnerId || ""}\n`;
    prompt += `Antall dyr: ${storedUserContext.NumberOfPets || 0}\n`;

    if (storedUserContext.Pets && storedUserContext.Pets.length > 0) {
      prompt += "\nRegistrerte dyr:\n";
      for (const pet of storedUserContext.Pets) {
        prompt += `- ${pet.Name}`;
        if (pet.Species) prompt += ` (${pet.Species}`;
        if (pet.Breed) prompt += `, ${pet.Breed}`;
        if (pet.Species) prompt += `)`;
        if (pet.ChipNumber) prompt += ` - Chip: ${pet.ChipNumber}`;
        const id = pet.AnimalId || pet.PetId;
        if (id) prompt += ` - ID: ${id}`;
        if (pet.DateOfBirth) prompt += ` - Fodt: ${pet.DateOfBirth}`;
        if (pet.Gender) prompt += ` - ${pet.Gender}`;
        prompt += "\n";
      }
    } else if (storedUserContext.NumberOfPets > 0) {
      prompt += `\nBrukeren har ${storedUserContext.NumberOfPets} registrerte dyr.\n`;
    }
  }

  return prompt;
}

function parseActions(text: string): { action: string; params: Record<string, string> }[] {
  const actionRegex = /\[ACTION:\s*(\w+)(?:\s*\|([^\]]*))?\]/g;
  const actions: { action: string; params: Record<string, string> }[] = [];
  let match;

  while ((match = actionRegex.exec(text)) !== null) {
    const action = match[1];
    const params: Record<string, string> = {};
    if (match[2]) {
      match[2].split("|").forEach((p) => {
        const [key, value] = p.split("=").map((s) => s.trim());
        if (key && value) params[key] = value;
      });
    }
    actions.push({ action, params });
  }

  return actions;
}

async function matchUserIntent(
  message: string,
  conversationId: number,
  isAuthenticated: boolean,
  ownerContext: any | null,
  storedUserContext: any | null
): Promise<{ intent: string | null; playbook: PlaybookEntry | null; method: string }> {
  const session = getOrCreateSession(conversationId);

  if (session.intent && session.awaitingInput && session.playbook) {
    const extracted = extractDataFromMessage(message, [session.awaitingInput]);
    if (Object.keys(extracted).length > 0) {
      Object.assign(session.collectedData, extracted);
      session.awaitingInput = undefined;
    } else {
      if (session.awaitingInput === "newOwnerPhone") {
        const digits = message.replace(/\D/g, "");
        if (digits.length === 8) {
          session.collectedData["newOwnerPhone"] = digits;
          session.awaitingInput = undefined;
        }
      } else if (session.awaitingInput === "tagId") {
        session.collectedData["tagId"] = message.trim();
        session.awaitingInput = undefined;
      }
    }
    return { intent: session.intent, playbook: session.playbook, method: "session-continue" };
  }

  const quickIntent = quickIntentMatch(message);
  if (quickIntent) {
    const playbook = await storage.getPlaybookByIntent(quickIntent);
    if (playbook) {
      session.intent = quickIntent;
      session.playbook = playbook;
      session.collectedData = {};
      return { intent: quickIntent, playbook, method: "quick-match" };
    }
  }

  const keywordMatch = await storage.searchPlaybookByKeywords(message);
  if (keywordMatch) {
    session.intent = keywordMatch.intent;
    session.playbook = keywordMatch;
    session.collectedData = {};
    return { intent: keywordMatch.intent, playbook: keywordMatch, method: "keyword-match" };
  }

  if (quickIntent) {
    session.intent = quickIntent;
    session.collectedData = {};
    return { intent: quickIntent, playbook: null, method: "quick-match-no-playbook" };
  }

  return { intent: null, playbook: null, method: "none" };
}

async function handlePlaybookResponse(
  playbook: PlaybookEntry,
  session: SessionState,
  conversationId: number,
  userMessage: string,
  ownerId: string | null | undefined,
  ownerContext: any | null,
  storedUserContext: any | null,
  isAuthenticated: boolean
): Promise<ChatbotResponse | null> {
  const extracted = extractDataFromMessage(userMessage, playbook.requiredRuntimeDataArray);
  Object.assign(session.collectedData, extracted);

  const actionType = playbook.actionType;

  if (actionType === "API_CALL" && isAuthenticated && ownerId) {
    const guideResult = guideDataCollection(playbook, session, ownerContext, storedUserContext, isAuthenticated);
    if (guideResult) return guideResult;

    const requiredFields = playbook.requiredRuntimeDataArray || [];
    if (hasAllRequiredData(session.collectedData, requiredFields)) {
      const result = await executePlaybookAction(playbook, ownerId, session.collectedData, ownerContext);
      if (result.actionSuccess) {
        clearSession(conversationId);
      }
      return result;
    }

    return {
      text: playbook.combinedResponse || playbook.resolutionSteps || `Jeg kan hjelpe deg med ${playbook.primaryAction || playbook.intent}.`,
      suggestions: generateSuggestions(playbook),
      model: "playbook-guide-fallback",
    };
  }

  if (actionType === "API_CALL" && !isAuthenticated) {
    return {
      text: `For a ${playbook.primaryAction || "utfore denne handlingen"}, ma du logge inn forst. Trykk pa "Logg inn (OTP)"-knappen overst.`,
      requiresLogin: true,
      suggestions: [{ label: "Logg inn med OTP", action: "REQUEST_LOGIN" }],
      model: "playbook-guide-login",
    };
  }

  if (actionType === "FORM_FILL" || actionType === "NAVIGATION") {
    return {
      text: playbook.combinedResponse || playbook.resolutionSteps || "Folg instruksjonene for a fullere dette.",
      suggestions: generateSuggestions(playbook),
      helpCenterLink: playbook.helpCenterArticleUrl,
      requiresLogin: !!(playbook.requiresLogin && !isAuthenticated),
      model: "playbook-instruct",
    };
  }

  if (playbook.combinedResponse || playbook.resolutionSteps) {
    return {
      text: playbook.combinedResponse || playbook.resolutionSteps || "",
      helpCenterLink: playbook.helpCenterArticleUrl,
      suggestions: generateSuggestions(playbook),
      model: "playbook-info",
    };
  }

  return null;
}

let lastInteractionId: number | null = null;

export function getLastInteractionId(): number | null {
  return lastInteractionId;
}

export async function* streamChatResponse(
  conversationId: number,
  userMessage: string,
  ownerId?: string | null,
  storedUserContext?: any | null
): AsyncGenerator<string, void, unknown> {
  const startTime = Date.now();
  lastInteractionId = null;

  await storage.createMessage({
    conversationId,
    role: "user",
    content: userMessage,
  });

  const isAuthenticated = !!(ownerId && (storedUserContext || getMinSideContext(ownerId)));
  const ownerContext = ownerId ? getMinSideContext(ownerId) : null;
  const session = getOrCreateSession(conversationId);

  const animals = ownerContext?.animals || storedUserContext?.Pets || [];
  if (animals.length > 0) {
    const lowerMsg = userMessage.toLowerCase();
    const matchedPet = animals.find((a: any) => {
      const name = (a.name || a.Name || "").toLowerCase();
      return name && name.length > 1 && (name === lowerMsg || lowerMsg.includes(name));
    });
    if (matchedPet) {
      const petId = matchedPet.animalId || matchedPet.AnimalId || matchedPet.PetId || matchedPet.petId;
      session.collectedData["petId"] = petId;
      session.collectedData["animalId"] = petId;
      session.collectedData["petName"] = matchedPet.name || matchedPet.Name;
    }
  }

  const tags = ownerContext?.tags || [];
  if (tags.length > 0) {
    const tagMatch = userMessage.match(/TAG-\d+/i);
    if (tagMatch) {
      const matchedTag = tags.find((t: any) => t.tagId.toLowerCase() === tagMatch[0].toLowerCase());
      if (matchedTag) {
        session.collectedData["tagId"] = matchedTag.tagId;
      }
    }
  }

  const { intent, playbook, method } = await matchUserIntent(
    userMessage, conversationId, isAuthenticated, ownerContext, storedUserContext
  );

  if (playbook) {
    const playbookResponse = await handlePlaybookResponse(
      playbook, session, conversationId, userMessage,
      ownerId, ownerContext, storedUserContext, isAuthenticated
    );

    if (playbookResponse) {
      let responseText = playbookResponse.text;

      if (playbookResponse.suggestions && playbookResponse.suggestions.length > 0) {
        const suggestionLabels = playbookResponse.suggestions
          .filter(s => s.action !== "REQUEST_LOGIN" && s.action !== "OPEN_ARTICLE")
          .map(s => s.label);
        if (suggestionLabels.length > 0) {
          responseText += "\n\nValg:\n" + suggestionLabels.map((l, i) => `${i + 1}. ${l}`).join("\n");
        }
      }

      const metadata: any = {
        playbookMatch: true,
        intent,
        method,
        model: playbookResponse.model,
      };
      if (playbookResponse.actionExecuted) {
        metadata.actionExecuted = true;
        metadata.actionType = playbookResponse.actionType;
        metadata.actionSuccess = playbookResponse.actionSuccess;
      }
      if (playbookResponse.requiresLogin) {
        metadata.requiresLogin = true;
      }
      if (playbookResponse.helpCenterLink) {
        metadata.helpCenterLink = playbookResponse.helpCenterLink;
      }
      if (playbookResponse.suggestions) {
        metadata.suggestions = playbookResponse.suggestions;
      }

      const msg = await storage.createMessage({
        conversationId,
        role: "assistant",
        content: responseText,
        metadata,
      });

      const interaction = await storage.logChatbotInteraction({
        conversationId,
        messageId: msg.id,
        userQuestion: userMessage,
        botResponse: responseText,
        responseMethod: playbookResponse.model,
        matchedIntent: intent,
        actionsExecuted: playbookResponse.actionExecuted ? [{ action: playbookResponse.actionType, success: playbookResponse.actionSuccess }] : null,
        authenticated: isAuthenticated,
        responseTimeMs: Date.now() - startTime,
      });
      lastInteractionId = interaction.id;

      await db
        .update(messages)
        .set({ metadata: { ...metadata, interactionId: interaction.id } })
        .where(eq(messages.id, msg.id));

      yield responseText;
      return;
    }
  }

  const allPlaybook = await storage.getActivePlaybookEntries();
  const activePrices = await storage.getActiveServicePrices();
  const activeTemplates = await storage.getActiveResponseTemplates();
  const matchedPb = playbook || (intent ? await storage.getPlaybookByIntent(intent) : null);
  const systemPrompt = buildSystemPrompt(allPlaybook, ownerContext, ownerContext ? null : storedUserContext, activePrices, activeTemplates, matchedPb);

  const history = await storage.getMessagesByConversation(conversationId);
  const chatMessages = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const stream = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: systemPrompt },
      ...chatMessages,
    ],
    stream: true,
  });

  let fullResponse = "";

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      fullResponse += content;
      yield content;
    }
  }

  const actions = parseActions(fullResponse);
  let actionResults: string[] = [];

  for (const { action, params } of actions) {
    if (action === "request_auth") continue;

    if (ownerId) {
      const result = performAction(ownerId, action, params);
      actionResults.push(
        result.success
          ? `Handling utfort: ${result.message}`
          : `Feil: ${result.message}`
      );
    }
  }

  const cleanResponse = fullResponse.replace(/\[ACTION:[^\]]*\]/g, "").trim();
  const finalContent = actionResults.length > 0
    ? `${cleanResponse}\n\n${actionResults.join("\n")}`
    : cleanResponse;

  const msg = await storage.createMessage({
    conversationId,
    role: "assistant",
    content: finalContent,
    metadata: {
      ...(actions.length > 0 ? { actions } : {}),
      ...(intent ? { matchedIntent: intent, method } : {}),
    },
  });

  const interaction = await storage.logChatbotInteraction({
    conversationId,
    messageId: msg.id,
    userQuestion: userMessage,
    botResponse: finalContent,
    responseMethod: method !== "none" ? `ai-with-${method}` : "ai",
    matchedIntent: intent,
    actionsExecuted: actions.length > 0 ? actions : null,
    authenticated: isAuthenticated,
    responseTimeMs: Date.now() - startTime,
  });
  lastInteractionId = interaction.id;

  await db
    .update(messages)
    .set({ metadata: { ...(actions.length > 0 ? { actions } : {}), interactionId: interaction.id, ...(intent ? { matchedIntent: intent } : {}) } })
    .where(eq(messages.id, msg.id));
}
