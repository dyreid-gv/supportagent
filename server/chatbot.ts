import OpenAI from "openai";
import { INTENTS, INTENT_DEFINITIONS, INTENT_BY_NAME } from "@shared/intents";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { getMinSideContext, performAction, lookupOwnerByPhone, lookupByChipNumber, sendOwnershipTransferSms } from "./minside-sandbox";
import type { ChipLookupResult } from "./minside-sandbox";
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
  chipLookupFlow?: "awaiting_chip" | "awaiting_ownership_confirm" | "awaiting_sms_confirm";
  chipLookupResult?: ChipLookupResult;
  directIntentFlow?: string;
  loginHelpStep?: "awaiting_phone" | "awaiting_sms_confirm";
}

const sessionStates = new Map<number, SessionState>();

function getOrCreateSession(conversationId: number): SessionState {
  if (!sessionStates.has(conversationId)) {
    sessionStates.set(conversationId, { collectedData: {} });
  }
  return sessionStates.get(conversationId)!;
}

export function clearSession(conversationId: number) {
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
  { intent: "OwnershipTransferDead", regex: /eier.*død|dødsfall.*eier|arv.*dyr/i },
  { intent: "NKKOwnership", regex: /nkk|norsk kennel|stambokført|rasehund.*eierskift/i },
  { intent: "OwnershipTransferWeb", regex: /eierskift.*min side|via min side|eierskift|selge|solgt|ny eier|overfør|kjøpt/i },

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
  { intent: "UnregisteredChip578", regex: /uregistrert.*brikke|uregistrert.*chip|578.*ikke.*registrert|ikke.*forhåndsbetalt/i },
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

  // ── Chip-oppslag / Feil eier / Registrering ──────────────
  { intent: "ChipLookup", regex: /id.?nummer|chip.?nummer|søke.*opp.*dyr|finne.*dyr.*chip|finn.*dyr|slå.*opp|chip.*søk|id.*søk.*dyr/i },
  { intent: "WrongOwner", regex: /feil eier|feil.*registrert.*eier|ikke.*min.*eier|registrert.*på.*feil|feil.*person.*registrert/i },
  { intent: "PetNotInSystem", regex: /finnes ikke.*system|ikke.*registrert|dyr.*finnes ikke|finner ikke.*dyr.*register|ikke i registeret|ikke.*søkbar|mangler.*register/i },
  { intent: "NewRegistration", regex: /registrere.*nytt.*dyr|nytt.*dyr.*registrer|ny.*registrering|hvordan registrere/i },

  // ── Generell ────────────────────────────────────────────
  { intent: "GeneralInquiry", regex: /generell|hjelp med|lurer på|spørsmål om/i },
];

interface CategorySubtopic {
  label: string;
  query: string;
  url?: string;
  intent?: string;
  description?: string;
}

interface CategoryMenu {
  broadRegex: RegExp;
  excludeRegex?: RegExp;
  title: string;
  intro: string;
  subtopics: CategorySubtopic[];
}

const HJELPESENTER_BASE = "https://www.dyreid.no";

