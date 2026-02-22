import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { getMinSideContext, performAction, lookupOwnerByPhone, lookupByChipNumber, sendOwnershipTransferSms } from "./minside-sandbox";
import type { ChipLookupResult } from "./minside-sandbox";
import { getStoredSession } from "./minside-client";
import { messages, type PlaybookEntry, type ServicePrice, type ResponseTemplate } from "@shared/schema";
import { findSemanticMatch, findTopNSemanticMatches, getApprovedIntentIds, getIndexSize, isIndexReady, refreshIntentIndex } from "./intent-index";
import { recordPilotMatch, isPilotEnabled } from "./pilot-stats";
import { ensureRuntimeIntentsInCanonical, validateRuntimeIntents, getApprovedIntentSet } from "./canonical-intents";
import { isNormalizationEnabled, normalizeInput, fuzzyLabelFallback, logFuzzyMatch } from "./input-normalization";
import { isEscalationEnabled, validateEmail, createEscalation, detectFrustration } from "./case-escalation";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let priceCache: Map<string, number> = new Map();
let priceCacheLastLoad = 0;
const PRICE_CACHE_TTL = 60_000;

export async function ensurePriceCache(): Promise<void> {
  if (Date.now() - priceCacheLastLoad < PRICE_CACHE_TTL && priceCache.size > 0) return;
  try {
    const prices = await storage.getActiveServicePrices();
    const m = new Map<string, number>();
    for (const p of prices) m.set(p.serviceKey, p.price);
    priceCache = m;
    priceCacheLastLoad = Date.now();
  } catch (e) {
    console.error("[PriceCache] Failed to load prices:", e);
  }
}

export function getPrice(key: string, fallback?: number): string {
  const val = priceCache.get(key);
  if (val !== undefined) return val === 0 ? "gratis" : `${val} kr`;
  if (fallback !== undefined) return fallback === 0 ? "gratis" : `${fallback} kr`;
  return "[pris ikke tilgjengelig]";
}

