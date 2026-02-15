export interface IntentDefinition {
  intent: string;
  category: string;
  subcategory: string;
  slug: string;
  description: string;
  keywords: string[];
}

export const INTENT_DEFINITIONS: IntentDefinition[] = [
  // ── Min side ──────────────────────────────────────────────
  { intent: "LoginIssue", category: "Min side", subcategory: "Logg inn på Min side", slug: "logg-inn", description: "Hvordan logge inn på Min side", keywords: ["logg inn", "innlogging", "bankid", "passord"] },
  { intent: "SMSEmailNotification", category: "Min side", subcategory: "Hvorfor har jeg fått sms/e-post?", slug: "sms-epost", description: "Informasjon om mottatte meldinger", keywords: ["sms", "e-post", "melding", "varsel", "notifikasjon"] },
  { intent: "ProfileVerification", category: "Min side", subcategory: "Har jeg en Min side?", slug: "har-min-side", description: "Verifisere om profil eksisterer", keywords: ["har jeg", "min side", "profil", "konto", "finnes"] },
  { intent: "LoginProblem", category: "Min side", subcategory: "Hvorfor får jeg ikke logget meg inn?", slug: "login-problem", description: "Feilsøke innloggingsproblemer", keywords: ["får ikke logget", "kan ikke logge", "feil", "innlogging feiler", "problemer"] },
  { intent: "MissingPetProfile", category: "Min side", subcategory: "Det mangler et kjæledyr på Min side", slug: "mangler-dyr", description: "Dyr vises ikke i profil", keywords: ["mangler", "vises ikke", "finner ikke", "dyr borte", "kjæledyr"] },
  { intent: "PetDeceased", category: "Min side", subcategory: "Kjæledyret mitt er dødt", slug: "dyr-dod", description: "Håndtere avdøde kjæledyr", keywords: ["død", "dødt", "avdød", "avlivet", "bortgang"] },
  { intent: "GDPRDelete", category: "Min side", subcategory: "Slett meg", slug: "gdpr-slett", description: "GDPR sletting av profil", keywords: ["slett", "fjerne", "gdpr", "personvern", "slette konto"] },
  { intent: "GDPRExport", category: "Min side", subcategory: "Eksporter mine data", slug: "gdpr-eksport", description: "GDPR dataeksport", keywords: ["eksporter", "mine data", "gdpr", "personvern", "dataeksport"] },

  // ── Eierskifte ────────────────────────────────────────────
  { intent: "OwnershipTransferCost", category: "Eierskifte", subcategory: "Hva koster eierskifte?", slug: "kostnad-eierskifte", description: "Priser for eierskifte", keywords: ["koster", "pris", "eierskifte", "gebyr", "betale"] },
  { intent: "OwnershipTransfer", category: "Eierskifte", subcategory: "Hvordan foreta eierskifte?", slug: "eierskifte-prosess", description: "Prosess for eierskifte", keywords: ["eierskifte", "selge", "solgt", "ny eier", "overfør", "kjøpt"] },
  { intent: "OwnershipTransferDead", category: "Eierskifte", subcategory: "Eierskifte når eier er død", slug: "eier-dod", description: "Eierskifte ved dødsfall", keywords: ["eier er død", "dødsfall", "arv", "avdød eier"] },
  { intent: "NKKOwnership", category: "Eierskifte", subcategory: "Eierskifte av NKK-registrert hund", slug: "nkk-eierskifte", description: "NKK-spesifikk prosess", keywords: ["nkk", "norsk kennel", "rasehund", "stambokført"] },

  // ── Registrering ──────────────────────────────────────────
  { intent: "InactiveRegistration", category: "Registrering", subcategory: "Kjæledyret mitt er ikke søkbart", slug: "ikke-sokbart", description: "Dyr ikke synlig i søk", keywords: ["ikke søkbart", "finner ikke", "søk", "inaktiv", "registrering"] },
  { intent: "PetRegistration", category: "Registrering", subcategory: "Hvordan få dyret registrert i Norge?", slug: "registrering-norge", description: "Registreringsprosess", keywords: ["registrere", "chip", "id-merke", "registrering", "norge"] },
  { intent: "RegistrationPayment", category: "Registrering", subcategory: "Hva koster det å registrere et dyr?", slug: "kostnad-registrering", description: "Registreringspriser", keywords: ["koster", "pris", "registrering", "gebyr"] },
  { intent: "ForeignChip", category: "Registrering", subcategory: "Utenlandsregistrering", slug: "utenlands-chip", description: "Registrere utenlandsk chip", keywords: ["utenlands", "importert", "utlandet", "utenlandsk chip", "eu-pass"] },

  // ── Produkter - QR Tag ────────────────────────────────────
  { intent: "QRTagActivation", category: "Produkter - QR Tag", subcategory: "Hvordan aktivere QR-brikken?", slug: "aktivere-qr", description: "Aktivering av QR-brikke", keywords: ["aktivere", "qr", "brikke", "skann", "tag"] },
  { intent: "QRTagContactInfo", category: "Produkter - QR Tag", subcategory: "Er kontaktinformasjonen min tilgjengelig?", slug: "kontaktinfo-synlig", description: "Synlighet av kontaktinfo på QR-brikke", keywords: ["kontaktinfo", "synlig", "tilgjengelig", "qr", "hvem ser"] },
  { intent: "QRTagLost", category: "Produkter - QR Tag", subcategory: "Jeg har mistet tag'en", slug: "mistet-qr", description: "Erstatte tapt QR-brikke", keywords: ["mistet", "tapt", "ny brikke", "erstatte", "qr tag"] },
  { intent: "TagSubscriptionExpiry", category: "Produkter - QR Tag", subcategory: "Hva skjer hvis abonnementet utløper?", slug: "abonnement-utloper", description: "Konsekvenser ved utløp av abonnement", keywords: ["utløper", "abonnement", "slutt", "forny", "inaktiv"] },

  // ── Produkter - Smart Tag ─────────────────────────────────
  { intent: "SmartTagConnection", category: "Produkter - Smart Tag", subcategory: "Kan ikke koble til taggen", slug: "smarttag-kobling", description: "Koblingsproblemer Smart Tag", keywords: ["koble", "bluetooth", "smart tag", "tilkobling", "fungerer ikke"] },
  { intent: "SmartTagMissing", category: "Produkter - Smart Tag", subcategory: "Taggen var lagt til før men jeg finner den ikke", slug: "smarttag-forsvunnet", description: "Smart Tag ikke synlig i app", keywords: ["finner ikke", "forsvunnet", "borte", "smart tag", "lagt til"] },
  { intent: "SmartTagPosition", category: "Produkter - Smart Tag", subcategory: "Posisjonen har ikke oppdatert seg", slug: "smarttag-posisjon", description: "Posisjonsproblemer med Smart Tag", keywords: ["posisjon", "oppdatert", "gps", "sporing", "lokasjon"] },
  { intent: "SmartTagMultiple", category: "Produkter - Smart Tag", subcategory: "Flere tagger men får bare koblet til en", slug: "smarttag-flere", description: "Koble flere Smart Tags samtidig", keywords: ["flere", "tagger", "bare en", "koble", "smart tag"] },

  // ── Abonnement ────────────────────────────────────────────
  { intent: "SubscriptionComparison", category: "Abonnement", subcategory: "DyreID basis vs DyreID+", slug: "basis-vs-plus", description: "Forskjeller mellom abonnementsplaner", keywords: ["basis", "plus", "dyreID+", "forskjell", "sammenligne", "inkludert"] },
  { intent: "AppCost", category: "Abonnement", subcategory: "Koster appen noe?", slug: "app-kostnad", description: "Priser for app og abonnement", keywords: ["koster", "gratis", "pris", "app", "betale"] },
  { intent: "CancelSubscription", category: "Abonnement", subcategory: "Avslutte abonnement", slug: "avslutte-abo", description: "Oppsigelse av abonnement", keywords: ["avslutte", "oppsigelse", "slutt", "si opp", "kansellere"] },

  // ── Savnet/Funnet ─────────────────────────────────────────
  { intent: "ReportLostPet", category: "Savnet/Funnet", subcategory: "Hvordan melde mitt kjæledyr savnet?", slug: "melde-savnet", description: "Prosess for savnetmelding", keywords: ["savnet", "mistet", "borte", "forsvunnet", "melde"] },
  { intent: "ReportFoundPet", category: "Savnet/Funnet", subcategory: "Kjæledyret har kommet til rette", slug: "funnet-igjen", description: "Markere kjæledyr som funnet", keywords: ["funnet", "til rette", "kommet hjem", "tilbake"] },
  { intent: "LostFoundInfo", category: "Savnet/Funnet", subcategory: "Hvordan fungerer Savnet & Funnet?", slug: "savnet-funnet-info", description: "Informasjon om Savnet & Funnet-tjenesten", keywords: ["savnet", "funnet", "hvordan", "fungerer", "tjeneste"] },

  // ── Familiedeling ─────────────────────────────────────────
  { intent: "FamilySharing", category: "Familiedeling", subcategory: "Hvordan dele tilgang med familiemedlemmer?", slug: "dele-tilgang", description: "Prosess for familiedeling", keywords: ["familie", "deling", "del tilgang", "familiemedlem"] },
  { intent: "FamilySharingExisting", category: "Familiedeling", subcategory: "Familiedeling med noen som har kjæledyr?", slug: "familiedeling-eksisterende", description: "Deling med eksisterende brukere", keywords: ["familie", "eksisterende", "kjæledyr", "bruker", "allerede"] },
  { intent: "FamilyAccessLost", category: "Familiedeling", subcategory: "Jeg ser ikke lenger kjæledyret som har blitt delt", slug: "deling-forsvunnet", description: "Tilgang til delt kjæledyr mistet", keywords: ["ser ikke", "delt", "mistet tilgang", "borte", "familiedeling"] },

  // ── App ───────────────────────────────────────────────────
  { intent: "AppAccess", category: "App", subcategory: "Hvordan få tilgang til DyreID-appen?", slug: "app-tilgang", description: "Laste ned og logge inn i appen", keywords: ["app", "laste ned", "installere", "tilgang", "mobil"] },
  { intent: "AppLoginIssue", category: "App", subcategory: "Innlogging app", slug: "app-login", description: "Innloggingsprosess i appen", keywords: ["app", "logg inn", "innlogging", "app login", "mobil"] },
  { intent: "AppBenefits", category: "App", subcategory: "Hvorfor app?", slug: "app-fordeler", description: "Fordeler med DyreID-appen", keywords: ["hvorfor", "app", "fordeler", "funksjoner", "bruke"] },

  // ── Ekstra intents (fra originalene, ikke direkte i hjelpesenter CSV) ──
  { intent: "ProfileUpdate", category: "Min side", subcategory: "Oppdater profil", slug: "profil-oppdater", description: "Endre profilinformasjon", keywords: ["endre", "oppdatere", "profil", "informasjon", "telefon", "epost"] },
  { intent: "BillingIssue", category: "Abonnement", subcategory: "Betalingsproblem", slug: "betaling-problem", description: "Problemer med betaling", keywords: ["betaling", "faktura", "belastet", "trekk", "refusjon"] },
  { intent: "UpgradeSubscription", category: "Abonnement", subcategory: "Oppgradere abonnement", slug: "oppgrader-abo", description: "Oppgradering av abonnement", keywords: ["oppgradere", "upgrade", "dyreID+", "basis til plus"] },
  { intent: "ActivationIssue", category: "Produkter - QR Tag", subcategory: "Aktiveringsproblem", slug: "aktivering-problem", description: "Problemer med å aktivere produkt", keywords: ["aktivere", "fungerer ikke", "problem", "feil"] },
  { intent: "ProductReplace", category: "Produkter - QR Tag", subcategory: "Erstatte produkt", slug: "erstatte-produkt", description: "Bestille erstatningsprodukt", keywords: ["erstatte", "ny", "ødelagt", "bytte", "bestille"] },
  { intent: "IDSearch", category: "ID-søk", subcategory: "Søk etter dyr", slug: "id-sok", description: "Søke etter dyr via chipnummer eller navn", keywords: ["id-søk", "søke", "chipnummer", "finne eier", "hvem eier"] },
  { intent: "VetRegistration", category: "Registrering", subcategory: "Veterinærregistrering", slug: "vet-registrering", description: "Registrering via veterinær eller klinikk", keywords: ["veterinær", "klinikk", "dyrelege", "registrere"] },
  { intent: "ViewMyPets", category: "Min side", subcategory: "Se mine dyr", slug: "mine-dyr", description: "Vise oversikt over egne dyr", keywords: ["mine dyr", "se dyr", "dyrene mine", "hvilke dyr", "vis dyr"] },
  { intent: "GeneralInquiry", category: "Populære emner", subcategory: "Generell henvendelse", slug: "generell", description: "Generelle spørsmål som ikke passer andre kategorier", keywords: ["hjelp", "spørsmål", "lurer på", "informasjon"] },
];

export const INTENTS = INTENT_DEFINITIONS.map(d => d.intent);

export const INTENT_BY_NAME = new Map(INTENT_DEFINITIONS.map(d => [d.intent, d]));

export const INTENTS_BY_CATEGORY = INTENT_DEFINITIONS.reduce((acc, d) => {
  if (!acc[d.category]) acc[d.category] = [];
  acc[d.category].push(d);
  return acc;
}, {} as Record<string, IntentDefinition[]>);

export function getIntentsForCategory(category: string): IntentDefinition[] {
  return INTENTS_BY_CATEGORY[category] || [];
}

export function findIntentBySlug(slug: string): IntentDefinition | undefined {
  return INTENT_DEFINITIONS.find(d => d.slug === slug);
}