const CATEGORY_MENUS: Record<string, CategoryMenu> = {
  Eierskifte: {
    broadRegex: /^(eierskifte|hvordan.*eierskift|hjelp.*eierskift|om eierskift|foreta eierskifte|gjøre eierskift|overføre eierskap)[\?\.\!]?$/i,
    title: "Eierskifte",
    intro: "Jeg kan hjelpe deg med eierskifte. Velg det som passer din situasjon:",
    subtopics: [
      { label: "Eierskifte Min side", query: "Eierskifte via Min side", intent: "OwnershipTransferWeb", description: "Gjennomfør eierskifte selv via Min side (krever innlogging)" },
      { label: "Eierskifte APP", query: "Eierskifte i DyreID-appen", intent: "OwnershipTransferApp", url: `${HJELPESENTER_BASE}/hjelp-eierskifte/39-eierskifte-app` },
      { label: "Hva koster eierskifte?", query: "Hva koster eierskifte?", intent: "OwnershipTransferCost", url: `${HJELPESENTER_BASE}/hjelp-eierskifte/40-hva-koster-eierskifte` },
      { label: "Eierskifte når eier er død", query: "Eierskifte når eier er død", intent: "OwnershipTransferDead", url: `${HJELPESENTER_BASE}/hjelp-eierskifte/42-eierskifte-naar-eier-er-dod` },
      { label: "Eierskifte av NKK-registrert hund", query: "Eierskifte av NKK-registrert hund", intent: "NKKOwnership", url: `${HJELPESENTER_BASE}/hjelp-eierskifte/41-eierskifte-av-nkk-registrert-hund` },
    ],
  },
  "ID-søk": {
    broadRegex: /^(id.?søk|id.?merk|om id.?merking|hjelp.*id)[\?\.\!]?$/i,
    title: "ID-søk og ID-merking",
    intro: "Her er temaene under ID-søk og ID-merking:",
    subtopics: [
      { label: "Hvorfor bør jeg ID-merke?", query: "Hvorfor bør jeg ID-merke kjæledyret mitt?", intent: "WhyIDMark", url: `${HJELPESENTER_BASE}/hjelp-id-sok/1-hvorfor-bor-jeg-id-merke` },
      { label: "Kontrollere kontaktdata", query: "Hvordan kontrollere at mine kontaktdata er riktig?", intent: "CheckContactData", url: `${HJELPESENTER_BASE}/hjelp-id-sok/2-kontrollere-kontaktdata` },
      { label: "Kjæledyret er ikke søkbart", query: "Kjæledyret mitt er ikke søkbart", intent: "InactiveRegistration", url: `${HJELPESENTER_BASE}/hjelp-id-sok/3-kjaledyret-er-ikke-sokbart` },
    ],
  },
  "DyreID-appen": {
    broadRegex: /^(dyreid.?appen|om appen|hjelp.*app|dyreID app)[\?\.\!]?$/i,
    title: "DyreID-appen",
    intro: "Her er temaene om DyreID-appen:",
    subtopics: [
      { label: "Tilgang til DyreID-appen", query: "Hvordan får jeg tilgang til DyreID-appen?", intent: "AppAccess", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/4-tilgang-til-appen` },
      { label: "Innlogging app", query: "Hjelp med innlogging i DyreID-appen", intent: "AppLoginIssue", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/5-innlogging-app` },
      { label: "Hvorfor app?", query: "Hva er fordelene med DyreID-appen?", intent: "AppBenefits", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/6-hvorfor-app` },
      { label: "Hvem passer appen for?", query: "Hvem passer DyreID-appen for?", intent: "AppTargetAudience", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/7-hvem-passer-appen-for` },
      { label: "Basis vs DyreID+", query: "Hva er forskjellen på DyreID basis og DyreID+ abonnement?", intent: "SubscriptionComparison", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/8-basis-vs-dyreID-pluss` },
      { label: "Koster appen noe?", query: "Koster DyreID-appen noe?", intent: "AppCost", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/9-koster-appen-noe` },
      { label: "Min side (i appen)", query: "Min side-funksjonalitet i DyreID-appen", intent: "AppMinSide", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/10-min-side-i-appen` },
    ],
  },
  "Min side": {
    broadRegex: /^(min side|om min side|hjelp.*min side|min.?side)[\?\.\!]?$/i,
    title: "Min side",
    intro: "Her er temaene om Min side:",
    subtopics: [
      { label: "Logg inn på Min side", query: "Hvordan logger jeg inn på Min side?", intent: "LoginIssue", url: `${HJELPESENTER_BASE}/hjelp-min-side/11-logg-inn` },
      { label: "Fått SMS/e-post fra DyreID", query: "Hvorfor har jeg fått SMS eller e-post fra DyreID?", intent: "SMSEmailNotification", url: `${HJELPESENTER_BASE}/hjelp-min-side/12-sms-epost` },
      { label: "Har jeg en Min side?", query: "Har jeg en Min side?", intent: "ProfileVerification", url: `${HJELPESENTER_BASE}/hjelp-min-side/13-har-jeg-min-side` },
      { label: "Får ikke logget inn", query: "Hvorfor får jeg ikke logget meg inn på Min side?", intent: "LoginProblem", url: `${HJELPESENTER_BASE}/hjelp-min-side/14-far-ikke-logget-inn` },
      { label: "Feilmelding e-postadresse", query: "Feilmelding ved e-postadresse på Min side", intent: "EmailError", url: `${HJELPESENTER_BASE}/hjelp-min-side/15-feilmelding-epost` },
      { label: "Feilmelding telefonnummer", query: "Feilmelding ved telefonnummer på Min side", intent: "PhoneError", url: `${HJELPESENTER_BASE}/hjelp-min-side/16-feilmelding-telefon` },
      { label: "Feil informasjon på Min side", query: "Det er feil informasjon på Min side", intent: "WrongInfo", url: `${HJELPESENTER_BASE}/hjelp-min-side/18-feil-info` },
      { label: "Mangler kjæledyr", query: "Det mangler et kjæledyr på Min side", intent: "MissingPetProfile", url: `${HJELPESENTER_BASE}/hjelp-min-side/19-mangler-kjaledyr` },
      { label: "Kjæledyret er dødt", query: "Kjæledyret mitt er dødt, hva gjør jeg?", intent: "PetDeceased", url: `${HJELPESENTER_BASE}/hjelp-min-side/20-kjaledyret-er-dodt` },
      { label: "Slett meg / GDPR", query: "Jeg vil slette profilen min (GDPR)", intent: "GDPRDelete", url: `${HJELPESENTER_BASE}/hjelp-min-side/21-slett-meg` },
    ],
  },
  "Smart Tag": {
    broadRegex: /^(smart.?tag|om smart.?tag|hjelp.*smart.?tag)[\?\.\!]?$/i,
    title: "Smart Tag",
    intro: "Her er temaene om Smart Tag:",
    subtopics: [
      { label: "Aktivering av Smart Tag", query: "Hvordan aktivere Smart Tag?", intent: "SmartTagActivation", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/25-aktivering-smart-tag` },
      { label: "Aktiver QR-koden på Smart Tag", query: "Aktivere QR-koden på Smart Tag", intent: "SmartTagQRActivation", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/26-aktiver-qr-smart-tag` },
      { label: "Kan ikke koble til taggen", query: "Kan ikke koble til eller legge til Smart Tag", intent: "SmartTagConnection", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/27-kan-ikke-koble-smart-tag` },
      { label: "Taggen forsvunnet fra appen", query: "Smart Tag var lagt til men finner den ikke", intent: "SmartTagMissing", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/28-smart-tag-forsvunnet` },
      { label: "Posisjon ikke oppdatert", query: "Smart Tag posisjonen har ikke oppdatert seg", intent: "SmartTagPosition", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/29-smart-tag-posisjon` },
      { label: "Taggen lager lyder", query: "Smart Tag lager lyder av seg selv", intent: "SmartTagSound", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/30-smart-tag-lyd` },
      { label: "Flere tagger - bare én kobles", query: "Har flere Smart Tags men får bare koblet til én", intent: "SmartTagMultiple", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/31-smart-tag-flere` },
    ],
  },
  "QR-brikke": {
    broadRegex: /^(qr.?brikke|om qr|hjelp.*qr|qr.?tag)[\?\.\!]?$/i,
    title: "QR-brikke",
    intro: "Her er temaene om QR-brikke:",
    subtopics: [
      { label: "Passer for hund og katt?", query: "Passer DyreIDs QR-brikke for hund og katt?", intent: "QRCompatibility", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/32-qr-kompatibilitet` },
      { label: "Krav om ID-merking?", query: "Må kjæledyret være ID-merket for QR-brikke?", intent: "QRRequiresIDMark", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/33-qr-krav-id-merking` },
      { label: "Abonnement eller engangskostnad?", query: "Er QR-brikke abonnement eller engangskostnad?", intent: "QRPricingModel", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/34-qr-prismodell` },
      { label: "Hvordan aktivere QR-brikken?", query: "Hvordan aktivere QR-brikken?", intent: "QRTagActivation", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/35-aktivere-qr` },
      { label: "Hva skjer når QR skannes?", query: "Hva skjer når QR-koden skannes?", intent: "QRScanResult", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/37-qr-skanning` },
      { label: "Fordelen med QR-brikke", query: "Hva er fordelen med DyreIDs QR-brikke?", intent: "QRBenefits", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/39-qr-fordeler` },
      { label: "Mistet QR-brikke", query: "Jeg har mistet QR-brikken min", intent: "QRTagLost", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/40-mistet-qr` },
    ],
  },
  Utenlandsregistrering: {
    broadRegex: /^(utenlandsregistrering|utenlandsk.*dyr|registrere.*utland|hjelp.*utenlands|importert.*dyr|uregistrert.*brikke|578.*ikke.*registrert)[\?\.\!]?$/i,
    title: "Utenlandsregistrering",
    intro: "Her er temaene om registrering av utenlandske dyr og uregistrerte ID-merker:\n\n**OBS:** Noen ID-merker som begynner med 578 (Norges landskode) er ikke nødvendigvis registrert hos DyreID. Disse er såkalte uregistrerte brikker som ikke er forhåndsbetalte hos oss, og betraktes som utlandsregistrerte.",
    subtopics: [
      { label: "Registrere dyr i Norge", query: "Hvordan få dyret registrert i Norge?", intent: "ForeignRegistration", url: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/43-registrering-norge` },
      { label: "Uregistrert 578-brikke", query: "Chipen begynner med 578 men er ikke registrert hos DyreID", intent: "UnregisteredChip578", url: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/43-registrering-norge` },
      { label: "Hva koster registrering?", query: "Hva koster det å registrere et dyr i Norge?", intent: "ForeignRegistrationCost", url: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/44-kostnad-registrering` },
      { label: "Utenlandsk hund med stamtavle", query: "Registrering av utenlandsk hund med stamtavle", intent: "ForeignPedigree", url: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/45-utenlandsk-stamtavle` },
    ],
  },
  "Savnet/Funnet": {
    broadRegex: /^(savnet|funnet|savnet.*funnet|melde.*savnet|melde.*funnet|hjelp.*savnet)[\?\.\!]?$/i,
    title: "Savnet/Funnet",
    intro: "Her er temaene om Savnet & Funnet:",
    subtopics: [
      { label: "Melde kjæledyr savnet", query: "Hvordan melde mitt kjæledyr savnet?", intent: "ReportLostPet", description: "Meld dyret ditt savnet direkte (krever innlogging)" },
      { label: "Kjæledyret har kommet til rette", query: "Kjæledyret har kommet til rette", intent: "ReportFoundPet", description: "Marker dyret som funnet (krever innlogging)" },
      { label: "Hvordan fungerer Savnet & Funnet?", query: "Hvordan fungerer Savnet og Funnet-tjenesten?", intent: "LostFoundInfo", url: `${HJELPESENTER_BASE}/hjelp-savnet-funnet/48-savnet-funnet-info` },
      { label: "Søkbar på 1-2-3", query: "Hvordan fungerer Søkbar på 1-2-3?", intent: "SearchableInfo", url: `${HJELPESENTER_BASE}/hjelp-savnet-funnet/49-sokbar-123` },
      { label: "Kan Søkbar misbrukes?", query: "Kan Søkbar på 1-2-3 misbrukes?", intent: "SearchableMisuse", url: `${HJELPESENTER_BASE}/hjelp-savnet-funnet/50-sokbar-misbruk` },
    ],
  },
  Registrering: {
    broadRegex: /^(feil.*registrering|manglende.*registrering|registrering.*(?:av\s)?dyr|registrering.*feil|feil.*manglende.*registr\w*|problem.*registrering|hjelp.*registrering)(?:\s+\w+)*[\?\.\!]?$/i,
    title: "Feil eller manglende registrering",
    intro: "Jeg forstår at du har et problem med registrering. Hva gjelder det?",
    subtopics: [
      { label: "Feil informasjon på registreringen", query: "Det er feil informasjon registrert på dyret mitt", intent: "WrongInfo", description: "Feil navn, rase, chipnummer eller annet" },
      { label: "Dyret er registrert på feil eier", query: "Dyret mitt er registrert på feil person", intent: "WrongOwner", description: "Dyret står på en annen person enn meg" },
      { label: "Finner ikke dyret mitt / ikke registrert", query: "Jeg finner ikke dyret mitt i registeret", intent: "PetNotInSystem", description: "Dyret vises ikke i DyreID-søk" },
      { label: "Dyret mangler på Min side", query: "Det mangler et kjæledyr på Min side", intent: "MissingPetProfile", description: "Dyret vises ikke på min profil", url: `${HJELPESENTER_BASE}/hjelp-min-side/19-mangler-kjaledyr` },
      { label: "Dyret er ikke søkbart", query: "Kjæledyret mitt er ikke søkbart", intent: "InactiveRegistration", description: "Dyret vises ikke i offentlig søk", url: `${HJELPESENTER_BASE}/hjelp-id-sok/3-kjaledyret-er-ikke-sokbart` },
      { label: "Registrere nytt dyr", query: "Hvordan registrere et nytt dyr i DyreID?", intent: "NewRegistration", description: "Registrere et dyr som ikke er i systemet", url: `${HJELPESENTER_BASE}/hjelp-id-sok/1-hvorfor-bor-jeg-id-merke` },
    ],
  },
  Familiedeling: {
    broadRegex: /^(familiedeling|om familiedeling|hjelp.*familiedeling|dele.*tilgang)[\?\.\!]?$/i,
    title: "Familiedeling",
    intro: "Her er temaene om Familiedeling:",
    subtopics: [
      { label: "Hvorfor familiedeling?", query: "Hvorfor burde jeg ha familiedeling?", intent: "FamilySharingBenefits", url: `${HJELPESENTER_BASE}/hjelp-familiedeling/51-familiedeling-fordeler` },
      { label: "Dele med andre enn familien?", query: "Kan jeg dele tilgang med andre enn familien?", intent: "FamilySharingNonFamily", url: `${HJELPESENTER_BASE}/hjelp-familiedeling/52-dele-ikke-familie` },
      { label: "Trenger jeg DyreID+?", query: "Trenger jeg DyreID+ for familiedeling?", intent: "FamilySharingRequirement", url: `${HJELPESENTER_BASE}/hjelp-familiedeling/53-familiedeling-krav` },
      { label: "Forespørsel ikke akseptert", query: "Familiedeling forespørsel ikke akseptert", intent: "FamilySharingRequest", url: `${HJELPESENTER_BASE}/hjelp-familiedeling/54-familiedeling-foresporsel` },
      { label: "Hvordan dele tilgang?", query: "Hvordan dele tilgang med familiemedlemmer?", intent: "FamilySharing", url: `${HJELPESENTER_BASE}/hjelp-familiedeling/55-dele-tilgang` },
      { label: "Rettigheter ved deling", query: "Kan de jeg deler med gjøre endringer?", intent: "FamilySharingPermissions", url: `${HJELPESENTER_BASE}/hjelp-familiedeling/56-familiedeling-rettigheter` },
    ],
  },
};

function getHelpCenterUrl(intent: string): string | null {
  for (const [, menu] of Object.entries(CATEGORY_MENUS)) {
    for (const sub of menu.subtopics) {
      if (sub.intent === intent && sub.url) {
        return sub.url;
      }
    }
  }
  return null;
}

function detectCategoryMenu(message: string): CategoryMenu | null {
  const cleaned = message.trim().replace(/[\?\.\!]+$/, "").trim();
  for (const [, menu] of Object.entries(CATEGORY_MENUS)) {
    if (menu.broadRegex.test(message) || menu.broadRegex.test(cleaned)) {
      return menu;
    }
  }
  return null;
}

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

function extractChipNumber(message: string): string | null {
  const chipMatch = message.match(/\b(\d{15})\b/);
  if (chipMatch) return chipMatch[1];
  const chipMatch2 = message.match(/\b(\d{9,15})\b/);
  if (chipMatch2 && chipMatch2[1].length >= 9) return chipMatch2[1];
  return null;
}

function isChipLookupTrigger(intent: string | null): boolean {
  return intent === "ChipLookup" || intent === "WrongOwner" || intent === "PetNotInSystem" || intent === "MissingPetProfile" || intent === "InactiveRegistration";
}

function handleChipLookupFlow(
  session: SessionState,
  userMessage: string,
  isAuthenticated: boolean,
  ownerContext: any | null,
  storedUserContext: any | null
): ChatbotResponse | null {
  const lowerMsg = userMessage.toLowerCase().trim();

  if (session.chipLookupFlow === "awaiting_chip") {
    const chipNumber = extractChipNumber(userMessage);
    if (!chipNumber) {
      return {
        text: "Jeg trenger et gyldig ID-nummer (chipnummer) for å gjøre et oppslag. Chipnummeret er vanligvis 15 siffer. Kan du oppgi det?",
        model: "chip-lookup-retry",
      };
    }

    const result = lookupByChipNumber(chipNumber);
    if (!result.found) {
      session.chipLookupFlow = undefined;
      session.chipLookupResult = undefined;
      const is578 = chipNumber.startsWith("578");
      let notFoundText = `Jeg fant ingen registrering på chipnummer ${chipNumber}.\n\n`;
      if (is578) {
        notFoundText += `**Merk:** Selv om chipnummeret begynner med 578 (Norges landskode), betyr det ikke nødvendigvis at chipen er registrert hos DyreID. Noen ID-merker som begynner med 578 er såkalte **uregistrerte brikker** – det vil si brikker som ikke er forhåndsbetalte hos oss. Disse betraktes som utlandsregistrerte.\n\n`;
        notFoundText += `Dette kan bety at:\n`;
        notFoundText += `- Chipen er en uregistrert 578-brikke (ikke forhåndsbetalt hos DyreID)\n`;
        notFoundText += `- Dyret ikke er registrert i DyreID ennå\n`;
        notFoundText += `- Nummeret er feil\n\n`;
        notFoundText += `For å få dyret registrert i DyreID må du ta kontakt med en veterinær. Veterinæren registrerer chipen, og det koster 676 kr. Les mer: ${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/43-registrering-norge`;
      } else {
        notFoundText += `Dette kan bety at:\n`;
        notFoundText += `- Chipen ikke er registrert i DyreID ennå\n`;
        notFoundText += `- Nummeret er feil\n`;
        notFoundText += `- Dyret er registrert i et annet land\n\n`;
        notFoundText += `For å få dyret registrert i Norge/DyreID, ta kontakt med en veterinær. Registrering av utenlandsk chip koster 676 kr. Les mer: ${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/43-registrering-norge`;
      }
      return {
        text: notFoundText,
        model: "chip-lookup-not-found",
        requestFeedback: true,
      };
    }

    session.chipLookupResult = result;
    session.chipLookupFlow = "awaiting_ownership_confirm";

    const animal = result.animal!;
    const owner = result.owner!;

    let responseText = `Jeg fant følgende informasjon:\n\n`;
    responseText += `**Dyr:**\n`;
    responseText += `- Navn: ${animal.name}\n`;
    responseText += `- Art: ${animal.species}\n`;
    responseText += `- Rase: ${animal.breed}\n`;
    responseText += `- Kjønn: ${animal.gender}\n`;
    responseText += `- Chipnummer: ${animal.chipNumber}\n`;
    if (animal.dateOfBirth) responseText += `- Fødselsdato: ${animal.dateOfBirth}\n`;

    responseText += `\n**Registrert eier:**\n`;
    responseText += `- Navn: ${owner.name}\n`;
    responseText += `- Adresse: ${owner.address}\n`;
    responseText += `- Postnr/-sted: ${owner.postalCode} ${owner.city}\n`;
    responseText += `- Telefon: ${owner.phone}\n`;

    responseText += `\nSkal ${animal.name} være registrert på deg?`;

    return {
      text: responseText,
      suggestions: [
        { label: "Ja, det skal være mitt dyr", action: "CONFIRM_OWNERSHIP" },
        { label: "Nei, bare informasjon", action: "CANCEL_LOOKUP" },
      ],
      model: "chip-lookup-result",
    };
  }

  if (session.chipLookupFlow === "awaiting_ownership_confirm") {
    const isYes = /^(ja|yes|stemmer|riktig|det stemmer|mitt dyr|skal.*mitt|bekreft)/i.test(lowerMsg);
    const isNo = /^(nei|no|avbryt|cancel|bare info|ikke mitt)/i.test(lowerMsg);

    if (isNo || lowerMsg === "nei, bare informasjon") {
      session.chipLookupFlow = undefined;
      session.chipLookupResult = undefined;
      return {
        text: "Forstått. Er det noe annet jeg kan hjelpe deg med?",
        model: "chip-lookup-cancelled",
      };
    }

    if (isYes || lowerMsg.includes("ja") || lowerMsg.includes("mitt dyr")) {
      const result = session.chipLookupResult!;
      const registeredOwner = result.owner!;
      const petName = result.animal!.name;

      if (!isAuthenticated) {
        return {
          text: `For å gå videre med eierskifte av ${petName}, må du logge inn først. Klikk på knappen under for å logge inn med engangskode (OTP).`,
          requiresLogin: true,
          suggestions: [{ label: "Logg inn med OTP", action: "REQUEST_LOGIN" }],
          model: "chip-lookup-needs-login",
        };
      }

      session.chipLookupFlow = "awaiting_sms_confirm";

      const customerName = ownerContext
        ? `${ownerContext.owner.firstName} ${ownerContext.owner.lastName}`
        : storedUserContext
          ? `${storedUserContext.FirstName || ""} ${storedUserContext.LastName || ""}`.trim()
          : "Kunden";

      return {
        text: `Jeg kan sende en SMS til ${registeredOwner.name} og be om at du blir kontaktet for eierskifte.\n\nSMS-en vil inneholde:\n> "Hei - vi er blitt kontaktet av ${customerName} vedrørende eierskifte av ${petName}. Vennligst ta direkte kontakt på [ditt mobilnummer]. Med vennlig hilsen DyreID"\n\nØnsker du at jeg sender denne SMS-en?`,
        suggestions: [
          { label: "Ja, send SMS", action: "SEND_OWNERSHIP_SMS" },
          { label: "Nei, avbryt", action: "CANCEL_SMS" },
        ],
        model: "chip-lookup-sms-confirm",
      };
    }

    return {
      text: "Skal dyret være registrert på deg? Svar ja eller nei.",
      model: "chip-lookup-clarify",
    };
  }

  if (session.chipLookupFlow === "awaiting_sms_confirm") {
    const isYes = /^(ja|yes|send|bekreft|ok|gjør det)/i.test(lowerMsg);
    const isNo = /^(nei|no|avbryt|cancel|ikke send|stopp)/i.test(lowerMsg);

    if (isNo || lowerMsg.includes("avbryt")) {
      session.chipLookupFlow = undefined;
      session.chipLookupResult = undefined;
      return {
        text: "SMS ble ikke sendt. Er det noe annet jeg kan hjelpe deg med?",
        model: "chip-lookup-sms-cancelled",
      };
    }

    if (isYes || lowerMsg.includes("ja") || lowerMsg.includes("send")) {
      const result = session.chipLookupResult!;
      const registeredOwner = result.owner!;
      const petName = result.animal!.name;

      const customerName = ownerContext
        ? `${ownerContext.owner.firstName} ${ownerContext.owner.lastName}`
        : storedUserContext
          ? `${storedUserContext.FirstName || ""} ${storedUserContext.LastName || ""}`.trim()
          : "Kunden";

      const customerPhone = ownerContext
        ? ownerContext.owner.phone
        : storedUserContext
          ? storedUserContext.Phone || ""
          : "";

      const smsResult = sendOwnershipTransferSms(
        registeredOwner.phone,
        registeredOwner.name,
        customerName,
        customerPhone,
        petName
      );

      session.chipLookupFlow = undefined;
      session.chipLookupResult = undefined;

      if (smsResult.success) {
        return {
          text: `SMS er sendt til ${registeredOwner.name} (${registeredOwner.phone}).\n\nDe har blitt bedt om å ta kontakt med deg på ${customerPhone} angående eierskifte av ${petName}.\n\nNår dere har blitt enige, kan eierskiftet gjennomføres via Min Side eller DyreID-appen.`,
          actionExecuted: true,
          actionType: "SEND_OWNERSHIP_SMS",
          actionSuccess: true,
          requestFeedback: true,
          model: "chip-lookup-sms-sent",
        };
      } else {
        return {
          text: `Kunne ikke sende SMS: ${smsResult.message}\n\nDu kan alternativt kontakte DyreID kundeservice på telefon 22 99 11 30 for hjelp med eierskiftet.`,
          actionExecuted: true,
          actionType: "SEND_OWNERSHIP_SMS",
          actionSuccess: false,
          model: "chip-lookup-sms-failed",
        };
      }
    }

    return {
      text: "Ønsker du at jeg sender SMS-en til registrert eier? Svar ja eller nei.",
      model: "chip-lookup-sms-clarify",
    };
  }

  return null;
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
  pets?: any[];
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
    return {
      text: "QR-brikken aktiveres i **DyreID-appen**, ikke via Min Side.\n\nSlik aktiverer du brikken:\n\n1. Åpne DyreID-appen\n2. Klikk på QR-brikke-ikonet på forsiden eller under Meny\n3. Skann QR-koden på brikken\n4. Skriv inn telefonnummeret ditt\n5. Skriv inn chipnummer på kjæledyret\n6. Kryss av for kontaktdata som skal vises ved skanning\n7. Husk å aktivere pushvarsel i appen\n\nHar du problemer med å skanne koden i appen? Prøv å skanne den med kameraet på mobilen i stedet.",
      requestFeedback: true,
      model: "action-qr-app-redirect",
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
      text: `For å hjelpe deg med ${playbook.primaryAction || playbook.intent}, må du logge inn først. Klikk på knappen under for å logge inn med engangskode (OTP).`,
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

function formatPetForMetadata(animal: any, source: "sandbox" | "minside"): any {
  if (source === "sandbox") {
    return {
      Name: animal.name,
      Species: animal.species === "dog" ? "Hund" : animal.species === "cat" ? "Katt" : "Annet",
      Breed: animal.breed,
      Gender: animal.gender === "male" ? "Hannkjønn" : "Hunnkjønn",
      ChipNumber: animal.chipNumber,
      DateOfBirth: animal.dateOfBirth,
      AnimalId: animal.animalId,
      Status: animal.status,
    };
  }
  return animal;
}

function handleDirectIntent(
  intent: string,
  session: SessionState,
  isAuthenticated: boolean,
  ownerContext: any | null,
  storedUserContext: any | null,
  userMessage: string
): ChatbotResponse | null {
  if (intent === "ViewMyPets") {
    if (!isAuthenticated) {
      return {
        text: "For å se dine registrerte dyr, må du logge inn først. Klikk på knappen under for å logge inn med engangskode (OTP).",
        requiresLogin: true,
        model: "direct-view-pets-login",
      };
    }

    const animals = ownerContext?.animals || [];
    const minSidePets = storedUserContext?.Pets || [];

    if (ownerContext && animals.length > 0) {
      const activePets = animals.filter((a: any) => a.status === "active");
      const deceasedPets = animals.filter((a: any) => a.status === "deceased");
      const pets = activePets.map((a: any) => formatPetForMetadata(a, "sandbox"));

      let text = `Du har **${activePets.length} registrerte dyr** på Min Side:`;
      if (deceasedPets.length > 0) {
        text += `\n\n${deceasedPets.length} avdøde dyr er ikke vist.`;
      }

      const lostAnimals = ownerContext.lostStatuses?.filter((l: any) => l.lost) || [];
      if (lostAnimals.length > 0) {
        text += `\n\n**Savnet:** ${lostAnimals.map((l: any) => l.animalName).join(", ")}`;
      }

      const pa = ownerContext.pendingActions;
      if (pa && (pa.pendingPayments > 0 || pa.pendingTransfers > 0 || pa.inactiveTags > 0)) {
        const notices: string[] = [];
        if (pa.pendingPayments > 0) notices.push(`${pa.pendingPayments} ubetalt(e) registrering(er)`);
        if (pa.pendingTransfers > 0) notices.push(`${pa.pendingTransfers} pågående eierskifte(r)`);
        if (pa.inactiveTags > 0) notices.push(`${pa.inactiveTags} ikke-aktivert(e) tag(s)`);
        text += `\n\n**Ventende:** ${notices.join(", ")}`;
      }

      return {
        text,
        model: "direct-view-pets",
        requestFeedback: true,
        pets,
      };
    }

    if (minSidePets.length > 0) {
      return {
        text: `Du har **${minSidePets.length} registrerte dyr** på Min Side:`,
        model: "direct-view-pets",
        requestFeedback: true,
        pets: minSidePets,
      };
    }

    return {
      text: "Jeg fant ingen registrerte dyr på din profil. Har du registrert kjæledyrene dine på dyreid.no?",
      model: "direct-view-pets-empty",
    };
  }

  if (intent === "OwnershipTransferWeb" || session.directIntentFlow === "OwnershipTransferWeb") {
    if (!isAuthenticated) {
      return {
        text: "For å gjennomføre eierskifte må du først logge inn. Klikk på knappen under for å logge inn med engangskode (OTP).\n\nEtter innlogging hjelper jeg deg steg for steg med å overføre eierskapet.",
        requiresLogin: true,
        model: "direct-transfer-login",
      };
    }

    if (session.directIntentFlow === "OwnershipTransferWeb" && session.collectedData["petId"] && !session.collectedData["newOwnerPhone"]) {
      const digits = userMessage.replace(/\D/g, "");
      if (digits.length === 8) {
        const petName = session.collectedData["petName"] || "Dyret";
        const ownerId = ownerContext?.owner?.ownerId || storedUserContext?.OwnerId;
        if (ownerId) {
          const result = performAction(ownerId, "initiate_transfer", {
            animalId: session.collectedData["petId"],
            newOwnerPhone: digits,
          });
          if (result.success) {
            session.collectedData = {};
            session.intent = undefined;
            session.directIntentFlow = undefined;
            return {
              text: `Eierskifte startet for **${petName}**!\n\n- Ny eier (${digits}) mottar SMS med bekreftelseslenke\n- Betalingslink sendes automatisk\n- Tidslinje: 1-2 virkedager`,
              actionExecuted: true,
              actionType: "OWNERSHIP_TRANSFER",
              actionSuccess: true,
              requestFeedback: true,
              model: "direct-transfer-executed",
            };
          }
        }
      }
      return {
        text: `Oppgi ny eiers mobilnummer (8 siffer):`,
        model: "direct-transfer-collect-phone",
      };
    }

    const animals = ownerContext?.animals || [];
    const minSidePets = storedUserContext?.Pets || [];
    const allPets = animals.length > 0
      ? animals.filter((a: any) => a.status === "active").map((a: any) => formatPetForMetadata(a, "sandbox"))
      : minSidePets;

    if (allPets.length === 0) {
      return {
        text: "Du har ingen registrerte dyr å gjennomføre eierskifte for.",
        model: "direct-transfer-no-pets",
      };
    }

    session.directIntentFlow = "OwnershipTransferWeb";

    if (!session.collectedData["petId"] && allPets.length > 1) {
      const msgLower = userMessage.toLowerCase().trim();
      const matchedPet = allPets.find((p: any) => {
        const name = (p.Name || p.name || "").toLowerCase();
        return name && (msgLower.includes(name) || name.includes(msgLower));
      });
      if (matchedPet) {
        const petId = matchedPet.AnimalId || matchedPet.animalId || matchedPet.PetId || matchedPet.petId;
        session.collectedData["petId"] = petId;
        session.collectedData["petName"] = matchedPet.Name || matchedPet.name;
      }
    }

    if (session.collectedData["petId"]) {
      return {
        text: `Eierskifte for **${session.collectedData["petName"] || "valgt dyr"}**.\n\nOppgi ny eiers mobilnummer (8 siffer):`,
        model: "direct-transfer-collect-phone",
      };
    }

    if (allPets.length === 1) {
      const pet = allPets[0];
      const petId = pet.AnimalId || pet.animalId || pet.PetId || pet.petId;
      session.collectedData["petId"] = petId;
      session.collectedData["animalId"] = petId;
      session.collectedData["petName"] = pet.Name || pet.name;
      return {
        text: `Eierskifte for **${pet.Name || pet.name}**.\n\nOppgi ny eiers mobilnummer (8 siffer):`,
        model: "direct-transfer-collect-phone",
        pets: [pet],
      };
    }

    const suggestions = allPets.map((a: any) => ({
      label: `${a.Name || a.name} (${a.Species || a.species || ""})`,
      action: "SELECT_PET",
      data: { petId: a.AnimalId || a.animalId || a.PetId || a.petId, petName: a.Name || a.name },
    }));

    return {
      text: "Hvilket dyr gjelder eierskiftet?",
      suggestions,
      model: "direct-transfer-select-pet",
      pets: allPets,
    };
  }

  if (intent === "ReportLostPet") {
    if (!isAuthenticated) {
      return {
        text: "For å melde dyret ditt savnet, må du logge inn først. Klikk på knappen under for å logge inn med engangskode (OTP).\n\nEtter innlogging aktiverer jeg savnet-varsling med SMS og push-notifikasjoner.",
        requiresLogin: true,
        model: "direct-lost-login",
      };
    }

    const animals = ownerContext?.animals || [];
    const minSidePets = storedUserContext?.Pets || [];
    const activePets = animals.length > 0
      ? animals.filter((a: any) => a.status === "active").map((a: any) => formatPetForMetadata(a, "sandbox"))
      : minSidePets;

    if (activePets.length === 0) {
      return {
        text: "Du har ingen registrerte dyr å melde savnet.",
        model: "direct-lost-no-pets",
      };
    }

    session.intent = "ReportLostPet";
    session.collectedData = {};

    if (activePets.length === 1) {
      const pet = activePets[0];
      const petId = pet.AnimalId || pet.animalId || pet.PetId || pet.petId;
      const petName = pet.Name || pet.name;
      const ownerId = ownerContext?.owner?.ownerId || storedUserContext?.OwnerId;
      if (ownerId) {
        const result = performAction(ownerId, "mark_lost", { animalId: petId });
        if (result.success) {
          return {
            text: `**${petName}** er nå meldt savnet!\n\n- SMS-varsling aktivert\n- Push-notifikasjoner aktivert\n- Naboer i området blir varslet\n\nDel gjerne savnet-oppslaget på sosiale medier for ekstra rekkevidde.`,
            actionExecuted: true,
            actionType: "MARK_LOST",
            actionSuccess: true,
            requestFeedback: true,
            model: "direct-lost-executed",
          };
        }
      }
    }

    const suggestions = activePets.map((a: any) => ({
      label: `${a.Name || a.name}`,
      action: "SELECT_PET",
      data: { petId: a.AnimalId || a.animalId || a.PetId || a.petId, petName: a.Name || a.name },
    }));

    return {
      text: "Hvilket dyr vil du melde savnet?",
      suggestions,
      model: "direct-lost-select-pet",
    };
  }

  if (intent === "ReportFoundPet") {
    if (!isAuthenticated) {
      return {
        text: "For å melde dyret ditt funnet, må du logge inn først. Klikk på knappen under for å logge inn med engangskode (OTP).",
        requiresLogin: true,
        model: "direct-found-login",
      };
    }

    const lostAnimals = ownerContext?.lostStatuses?.filter((l: any) => l.lost) || [];
    if (lostAnimals.length === 0) {
      return {
        text: "Ingen av dine dyr er meldt savnet. Gjelder det et dyr du har funnet? Bruk ID-søk for å slå opp chipnummeret.",
        model: "direct-found-none-lost",
      };
    }

    session.intent = "ReportFoundPet";
    session.collectedData = {};

    if (lostAnimals.length === 1) {
      const lost = lostAnimals[0];
      const ownerId = ownerContext?.owner?.ownerId;
      if (ownerId) {
        const result = performAction(ownerId, "mark_found", { animalId: lost.animalId });
        if (result.success) {
          return {
            text: `**${lost.animalName}** er markert som funnet!\n\nSavnet-varslingen er deaktivert. Så flott at dere fant hverandre igjen!`,
            actionExecuted: true,
            actionType: "MARK_FOUND",
            actionSuccess: true,
            requestFeedback: true,
            model: "direct-found-executed",
          };
        }
      }
    }

    const suggestions = lostAnimals.map((l: any) => ({
      label: l.animalName,
      action: "SELECT_PET",
      data: { petId: l.animalId, petName: l.animalName },
    }));

    return {
      text: "Hvilket dyr er funnet?",
      suggestions,
      model: "direct-found-select-pet",
    };
  }

  if (intent === "LoginIssue" || intent === "LoginProblem" || session.loginHelpStep) {
    if (session.loginHelpStep === "awaiting_sms_confirm") {
      const msgLower = userMessage.toLowerCase().trim();
      const isYes = /^(ja|yes|fikk|mottatt|jep|japp|jepp)/.test(msgLower);
      const isNo = /^(nei|no|ikke|fikk ikke|har ikke)/.test(msgLower);

      if (isYes) {
        session.loginHelpStep = undefined;
        session.intent = undefined;
        return {
          text: "Flott! Da bruker du engangskoden fra SMS-en for å logge inn på Min Side.\n\nKlikk her for å gå til innloggingen:\nhttps://minside.dyreid.no\n\nHvis du får problemer igjen, er det bare å si ifra.",
          helpCenterLink: `${HJELPESENTER_BASE}/hjelp-min-side/11-logg-inn`,
          model: "direct-login-help-success",
          requestFeedback: true,
        };
      } else if (isNo) {
        session.loginHelpStep = undefined;
        session.intent = undefined;
        return {
          text: "Hvis du ikke mottar SMS med engangskode, kan det skyldes:\n\n1. **Feil telefonnummer** - Sjekk at du bruker nummeret registrert i DyreID\n2. **Nummeret er ikke registrert** - Du har kanskje ikke en Min Side ennå\n3. **Teknisk feil** - Prøv igjen om noen minutter\n\nHvis problemet vedvarer, ta kontakt med DyreID kundeservice så hjelper vi deg videre.",
          helpCenterLink: `${HJELPESENTER_BASE}/hjelp-min-side/14-far-ikke-logget-inn`,
          model: "direct-login-help-no-sms",
          requestFeedback: true,
        };
      }
    }

    if (session.loginHelpStep === "awaiting_phone") {
      const digits = userMessage.replace(/\D/g, "");
      if (digits.length === 8) {
        session.collectedData["loginPhone"] = digits;
        session.loginHelpStep = "awaiting_sms_confirm";
        return {
          text: `Vi prøver innlogging med **${digits}**.\n\nDu skal nå motta en SMS med en engangskode (OTP) på dette nummeret.\n\nFikk du en SMS?`,
          suggestions: [
            { label: "Ja, fikk SMS", action: "CONFIRM_SMS" },
            { label: "Nei, ingen SMS", action: "DENY_SMS" },
          ],
          model: "direct-login-help-awaiting-sms",
        };
      }
      return {
        text: "Jeg trenger et gyldig norsk mobilnummer (8 siffer). Hvilket telefonnummer bruker du for å logge inn?",
        model: "direct-login-help-retry-phone",
      };
    }

    session.intent = intent || "LoginIssue";
    session.loginHelpStep = "awaiting_phone";
    session.collectedData = {};
    return {
      text: "Jeg hjelper deg med innlogging på Min Side. Vi bruker engangskode (OTP) via SMS.\n\nHvilket telefonnummer bruker du for å logge inn?",
      model: "direct-login-help-start",
    };
  }

  if (intent === "PetDeceased" || session.directIntentFlow === "PetDeceased") {
    if (!isAuthenticated) {
      return {
        text: "For å registrere at kjæledyret ditt er dødt, må du logge inn først. Klikk på knappen under for å logge inn med engangskode (OTP).\n\nEtter innlogging kan du velge dyret og markere det som avdødt.",
        requiresLogin: true,
        model: "direct-deceased-login",
      };
    }

    if (session.directIntentFlow === "PetDeceased" && session.collectedData["petId"]) {
      const msgLower = userMessage.toLowerCase().trim();
      const isConfirm = /^(ja|yes|bekreft|marker|ok)/.test(msgLower);
      if (isConfirm) {
        const petName = session.collectedData["petName"] || "Dyret";
        const ownerId = ownerContext?.owner?.ownerId || storedUserContext?.OwnerId;
        if (ownerId) {
          const result = performAction(ownerId, "mark_deceased", { animalId: session.collectedData["petId"] });
          if (result.success) {
            session.directIntentFlow = undefined;
            session.intent = undefined;
            session.collectedData = {};
            return {
              text: `**${petName}** er nå markert som avdødt.\n\nVi beklager tapet ditt. Registreringen er oppdatert og dyret vil ikke lenger vises som aktivt.\n\nHvis du har spørsmål om registreringen, er det bare å si ifra.`,
              actionExecuted: true,
              actionType: "MARK_DECEASED",
              actionSuccess: true,
              requestFeedback: true,
              model: "direct-deceased-executed",
            };
          }
        }
      }
      session.directIntentFlow = undefined;
      session.intent = undefined;
      session.collectedData = {};
      return {
        text: "Forstått, avbryter. Er det noe annet jeg kan hjelpe deg med?",
        model: "direct-deceased-cancelled",
      };
    }

    const animals = ownerContext?.animals || [];
    const minSidePets = storedUserContext?.Pets || [];
    const activePets = animals.length > 0
      ? animals.filter((a: any) => a.status === "active").map((a: any) => formatPetForMetadata(a, "sandbox"))
      : minSidePets;

    if (activePets.length === 0) {
      return {
        text: "Du har ingen aktive registrerte dyr. Hvis du mener dette er feil, ta kontakt med DyreID kundeservice.",
        model: "direct-deceased-no-pets",
      };
    }

    session.directIntentFlow = "PetDeceased";

    const msgLower = userMessage.toLowerCase().trim();
    const matchedPet = activePets.find((p: any) => {
      const name = (p.Name || p.name || "").toLowerCase();
      return name && msgLower.includes(name);
    });
    if (matchedPet) {
      const petId = matchedPet.AnimalId || matchedPet.animalId || matchedPet.PetId || matchedPet.petId;
      const petName = matchedPet.Name || matchedPet.name;
      session.collectedData = { petId, petName };
      return {
        text: `Jeg beklager å høre det. Ønsker du å markere **${petName}** som avdødt?`,
        suggestions: [
          { label: "Ja, bekreft", action: "CONFIRM_DECEASED" },
          { label: "Nei, avbryt", action: "CANCEL" },
        ],
        model: "direct-deceased-confirm",
      };
    }

    if (activePets.length === 1) {
      const pet = activePets[0];
      const petId = pet.AnimalId || pet.animalId || pet.PetId || pet.petId;
      const petName = pet.Name || pet.name;
      session.collectedData = { petId, petName };
      return {
        text: `Jeg beklager å høre det. Ønsker du å markere **${petName}** som avdødt?`,
        suggestions: [
          { label: "Ja, bekreft", action: "CONFIRM_DECEASED" },
          { label: "Nei, avbryt", action: "CANCEL" },
        ],
        pets: [pet],
        model: "direct-deceased-confirm",
      };
    }

    session.collectedData = {};
    const suggestions = activePets.map((a: any) => ({
      label: `${a.Name || a.name}`,
      action: "SELECT_PET",
      data: { petId: a.AnimalId || a.animalId || a.PetId || a.petId, petName: a.Name || a.name },
    }));

    return {
      text: "Jeg beklager å høre det. Hvilket kjæledyr gjelder det?",
      suggestions,
      model: "direct-deceased-select-pet",
      pets: activePets,
    };
  }

  if (intent === "WrongInfo" || session.directIntentFlow === "WrongInfo") {
    if (!isAuthenticated) {
      return {
        text: "Jeg kan hjelpe deg med å rette opp feil informasjon på dyret ditt. Klikk på knappen under for å logge inn med engangskode (OTP), så finner vi dyret det gjelder.",
        requiresLogin: true,
        model: "direct-wronginfo-login",
      };
    }

    if (session.directIntentFlow === "WrongInfo" && session.collectedData["petId"]) {
      const petName = session.collectedData["petName"] || "Dyret";
      if (!session.collectedData["whatToChange"]) {
        session.collectedData["whatToChange"] = userMessage;
        const ownerId = ownerContext?.owner?.ownerId || storedUserContext?.OwnerId;
        if (ownerId) {
          const result = performAction(ownerId, "update_profile", {});
          session.directIntentFlow = undefined;
          session.intent = undefined;
          const data = session.collectedData;
          session.collectedData = {};
          return {
            text: `Takk! Jeg har registrert ønsket endring for **${petName}**: "${data["whatToChange"]}"\n\nEndringen er sendt til oppdatering. Merk at noen endringer (som chipnummer eller rase) kan kreve bekreftelse fra veterinær.\n\nEr det noe annet jeg kan hjelpe deg med?`,
            actionExecuted: true,
            actionType: "UPDATE_PET_INFO",
            actionSuccess: true,
            requestFeedback: true,
            model: "direct-wronginfo-executed",
          };
        }
      }
    }

    const animals = ownerContext?.animals || [];
    const minSidePets = storedUserContext?.Pets || [];
    const activePets = animals.length > 0
      ? animals.filter((a: any) => a.status === "active").map((a: any) => formatPetForMetadata(a, "sandbox"))
      : minSidePets;

    if (activePets.length === 0) {
      return {
        text: "Du har ingen registrerte dyr. Hvis du mener dette er feil, ta kontakt med DyreID kundeservice.",
        model: "direct-wronginfo-no-pets",
      };
    }

    session.directIntentFlow = "WrongInfo";

    const msgLower = userMessage.toLowerCase().trim();
    const matchedPet = activePets.find((p: any) => {
      const name = (p.Name || p.name || "").toLowerCase();
      return name && msgLower.includes(name);
    });
    if (matchedPet) {
      const petId = matchedPet.AnimalId || matchedPet.animalId || matchedPet.PetId || matchedPet.petId;
      const petName = matchedPet.Name || matchedPet.name;
      session.collectedData = { petId, petName };
      return {
        text: `Hva er feil med informasjonen for **${petName}**? Beskriv hva som bør endres (f.eks. feil navn, rase, fødselsdato, chipnummer).`,
        model: "direct-wronginfo-what",
      };
    }

    if (activePets.length === 1) {
      const pet = activePets[0];
      const petId = pet.AnimalId || pet.animalId || pet.PetId || pet.petId;
      const petName = pet.Name || pet.name;
      session.collectedData = { petId, petName };
      return {
        text: `Hva er feil med informasjonen for **${petName}**? Beskriv hva som bør endres (f.eks. feil navn, rase, fødselsdato, chipnummer).`,
        model: "direct-wronginfo-what",
      };
    }

    session.collectedData = {};
    const suggestions = activePets.map((a: any) => ({
      label: `${a.Name || a.name}`,
      action: "SELECT_PET",
      data: { petId: a.AnimalId || a.animalId || a.PetId || a.petId, petName: a.Name || a.name },
    }));

    return {
      text: "Hvilket dyr har feil informasjon?",
      suggestions,
      model: "direct-wronginfo-select-pet",
      pets: activePets,
    };
  }

  if (intent === "WrongOwner") {
    return {
      text: "Hvis dyret ditt er registrert på feil person, må dette løses via et **eierskifte**.\n\nDet finnes to måter å gjøre dette på:\n\n1. **Via DyreID-appen** - Nåværende registrert eier starter eierskifte i appen\n2. **Her i chatten** - Jeg kan hjelpe deg med eierskifte etter innlogging med OTP\n\nHvis du ikke kjenner den registrerte eieren, kan du gjøre et **ID-søk** med chipnummeret for å finne kontaktinfo.\n\nHva vil du gjøre?",
      suggestions: [
        { label: "Start eierskifte", action: "SELECT_PET", data: { intent: "OwnershipTransferWeb" } },
        { label: "Søk opp chipnummer", action: "SELECT_PET", data: { intent: "ChipLookup" } },
      ],
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-eierskifte/41-eierskifte-av-nkk-registrert-hund`,
      model: "direct-wrongowner-info",
      requestFeedback: true,
    };
  }

  if (intent === "MissingPetProfile") {
    if (!isAuthenticated) {
      return {
        text: "Jeg kan sjekke om dyret ditt mangler på profilen din. Klikk på knappen under for å logge inn med engangskode (OTP), så ser vi på det sammen.",
        requiresLogin: true,
        model: "direct-missingpet-login",
      };
    }

    const animals = ownerContext?.animals || [];
    const minSidePets = storedUserContext?.Pets || [];
    const petCount = animals.length || minSidePets.length;

    return {
      text: `Du har **${petCount} dyr** registrert på din profil.\n\nHvis et dyr mangler kan det skyldes:\n- Dyret er registrert på en annen person\n- Dyret er ikke registrert i DyreID ennå\n- Dyret har blitt overført til en annen eier\n\nHvis du vet chipnummeret til dyret som mangler, kan jeg gjøre et oppslag for å finne ut hvem det er registrert på.\n\nVil du søke opp et chipnummer?`,
      suggestions: [
        { label: "Søk opp chipnummer", action: "SELECT_PET", data: { intent: "ChipLookup" } },
      ],
      model: "direct-missingpet-info",
      requestFeedback: true,
      pets: animals.length > 0 ? animals.filter((a: any) => a.status === "active").map((a: any) => formatPetForMetadata(a, "sandbox")) : minSidePets,
    };
  }

  if (intent === "InactiveRegistration") {
    return {
      text: "Hvis kjæledyret ditt ikke er søkbart i DyreID, kan det skyldes:\n\n1. **Registreringen er ikke betalt** - Sjekk at registreringsavgiften er betalt\n2. **Nylig registrert** - Det kan ta opptil 24 timer før dyret er søkbart\n3. **Inaktiv chip** - Chipen kan ha blitt deaktivert\n\nFor å sjekke status og aktivere registreringen, klikk på knappen under for å logge inn med engangskode (OTP).",
      requiresLogin: true,
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-id-sok/3-kjaledyret-er-ikke-sokbart`,
      model: "direct-inactive-info",
      requestFeedback: true,
    };
  }

  if (intent === "NewRegistration") {
    return {
      text: "For å registrere et nytt dyr i DyreID, må du ta det med til en **veterinær**.\n\n**Slik gjør du:**\n1. Bestill time hos en veterinærklinikk\n2. Veterinæren implanterer en mikrochip (hvis dyret ikke allerede har en)\n3. Veterinæren registrerer dyret i DyreID\n4. Du får tilgang til Min Side og kan administrere dyrets profil\n\n**Pris:** Registrering koster vanligvis 590 kr (inkl. chip og registrering).\n\nHar dyret allerede en chip? Da kan du sjekke om det er registrert ved å oppgi chipnummeret.",
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-id-sok/1-hvorfor-bor-jeg-id-merke`,
      model: "direct-newreg-info",
      requestFeedback: true,
    };
  }

  if (intent === "NKKOwnership") {
    return {
      text: "Eierskifte av NKK-registrert hund håndteres av **Norsk Kennelklubb (NKK)**.\n\nNKK har egne regler og prosedyrer for eierskifte av stambokførte hunder. Du må kontakte NKKs sekretariat direkte for å gjennomføre eierskiftet.\n\n**Kontakt NKK:**\nBesøk NKKs sekretariat-side for kontaktinformasjon og veiledning:\nhttps://www.nkk.no/om-nkk/sekretariatet/\n\nNår eierskiftet er registrert hos NKK, vil oppdateringen også gjelde i DyreID.",
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-eierskifte/41-eierskifte-av-nkk-registrert-hund`,
      model: "direct-nkk-info",
      requestFeedback: true,
    };
  }

  if (intent === "QRTagActivation") {
    return {
      text: "QR-brikken må aktiveres i **DyreID-appen** før du tar den i bruk. Alle som finner kjæledyret ditt kan skanne QR-brikken og ringe deg direkte.\n\nSlik aktiverer du brikken:\n\n1. Åpne DyreID-appen\n2. Klikk på QR-brikke-ikonet på forsiden eller under Meny\n3. Skann QR-koden på brikken\n4. Skriv inn telefonnummeret ditt\n5. Skriv inn chipnummer på kjæledyret\n6. Kryss av for kontaktdata som skal vises ved skanning\n7. Husk å aktivere pushvarsel i appen\n\nHar du problemer med å skanne koden i appen? Prøv å skanne den med kameraet på mobilen i stedet.",
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-qr-brikke/35-aktivere-qr`,
      model: "direct-qr-info",
      requestFeedback: true,
    };
  }

  if (intent === "UnregisteredChip578") {
    return {
      text: "**Uregistrert 578-brikke**\n\nNoen ID-merker som begynner med **578** (Norges landskode) er likevel ikke registrert hos DyreID. Dette gjelder brikker som ikke er **forhåndsbetalte** hos oss – de er såkalte uregistrerte brikker og betraktes som **utlandsregistrerte**.\n\nDette betyr at selv om dyret er ID-merket hos en veterinær i Norge, er ikke chipen automatisk registrert i DyreID-registeret.\n\n**Hva må du gjøre?**\nFor å få dyret registrert i DyreID med en slik brikke, må du ta kontakt med en veterinær som kan registrere chipen hos oss. Dette koster **676 kr** og følger samme prosedyre som for utlandsregistrering.\n\nLes mer om prosessen her:\nhttps://hjelpesenter.dyreid.no/hjelp-utenlandsregistrering/43-registrering-norge",
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/43-registrering-norge`,
      model: "direct-unregistered-578",
      requestFeedback: true,
    };
  }

  if (intent === "ForeignRegistration") {
    return {
      text: "**Registrering av dyr med utenlandsk eller uregistrert chip i Norge**\n\nFor å registrere et dyr i DyreID som har en utenlandsk chip, eller en **uregistrert 578-brikke** (brikke som begynner med 578 men ikke er forhåndsbetalt hos oss), må du ta kontakt med en **veterinær**.\n\n**OBS:** Ikke alle brikker som begynner med 578 er registrert hos DyreID. Noen 578-brikker er ikke forhåndsbetalte og betraktes som utlandsregistrerte. Disse må registreres på nytt.\n\n**Slik gjør du:**\n1. Bestill time hos en veterinærklinikk\n2. Veterinæren skanner chipen og registrerer dyret i DyreID\n3. Registreringen koster **676 kr**\n4. Du får tilgang til Min Side og kan administrere dyrets profil\n\nLes mer: https://hjelpesenter.dyreid.no/hjelp-utenlandsregistrering/43-registrering-norge",
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/43-registrering-norge`,
      model: "direct-foreign-registration",
      requestFeedback: true,
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
- Nar handlinger krever autentisering, be kunden logge inn via OTP-knappen i chatten - ALDRI be kunden logge inn eksternt pa Min Side med telefon og passord
- Forklar tydelig hva du gjor og hvorfor
- Bruk informasjon fra playbook-entries til a gi presise svar
- ALDRI si "logg inn pa Min Side" eller "ga til Min Side for a logge inn" - innlogging skjer alltid via OTP i denne chatten

KUNDEN ER ${isAuthenticated ? "INNLOGGET" : "IKKE INNLOGGET"}

HANDLINGER DU KAN UTFORE (etter autentisering via Min Side):
- Vise kundens dyr og profil
- Melde dyr savnet/funnet
- Starte eierskifte
- Markere kjaeledyr som avdodt
- Sende betalingslink
- Oppdatere profilinformasjon

HANDLINGER SOM GJORES I DYREID-APPEN (IKKE Min Side):
- Aktivere QR-brikke (gjores i DyreID-appen, ikke via Min Side)
- Aktivere Smart Tag (gjores i DyreID-appen)
- Eierskifte i appen (gjores i DyreID-appen)

VIKTIG: For handlinger som gjores i appen, gi instruksjoner istedenfor a be om innlogging.
For informasjonssporsmaal (priser, prosedyrer, hjelpesenter-info), gi svaret direkte uten a be om innlogging.
Be KUN om innlogging nar handlingen faktisk krever tilgang til Min Side data.

UREGISTRERTE 578-BRIKKER:
Ikke alle ID-merker som begynner med 578 er registrert hos DyreID. Noen 578-brikker er ikke forhandsbetalt hos oss og betraktes som utlandsregistrerte. Disse ma registreres pa nytt via en veterinaer (koster 676 kr). Folger samme prosedyre som utenlandsregistrering.

Nar du identifiserer at en handling er nodvendig, inkluder en ACTION-blokk i svaret ditt:
[ACTION: action_name | param1=value1 | param2=value2]

Gyldige actions:
- [ACTION: request_auth] - Be kunden logge inn (KUN for Min Side-handlinger)
- [ACTION: mark_lost | animalId=X]
- [ACTION: mark_found | animalId=X]
- [ACTION: mark_deceased | animalId=X]
- [ACTION: initiate_transfer | animalId=X | newOwnerPhone=X]
- [ACTION: send_payment_link | paymentType=X]
- [ACTION: update_profile | field=value]
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
      text: `For å ${playbook.primaryAction || "utføre denne handlingen"}, må du logge inn først. Klikk på knappen under for å logge inn med engangskode (OTP).`,
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

  if (session.chipLookupFlow) {
    const chipResponse = handleChipLookupFlow(session, userMessage, isAuthenticated, ownerContext, storedUserContext || null);
    if (chipResponse) {
      let responseText = chipResponse.text;
      if (chipResponse.suggestions && chipResponse.suggestions.length > 0) {
        const suggestionLabels = chipResponse.suggestions
          .filter(s => s.action !== "REQUEST_LOGIN")
          .map(s => s.label);
        if (suggestionLabels.length > 0) {
          responseText += "\n\nValg:\n" + suggestionLabels.map((l, i) => `${i + 1}. ${l}`).join("\n");
        }
      }

      const metadata: any = {
        model: chipResponse.model,
        chipLookup: true,
      };
      if (chipResponse.actionExecuted) {
        metadata.actionExecuted = true;
        metadata.actionType = chipResponse.actionType;
        metadata.actionSuccess = chipResponse.actionSuccess;
      }
      if (chipResponse.requiresLogin) metadata.requiresLogin = true;
      if (chipResponse.suggestions) metadata.suggestions = chipResponse.suggestions;

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
        responseMethod: chipResponse.model,
        matchedIntent: "ChipLookup",
        actionsExecuted: chipResponse.actionExecuted ? [{ action: chipResponse.actionType, success: chipResponse.actionSuccess }] : null,
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

  const chipInMessage = extractChipNumber(userMessage);

  const categoryMenu = detectCategoryMenu(userMessage);
  if (categoryMenu) {
    const subtopicLines = categoryMenu.subtopics.map((s, i) => {
      const desc = s.description || (s.url ? "Les mer på hjelpesenteret" : "");
      return `${i + 1}. **${s.label}**${desc ? ` - ${desc}` : ""}`;
    }).join("\n");
    const responseText = `${categoryMenu.intro}\n\n${subtopicLines}`;

    const suggestions = categoryMenu.subtopics.map(s => ({
      label: s.label,
      action: "SUBTOPIC" as string,
      data: { query: s.query, url: s.url, intent: s.intent },
    }));

    const metadata: any = {
      model: "category-menu",
      matchedIntent: `CategoryMenu_${categoryMenu.title}`,
      suggestions,
    };

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
      responseMethod: "category-menu",
      matchedIntent: `CategoryMenu_${categoryMenu.title}`,
      actionsExecuted: null,
      authenticated: isAuthenticated,
      responseTimeMs: Date.now() - startTime,
    });

    await db
      .update(messages)
      .set({ metadata: { ...metadata, interactionId: interaction.id } })
      .where(eq(messages.id, msg.id));

    yield responseText;
    return;
  }

  const { intent, playbook, method } = await matchUserIntent(
    userMessage, conversationId, isAuthenticated, ownerContext, storedUserContext
  );

  if (chipInMessage && !session.chipLookupFlow) {
    session.chipLookupFlow = "awaiting_chip";
    const chipResponse = handleChipLookupFlow(session, userMessage, isAuthenticated, ownerContext, storedUserContext || null);
    if (chipResponse) {
      let responseText = chipResponse.text;
      if (chipResponse.suggestions && chipResponse.suggestions.length > 0) {
        const suggestionLabels = chipResponse.suggestions
          .filter(s => s.action !== "REQUEST_LOGIN")
          .map(s => s.label);
        if (suggestionLabels.length > 0) {
          responseText += "\n\nValg:\n" + suggestionLabels.map((l, i) => `${i + 1}. ${l}`).join("\n");
        }
      }
      const metadata: any = { model: chipResponse.model, chipLookup: true };
      if (chipResponse.suggestions) metadata.suggestions = chipResponse.suggestions;

      const msg = await storage.createMessage({ conversationId, role: "assistant", content: responseText, metadata });
      const interaction = await storage.logChatbotInteraction({
        conversationId, messageId: msg.id, userQuestion: userMessage, botResponse: responseText,
        responseMethod: chipResponse.model, matchedIntent: "ChipLookup",
        actionsExecuted: null, authenticated: isAuthenticated, responseTimeMs: Date.now() - startTime,
      });
      lastInteractionId = interaction.id;
      await db.update(messages).set({ metadata: { ...metadata, interactionId: interaction.id } }).where(eq(messages.id, msg.id));
      yield responseText;
      return;
    }
  }

  if (isChipLookupTrigger(intent) && !session.chipLookupFlow && !chipInMessage) {
    session.chipLookupFlow = "awaiting_chip";
    session.intent = intent || undefined;
    const responseText = "Jeg kan hjelpe deg med å slå opp dyret i registeret. Har du dyrets ID-nummer (chipnummer)? Det er vanligvis 15 siffer og står på registreringsbeviset eller kan leses av en veterinær.";
    const metadata: any = { model: "chip-lookup-start", chipLookup: true };
    const msg = await storage.createMessage({ conversationId, role: "assistant", content: responseText, metadata });
    const interaction = await storage.logChatbotInteraction({
      conversationId, messageId: msg.id, userQuestion: userMessage, botResponse: responseText,
      responseMethod: "chip-lookup-start", matchedIntent: intent,
      actionsExecuted: null, authenticated: isAuthenticated, responseTimeMs: Date.now() - startTime,
    });
    lastInteractionId = interaction.id;
    await db.update(messages).set({ metadata: { ...metadata, interactionId: interaction.id } }).where(eq(messages.id, msg.id));
    yield responseText;
    return;
  }

  const DIRECT_INTENTS = ["ViewMyPets", "OwnershipTransferWeb", "ReportLostPet", "ReportFoundPet", "QRTagActivation", "PetDeceased", "NKKOwnership", "LoginIssue", "LoginProblem", "UnregisteredChip578", "ForeignRegistration", "WrongInfo", "WrongOwner", "MissingPetProfile", "InactiveRegistration", "NewRegistration"];
  if ((intent && DIRECT_INTENTS.includes(intent)) || session.directIntentFlow || session.loginHelpStep) {
    const effectiveIntent = session.directIntentFlow || intent || "";
    const directResponse = handleDirectIntent(effectiveIntent, session, isAuthenticated, ownerContext, storedUserContext || null, userMessage);
    if (directResponse) {
      const metadata: any = {
        model: directResponse.model,
        matchedIntent: effectiveIntent,
        directAction: true,
      };
      if (directResponse.actionExecuted) {
        metadata.actionExecuted = true;
        metadata.actionType = directResponse.actionType;
        metadata.actionSuccess = directResponse.actionSuccess;
      }
      if (directResponse.requiresLogin) metadata.requiresLogin = true;
      if (directResponse.suggestions) metadata.suggestions = directResponse.suggestions;
      if (directResponse.pets) metadata.pets = directResponse.pets;

      const msg = await storage.createMessage({
        conversationId,
        role: "assistant",
        content: directResponse.text,
        metadata,
      });

      const interaction = await storage.logChatbotInteraction({
        conversationId,
        messageId: msg.id,
        userQuestion: userMessage,
        botResponse: directResponse.text,
        responseMethod: directResponse.model,
        matchedIntent: intent,
        actionsExecuted: directResponse.actionExecuted
          ? [{ action: directResponse.actionType, success: directResponse.actionSuccess }]
          : null,
        authenticated: isAuthenticated,
        responseTimeMs: Date.now() - startTime,
      });
      lastInteractionId = interaction.id;

      await db
        .update(messages)
        .set({ metadata: { ...metadata, interactionId: interaction.id } })
        .where(eq(messages.id, msg.id));

      yield directResponse.text;
      return;
    }
  }

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
      const pbHelpLink = playbookResponse.helpCenterLink || (intent ? getHelpCenterUrl(intent) : null);
      if (pbHelpLink) {
        metadata.helpCenterLink = pbHelpLink;
      }
      if (playbookResponse.suggestions) {
        metadata.suggestions = playbookResponse.suggestions;
      }
      if (playbookResponse.pets) {
        metadata.pets = playbookResponse.pets;
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

  const helpCenterLink = intent ? getHelpCenterUrl(intent) : null;

  const aiMetadata: any = {
    ...(actions.length > 0 ? { actions } : {}),
    ...(intent ? { matchedIntent: intent, method } : {}),
    ...(helpCenterLink ? { helpCenterLink } : {}),
  };

  const msg = await storage.createMessage({
    conversationId,
    role: "assistant",
    content: finalContent,
    metadata: aiMetadata,
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
    .set({ metadata: { ...aiMetadata, interactionId: interaction.id } })
    .where(eq(messages.id, msg.id));
}