function getPriceNum(key: string): number | undefined {
  return priceCache.get(key);
}

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
  escalationFlow?: "awaiting_resolution_feedback" | "awaiting_email" | "completed";
  escalationContext?: {
    intentId: string | null;
    matchedBy: string | null;
    semanticScore: number | null;
    triggerType: string;
  };
  consecutiveNoProgress?: number;
  hasEscalated?: boolean;
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
  { intent: "WhyIDMark", regex: /hvorfor.*id.?merk|bør.*(?:id.?)?merk|fordel.*(?:chip|id.?merk)|id.?merk.*(?:fordel|viktig)|poenget med.*id|viktig.*id.?merk|hvorfor.*chippe/i },
  { intent: "CheckContactData", regex: /kontrollere.*kontakt|kontaktdata.*(?:riktig|oppdater)|sjekke.*kontakt|verifisere.*kontakt|kontaktinfo|stemmer.*kontakt/i },
  { intent: "InactiveRegistration", regex: /ikke søkbar|kjaledyr.*søkbar|dyr.*søkbar|inaktiv.*registr|registrering.*inaktiv|dukker ikke opp.*søk|finnes ikke.*søk/i },

  // ── DyreID-appen ────────────────────────────────────────
  { intent: "AppTargetAudience", regex: /hvem.*(?:passer|kan bruke|laget for|bør (?:laste|bruke|ha)|målgrupp).*(?:app|appen|dyreid)|(?:app|appen).*(?:for meg|for alle|for hundeeier|for katteeier)|hvem.*bør.*laste.*ned/i },
  { intent: "AppMinSide", regex: /min side.*(?:app|appen)|(?:app|appen).*min side|profil.*appen|min side.*funksjon|funksjon.*(?:app|appen).*min side|administrere.*min side.*app/i },
  { intent: "AppAccess", regex: /laste ned.*(?:app|dyreid)|installere.*(?:app|dyreid)|tilgang.*app|(?:app|dyreid).*nedlast|hente.*app|(?:app|dyreid).*(?:iphone|android)/i },
  { intent: "AppLoginIssue", regex: /(?:app|appen).*(?:logg|login|innlogg)|(?:logg|login|innlogg).*(?:app|appen)|(?:app|appen).*(?:nekter|feiler)/i },
  { intent: "AppBenefits", regex: /(?:hvorfor|fordel|funksjoner|bra med|tilbyr|nytte|nyttig|hva får).*(?:app|appen)|(?:app|appen).*(?:fordel|funksjoner|nytte)/i },
  { intent: "FamilySharingRequirement", regex: /(?:treng|krev|forutsett|behøv|må|nødvendig|påkrevd).*(?:dyreID.?(?:\+|pluss)|abonnement|premium).*(?:familie|del)|familiedeling.*(?:dyreID.?(?:\+|pluss)|abonnement|krav|uten)|(?:dyreID.?(?:\+|pluss)).*(?:krav|nødvendig|familiedeling|deling|familie)|(?:familiedeling|dele).*uten.*(?:dyreID|abonnement)/i },
  { intent: "SubscriptionComparison", regex: /basis.*(?:plus|pluss|\+)|(?:dyreID\+|dyreID pluss)(?!.*(?:familie|del))|forskjell.*abonnement|sammenlign.*(?:abonnement|dyreID)|(?:vs|kontra|forskjell).*(?:dyreID|abonnement)|inkludert i.*dyreID\+|skiller.*dyreID/i },
  { intent: "AppCost", regex: /koster.*(?:app|appen|dyreID)|(?:app|appen|dyreID).*(?:gratis|kost|pris)|pris.*(?:app|appen)|abonnementspris|betale.*(?:app|appen)/i },

  // ── Min side ────────────────────────────────────────────
  { intent: "EmailError", regex: /(?:feilmelding|feil|problem).*e-?post|ugyldig.*e-?post|e-?post.*(?:feil|fungerer ikke)|(?:kan ikke|klarer ikke).*(?:endre.*)?e-?post/i },
  { intent: "PhoneError", regex: /(?:feilmelding|feil|problem).*(?:telefon|tlf|nummer)|ugyldig.*nummer|telefon.*(?:feil|vises feil|fungerer ikke)|(?:kan ikke|klarer ikke).*(?:endre.*)?(?:telefon|nummer)/i },
  { intent: "LoginProblem", regex: /(?:får|greier|klarer) ikke.*(?:logg|komm)|hvorfor.*(?:får|kan) (?:jeg )?ikke.*logg|(?:logg|login|innlogg).*(?:fungerer|virker).*ikke|(?:logg|login|innlogg).*(?:feiler|feil(?:er|melding)?)|problem.*(?:innlogg|login|å logg)|feil.*(?:ved|med).*innlogg|innloggingsproblemer|feil passord|(?:umulig|ikke mulig).*(?:å )?logg|feilmelding.*(?:logg|login)|(?:logg|login).*problem|(?:noe|alt).*(?:galt|feil).*(?:innlogg|login)/i },
  { intent: "LoginIssue", regex: /logg.*inn|innlogg|login|passord|bankid.*(?:logg|inn)|hvordan.*komm.*inn|hjelp.*(?:med )?(?:å )?logg/i },
  { intent: "SMSEmailNotification", regex: /(?:hvorfor|har).*(?:fått|mottatt).*(?:sms|e-?post|melding)|(?:sms|e-?post).*(?:fra|varsel).*(?:dyreid|oss)|dyreid.*(?:sms|e-?post|sendte|kontaktet)|(?:fått|mottatt).*(?:sms|e-?post|melding|tekstmelding).*(?:dyreid|fra)/i },
  { intent: "ProfileVerification", regex: /har jeg.*(?:min side|profil|konto)|finnes.*(?:profil|konto)|eksisterer.*(?:konto|profil)|er jeg.*(?:registrert|i dyreid|i systemet)|har jeg en/i },
  { intent: "AddContactInfo", regex: /legge til.*telefon|legge til.*e-?post|flere.*nummer|flere.*kontakt/i },
  { intent: "WrongInfo", regex: /feil informasjon|feil.*(?:opplysning|data|info)(?!.*eier)|korrigere|endre.*opplysning|feil.*navn|endre.*navn|rett.*opp|feil.*profil(?!.*eier)|oppdater.*(?:navn|info)|feilregistrert|dyrenavn.*feil|navn.*feil|endre.*rase|feil.*rase|endre.*kjønn|feil.*kjønn|endre.*fødsel|feil.*fødsel|informasjon.*stemmer.*ikke/i },
  { intent: "MissingPetProfile", regex: /mangler.*(?:dyr|kjæledyr|hund|katt)|(?:dyr|hund|katt|kjæledyr).*(?:vises ikke|borte|mangler|finnes ikke).*(?:min side|profil)|(?:et av|kjæledyret).*borte.*(?:fra|på)|(?:kjæledyr|dyr|hund|katt).*(?:finnes ikke|vises ikke).*min side/i },
  { intent: "OwnershipTransferDead", regex: /(?:eier|person).*(?:er )?død|dødsfall.*eier|arv.*(?:dyr|hund|katt)|(?:eierskift|overf[øo]r).*(?:død|dødsfall|avdød)|avdød.*(?:person|eier)|tilhørte.*avdød|gått bort|overta.*(?:dyr|hund|katt).*(?:eier.*)?(?:død|døde|gått bort)|(?:eierskift|overf[øo]r).*(?:etter|når).*(?:død|gått bort)/i },
  { intent: "PetDeceased", regex: /kjæledyr.*(?:er )?død|(?:hund|katt|dyr).*(?:har )?(?:dødd?|døde|er død)|avlivet|bortgang|melde.*(?:fra.*)?(?:død|avliv)|registrere.*(?:død|avliv)|fjerne.*død|(?:er )?dø(?:dt|d)|(?:hund|katt|dyr).*dø(?:dt|d)/i },
  { intent: "GDPRDelete", regex: /slett(?:e)?.*(?:meg|konto|profil|data|all|personopplysning)|gdpr.*slett|fjerne?.*(?:profil|data|personopplysning)|personvern.*slett|slettet fra/i },
  { intent: "GDPRExport", regex: /eksporter.*data|mine data|gdpr.*eksport|personvern.*data/i },
  { intent: "ViewMyPets", regex: /mine dyr|se dyr|dyrene mine|vis dyr/i },

  // ── Eierskifte (specific subtypes BEFORE general) ──────
  { intent: "OwnershipTransferApp", regex: /eierskift.*(?:app|mobil)|(?:app|appen|mobil(?:app)?).*eierskift|overf[øo]r.*(?:i |via |gjennom |med )?(?:app|appen)|(?:app|appen).*(?:overf[øo]r|bytte eier)|eieroverføring.*(?:app|appen)|bytte eier.*(?:via|i|gjennom).*(?:app|appen)/i },
  { intent: "OwnershipTransferCost", regex: /(?:kost|pris|gebyr|avgift|betale|gratis|billig|dyrt).*(?:eierskift|overf[øo]r.*eier|eieroverføring)|(?:eierskift|overf[øo]r.*eier|eieroverføring).*(?:kost|pris|gebyr|betale|gratis|avgift)|hva (?:koster|må.*betale).*(?:eierskift|bytte eier|overf[øo]r)|pris.*eieroverføring/i },
  { intent: "NKKOwnership", regex: /nkk|norsk kennel|stambokført|rasehund.*eierskift/i },
  { intent: "OwnershipTransferWeb", regex: /eierskift.*min side|via min side|eierskift|selge|solgt|ny eier|overfør.*eier|bytte eier|overf[øo]re.*(?:hund|katt|dyr|eierskap)|eieroverføring/i },

  // ── Smart Tag ───────────────────────────────────────────
  { intent: "SmartTagQRActivation", regex: /qr.*smart.?tag|smart.?tag.*qr|aktivere.*qr.*tag|qr.?kode.*smart/i },
  { intent: "SmartTagActivation", regex: /aktivere.*smart.?tag|smart.?tag.*(?:aktivere|setup|oppsett)|sette opp.*smart|komme i gang.*smart|(?:bruke|starte|ta i bruk).*smart.?tag|smart.?tag.*(?:kom i gang)/i },
  { intent: "SmartTagMultiple", regex: /flere.*(?:smart\s*)?tag|bare.*(?:en|én).*(?:tag|kobl)|smart.?tag.*flere|koblet til én|koble.*flere|(?:to|tre|nummer to|nummer 2|andre).*smart.?tag|smart.?tag.*nummer|(?:kan ikke|får ikke).*koble.*(?:til )?flere/i },
  { intent: "SmartTagConnection", regex: /koble.*smart.?tag|smart.?tag.*kobl|bluetooth.*(?:tag|smart)|(?:kan ikke|får ikke).*koble|legge til.*smart|smart.?tag.*(?:pairing|tilkobling|bluetooth)|tilkobling.*smart/i },
  { intent: "SmartTagMissing", regex: /(?:finner ikke|forsvunnet|borte|vises ikke|mistet).*smart.?tag|smart.?tag.*(?:forsvunnet|borte|vises ikke|forsvant)/i },
  { intent: "SmartTagPosition", regex: /(?:posisjon|lokasjon|plassering|gps|sporing).*(?:smart.?tag|oppdater)|smart.?tag.*(?:posisjon|lokasjon|plassering|gps|sporing)/i },
  { intent: "SmartTagSound", regex: /(?:smart.?tag|tag).*(?:lyd|piper?|bråk|alarm|ringer|lager lyd)|(?:lyd|piper?|bråk).*(?:smart.?tag|tag)/i },

  // ── QR-brikke (specific subtypes BEFORE general) ────────
  { intent: "QRTagLost", regex: /mistet.*(?:qr|brikke)|(?:qr|brikke).*(?:mistet|borte|forsvunnet|falt av)|tapt.*(?:qr|brikke)|mista.*(?:qr|brikke)|(?:hund|katt).*mistet.*(?:qr|brikke)/i },
  { intent: "QRRequiresIDMark", regex: /(?:må|treng|krev|behøv|forutsett).*(?:id.?merk|chip|microchip).*(?:qr|brikke)|(?:qr|brikke).*(?:krav|uten).*(?:chip|id)|(?:id.?merk|chip).*(?:krav|nødvendig).*(?:qr|brikke)|(?:chip|chippet).*for.*qr/i },
  { intent: "QRPricingModel", regex: /qr.*(?:abonnement|engang|pris|kost|betal|månedlig)|(?:abonnement|engang|pris|kost|betal|månedlig).*qr|(?:koster|pris).*(?:qr|brikke)|(?:qr|brikke).*(?:koster|pris)/i },
  { intent: "QRBenefits", regex: /(?:fordel|nytte|verdt|hvorfor).*(?:qr|brikke)|(?:qr|brikke).*(?:nytte|fordel|verdt)/i },
  { intent: "QRTagActivation", regex: /aktivere.*(?:qr|brikke)|(?:qr|brikke).*aktiver|(?:sette|ta).*(?:opp|i bruk).*(?:qr|brikke)|(?:starte|bruke).*(?:qr|brikke)|(?:qr|brikke).*(?:oppsett|komme i gang)|(?:første|gang).*(?:qr|brikke)/i },
  { intent: "QRTagContactInfo", regex: /kontaktinfo.*qr|synlig.*kontakt.*skann|hvem ser.*qr/i },
  { intent: "QRScanResult", regex: /hva (?:skjer|vises|kommer).*(?:skann|qr)|(?:skann|qr).*(?:resultat|hva)|(?:noen|når).*skann/i },
  { intent: "QRUpdateContact", regex: /oppdatere.*kontakt.*qr|endre.*info.*brikke|qr.*kontakt.*endre/i },
  { intent: "QRCompatibility", regex: /(?:qr|brikke).*(?:hund.*katt|katt.*hund)|passer.*(?:qr|brikke)|kompatib.*qr|qr.*(?:for|passer).*(?:alle|katt|hund|kanin|dyr)|(?:katt|hund|kanin).*(?:ha )?qr|qr.*(?:for|kompatib)|(?:hvilke|alle).*dyr.*qr/i },
  { intent: "TagSubscriptionExpiry", regex: /utløper.*abonnement|abonnement.*utløp|tag.*inaktiv/i },

  // ── Utenlandsregistrering ───────────────────────────────
  { intent: "UnregisteredChip578", regex: /578|uregistrert.*(?:brikke|chip)|(?:norsk|norge).*chip.*ikke|chip.*(?:uregistrert|ikke registrert|ikke funnet|ikke i|mangler)|ikke.*forhåndsbetalt/i },
  { intent: "ForeignRegistrationCost", regex: /(?:kost|pris|gebyr|avgift|betale|gratis).*(?:registrer|utenlandsregistrering)|(?:utenlandsregistrering|utenlands.*registrer).*(?:kost|pris|gebyr|avgift)|hva koster.*registrer|676|registreringsavgift.*(?:utenlandsk|utland)|(?:utenlandsk|utland).*(?:dyr|hund|katt).*(?:gratis|kost|pris|gebyr|avgift)|registrering.*kost|kost.*registrering/i },
  { intent: "ForeignPedigree", regex: /stamtavle|pedigree|fci|rasehund.*(?:utland|import)|(?:utland|import).*rasehund|utenlandsk rasehund/i },
  { intent: "ForeignRegistration", regex: /registrer.*(?:i )?norge|(?:utenlands|import|utland).*registrer|registrer.*(?:utland|import)|(?:hund|katt|dyr).*(?:fra )?utland/i },

  // ── Savnet/Funnet ───────────────────────────────────────
  { intent: "LostFoundInfo", regex: /savnet.*funnet.*(?:fungerer|tjenest|virker|info)|hvordan.*savnet.*funnet|savnet og funnet|savnet.funnet.*(?:info|tjenest)|informasjon.*savnet/i },
  { intent: "SearchableMisuse", regex: /misbruk.*søkbar|søkbar.*(?:misbruk|sikkerhet|trygt)|(?:kan|noen).*misbruk.*søkbar/i },
  { intent: "SearchableInfo", regex: /søkbar.*1-?2-?3|hvordan.*søkbar/i },
  { intent: "ReportFoundPet", regex: /(?:funnet|kommet til rette|kommet hjem|funnet igjen|er tilbake|kom tilbake|kom hjem).*(?:dyr|hund|katt|kjæledyr)|(?:dyr|hund|katt|kjæledyr).*(?:funnet|kommet til rette|kommet hjem|er tilbake)|avmelde.*savnet/i },
  { intent: "ReportLostPet", regex: /savnet|melde.*(?:savnet|borte)|(?:hund|katt|dyr|kjæledyr).*(?:borte|forsvunnet|rømte|stakk av|forsvant)|mistet.*(?:hund|katt|dyr)|rapportere.*(?:savnet|borte)/i },

  // ── Familiedeling ───────────────────────────────────────
  { intent: "FamilySharingBenefits", regex: /(?:hvorfor|fordel|nytte|verdt|bra med|grunner|hva (?:er|får)).*familiedeling|familiedeling.*(?:fordel|nytte|verdt|verdi)/i },
  { intent: "FamilySharingNonFamily", regex: /(?:dele|deling|familiedeling).*(?:venn|nabo|hundelufter|ikke.*familie|bare.*for.*familie)|(?:dele|deling|familiedeling).*andre(?!.*(?:gjøre|endre|tilgang|rettighet))|(?:andre|venn|nabo).*(?:dele|tilgang|familiedeling)|(?:ikke|utenfor|bare).*(?:familie|familiemedlem).*(?:dele|tilgang)|(?:hvem).*(?:jeg )?dele.*med/i },
  { intent: "FamilySharingRequest", regex: /(?:forespørsel|invitasjon).*(?:familie|akseptert|godkjen|avvist|venter|mottatt|status|problem)|(?:familie|deling).*(?:forespørsel|invitasjon)|(?:sendt|ikke mottatt|venter).*(?:forespørsel|invitasjon)/i },
  { intent: "FamilySharingPermissions", regex: /(?:rettigheter|tillatelser|begrensninger).*(?:deling|familie|delt)|(?:kan|hva kan).*(?:de|den|delt.*(?:bruker|person)|familiemedlem).*(?:endre|gjøre|tilgang|se)|gjøre endringer.*deling|rettigheter.*delt|hva kan.*(?:andre|de|delt)|familiedeling.*(?:tillatels|rettighet|begrens|hva kan)|(?:delt|familiemedlem).*(?:bruker|person).*(?:endre|gjøre)|kan.*delt.*(?:endre|gjøre|oppdatere)|(?:hva har|hva kan).*(?:de|dem|delt|deler).*(?:tilgang|gjøre|endre|se)|(?:jeg )?deler med.*tilgang/i },
  { intent: "FamilySharing", regex: /sette opp.*(?:deling|familie)|(?:dele|deling).*(?:tilgang|familie)|familiemedlem|(?:legge til|invitere).*(?:familiemedlem|partner|familie)|gi.*(?:partner|familie).*tilgang|(?:hvordan|komme i gang|steg).*dele|familiedeling/i },
  { intent: "FamilyAccessLost", regex: /ser ikke.*delt|mistet.*tilgang.*deling|familie.*borte/i },
  { intent: "FamilySharingExisting", regex: /familiedeling.*eksisterende|deling.*allerede.*kjæledyr/i },

  // ── Chip-oppslag / Feil eier / Registrering ──────────────
  { intent: "WrongOwner", regex: /(?:feil|gal|annen).*(?:eier|person).*(?:registrert|står)|registrert.*(?:på|hos).*(?:feil|gal|annen)|(?:dyr|hund|katt).*(?:på|tilhører|står på).*(?:feil|gal|annen|noen andre)|feil.*eier|(?:eier|eierskap).*feil/i },
  { intent: "PetNotInSystem", regex: /finnes ikke.*(?:system|register)|(?:dyr|hund|katt).*(?:finnes|dukker|er).*ikke|finner ikke.*(?:dyr|hund|katt)|ikke (?:i )?(?:registeret|systemet)|mangler.*register|(?:hund|katt|dyr).*ikke registrert/i },
  { intent: "ChipLookup", regex: /chip.?(?:nummer|søk|sjekk|oppslag|registrering)|søke?.*(?:opp )?chip|finne.*(?:eier.*chip|dyr.*chip)|(?:slå|søke?).*opp.*(?:chip|id)|id.?(?:nummer|søk).*(?:søk|oppslag)|(?:hvem|finne).*eier.*chip|fant.*(?:en|et).*(?:katt|hund|dyr).*chip/i },
  { intent: "NewRegistration", regex: /registrere.*(?:nytt?|ny).*(?:dyr|hund|katt|valp|kattunge)|(?:nytt?|ny).*(?:dyr|hund|katt|valp|kattunge).*registrer|ny.*registrering|(?:nyregistrering|førstegangsregistrering)|(?:hvordan|første gang).*registrer|^registrer.*(?:hund|katt|dyr|valp)$|registrere.*(?:hund|katt|dyr|valp)(?:\s+(?:i|hos|på)\s+)?(?:DyreID)?$/i },

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
    broadRegex: /^(?:eierskifte|hvordan.*eierskift|hjelp.*eierskift|om eierskift|foreta eierskifte|gjøre eierskift|overføre eierskap)[\?\.\!]?$/i,
    title: "Eierskifte",
    intro: "Eierskifte handler om å overføre registreringen av et kjæledyr fra én eier til en annen. Du kan velge et tema nedenfor, eller skrive spørsmålet ditt direkte.",
    subtopics: [
      { label: "Eierskifte via Min side", query: "Eierskifte via Min side", intent: "OwnershipTransferWeb", description: "Gjennomfør eierskifte selv via Min side (krever innlogging)" },
      { label: "Eierskifte i appen", query: "Eierskifte i DyreID-appen", intent: "OwnershipTransferApp", description: "Slik gjør du eierskifte direkte i DyreID-appen", url: `${HJELPESENTER_BASE}/hjelp-eierskifte/39-eierskifte-app` },
      { label: "Hva koster eierskifte?", query: "Hva koster eierskifte?", intent: "OwnershipTransferCost", description: "Priser og betalingsinformasjon for eierskifte", url: `${HJELPESENTER_BASE}/hjelp-eierskifte/40-hva-koster-eierskifte` },
      { label: "Eierskifte når eier er død", query: "Eierskifte når eier er død", intent: "OwnershipTransferDead", description: "Spesiell prosess når tidligere eier er gått bort", url: `${HJELPESENTER_BASE}/hjelp-eierskifte/42-eierskifte-naar-eier-er-dod` },
      { label: "NKK-registrert hund", query: "Eierskifte av NKK-registrert hund", intent: "NKKOwnership", description: "Eierskifte for hunder registrert hos Norsk Kennel Klub", url: `${HJELPESENTER_BASE}/hjelp-eierskifte/41-eierskifte-av-nkk-registrert-hund` },
    ],
  },
  "ID-søk": {
    broadRegex: /^(id.?søk|id.?merk|om id.?merking|hjelp.*id)[\?\.\!]?$/i,
    title: "ID-søk og ID-merking",
    intro: "ID-merking gjør at kjæledyret ditt kan identifiseres og kobles tilbake til deg som eier. Velg et tema, eller beskriv hva du lurer på.",
    subtopics: [
      { label: "Hvorfor bør jeg ID-merke?", query: "Hvorfor bør jeg ID-merke kjæledyret mitt?", intent: "WhyIDMark", description: "Fordeler med å ID-merke kjæledyret ditt", url: `${HJELPESENTER_BASE}/hjelp-id-sok/1-hvorfor-bor-jeg-id-merke` },
      { label: "Kontrollere kontaktdata", query: "Hvordan kontrollere at mine kontaktdata er riktig?", intent: "CheckContactData", description: "Sjekk at opplysningene dine er oppdatert", url: `${HJELPESENTER_BASE}/hjelp-id-sok/2-kontrollere-kontaktdata` },
      { label: "Kjæledyret er ikke søkbart", query: "Kjæledyret mitt er ikke søkbart", intent: "InactiveRegistration", description: "Hjelp når dyret ikke vises i offentlig søk", url: `${HJELPESENTER_BASE}/hjelp-id-sok/3-kjaledyret-er-ikke-sokbart` },
    ],
  },
  "DyreID-appen": {
    broadRegex: /^(dyreid.?appen|om appen|hjelp.*app|dyreID app)[\?\.\!]?$/i,
    title: "DyreID-appen",
    intro: "DyreID-appen gir deg full oversikt over kjæledyrene dine rett på mobilen. Velg det du trenger hjelp med, eller skriv spørsmålet ditt.",
    subtopics: [
      { label: "Tilgang til appen", query: "Hvordan får jeg tilgang til DyreID-appen?", intent: "AppAccess", description: "Last ned og kom i gang med appen", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/4-tilgang-til-appen` },
      { label: "Innlogging", query: "Hjelp med innlogging i DyreID-appen", intent: "AppLoginIssue", description: "Problemer med å logge inn i appen?", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/5-innlogging-app` },
      { label: "Fordelene med appen", query: "Hva er fordelene med DyreID-appen?", intent: "AppBenefits", description: "Se hva appen kan gjøre for deg", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/6-hvorfor-app` },
      { label: "Hvem passer appen for?", query: "Hvem passer DyreID-appen for?", intent: "AppTargetAudience", description: "Finn ut om appen er noe for deg", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/7-hvem-passer-appen-for` },
      { label: "Basis vs DyreID+", query: "Hva er forskjellen på DyreID basis og DyreID+ abonnement?", intent: "SubscriptionComparison", description: "Sammenligning av gratis og premium abonnement", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/8-basis-vs-dyreID-pluss` },
      { label: "Koster appen noe?", query: "Koster DyreID-appen noe?", intent: "AppCost", description: "Prisinformasjon for DyreID-appen", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/9-koster-appen-noe` },
      { label: "Min side i appen", query: "Min side-funksjonalitet i DyreID-appen", intent: "AppMinSide", description: "Administrer profilen din direkte i appen", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/10-min-side-i-appen` },
    ],
  },
  "Min side": {
    broadRegex: /^(min side|om min side|hjelp.*min side|min.?side)[\?\.\!]?$/i,
    title: "Min side",
    intro: "Min side er din personlige portal hos DyreID der du kan administrere kjæledyrene dine, oppdatere kontaktinfo og mye mer. Hva trenger du hjelp med?",
    subtopics: [
      { label: "Logg inn på Min side", query: "Hvordan logger jeg inn på Min side?", intent: "LoginIssue", description: "Veiledning for innlogging via OTP", url: `${HJELPESENTER_BASE}/hjelp-min-side/11-logg-inn` },
      { label: "Fått SMS/e-post fra DyreID", query: "Hvorfor har jeg fått SMS eller e-post fra DyreID?", intent: "SMSEmailNotification", description: "Forstå hvorfor du ble kontaktet av oss", url: `${HJELPESENTER_BASE}/hjelp-min-side/12-sms-epost` },
      { label: "Har jeg en Min side?", query: "Har jeg en Min side?", intent: "ProfileVerification", description: "Finn ut om du allerede har en profil", url: `${HJELPESENTER_BASE}/hjelp-min-side/13-har-jeg-min-side` },
      { label: "Får ikke logget inn", query: "Hvorfor får jeg ikke logget meg inn på Min side?", intent: "LoginProblem", description: "Feilsøking når innlogging ikke fungerer", url: `${HJELPESENTER_BASE}/hjelp-min-side/14-far-ikke-logget-inn` },
      { label: "Feilmelding e-postadresse", query: "Feilmelding ved e-postadresse på Min side", intent: "EmailError", description: "Problemer med e-post ved registrering eller endring", url: `${HJELPESENTER_BASE}/hjelp-min-side/15-feilmelding-epost` },
      { label: "Feilmelding telefonnummer", query: "Feilmelding ved telefonnummer på Min side", intent: "PhoneError", description: "Problemer med telefonnummer ved registrering", url: `${HJELPESENTER_BASE}/hjelp-min-side/16-feilmelding-telefon` },
      { label: "Feil informasjon", query: "Det er feil informasjon på Min side", intent: "WrongInfo", description: "Oppdater feil opplysninger om deg eller dyret", url: `${HJELPESENTER_BASE}/hjelp-min-side/18-feil-info` },
      { label: "Mangler kjæledyr", query: "Det mangler et kjæledyr på Min side", intent: "MissingPetProfile", description: "Dyret ditt vises ikke på profilen din", url: `${HJELPESENTER_BASE}/hjelp-min-side/19-mangler-kjaledyr` },
      { label: "Kjæledyret er dødt", query: "Kjæledyret mitt er dødt, hva gjør jeg?", intent: "PetDeceased", description: "Registrere at et kjæledyr har gått bort", url: `${HJELPESENTER_BASE}/hjelp-min-side/20-kjaledyret-er-dodt` },
      { label: "Slett meg / GDPR", query: "Jeg vil slette profilen min (GDPR)", intent: "GDPRDelete", description: "Be om sletting av personopplysninger", url: `${HJELPESENTER_BASE}/hjelp-min-side/21-slett-meg` },
    ],
  },
  "Smart Tag": {
    broadRegex: /^(smart.?tag|om smart.?tag|hjelp.*smart.?tag)[\?\.\!]?$/i,
    title: "Smart Tag",
    intro: "Smart Tag er DyreIDs Bluetooth-sporing som hjelper deg med å holde oversikt over kjæledyret ditt. Velg et tema nedenfor, eller fortell meg hva du opplever.",
    subtopics: [
      { label: "Aktivering av Smart Tag", query: "Hvordan aktivere Smart Tag?", intent: "SmartTagActivation", description: "Kom i gang med din nye Smart Tag", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/25-aktivering-smart-tag` },
      { label: "Aktiver QR-koden", query: "Aktivere QR-koden på Smart Tag", intent: "SmartTagQRActivation", description: "Aktivere QR-funksjonen på taggen", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/26-aktiver-qr-smart-tag` },
      { label: "Kan ikke koble til", query: "Kan ikke koble til eller legge til Smart Tag", intent: "SmartTagConnection", description: "Feilsøking ved tilkoblingsproblemer", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/27-kan-ikke-koble-smart-tag` },
      { label: "Forsvunnet fra appen", query: "Smart Tag var lagt til men finner den ikke", intent: "SmartTagMissing", description: "Taggen vises ikke lenger i appen", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/28-smart-tag-forsvunnet` },
      { label: "Posisjon ikke oppdatert", query: "Smart Tag posisjonen har ikke oppdatert seg", intent: "SmartTagPosition", description: "Posisjonen oppdateres ikke som forventet", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/29-smart-tag-posisjon` },
      { label: "Lager lyder", query: "Smart Tag lager lyder av seg selv", intent: "SmartTagSound", description: "Uventede lyder fra taggen", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/30-smart-tag-lyd` },
      { label: "Flere tagger", query: "Har flere Smart Tags men får bare koblet til én", intent: "SmartTagMultiple", description: "Problemer med å koble flere tagger samtidig", url: `${HJELPESENTER_BASE}/hjelp-smart-tag/31-smart-tag-flere` },
    ],
  },
  "QR-brikke": {
    broadRegex: /^(qr|qr.?brikke|om qr|hjelp.*qr|qr.?tag|qr.?kode)[\?\.\!]?$/i,
    title: "QR-brikke",
    intro: "QR-brikken fra DyreID festes på halsbåndet og gjør at hvem som helst kan skanne og finne eieren hvis dyret kommer bort. Velg et tema, eller still meg et spørsmål.",
    subtopics: [
      { label: "Passer for hund og katt?", query: "Passer DyreIDs QR-brikke for hund og katt?", intent: "QRCompatibility", description: "Hvilke dyr kan bruke QR-brikken", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/32-qr-kompatibilitet` },
      { label: "Krav om ID-merking?", query: "Må kjæledyret være ID-merket for QR-brikke?", intent: "QRRequiresIDMark", description: "Om det kreves chip for å bruke QR-brikke", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/33-qr-krav-id-merking` },
      { label: "Abonnement eller engang?", query: "Er QR-brikke abonnement eller engangskostnad?", intent: "QRPricingModel", description: "Prisinformasjon og betalingsmodell", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/34-qr-prismodell` },
      { label: "Hvordan aktivere?", query: "Hvordan aktivere QR-brikken?", intent: "QRTagActivation", description: "Steg for å komme i gang med brikken", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/35-aktivere-qr` },
      { label: "Hva skjer når QR skannes?", query: "Hva skjer når QR-koden skannes?", intent: "QRScanResult", description: "Hva finner den som skanner koden", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/37-qr-skanning` },
      { label: "Fordeler med QR-brikke", query: "Hva er fordelen med DyreIDs QR-brikke?", intent: "QRBenefits", description: "Hvorfor du bør ha en QR-brikke", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/39-qr-fordeler` },
      { label: "Mistet brikken", query: "Jeg har mistet QR-brikken min", intent: "QRTagLost", description: "Hva gjør du hvis brikken er borte", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/40-mistet-qr` },
    ],
  },
  Utenlandsregistrering: {
    broadRegex: /^(?:utenlandsregistrering|utenlandsk dyr|registrere.*utland|hjelp.*utenlands|importert dyr)[\?\.\!]?$/i,
    title: "Utenlandsregistrering",
    intro: "Har du et dyr med utenlandsk chip, eller en brikke som ikke er registrert hos DyreID? Vi hjelper deg med å få det på plass. Merk at noen brikker med 578-prefix (Norges landskode) likevel kan være uregistrerte.",
    subtopics: [
      { label: "Registrere dyr i Norge", query: "Hvordan få dyret registrert i Norge?", intent: "ForeignRegistration", description: "Slik registrerer du et utenlandsk dyr hos DyreID", url: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/43-registrering-norge` },
      { label: "Uregistrert 578-brikke", query: "Chipen begynner med 578 men er ikke registrert hos DyreID", intent: "UnregisteredChip578", description: "Brikken har norsk kode men er ikke i systemet", url: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/43-registrering-norge` },
      { label: "Hva koster registrering?", query: "Hva koster det å registrere et dyr i Norge?", intent: "ForeignRegistrationCost", description: "Priser for registrering av utenlandske dyr", url: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/44-kostnad-registrering` },
      { label: "Hund med stamtavle", query: "Registrering av utenlandsk hund med stamtavle", intent: "ForeignPedigree", description: "Spesiell prosess for rasehunder med stamtavle", url: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/45-utenlandsk-stamtavle` },
    ],
  },
  "Savnet/Funnet": {
    broadRegex: /^(?:savnet|funnet|savnet.*funnet|hjelp.*savnet)[\?\.\!]?$/i,
    title: "Savnet/Funnet",
    intro: "Har kjæledyret ditt forsvunnet, eller har du funnet et dyr? DyreIDs Savnet & Funnet-tjeneste hjelper med å gjenforene dyr og eiere. Velg det som passer, eller fortell meg hva som har skjedd.",
    subtopics: [
      { label: "Melde kjæledyr savnet", query: "Hvordan melde mitt kjæledyr savnet?", intent: "ReportLostPet", description: "Registrer dyret som savnet for å nå ut til folk i området" },
      { label: "Dyret har kommet til rette", query: "Kjæledyret har kommet til rette", intent: "ReportFoundPet", description: "Oppdater statusen når dyret er funnet igjen" },
      { label: "Hvordan fungerer tjenesten?", query: "Hvordan fungerer Savnet og Funnet-tjenesten?", intent: "LostFoundInfo", description: "Les om hvordan Savnet & Funnet virker", url: `${HJELPESENTER_BASE}/hjelp-savnet-funnet/48-savnet-funnet-info` },
      { label: "Søkbar på 1-2-3", query: "Hvordan fungerer Søkbar på 1-2-3?", intent: "SearchableInfo", description: "Gjør kjæledyret ditt søkbart raskt", url: `${HJELPESENTER_BASE}/hjelp-savnet-funnet/49-sokbar-123` },
      { label: "Kan Søkbar misbrukes?", query: "Kan Søkbar på 1-2-3 misbrukes?", intent: "SearchableMisuse", description: "Informasjon om sikkerhet og personvern", url: `${HJELPESENTER_BASE}/hjelp-savnet-funnet/50-sokbar-misbruk` },
    ],
  },
  Registrering: {
    broadRegex: /^(feil.*registrering|manglende.*registrering|registrering.*(?:av\s)?dyr|registrering.*feil|feil.*manglende.*registr\w*|problem.*registrering|hjelp.*registrering)(?:\s+\w+)*[\?\.\!]?$/i,
    title: "Feil eller manglende registrering",
    intro: "Det kan være frustrerende når registreringen ikke stemmer. Fortell meg hva som er feil, eller velg det som passer best nedenfor.",
    subtopics: [
      { label: "Feil informasjon registrert", query: "Det er feil informasjon registrert på dyret mitt", intent: "WrongInfo", description: "Feil navn, rase, chipnummer eller annet" },
      { label: "Registrert på feil eier", query: "Dyret mitt er registrert på feil person", intent: "WrongOwner", description: "Dyret står på en annen person enn deg" },
      { label: "Finner ikke dyret mitt", query: "Jeg finner ikke dyret mitt i registeret", intent: "PetNotInSystem", description: "Dyret vises ikke i DyreID-søk" },
      { label: "Mangler på Min side", query: "Det mangler et kjæledyr på Min side", intent: "MissingPetProfile", description: "Dyret vises ikke på profilen din", url: `${HJELPESENTER_BASE}/hjelp-min-side/19-mangler-kjaledyr` },
      { label: "Dyret er ikke søkbart", query: "Kjæledyret mitt er ikke søkbart", intent: "InactiveRegistration", description: "Dyret vises ikke i offentlig søk", url: `${HJELPESENTER_BASE}/hjelp-id-sok/3-kjaledyret-er-ikke-sokbart` },
      { label: "Registrere nytt dyr", query: "Hvordan registrere et nytt dyr i DyreID?", intent: "NewRegistration", description: "Registrere et dyr som ikke er i systemet ennå", url: `${HJELPESENTER_BASE}/hjelp-id-sok/1-hvorfor-bor-jeg-id-merke` },
    ],
  },
  "Priser": {
    broadRegex: /^(pris|priser|priser og abonnement|abonnement|abonnement og priser|hva koster|kostnader|betaling)[\?\.\!]?$/i,
    title: "Priser og abonnement",
    intro: "Her finner du oversikt over priser og abonnementer hos DyreID. Velg det du vil vite mer om, eller spør direkte.",
    subtopics: [
      { label: "Hva koster eierskifte?", query: "Hva koster eierskifte?", intent: "OwnershipTransferCost", description: "Pris for å overføre eierskap", url: `${HJELPESENTER_BASE}/hjelp-eierskifte/40-hva-koster-eierskifte` },
      { label: "Koster appen noe?", query: "Koster DyreID-appen noe?", intent: "AppCost", description: "Prisinformasjon for DyreID-appen", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/9-koster-appen-noe` },
      { label: "Basis vs DyreID+", query: "Hva er forskjellen på DyreID basis og DyreID+ abonnement?", intent: "SubscriptionComparison", description: "Sammenligning av gratis og premium", url: `${HJELPESENTER_BASE}/hjelp-dyreid-appen/8-basis-vs-dyreID-pluss` },
      { label: "QR-brikke pris", query: "Er QR-brikke abonnement eller engangskostnad?", intent: "QRPricingModel", description: "Betalingsmodell for QR-brikken", url: `${HJELPESENTER_BASE}/hjelp-qr-brikke/34-qr-prismodell` },
      { label: "Registrering av dyr", query: "Hva koster det å registrere et dyr i Norge?", intent: "ForeignRegistrationCost", description: "Pris for å registrere utenlandsk dyr", url: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/44-kostnad-registrering` },
    ],
  },
  Familiedeling: {
    broadRegex: /^(familiedeling|om familiedeling|hjelp.*familiedeling|dele.*tilgang)[\?\.\!]?$/i,
    title: "Familiedeling",
    intro: "Med familiedeling kan flere i husstanden følge med på kjæledyrene i DyreID-appen. Velg det du lurer på, eller skriv spørsmålet ditt.",
    subtopics: [
      { label: "Hvorfor familiedeling?", query: "Hvorfor burde jeg ha familiedeling?", intent: "FamilySharingBenefits", description: "Fordelene med å dele tilgang", url: `${HJELPESENTER_BASE}/hjelp-familiedeling/51-familiedeling-fordeler` },
      { label: "Dele med andre enn familien?", query: "Kan jeg dele tilgang med andre enn familien?", intent: "FamilySharingNonFamily", description: "Hvem du kan invitere til deling", url: `${HJELPESENTER_BASE}/hjelp-familiedeling/52-dele-ikke-familie` },
      { label: "Trenger jeg DyreID+?", query: "Trenger jeg DyreID+ for familiedeling?", intent: "FamilySharingRequirement", description: "Abonnementskrav for familiedeling", url: `${HJELPESENTER_BASE}/hjelp-familiedeling/53-familiedeling-krav` },
      { label: "Forespørsel ikke akseptert", query: "Familiedeling forespørsel ikke akseptert", intent: "FamilySharingRequest", description: "Problemer med å godkjenne delingsforespørsel", url: `${HJELPESENTER_BASE}/hjelp-familiedeling/54-familiedeling-foresporsel` },
      { label: "Hvordan dele tilgang?", query: "Hvordan dele tilgang med familiemedlemmer?", intent: "FamilySharing", description: "Steg for å sette opp deling", url: `${HJELPESENTER_BASE}/hjelp-familiedeling/55-dele-tilgang` },
      { label: "Rettigheter ved deling", query: "Kan de jeg deler med gjøre endringer?", intent: "FamilySharingPermissions", description: "Hva de du deler med kan gjøre", url: `${HJELPESENTER_BASE}/hjelp-familiedeling/56-familiedeling-rettigheter` },
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

function getSubtopicInfo(intent: string): { label: string; url: string; description?: string; category: string } | null {
  for (const [key, menu] of Object.entries(CATEGORY_MENUS)) {
    for (const sub of menu.subtopics) {
      if (sub.intent === intent && sub.url) {
        return { label: sub.label, url: sub.url, description: sub.description, category: menu.title };
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

export function getRuntimeIntentIds(): string[] {
  const ids = new Set<string>();
  for (const p of INTENT_PATTERNS) ids.add(p.intent);
  for (const [, menu] of Object.entries(CATEGORY_MENUS)) {
    for (const sub of menu.subtopics) {
      if (sub.intent) ids.add(sub.intent);
    }
  }
  return Array.from(ids);
}

export async function validateAndAlignCanonicalIntents(): Promise<{
  total: number;
  valid: number;
  migrated: string[];
  invalid: string[];
}> {
  const runtimeIds = getRuntimeIntentIds();
  const result = await ensureRuntimeIntentsInCanonical(runtimeIds);
  const postValidation = await validateRuntimeIntents(runtimeIds);

  if (postValidation.invalid.length > 0) {
    console.error(`[Canonical] CRITICAL: ${postValidation.invalid.length} runtime intents still missing from canonical_intents after migration: ${postValidation.invalid.join(", ")}`);
  } else {
    console.log(`[Canonical] All ${runtimeIds.length} runtime intents are aligned with canonical_intents`);
  }

  return {
    total: runtimeIds.length,
    valid: postValidation.valid.length,
    migrated: result.migrated,
    invalid: postValidation.invalid,
  };
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
        notFoundText += `For å få dyret registrert i DyreID må du ta kontakt med en veterinær. Veterinæren registrerer chipen, og det koster ${getPrice("utenlandsregistrering")}. Les mer: ${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/43-registrering-norge`;
      } else {
        notFoundText += `Dette kan bety at:\n`;
        notFoundText += `- Chipen ikke er registrert i DyreID ennå\n`;
        notFoundText += `- Nummeret er feil\n`;
        notFoundText += `- Dyret er registrert i et annet land\n\n`;
        notFoundText += `For å få dyret registrert i Norge/DyreID, ta kontakt med en veterinær. Registrering av utenlandsk chip koster ${getPrice("utenlandsregistrering")}. Les mer: ${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/43-registrering-norge`;
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
    const shouldBreakOut = session.directIntentFlow === "OwnershipTransferWeb" && !userMessage.match(/^\d{8}$/) && (
      (intent && intent !== "OwnershipTransferWeb") ||
      /feil.*navn|endre.*navn|feil.*info|endre.*info|savnet|funnet|død|avdød|avlivet|registrere|QR|brikke|chip.*søk|id-?søk/i.test(userMessage)
    );
    if (shouldBreakOut) {
      session.directIntentFlow = undefined;
      session.collectedData = {};
      return null;
    }

    session.directIntentFlow = "OwnershipTransferWeb";

    if (!isAuthenticated) {
      return {
        text: "For å gjennomføre eierskifte må du først logge inn. Klikk på knappen under for å logge inn med engangskode (OTP).\n\nEtter innlogging hjelper jeg deg steg for steg med å overføre eierskapet.",
        requiresLogin: true,
        model: "direct-transfer-login",
      };
    }

    if (session.collectedData["petId"] && !session.collectedData["newOwnerPhone"]) {
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
    session.directIntentFlow = "ReportLostPet";

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
      session.directIntentFlow = undefined;
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
    session.directIntentFlow = "ReportFoundPet";

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
    if (session.directIntentFlow === "PetDeceased" && intent && intent !== "PetDeceased" && !/^(ja|yes|bekreft|nei|no|avbryt)/i.test(userMessage.trim())) {
      session.directIntentFlow = undefined;
      session.collectedData = {};
      return null;
    }

    session.directIntentFlow = "PetDeceased";

    if (!isAuthenticated) {
      return {
        text: "For å registrere at kjæledyret ditt er dødt, må du logge inn først. Klikk på knappen under for å logge inn med engangskode (OTP).\n\nEtter innlogging kan du velge dyret og markere det som avdødt.",
        requiresLogin: true,
        model: "direct-deceased-login",
      };
    }

    if (session.collectedData["petId"]) {
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
    if (session.directIntentFlow === "WrongInfo" && intent && intent !== "WrongInfo") {
      session.directIntentFlow = undefined;
      session.collectedData = {};
      return null;
    }

    session.directIntentFlow = "WrongInfo";

    if (!isAuthenticated) {
      return {
        text: "Jeg kan hjelpe deg med å rette opp feil informasjon på dyret ditt. Klikk på knappen under for å logge inn med engangskode (OTP), så finner vi dyret det gjelder.",
        requiresLogin: true,
        model: "direct-wronginfo-login",
      };
    }

    if (session.collectedData["petId"]) {
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
      text: `For å registrere et nytt dyr i DyreID, må du ta det med til en **veterinær**.\n\n**Slik gjør du:**\n1. Bestill time hos en veterinærklinikk\n2. Veterinæren implanterer en mikrochip (hvis dyret ikke allerede har en)\n3. Veterinæren registrerer dyret i DyreID\n4. Du får tilgang til Min Side og kan administrere dyrets profil\n\n**Pris:** Registrering koster vanligvis ${getPrice("registrering_ny")} (inkl. chip og registrering).\n\nHar dyret allerede en chip? Da kan du sjekke om det er registrert ved å oppgi chipnummeret.`,
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

  if (intent === "SmartTagActivation") {
    return {
      text: "**Slik aktiverer du Smart Tag:**\n\n1. Last ned **DyreID-appen** fra App Store eller Google Play\n2. Opprett en bruker eller logg inn\n3. Trykk på **Smart Tag**-ikonet i appen\n4. Hold Smart Tag inntil telefonen til den kobles\n5. Følg instruksjonene i appen for å knytte taggen til dyret ditt\n\n**Tips:** Sørg for at Bluetooth er aktivert på telefonen. Smart Tag bruker Bluetooth Low Energy (BLE) for tilkobling.\n\nHvis du har problemer med tilkoblingen, prøv å starte appen på nytt og hold taggen helt inntil telefonen.",
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-smart-tag/25-aktivering-smart-tag`,
      model: "direct-smart-tag-info",
      requestFeedback: true,
    };
  }

  if (intent === "SmartTagQRActivation") {
    return {
      text: "**Aktivere QR-koden på Smart Tag:**\n\nSmart Tag har en innebygd QR-kode som kan skannes av alle med en smarttelefon.\n\n1. Åpne **DyreID-appen**\n2. Gå til **Smart Tag**-seksjonen\n3. Velg taggen du vil aktivere QR for\n4. Trykk på **Aktiver QR-kode**\n5. Velg hvilke kontaktopplysninger som skal vises ved skanning\n\nNår QR-koden er aktivert, kan den som finner dyret ditt skanne koden og kontakte deg direkte uten å se sensitive opplysninger.",
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-smart-tag/26-aktiver-qr-smart-tag`,
      model: "direct-smart-tag-info",
      requestFeedback: true,
    };
  }

  if (intent === "SmartTagConnection") {
    return {
      text: "**Problemer med å koble til Smart Tag?**\n\nHer er noen feilsøkingssteg:\n\n1. **Sjekk Bluetooth** – Sørg for at Bluetooth er slått på i telefonens innstillinger\n2. **Nærhet** – Hold Smart Tag helt inntil telefonen under tilkobling\n3. **Start appen på nytt** – Lukk DyreID-appen helt og åpne den igjen\n4. **Restart telefonen** – Noen ganger hjelper det å starte telefonen på nytt\n5. **Batteri** – Sjekk at Smart Tag har strøm (den skal pipe/blinke ved aktivering)\n6. **Oppdater appen** – Sørg for at du har siste versjon av DyreID-appen\n\n**Viktig:** Smart Tag bruker Bluetooth Low Energy (BLE). Noen eldre telefoner støtter ikke dette. Sjekk at telefonen din er kompatibel.",
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-smart-tag/27-kan-ikke-koble-smart-tag`,
      model: "direct-smart-tag-info",
      requestFeedback: true,
    };
  }

  if (intent === "SmartTagMissing") {
    return {
      text: "**Smart Tag forsvunnet fra appen?**\n\nHvis Smart Tag ikke lenger vises i DyreID-appen, prøv følgende:\n\n1. **Lukk og åpne appen** – Noen ganger må appen oppdateres\n2. **Sjekk Bluetooth** – Sørg for at Bluetooth er aktivert\n3. **Rekkevidde** – Smart Tag må være innenfor Bluetooth-rekkevidde (ca. 10-15 meter)\n4. **Logg ut og inn igjen** – Gå til innstillinger i appen, logg ut og logg inn på nytt\n5. **Legg til på nytt** – Hvis taggen fortsatt ikke vises, prøv å legge den til på nytt via Smart Tag-menyen\n\nHvis ingen av stegene fungerer, kan det være et problem med taggens batteri eller en teknisk feil. Kontakt oss på **support@dyreid.no** for videre hjelp.",
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-smart-tag/28-smart-tag-forsvunnet`,
      model: "direct-smart-tag-info",
      requestFeedback: true,
    };
  }

  if (intent === "SmartTagPosition") {
    return {
      text: "**Smart Tag-posisjonen oppdateres ikke?**\n\nSmart Tag oppdaterer posisjonen via Bluetooth, noe som betyr at den trenger en tilkoblet telefon i nærheten for å sende posisjon.\n\n**Slik fungerer det:**\n- Posisjonen oppdateres når Smart Tag er innenfor Bluetooth-rekkevidde av telefonen din (ca. 10-15 meter)\n- Hvis dyret er utenfor rekkevidde, vises siste kjente posisjon\n- Andre DyreID-brukere i nærheten kan også oppdatere posisjonen anonymt\n\n**Feilsøking:**\n1. Sjekk at Bluetooth er aktivert på telefonen\n2. Sjekk at appen har tillatelse til bakgrunnsoppdatering\n3. Sjekk at appen har plasseringstillatelse\n4. Sørg for at batteriet i taggen ikke er tomt",
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-smart-tag/29-smart-tag-posisjon`,
      model: "direct-smart-tag-info",
      requestFeedback: true,
    };
  }

  if (intent === "SmartTagSound") {
    return {
      text: "**Smart Tag lager lyder av seg selv?**\n\nHvis Smart Tag piper eller lager lyder uventet, kan det skyldes flere ting:\n\n1. **Lavt batteri** – Taggen varsler når batteriet begynner å bli lavt\n2. **Adskillelsesvarsel** – Hvis du har aktivert varsel ved adskillelse, vil taggen pipe når den mister kontakt med telefonen\n3. **Finn min tag-funksjon** – Noen i nærheten kan ha aktivert \"Finn min tag\" i appen\n\n**Slik stopper du lyden:**\n- Åpne DyreID-appen og sjekk Smart Tag-innstillingene\n- Deaktiver adskillelsesvarsel hvis du ikke ønsker det\n- Sjekk batterinivået i appen\n\nHvis lydene fortsetter uten åpenbar grunn, prøv å ta ut og sette inn batteriet på nytt.",
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-smart-tag/30-smart-tag-lyd`,
      model: "direct-smart-tag-info",
      requestFeedback: true,
    };
  }

  if (intent === "SmartTagMultiple") {
    return {
      text: "**Problemer med flere Smart Tags?**\n\nHvis du har flere Smart Tags men bare klarer å koble til én, prøv dette:\n\n1. **Koble til én om gangen** – Aktiver og koble til én Smart Tag ferdig før du starter med neste\n2. **Hold avstand** – Legg de andre taggene i et annet rom mens du kobler til én\n3. **Unike navn** – Gi hver tag et unikt navn (f.eks. dyrets navn) så de er lette å skille\n4. **Start på nytt mellom tilkoblinger** – Lukk appen mellom hver tilkobling\n\n**OBS:** Hver Smart Tag kan kun kobles til ett dyr. Sørg for at du velger riktig dyr for hver tag under oppsettet.",
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-smart-tag/31-smart-tag-flere`,
      model: "direct-smart-tag-info",
      requestFeedback: true,
    };
  }

  if (intent === "UnregisteredChip578") {
    return {
      text: `**Uregistrert 578-brikke**\n\nNoen ID-merker som begynner med **578** (Norges landskode) er likevel ikke registrert hos DyreID. Dette gjelder brikker som ikke er **forhåndsbetalte** hos oss – de er såkalte uregistrerte brikker og betraktes som **utlandsregistrerte**.\n\nDette betyr at selv om dyret er ID-merket hos en veterinær i Norge, er ikke chipen automatisk registrert i DyreID-registeret.\n\n**Hva må du gjøre?**\nFor å få dyret registrert i DyreID med en slik brikke, må du ta kontakt med en veterinær som kan registrere chipen hos oss. Dette koster **${getPrice("utenlandsregistrering")}** og følger samme prosedyre som for utlandsregistrering.\n\nLes mer om prosessen her:\nhttps://hjelpesenter.dyreid.no/hjelp-utenlandsregistrering/43-registrering-norge`,
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/43-registrering-norge`,
      model: "direct-unregistered-578",
      requestFeedback: true,
    };
  }

  if (intent === "ForeignRegistration") {
    return {
      text: `**Registrering av dyr med utenlandsk eller uregistrert chip i Norge**\n\nFor å registrere et dyr i DyreID som har en utenlandsk chip, eller en **uregistrert 578-brikke** (brikke som begynner med 578 men ikke er forhåndsbetalt hos oss), må du ta kontakt med en **veterinær**.\n\n**OBS:** Ikke alle brikker som begynner med 578 er registrert hos DyreID. Noen 578-brikker er ikke forhåndsbetalte og betraktes som utlandsregistrerte. Disse må registreres på nytt.\n\n**Slik gjør du:**\n1. Bestill time hos en veterinærklinikk\n2. Veterinæren skanner chipen og registrerer dyret i DyreID\n3. Registreringen koster **${getPrice("utenlandsregistrering")}**\n4. Du får tilgang til Min Side og kan administrere dyrets profil\n\nLes mer: https://hjelpesenter.dyreid.no/hjelp-utenlandsregistrering/43-registrering-norge`,
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/43-registrering-norge`,
      model: "direct-foreign-registration",
      requestFeedback: true,
    };
  }

  if (intent === "ForeignRegistrationCost") {
    return {
      text: `**Pris for registrering av dyr i Norge**\n\nRegistrering av dyr med utenlandsk chip eller uregistrert 578-brikke koster **${getPrice("utenlandsregistrering")}**. Dette inkluderer:\n\n- Registrering i DyreID-registeret\n- Tilgang til Min Side for administrasjon av dyrets profil\n- Søkbarhet i DyreID-systemet\n\n**Slik gjør du:**\n1. Bestill time hos en veterinærklinikk\n2. Veterinæren skanner chipen og registrerer dyret\n3. Du betaler registreringsavgiften på **${getPrice("utenlandsregistrering")}**\n\nFor norske dyr som allerede har forhåndsbetalt chip er registreringen inkludert i chipprisen (vanligvis ${getPrice("registrering_ny")} totalt hos veterinær).`,
      helpCenterLink: `${HJELPESENTER_BASE}/hjelp-utenlandsregistrering/43-registrering-norge`,
      model: "direct-foreign-registration-cost",
      requestFeedback: true,
    };
  }

  if (intent === "OwnershipTransferApp") {
    return {
      text: `**Eierskifte via DyreID-appen**\n\nDu kan gjennomføre eierskifte direkte i DyreID-appen. Slik gjør du:\n\n1. Åpne **DyreID-appen**\n2. Gå til dyret du vil overføre\n3. Trykk på **Eierskifte** eller **Overfør eierskap**\n4. Skriv inn ny eiers mobilnummer\n5. Ny eier mottar en SMS med bekreftelseslenke\n6. Ny eier bekrefter og betaler eierskiftegebyret\n\n**Pris:** Eierskifte koster ${getPrice("eierskifte")}.\n\n**Viktig:**\n- Begge parter må ha DyreID-konto\n- Ny eier må godkjenne overføringen innen 14 dager\n- Eierskiftet fullføres først etter betaling\n\nVil du heller gjøre eierskiftet her i chatten? Da kan jeg hjelpe deg etter innlogging.`,
      suggestions: [
        { label: "Gjør eierskifte her", action: "SELECT_PET", data: { intent: "OwnershipTransferWeb" } },
      ],
      model: "direct-ownership-transfer-app",
      requestFeedback: true,
    };
  }

  if (intent === "GDPRDelete") {
    return {
      text: "**Sletting av profil (GDPR)**\n\nDu har rett til å be om sletting av dine personopplysninger i henhold til GDPR.\n\n**Viktig å vite:**\n- Sletting av profilen fjerner alle dine personopplysninger fra DyreID\n- Dyrene dine vil bli avregistrert fra din profil\n- Denne handlingen kan ikke angres\n- Chipregistreringen på dyrene dine forblir aktiv, men uten koblet eier\n\n**Slik ber du om sletting:**\nSend en e-post til **personvern@dyreid.no** med:\n1. Ditt fulle navn\n2. Telefonnummer registrert i DyreID\n3. Bekreftelse på at du ønsker sletting\n\nBehandlingstid er normalt 30 dager i henhold til GDPR-regelverket.\n\nHvis du bare ønsker å endre eller oppdatere informasjonen din, kan jeg hjelpe deg med det etter innlogging.",
      model: "direct-gdpr-delete",
      requestFeedback: true,
    };
  }

  if (intent === "LostFoundInfo") {
    return {
      text: "**Slik fungerer Savnet og Funnet-tjenesten i DyreID:**\n\nNår du melder et dyr savnet, skjer følgende:\n\n1. **SMS-varsling** – Alle DyreID-brukere i nærområdet får automatisk SMS om det savnede dyret\n2. **Push-varsel** – Brukere med DyreID-appen mottar push-notifikasjoner\n3. **Savnet-status** – Dyret markeres som savnet i DyreID-registeret\n4. **QR/Smart Tag** – Hvis noen skanner dyrets QR-brikke eller Smart Tag, får du umiddelbart beskjed\n5. **Søkbar på 1-2-3** – Andre kan søke opp dyret og se at det er meldt savnet\n\n**For å melde savnet:** Logg inn her i chatten med OTP, så aktiverer jeg varslingen for deg.\n**For å melde funnet:** Samme prosess – logg inn, og jeg markerer dyret som funnet og deaktiverer varslingene.\n\nVil du melde et dyr savnet eller funnet?",
      suggestions: [
        { label: "Meld savnet", action: "SELECT_PET", data: { intent: "ReportLostPet" } },
        { label: "Meld funnet", action: "SELECT_PET", data: { intent: "ReportFoundPet" } },
      ],
      model: "direct-lost-found-info",
      requestFeedback: true,
    };
  }

  if (intent === "SearchableMisuse") {
    return {
      text: "**Sikkerhet og personvern for Søkbar på 1-2-3**\n\nDyreID tar personvern på alvor. Slik er tjenesten beskyttet mot misbruk:\n\n1. **Begrenset informasjon** – Ved søk vises kun dyrets navn, art og rase. Eierens fulle personopplysninger vises ikke\n2. **Kontaktskjema** – Den som søker kan sende melding via et kontaktskjema, uten å se eierens direkte kontaktinfo\n3. **Logging** – Alle søk logges for å kunne spore eventuelt misbruk\n4. **Rapportering** – Mistenkelig aktivitet kan rapporteres til DyreID\n\n**Viktig:** Chipnummeret alene gir ikke tilgang til sensitiv informasjon. Det kreves innlogging for å se eller endre eierdata.\n\nHvis du mistenker misbruk av tjenesten, kontakt oss på **support@dyreid.no**.",
      model: "direct-searchable-misuse",
      requestFeedback: true,
    };
  }

  if (intent === "FamilySharing") {
    return {
      text: "**Slik deler du tilgang med familiemedlemmer i DyreID:**\n\nMed familiedeling kan andre i husstanden se og følge med på kjæledyrene deres i DyreID-appen.\n\n**Slik setter du opp familiedeling:**\n1. Åpne **DyreID-appen**\n2. Gå til **Innstillinger** → **Familiedeling**\n3. Trykk **Legg til familiemedlem**\n4. Skriv inn mobilnummeret til personen du vil dele med\n5. Personen mottar en invitasjon og må godkjenne\n\n**Krav:**\n- Du trenger **DyreID+**-abonnement for å bruke familiedeling\n- Personen du deler med må ha en DyreID-konto\n\n**Hva kan de du deler med gjøre?**\n- Se dyrets profil og informasjon\n- Motta varsler om savnet/funnet\n- Se posisjon via Smart Tag\n- De kan **ikke** gjøre endringer på dyrets profil eller starte eierskifte",
      model: "direct-family-sharing",
      requestFeedback: true,
    };
  }

  if (intent === "FamilySharingRequest") {
    return {
      text: "**Familiedeling-forespørsel ikke akseptert?**\n\nHvis en familiedeling-forespørsel ikke blir akseptert, kan det skyldes:\n\n1. **Ikke sett invitasjonen** – Personen har kanskje ikke sjekket DyreID-appen\n2. **Feil nummer** – Dobbeltsjekk at du skrev inn riktig mobilnummer\n3. **Mangler DyreID-konto** – Personen må ha en DyreID-konto for å godkjenne\n4. **Utløpt invitasjon** – Invitasjoner utløper etter 14 dager\n\n**Slik løser du det:**\n- Be personen åpne DyreID-appen og sjekke under **Varsler** eller **Innstillinger** → **Familiedeling**\n- Prøv å sende invitasjonen på nytt\n- Sørg for at personen har lastet ned og logget inn i DyreID-appen først\n\nHvis problemet vedvarer, kontakt oss på **support@dyreid.no**.",
      model: "direct-family-sharing-request",
      requestFeedback: true,
    };
  }

  if (intent === "FamilySharingPermissions") {
    return {
      text: "**Hva kan de du deler med gjøre?**\n\nPersoner du har delt tilgang med via familiedeling har **begrenset tilgang**:\n\n**De KAN:**\n- Se dyrets profil (navn, art, rase, bilde)\n- Motta push-varsler om savnet/funnet\n- Se dyrets posisjon via Smart Tag\n- Se QR-brikke-status\n\n**De kan IKKE:**\n- Endre dyrets profilinformasjon\n- Starte eller godkjenne eierskifte\n- Melde dyret savnet eller funnet\n- Slette dyret fra registeret\n- Endre eierens kontaktinformasjon\n\nKun den registrerte eieren har full tilgang til å gjøre endringer. Familiedeling gir kun lesetilgang og varsler.",
      model: "direct-family-sharing-permissions",
      requestFeedback: true,
    };
  }

  if (intent === "PetNotInSystem") {
    return {
      text: `**Finner ikke dyret i registeret?**\n\nDet kan være flere grunner til at dyret ditt ikke finnes i DyreID:\n\n1. **Ikke registrert** – Dyret er kanskje ikke registrert i DyreID ennå. Registrering gjøres hos veterinær\n2. **Utenlandsk chip** – Hvis dyret har en utenlandsk chip, må det registreres på nytt i Norge (koster ${getPrice("utenlandsregistrering")})\n3. **Uregistrert 578-brikke** – Noen norske 578-chipper er ikke forhåndsbetalt og må registreres separat\n4. **Feil chipnummer** – Dobbeltsjekk at du har riktig chipnummer\n5. **Registrert på annen person** – Dyret kan være registrert på en tidligere eier\n\n**Hva kan du gjøre?**\n- Har du chipnummeret? Jeg kan søke det opp for deg\n- Kontakt veterinæren som chipet dyret for å sjekke registreringsstatus\n\nVil du at jeg søker opp et chipnummer?`,
      suggestions: [
        { label: "Søk opp chipnummer", action: "SELECT_PET", data: { intent: "ChipLookup" } },
      ],
      model: "direct-pet-not-in-system",
      requestFeedback: true,
    };
  }

  if (intent === "FamilySharingRequirement") {
    return {
      text: `**Krever familiedeling DyreID+?**\n\nJa, familiedeling er en del av **DyreID+**-abonnementet.\n\n**DyreID+ inkluderer:**\n- Familiedeling med opptil 5 personer\n- Utvidet Smart Tag-funksjonalitet\n- Prioritert kundeservice\n- Avanserte varsler og notifikasjoner\n\n**Pris:** DyreID+ koster ${getPrice("dyreid_pluss_maaned")}/mnd eller ${getPrice("dyreid_pluss_aar")}/år.\n\nDu kan oppgradere til DyreID+ direkte i DyreID-appen under **Innstillinger** → **Abonnement**.`,
      model: "direct-family-sharing-requirement",
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

KUNDEN ER ${isAuthenticated ? "INNLOGGET - Du kan utfore handlinger direkte uten a be om innlogging" : "IKKE INNLOGGET - Be kunden klikke pa OTP-knappen i chatten for a logge inn. Si ALDRI at de skal logge inn pa Min Side eksternt."}

HANDLINGER DU KAN UTFORE (etter OTP-innlogging i chatten):
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
Ikke alle ID-merker som begynner med 578 er registrert hos DyreID. Noen 578-brikker er ikke forhandsbetalt hos oss og betraktes som utlandsregistrerte. Disse ma registreres pa nytt via en veterinaer (koster ${getPrice("utenlandsregistrering")}). Folger samme prosedyre som utenlandsregistrering.

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

// RUNTIME GPT POLICY — INTENT INTERPRETATION (allowed for both transactional & informational intents)
// GPT may: classify user message against allowlisted intents, return intent + confidence, handle fuzzy/typo input
// GPT must NOT: explain procedures, suggest actions, infer pricing, describe ownership transfer steps
// After classification, runtime routes to transactional flow (collectData → executeEndpoint) or informational flow (paraphrase infoText)
async function gptIntentInterpretation(
  userMessage: string
): Promise<{ intent: string | null; confidence: number }> {
  try {
    const approvedIntents = getApprovedIntentIds();
    if (approvedIntents.length === 0) {
      console.warn("[GPT Intent] No approved canonical intents available — skipping");
      return { intent: null, confidence: 0 };
    }
    const allowlistedIntents = approvedIntents.join(", ");
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 256,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Du er en intent-klassifiserer for DyreID (Norges nasjonale kjæledyrregister).

Din ENESTE oppgave er å klassifisere brukerens melding til EN av de godkjente intentene.

GODKJENTE INTENTS:
${allowlistedIntents}

REGLER:
- Returner KUN JSON med intent og confidence
- confidence skal være mellom 0.0 og 1.0
- Hvis du er usikker, sett confidence lavt
- Du skal ALDRI generere nye intents
- Du skal ALDRI forklare prosedyrer
- Du skal ALDRI svare på spørsmål

EKSEMPLER:
"jeg vil at datteren min skal være eier av Rex" → {"intent": "OwnershipTransferWeb", "confidence": 0.92}
"hunden min er borte" → {"intent": "ReportLostPet", "confidence": 0.95}
"hva koster appen" → {"intent": "AppCost", "confidence": 0.88}
"feil navn på katten" → {"intent": "WrongInfo", "confidence": 0.90}

Svar KUN med JSON: {"intent": "IntentNavn", "confidence": 0.85}`,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    const text = response.choices[0]?.message?.content || "";
    const result = JSON.parse(text);

    if (result.intent && typeof result.confidence === "number") {
      if (!approvedIntents.includes(result.intent)) {
        return { intent: null, confidence: 0 };
      }
      return { intent: result.intent, confidence: result.confidence };
    }
    return { intent: null, confidence: 0 };
  } catch (err: any) {
    console.error("GPT intent interpretation error:", err.message);
    return { intent: null, confidence: 0 };
  }
}

const PARAPHRASE_BLOCKLIST = [
  /veterinær/i, /chip.*innsett/i, /sett inn.*chip/i, /ny.*mikrobrikke/i,
  /kontakt.*support/i, /ring.*oss/i, /ta kontakt med/i,
  /send.*e-?post/i, /skriv.*til.*oss/i,
  /pris.*kr|kr.*pris|\d+\s*kr|\d+\s*nok/i,
  /anbefal/i, /vi foreslår/i, /du bør/i, /merk at/i,
];

function extractNumbers(text: string): string[] {
  return (text.match(/\d+([.,]\d+)?/g) || []).map(n => n.replace(",", "."));
}

function extractUrls(text: string): string[] {
  return (text.match(/https?:\/\/[^\s)]+/gi) || []);
}

function countSentences(text: string): number {
  return (text.match(/[.!?]+(?:\s|$)/g) || []).length || 1;
}

function validateParaphrase(original: string, paraphrased: string): { valid: boolean; reason?: string } {
  if (!paraphrased) return { valid: false, reason: "empty" };

  for (const pattern of PARAPHRASE_BLOCKLIST) {
    if (pattern.test(paraphrased) && !pattern.test(original)) {
      return { valid: false, reason: `blocklist: ${pattern.source}` };
    }
  }

  if (paraphrased.length > original.length * 2.5) {
    return { valid: false, reason: "length exceeded 2.5x" };
  }

  const origNumbers = extractNumbers(original);
  const paraNumbers = extractNumbers(paraphrased);
  for (const num of origNumbers) {
    if (!paraNumbers.includes(num)) {
      return { valid: false, reason: `numeric value changed: ${num} missing` };
    }
  }

  const origUrls = extractUrls(original);
  const paraUrls = extractUrls(paraphrased);
  for (const url of origUrls) {
    if (!paraUrls.includes(url)) {
      return { valid: false, reason: `URL changed: ${url} missing` };
    }
  }

  const origSentences = countSentences(original);
  const paraSentences = countSentences(paraphrased);
  if (paraSentences > origSentences + 1) {
    return { valid: false, reason: `sentence count exceeded: ${paraSentences} vs ${origSentences}` };
  }

  return { valid: true };
}

async function paraphrasePlaybookResponse(
  originalText: string,
  userMessage: string
): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 512,
      messages: [
        {
          role: "system",
          content: `Du er en parafraserings-assistent for DyreID kundeservice.

OPPGAVE: Omformuler teksten under til en mer naturlig, vennlig tone som svarer på kundens spørsmål.

STRENGE REGLER:
- Du skal KUN omformulere innholdet som allerede finnes i teksten
- Du skal ALDRI legge til nye setninger, steg, prosedyrer eller instruksjoner
- Du skal ALDRI legge til advarsler, anbefalinger eller disclaimers
- Du skal ALDRI nevne veterinær, chipinnsetting, nye priser eller kontakt support
- Du skal ALDRI finne opp informasjon som ikke står i originalteksten
- Du skal ALDRI endre tall, priser, beløp eller URLer
- Du skal ALDRI legge til kontaktinformasjon som ikke finnes i originalen
- Behold alle fakta, tall, URLer og steg nøyaktig som de er
- Maks 200 ord

ORIGINALTEKST:
${originalText}`,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    const paraphrased = response.choices[0]?.message?.content?.trim() || "";

    const validation = validateParaphrase(originalText, paraphrased);
    if (!validation.valid) {
      if (process.env.RUNTIME_DEBUG === "true") {
        console.log(`[Paraphrase] Rejected: ${validation.reason}`);
      }
      return originalText;
    }

    return paraphrased;
  } catch (err: any) {
    console.error("Paraphrase error:", err.message);
    return originalText;
  }
}

interface MatchDebugInfo {
  matchedBy: "session" | "regex" | "semantic" | "keyword" | "gpt" | "fuzzy" | "block";
  semanticScore: number;
  gptConfidence: number;
  finalIntentId: string | null;
  responseMethod: string;
  blockReason?: "lowSemanticZone" | "noMatch" | "lowGptConfidence" | "embeddingUnavailable" | null;
  topIntentId?: string | null;
  topSemanticScore?: number;
}

async function matchUserIntent(
  message: string,
  conversationId: number,
  isAuthenticated: boolean,
  ownerContext: any | null,
  storedUserContext: any | null
): Promise<{ intent: string | null; playbook: PlaybookEntry | null; method: string; debug: MatchDebugInfo }> {
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
    const d: MatchDebugInfo = { matchedBy: "session", semanticScore: 0, gptConfidence: 0, finalIntentId: session.intent || null, responseMethod: "session" };
    return { intent: session.intent, playbook: session.playbook, method: "session-continue", debug: d };
  }

  const debugInfo: MatchDebugInfo = { matchedBy: "block", semanticScore: 0, gptConfidence: 0, finalIntentId: null, responseMethod: "BLOCK", blockReason: null, topIntentId: null, topSemanticScore: 0 };

  let effectiveMessage = message;
  let normalizationApplied = false;
  if (isNormalizationEnabled()) {
    const normResult = normalizeInput(message);
    effectiveMessage = normResult.normalized;
    normalizationApplied = normResult.changed;
    if (normalizationApplied) {
      (debugInfo as any).originalMessage = message;
      (debugInfo as any).normalizedMessage = effectiveMessage;
    }
  }

  const quickIntent = quickIntentMatch(effectiveMessage);
  if (quickIntent) {
    const playbook = await storage.getPlaybookByIntent(quickIntent);
    session.intent = quickIntent;
    session.playbook = playbook;
    session.collectedData = {};
    debugInfo.matchedBy = "regex";
    debugInfo.finalIntentId = quickIntent;
    debugInfo.responseMethod = playbook ? (playbook.actionType === "API_CALL" ? "API_CALL" : "INFO") : "DIRECT";
    return { intent: quickIntent, playbook: playbook || null, method: "quick-match", debug: debugInfo };
  }

  let semanticBestScore = 0;
  let embeddingAvailable = false;

  try {
    if (!isIndexReady()) {
      await refreshIntentIndex();
    }
    if (isIndexReady() && getIndexSize() > 0) {
      embeddingAvailable = true;
      const { match: semanticResult, bestScore, bestIntentId } = await findSemanticMatch(effectiveMessage, 0.78);
      semanticBestScore = bestScore;
      debugInfo.semanticScore = bestScore;
      debugInfo.topSemanticScore = bestScore;
      debugInfo.topIntentId = bestIntentId;

      if (semanticResult) {
        const semanticPlaybook = await storage.getPlaybookByIntent(semanticResult.intentId);
        debugInfo.matchedBy = "semantic";
        debugInfo.finalIntentId = semanticResult.intentId;
        if (semanticPlaybook) {
          session.intent = semanticResult.intentId;
          session.playbook = semanticPlaybook;
          session.collectedData = {};
          debugInfo.responseMethod = semanticPlaybook.actionType === "API_CALL" ? "API_CALL" : "INFO";
          return { intent: semanticResult.intentId, playbook: semanticPlaybook, method: `semantic-match (${semanticResult.similarity.toFixed(2)})`, debug: debugInfo };
        }
        session.intent = semanticResult.intentId;
        session.collectedData = {};
        debugInfo.responseMethod = "INFO";
        return { intent: semanticResult.intentId, playbook: null, method: `semantic-match-no-playbook (${semanticResult.similarity.toFixed(2)})`, debug: debugInfo };
      }
    } else {
      debugInfo.blockReason = "embeddingUnavailable";
    }
  } catch (err: any) {
    console.warn("[SemanticMatch] Skipped due to error:", err.message);
    debugInfo.blockReason = "embeddingUnavailable";
  }

  let hadKeywordMatch = false;
  const keywordMatch = await storage.searchPlaybookByKeywords(effectiveMessage);
  if (keywordMatch) {
    hadKeywordMatch = true;
    session.intent = keywordMatch.intent;
    session.playbook = keywordMatch;
    session.collectedData = {};
    debugInfo.matchedBy = "keyword";
    debugInfo.finalIntentId = keywordMatch.intent;
    debugInfo.responseMethod = keywordMatch.actionType === "API_CALL" ? "API_CALL" : "INFO";
    return { intent: keywordMatch.intent, playbook: keywordMatch, method: "keyword-match", debug: debugInfo };
  }

  if (quickIntent) {
    session.intent = quickIntent;
    session.collectedData = {};
    debugInfo.matchedBy = "regex";
    debugInfo.finalIntentId = quickIntent;
    debugInfo.responseMethod = "INFO";
    return { intent: quickIntent, playbook: null, method: "quick-match-no-playbook", debug: debugInfo };
  }

  // BETWEEN-ZONE: semanticScore >= 0.60 but below threshold (0.78)
  // Try fuzzy label fallback before blocking (only when normalization enabled)
  if (semanticBestScore >= 0.60 && semanticBestScore < 0.78 && !hadKeywordMatch && isNormalizationEnabled()) {
    try {
      const fuzzyResult = await fuzzyLabelFallback(effectiveMessage, semanticBestScore);
      if (fuzzyResult && fuzzyResult.fuzzyScore >= 0.75) {
        logFuzzyMatch(message, effectiveMessage, fuzzyResult);
        const fuzzyPlaybook = await storage.getPlaybookByIntent(fuzzyResult.intentId);
        debugInfo.matchedBy = "fuzzy";
        debugInfo.finalIntentId = fuzzyResult.intentId;
        if (fuzzyPlaybook) {
          session.intent = fuzzyResult.intentId;
          session.playbook = fuzzyPlaybook;
          session.collectedData = {};
          debugInfo.responseMethod = fuzzyPlaybook.actionType === "API_CALL" ? "API_CALL" : "INFO";
          return { intent: fuzzyResult.intentId, playbook: fuzzyPlaybook, method: `fuzzy-match (${fuzzyResult.fuzzyScore})`, debug: debugInfo };
        }
        session.intent = fuzzyResult.intentId;
        session.collectedData = {};
        debugInfo.responseMethod = "INFO";
        return { intent: fuzzyResult.intentId, playbook: null, method: `fuzzy-match-no-playbook (${fuzzyResult.fuzzyScore})`, debug: debugInfo };
      }
    } catch (err: any) {
      console.warn("[FuzzyFallback] Error:", err.message);
    }
  }

  if (semanticBestScore >= 0.65) {
    debugInfo.blockReason = "lowSemanticZone";
    return { intent: null, playbook: null, method: "none", debug: debugInfo };
  }

  // GPT GATE: only if semanticScore < 0.65 AND no keyword match was found
  if (!hadKeywordMatch) {
    const gptResult = await gptIntentInterpretation(effectiveMessage);
    debugInfo.gptConfidence = gptResult.confidence;
    if (gptResult.intent && gptResult.confidence >= 0.7) {
      const gptPlaybook = await storage.getPlaybookByIntent(gptResult.intent);
      debugInfo.matchedBy = "gpt";
      debugInfo.finalIntentId = gptResult.intent;
      if (gptPlaybook) {
        session.intent = gptResult.intent;
        session.playbook = gptPlaybook;
        session.collectedData = {};
        debugInfo.responseMethod = gptPlaybook.actionType === "API_CALL" ? "API_CALL" : "INFO";
        return { intent: gptResult.intent, playbook: gptPlaybook, method: "gpt-intent-interpretation", debug: debugInfo };
      }
      session.intent = gptResult.intent;
      session.collectedData = {};
      debugInfo.responseMethod = "INFO";
      return { intent: gptResult.intent, playbook: null, method: "gpt-intent-no-playbook", debug: debugInfo };
    }
    if (gptResult.confidence > 0) {
      debugInfo.blockReason = "lowGptConfidence";
    } else {
      debugInfo.blockReason = debugInfo.blockReason || "noMatch";
    }
  }

  if (!debugInfo.blockReason) {
    debugInfo.blockReason = "noMatch";
  }

  return { intent: null, playbook: null, method: "none", debug: debugInfo };
}

// RUNTIME FLOW ROUTER — Separates transactional vs informational intent handling
// TRANSACTIONAL (API_CALL): OTP required, modifies register, may trigger payment
//   → GPT is NOT involved. Collect requiredData → execute actionEndpoint.
// INFORMATIONAL (no API_CALL): Help Center content, no register modification
//   → GPT MAY paraphrase existing Playbook infoText. Must NOT generate new content.
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

  // TRANSACTIONAL FLOW — No GPT involvement beyond intent classification
  // Collect required data fields → execute action endpoint → return result
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

  // INFORMATIONAL FLOW — GPT may paraphrase existing Playbook infoText, adapt tone
  // GPT must NOT: generate new procedures, infer pricing not in Playbook, suggest operational steps
  if (playbook.combinedResponse || playbook.resolutionSteps) {
    const originalInfoText = playbook.combinedResponse || playbook.resolutionSteps || "";
    const paraphrased = await paraphrasePlaybookResponse(originalInfoText, userMessage);
    return {
      text: paraphrased,
      helpCenterLink: playbook.helpCenterArticleUrl,
      suggestions: generateSuggestions(playbook),
      model: "playbook-info-paraphrased",
    };
  }

  return null;
}

let lastInteractionId: number | null = null;

export function getLastInteractionId(): number | null {
  return lastInteractionId;
}

export async function testIntentMatch(query: string): Promise<{
  matchedIntent: string;
  method: string;
  semanticScore?: number;
  model: string;
  isCanonical?: boolean;
  normalized?: string;
  fuzzyMatch?: { intentId: string; score: number } | null;
}> {
  let normalized = query.trim().toLowerCase();
  let normalizationApplied = false;
  if (isNormalizationEnabled()) {
    const normResult = normalizeInput(query);
    normalized = normResult.normalized;
    normalizationApplied = normResult.changed;
  }
  let approvedSet: Set<string> | null = null;
  try { approvedSet = await getApprovedIntentSet(); } catch {}
  
  const tagCanonical = (intentId: string, result: any) => {
    if (approvedSet && intentId !== "CategoryMenu" && intentId !== "NONE" && intentId !== "PlaybookMatch") {
      result.isCanonical = approvedSet.has(intentId);
    }
    return result;
  };

  // 1. Category menu check (broadRegex)
  for (const [, menu] of Object.entries(CATEGORY_MENUS)) {
    if (menu.broadRegex.test(normalized) || menu.broadRegex.test(query.trim())) {
      return { matchedIntent: "CategoryMenu", method: "category-menu", model: "category-menu" };
    }
  }
  
  // 2. Regex matching
  for (const pattern of INTENT_PATTERNS) {
    if (pattern.regex.test(query) || pattern.regex.test(normalized)) {
      return tagCanonical(pattern.intent, { matchedIntent: pattern.intent, method: "regex", model: "regex-match" });
    }
  }
  
  // 3. Semantic matching
  if (isIndexReady()) {
    const semanticResult = await findSemanticMatch(query);
    if (semanticResult && semanticResult.bestScore >= 0.78 && semanticResult.bestIntentId) {
      return tagCanonical(semanticResult.bestIntentId, { 
        matchedIntent: semanticResult.bestIntentId, 
        method: "semantic", 
        semanticScore: semanticResult.bestScore,
        model: "semantic-match" 
      });
    }
    
    // 4. Keyword/playbook matching
    const allPlaybook = await storage.getPlaybookEntries();
    for (const entry of allPlaybook) {
      if (!entry.keywords) continue;
      const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
      for (const kw of keywords) {
        if (normalized.includes((kw as string).toLowerCase())) {
          const intentId = entry.intent || "PlaybookMatch";
          return tagCanonical(intentId, { matchedIntent: intentId, method: "keyword", model: "keyword-match" });
        }
      }
    }
    
    // 5. Fuzzy label fallback in gap zone (0.60–0.78)
    if (isNormalizationEnabled() && semanticResult && semanticResult.bestScore >= 0.60 && semanticResult.bestScore < 0.78) {
      try {
        const fuzzyResult = await fuzzyLabelFallback(normalized, semanticResult.bestScore);
        if (fuzzyResult && fuzzyResult.fuzzyScore >= 0.75) {
          logFuzzyMatch(query, normalized, fuzzyResult);
          return tagCanonical(fuzzyResult.intentId, {
            matchedIntent: fuzzyResult.intentId,
            method: "fuzzy-match",
            semanticScore: semanticResult.bestScore,
            model: "fuzzy-deterministic",
            normalized: normalizationApplied ? normalized : undefined,
            fuzzyMatch: { intentId: fuzzyResult.intentId, score: fuzzyResult.fuzzyScore },
          });
        }
      } catch {}
    }

    // 6. Return semantic result even below threshold if available
    if (semanticResult && semanticResult.bestIntentId) {
      const result: any = { 
        matchedIntent: semanticResult.bestIntentId, 
        method: "semantic-below-threshold", 
        semanticScore: semanticResult.bestScore,
        model: "semantic-weak",
      };
      if (normalizationApplied) result.normalized = normalized;
      return tagCanonical(semanticResult.bestIntentId, result);
    }
  }
  
  return { matchedIntent: "NONE", method: "none", model: "block-escalation" };
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

  await ensurePriceCache();
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

  if (session.escalationFlow) {
    const lowerMsg = userMessage.toLowerCase().trim();

    if (session.escalationFlow === "awaiting_resolution_feedback") {
      const isYes = /^(ja|yes|jep|japp|jepp|det stemmer|løst|takk|ok|👍)$/i.test(lowerMsg);
      const isNo = /^(nei|no|nope|ikke|niks|👎)$/i.test(lowerMsg);
      const isBlockTrigger = session.escalationContext?.triggerType === "block";

      if (isBlockTrigger) {
        if (isYes) {
          session.escalationFlow = "awaiting_email";
          const emailCtx = storedUserContext?.Email || storedUserContext?.email;
          let emailPrompt: string;
          if (emailCtx) {
            emailPrompt = `Skal jeg bruke **${emailCtx}**? Skriv e-postadressen du vil bruke, eller bekreft med "ja".`;
            session.collectedData["suggestedEmail"] = emailCtx;
          } else {
            emailPrompt = "Hvilken e-postadresse skal kobles til saken?";
          }
          await storage.createMessage({ conversationId, role: "assistant", content: emailPrompt, metadata: { model: "escalation-email-prompt" } });
          yield emailPrompt;
          return;
        } else if (isNo) {
          session.escalationFlow = undefined;
          session.escalationContext = undefined;
          const declineResponse = "Greit! Er det noe annet jeg kan hjelpe med?";
          await storage.createMessage({ conversationId, role: "assistant", content: declineResponse, metadata: { model: "escalation-declined" } });
          yield declineResponse;
          return;
        }
      } else {
        if (isYes) {
          session.escalationFlow = undefined;
          session.escalationContext = undefined;
          const feedbackResponse = "Flott, glad jeg kunne hjelpe! Er det noe annet du lurer på?";
          const msg = await storage.createMessage({
            conversationId,
            role: "assistant",
            content: feedbackResponse,
            metadata: { model: "escalation-feedback", resolved: true, intentId: session.intent },
          });
          await storage.logChatbotInteraction({
            conversationId,
            messageId: msg.id,
            userQuestion: userMessage,
            botResponse: feedbackResponse,
            responseMethod: "escalation-resolved",
            matchedIntent: session.intent || null,
            actionsExecuted: null,
            authenticated: isAuthenticated,
            responseTimeMs: Date.now() - startTime,
          });
          yield feedbackResponse;
          return;
        } else if (isNo) {
          if (!isEscalationEnabled()) {
            session.escalationFlow = undefined;
            const fallback = "Beklager at det ikke løste saken. Kontakt DyreID kundeservice på **support@dyreid.no** for videre hjelp.";
            await storage.createMessage({ conversationId, role: "assistant", content: fallback, metadata: { model: "escalation-disabled" } });
            yield fallback;
            return;
          }
          session.escalationFlow = "awaiting_email";
          const emailCtx = storedUserContext?.Email || storedUserContext?.email;
          let emailPrompt: string;
          if (emailCtx) {
            emailPrompt = `Ok, jeg kan opprette en supportsak for deg.\n\nSkal jeg bruke **${emailCtx}**? Skriv e-postadressen du vil bruke, eller bekreft med "ja".`;
            session.collectedData["suggestedEmail"] = emailCtx;
          } else {
            emailPrompt = "Ok, jeg kan opprette en supportsak for deg.\n\nHvilken e-postadresse skal kobles til saken?";
          }
          await storage.createMessage({ conversationId, role: "assistant", content: emailPrompt, metadata: { model: "escalation-email-prompt" } });
          yield emailPrompt;
          return;
        }
      }
      session.escalationFlow = undefined;
      session.escalationContext = undefined;
    }

    if (session.escalationFlow === "awaiting_email") {
      const suggestedEmail = session.collectedData["suggestedEmail"];
      let email: string;
      const confirmsExisting = /^(ja|yes|ok|bekreft|stemmer)$/i.test(lowerMsg);
      if (confirmsExisting && suggestedEmail) {
        email = suggestedEmail;
      } else {
        const emailMatch = userMessage.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        if (emailMatch) {
          email = emailMatch[0];
        } else {
          const retryPrompt = "Jeg trenger en gyldig e-postadresse for å opprette saken. Vennligst skriv e-postadressen din:";
          await storage.createMessage({ conversationId, role: "assistant", content: retryPrompt, metadata: { model: "escalation-email-retry" } });
          yield retryPrompt;
          return;
        }
      }

      if (!validateEmail(email)) {
        const retryPrompt = "E-postadressen ser ikke riktig ut. Vennligst skriv en gyldig e-postadresse:";
        await storage.createMessage({ conversationId, role: "assistant", content: retryPrompt, metadata: { model: "escalation-email-invalid" } });
        yield retryPrompt;
        return;
      }

      const ctx = session.escalationContext;
      const result = await createEscalation({
        conversationId,
        intentId: ctx?.intentId || session.intent || null,
        matchedBy: ctx?.matchedBy || null,
        semanticScore: ctx?.semanticScore || null,
        userEmail: email,
        productContext: session.collectedData["petName"] ? `Dyr: ${session.collectedData["petName"]}` : undefined,
      });

      session.escalationFlow = "completed";
      session.hasEscalated = true;
      delete session.collectedData["suggestedEmail"];

      let responseText: string;
      if (result.success) {
        responseText = `Supportsaken er opprettet (ref: #${result.escalationId}). Kundeservice vil kontakte deg på **${email}**.\n\nEr det noe annet jeg kan hjelpe med?`;
      } else if (result.isDuplicate) {
        responseText = `${result.error}\n\nKundeservice jobber allerede med saken din. Er det noe annet jeg kan hjelpe med?`;
      } else {
        responseText = result.error || "Beklager, noe gikk galt. Kontakt **support@dyreid.no** direkte.";
      }

      const msg = await storage.createMessage({
        conversationId,
        role: "assistant",
        content: responseText,
        metadata: {
          model: "escalation-created",
          escalationId: result.escalationId,
          escalationSuccess: result.success,
          isDuplicate: result.isDuplicate,
        },
      });
      await storage.logChatbotInteraction({
        conversationId,
        messageId: msg.id,
        userQuestion: userMessage,
        botResponse: responseText,
        responseMethod: "escalation-create",
        matchedIntent: ctx?.intentId || session.intent || null,
        actionsExecuted: result.success ? [{ action: "create_escalation", success: true, escalationId: result.escalationId }] : null,
        authenticated: isAuthenticated,
        responseTimeMs: Date.now() - startTime,
      });
      yield responseText;
      return;
    }
  }

  if (session.chipLookupFlow) {
    const newTopicIntent = quickIntentMatch(userMessage);
    const isCategorySwitch = detectCategoryMenu(userMessage) !== null;
    if ((newTopicIntent && newTopicIntent !== "ChipLookup" && newTopicIntent !== session.intent) || isCategorySwitch) {
      session.chipLookupFlow = undefined;
      session.chipLookupResult = undefined;
      session.intent = undefined;
      session.collectedData = {};
      session.directIntentFlow = undefined;
      session.loginHelpStep = undefined;
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

  if (session.directIntentFlow || session.loginHelpStep) {
    const newTopicIntent = quickIntentMatch(userMessage);
    const isCategorySwitch = detectCategoryMenu(userMessage) !== null;
    if ((newTopicIntent && newTopicIntent !== session.intent && newTopicIntent !== session.directIntentFlow) || isCategorySwitch) {
      session.directIntentFlow = undefined;
      session.loginHelpStep = undefined;
      session.intent = undefined;
      session.collectedData = {};
      session.awaitingInput = undefined;
      session.playbook = undefined;
    }
  }

  const chipInMessage = extractChipNumber(userMessage);

  const categoryMenu = detectCategoryMenu(userMessage);
  if (categoryMenu) {
    const responseText = categoryMenu.intro;

    const suggestions = categoryMenu.subtopics.map(s => ({
      label: s.label,
      action: "SUBTOPIC" as string,
      data: { query: s.query, url: s.url, intent: s.intent, description: s.description },
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

  const { intent, playbook, method, debug: matchDebug } = await matchUserIntent(
    userMessage, conversationId, isAuthenticated, ownerContext, storedUserContext
  );

  if (process.env.RUNTIME_DEBUG === "true") {
    let debugLine = `[RuntimeDebug] conv=${conversationId} | matchedBy=${matchDebug.matchedBy} | semanticScore=${matchDebug.semanticScore.toFixed(3)} | gptConfidence=${matchDebug.gptConfidence.toFixed(2)} | intent=${matchDebug.finalIntentId || "NONE"} | responseMethod=${matchDebug.responseMethod}`;
    if (matchDebug.matchedBy === "block") {
      debugLine += ` | blockReason=${matchDebug.blockReason || "noMatch"} | topIntentId=${matchDebug.topIntentId || "NONE"} | topSemanticScore=${(matchDebug.topSemanticScore || 0).toFixed(3)}`;
    }
    console.log(debugLine);
  }

  if (isPilotEnabled()) {
    recordPilotMatch(matchDebug.matchedBy, matchDebug.semanticScore, matchDebug.gptConfidence, matchDebug.finalIntentId, userMessage);
  }

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

  const DIRECT_INTENTS = ["ViewMyPets", "OwnershipTransferWeb", "OwnershipTransferApp", "ReportLostPet", "ReportFoundPet", "QRTagActivation", "PetDeceased", "NKKOwnership", "LoginIssue", "LoginProblem", "UnregisteredChip578", "ForeignRegistration", "ForeignRegistrationCost", "WrongInfo", "WrongOwner", "MissingPetProfile", "InactiveRegistration", "NewRegistration", "SmartTagActivation", "SmartTagQRActivation", "SmartTagConnection", "SmartTagMissing", "SmartTagPosition", "SmartTagSound", "SmartTagMultiple", "GDPRDelete", "LostFoundInfo", "SearchableMisuse", "FamilySharing", "FamilySharingRequest", "FamilySharingPermissions", "FamilySharingRequirement", "PetNotInSystem"];
  if ((intent && DIRECT_INTENTS.includes(intent)) || session.directIntentFlow || session.loginHelpStep) {
    let effectiveIntent = session.directIntentFlow || intent || "";
    let directResponse = handleDirectIntent(effectiveIntent, session, isAuthenticated, ownerContext, storedUserContext || null, userMessage);

    if (!directResponse && intent && DIRECT_INTENTS.includes(intent)) {
      effectiveIntent = intent;
      directResponse = handleDirectIntent(effectiveIntent, session, isAuthenticated, ownerContext, storedUserContext || null, userMessage);
    }

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

      if (isEscalationEnabled() && !session.hasEscalated) {
        const justCompleted = !!playbookResponse.actionExecuted;
        const justAnswered = !playbookResponse.requiresLogin && !justCompleted;
        if (justAnswered || justCompleted) {
          session.escalationFlow = "awaiting_resolution_feedback";
          session.escalationContext = {
            intentId: intent || null,
            matchedBy: method || null,
            semanticScore: matchDebug?.semanticScore || null,
            triggerType: justCompleted ? "post_action" : "post_answer",
          };
          responseText += "\n\n---\n**Løste dette saken?** (Ja / Nei)";
        }
      }

      yield responseText;
      return;
    }
  }

  if (intent) {
    const subtopicInfo = getSubtopicInfo(intent);
    if (subtopicInfo) {
      const responseText = `**${subtopicInfo.label}**\n\n${subtopicInfo.description ? subtopicInfo.description + "\n\n" : ""}Du finner detaljert informasjon om dette på hjelpesenteret vårt:\n${subtopicInfo.url}`;

      const metadata: any = {
        model: "help-center-redirect",
        matchedIntent: intent,
        method,
        helpCenterLink: subtopicInfo.url,
        suggestions: [
          { label: "Tilbake til " + subtopicInfo.category, action: "SUBTOPIC", data: { query: subtopicInfo.category.toLowerCase() } },
        ],
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
        responseMethod: "help-center-redirect",
        matchedIntent: intent,
        actionsExecuted: null,
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

  let semanticSuggestions: { label: string; action: string; data: { query: string }; score: number }[] = [];
  let usedFallbackCategories = false;
  try {
    if (isIndexReady() && getIndexSize() > 0) {
      const topMatches = await findTopNSemanticMatches(userMessage, 3);
      const topScore = topMatches.length > 0 ? topMatches[0].similarity : 0;

      if (topScore >= 0.50) {
        semanticSuggestions = topMatches
          .filter(m => m.similarity >= 0.50)
          .sort((a, b) => b.similarity - a.similarity)
          .map(m => ({
            label: `${m.category}${m.subcategory ? " – " + m.subcategory : ""}`,
            action: "SUBTOPIC",
            data: { query: m.intentId },
            score: parseFloat(m.similarity.toFixed(3)),
          }));
      }
    }
  } catch (err: any) {
    console.warn("[Block] Failed to get semantic suggestions:", err.message);
  }

  if (semanticSuggestions.length === 0 && (!isIndexReady() || getIndexSize() === 0)) {
    usedFallbackCategories = true;
    semanticSuggestions = [
      { label: "Eierskifte", action: "SUBTOPIC", data: { query: "eierskifte" }, score: 0 },
      { label: "ID-merking", action: "SUBTOPIC", data: { query: "id-merking" }, score: 0 },
      { label: "Min Side", action: "SUBTOPIC", data: { query: "min side" }, score: 0 },
    ];
  }

  const showSuggestions = semanticSuggestions.length > 0;
  let blockResponse: string;
  if (showSuggestions) {
    const suggestionLines = semanticSuggestions.map(s => `- ${s.label}`).join("\n");
    blockResponse = `Beklager, dette er utenfor det jeg kan hjelpe med automatisk.\n\nMener du kanskje noe av dette?\n${suggestionLines}\n\nHvis ikke, kontakt DyreID kundeservice på **support@dyreid.no** for videre hjelp.`;
  } else {
    blockResponse = `Beklager, dette er utenfor det jeg kan hjelpe med automatisk.\n\nKontakt DyreID kundeservice på **support@dyreid.no** for videre hjelp.`;
  }

  const blockMetadata: any = {
    model: "block-escalation",
    method: matchDebug.matchedBy,
    blocked: true,
    semanticScore: matchDebug.semanticScore,
    blockReason: matchDebug.blockReason || "noMatch",
    topIntentId: matchDebug.topIntentId || null,
    topSemanticScore: matchDebug.topSemanticScore || 0,
    suggestions: showSuggestions ? semanticSuggestions : [],
    usedFallbackCategories,
  };

  const msg = await storage.createMessage({
    conversationId,
    role: "assistant",
    content: blockResponse,
    metadata: blockMetadata,
  });

  const interaction = await storage.logChatbotInteraction({
    conversationId,
    messageId: msg.id,
    userQuestion: userMessage,
    botResponse: blockResponse,
    responseMethod: "block-escalation",
    matchedIntent: null,
    actionsExecuted: null,
    authenticated: isAuthenticated,
    responseTimeMs: Date.now() - startTime,
  });
  lastInteractionId = interaction.id;

  await db
    .update(messages)
    .set({ metadata: { ...blockMetadata, interactionId: interaction.id } })
    .where(eq(messages.id, msg.id));

  if (isEscalationEnabled() && !session.hasEscalated) {
    session.escalationFlow = "awaiting_resolution_feedback";
    session.escalationContext = {
      intentId: matchDebug.topIntentId || null,
      matchedBy: matchDebug.matchedBy || null,
      semanticScore: matchDebug.semanticScore || null,
      triggerType: "block",
    };
    blockResponse += "\n\n---\n**Vil du at jeg oppretter en supportsak?** (Ja / Nei)";
  }

  yield blockResponse;
}
