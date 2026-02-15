export interface IntentDefinition {
  intent: string;
  category: string;
  subcategory: string;
  slug: string;
  description: string;
  keywords: string[];
}

export const INTENT_DEFINITIONS: IntentDefinition[] = [
  // ── ID-søk (3) ────────────────────────────────────────────
  { intent: "WhyIDMark", category: "ID-søk", subcategory: "Hvorfor bør jeg ID-merke?", slug: "hvorfor-id-merke", description: "Fordeler med ID-merking av kjæledyr", keywords: ["id-merke", "merke", "chip", "hvorfor", "fordel"] },
  { intent: "CheckContactData", category: "ID-søk", subcategory: "Hvordan kontrollere at mine kontaktdata er riktig?", slug: "kontrollere-kontaktdata", description: "Sjekke og oppdatere kontaktdata på chipnummer", keywords: ["kontaktdata", "kontrollere", "chipnummer", "riktig", "sjekke"] },
  { intent: "InactiveRegistration", category: "ID-søk", subcategory: "Kjæledyret mitt er ikke søkbart", slug: "ikke-sokbart", description: "Dyr ikke synlig i søk", keywords: ["ikke søkbart", "søkbar", "finner ikke", "inaktiv", "søk"] },

  // ── DyreID-appen (7) ──────────────────────────────────────
  { intent: "AppAccess", category: "DyreID-appen", subcategory: "Hvordan får tilgang til DyreID-appen?", slug: "app-tilgang", description: "Laste ned og logge inn i appen", keywords: ["app", "laste ned", "installere", "tilgang", "mobil"] },
  { intent: "AppLoginIssue", category: "DyreID-appen", subcategory: "Innlogging app", slug: "app-login", description: "Innloggingsprosess i appen", keywords: ["app", "logg inn", "innlogging", "app login"] },
  { intent: "AppBenefits", category: "DyreID-appen", subcategory: "Hvorfor app?", slug: "app-fordeler", description: "Fordeler med DyreID-appen", keywords: ["hvorfor", "app", "fordeler", "funksjoner"] },
  { intent: "AppTargetAudience", category: "DyreID-appen", subcategory: "Hvem passer appen for?", slug: "app-maalgruppe", description: "Hvem appen er laget for", keywords: ["hvem", "passer", "app", "dyreeier", "bruker"] },
  { intent: "SubscriptionComparison", category: "DyreID-appen", subcategory: "Hva er forskjellen på DyreID basis og DyreID+?", slug: "basis-vs-plus", description: "Forskjeller mellom abonnementsplaner", keywords: ["basis", "plus", "dyreID+", "forskjell", "sammenligne"] },
  { intent: "AppCost", category: "DyreID-appen", subcategory: "Koster appen noe?", slug: "app-kostnad", description: "Priser for app og abonnement", keywords: ["koster", "gratis", "pris", "app", "betale"] },
  { intent: "AppMinSide", category: "DyreID-appen", subcategory: "Min side (i appen)", slug: "app-min-side", description: "Min side-funksjonalitet i appen", keywords: ["min side", "app", "profil", "oversikt"] },

  // ── Min side (12) ─────────────────────────────────────────
  { intent: "LoginIssue", category: "Min side", subcategory: "Logg inn på Min side", slug: "logg-inn", description: "Hvordan logge inn på Min side", keywords: ["logg inn", "innlogging", "bankid", "passord"] },
  { intent: "SMSEmailNotification", category: "Min side", subcategory: "Hvorfor har jeg fått sms/e-post?", slug: "sms-epost", description: "Informasjon om mottatte meldinger", keywords: ["sms", "e-post", "melding", "varsel", "notifikasjon"] },
  { intent: "ProfileVerification", category: "Min side", subcategory: "Har jeg en Min side?", slug: "har-min-side", description: "Verifisere om profil eksisterer", keywords: ["har jeg", "min side", "profil", "konto", "finnes"] },
  { intent: "LoginProblem", category: "Min side", subcategory: "Hvorfor får jeg ikke logget meg inn?", slug: "login-problem", description: "Feilsøke innloggingsproblemer", keywords: ["får ikke logget", "kan ikke logge", "feil", "innlogging feiler"] },
  { intent: "EmailError", category: "Min side", subcategory: "Feilmelding e-postadresse", slug: "feilmelding-epost", description: "Feilmelding ved ugyldig e-postadresse", keywords: ["feilmelding", "e-post", "ugyldig", "e-postadresse", "feil epost"] },
  { intent: "PhoneError", category: "Min side", subcategory: "Feilmelding telefonnummer", slug: "feilmelding-telefon", description: "Feilmelding ved ugyldig telefonnummer", keywords: ["feilmelding", "telefonnummer", "ugyldig", "feil nummer"] },
  { intent: "AddContactInfo", category: "Min side", subcategory: "Legge til flere telefonnumre eller e-postadresser", slug: "flere-kontaktdata", description: "Administrere flere kontaktpunkter", keywords: ["legge til", "flere", "telefonnummer", "e-postadresse", "kontaktinfo"] },
  { intent: "WrongInfo", category: "Min side", subcategory: "Det er feil informasjon på min side", slug: "feil-info", description: "Korrigere feil registrert informasjon", keywords: ["feil informasjon", "feil", "korrigere", "endre", "oppdatere"] },
  { intent: "MissingPetProfile", category: "Min side", subcategory: "Det mangler et kjæledyr på Min side", slug: "mangler-dyr", description: "Dyr vises ikke i profil", keywords: ["mangler", "vises ikke", "finner ikke", "dyr borte"] },
  { intent: "PetDeceased", category: "Min side", subcategory: "Kjæledyret mitt er dødt", slug: "dyr-dod", description: "Håndtere avdøde kjæledyr", keywords: ["død", "dødt", "avdød", "avlivet", "bortgang"] },
  { intent: "GDPRDelete", category: "Min side", subcategory: "Slett meg", slug: "gdpr-slett", description: "GDPR sletting av profil", keywords: ["slett", "fjerne", "gdpr", "personvern", "slette konto"] },
  { intent: "GDPRExport", category: "Min side", subcategory: "Eksporter mine data", slug: "gdpr-eksport", description: "GDPR dataeksport", keywords: ["eksporter", "mine data", "gdpr", "personvern", "dataeksport"] },

  // ── Eierskifte (5) ────────────────────────────────────────
  { intent: "OwnershipTransferApp", category: "Eierskifte", subcategory: "Eierskifte APP", slug: "eierskifte-app", description: "Hvordan gjøre eierskifte i appen", keywords: ["eierskifte", "app", "overføre", "mobil"] },
  { intent: "OwnershipTransferCost", category: "Eierskifte", subcategory: "Hva koster eierskifte?", slug: "kostnad-eierskifte", description: "Priser for eierskifte", keywords: ["koster", "pris", "eierskifte", "gebyr"] },
  { intent: "OwnershipTransferWeb", category: "Eierskifte", subcategory: "Eierskifte på Web", slug: "eierskifte-web", description: "Hvordan gjøre eierskifte via Min side web", keywords: ["eierskifte", "web", "min side", "overføre", "selge", "solgt", "ny eier", "kjøpt"] },
  { intent: "OwnershipTransferDead", category: "Eierskifte", subcategory: "Eierskifte når eier er død", slug: "eier-dod", description: "Eierskifte ved dødsfall", keywords: ["eier er død", "dødsfall", "arv", "avdød eier"] },
  { intent: "NKKOwnership", category: "Eierskifte", subcategory: "Eierskifte av NKK-registrert hund", slug: "nkk-eierskifte", description: "NKK-spesifikk eierskifteprosess", keywords: ["nkk", "norsk kennel", "stambokført", "rasehund"] },

  // ── Smart Tag (7) ─────────────────────────────────────────
  { intent: "SmartTagActivation", category: "Smart Tag", subcategory: "Aktivering av Smart Tag", slug: "smarttag-aktivering", description: "Aktivere Smart Tag for iOS og Android", keywords: ["aktivere", "smart tag", "oppsett", "starte"] },
  { intent: "SmartTagQRActivation", category: "Smart Tag", subcategory: "Aktiver QR-koden på Smart Tag", slug: "smarttag-qr-aktivering", description: "Aktivere QR-kode på Smart Tag", keywords: ["qr", "smart tag", "aktivere", "kode"] },
  { intent: "SmartTagConnection", category: "Smart Tag", subcategory: "Kan ikke koble til eller legge til taggen", slug: "smarttag-kobling", description: "Koblingsproblemer med Smart Tag", keywords: ["koble", "bluetooth", "smart tag", "tilkobling", "fungerer ikke"] },
  { intent: "SmartTagMissing", category: "Smart Tag", subcategory: "Taggen var lagt til før men jeg finner den ikke", slug: "smarttag-forsvunnet", description: "Smart Tag ikke synlig i app", keywords: ["finner ikke", "forsvunnet", "borte", "smart tag", "lagt til"] },
  { intent: "SmartTagPosition", category: "Smart Tag", subcategory: "Posisjonen har ikke oppdatert seg på lenge", slug: "smarttag-posisjon", description: "Posisjonsproblemer med Smart Tag", keywords: ["posisjon", "oppdatert", "gps", "sporing", "lokasjon"] },
  { intent: "SmartTagSound", category: "Smart Tag", subcategory: "Taggen lager lyder av seg selv", slug: "smarttag-lyd", description: "Uønskede lyder fra Smart Tag", keywords: ["lyd", "lyder", "piper", "bråk", "smart tag"] },
  { intent: "SmartTagMultiple", category: "Smart Tag", subcategory: "Flere tagger men får bare koblet til den ene", slug: "smarttag-flere", description: "Koble flere Smart Tags samtidig", keywords: ["flere", "tagger", "bare en", "koble", "smart tag"] },

  // ── QR-brikke (10) ────────────────────────────────────────
  { intent: "QRCompatibility", category: "QR-brikke", subcategory: "Passer QR-brikke for hunder og katter?", slug: "qr-kompatibilitet", description: "QR-brikke kompatibilitet med dyretyper", keywords: ["passer", "hund", "katt", "qr", "brikke", "kompatibel"] },
  { intent: "QRRequiresIDMark", category: "QR-brikke", subcategory: "Må kjæledyret være ID-merket for QR-brikke?", slug: "qr-krav-id-merking", description: "Krav om ID-merking for QR-brikke", keywords: ["id-merket", "krav", "qr", "brikke", "chip"] },
  { intent: "QRPricingModel", category: "QR-brikke", subcategory: "Er det abonnement eller engangskostnad?", slug: "qr-abonnement-engang", description: "Prismodell for QR-brikke", keywords: ["abonnement", "engangskostnad", "pris", "qr", "brikke"] },
  { intent: "QRTagActivation", category: "QR-brikke", subcategory: "Hvordan aktivere QR-brikken?", slug: "aktivere-qr", description: "Aktivering av QR-brikke", keywords: ["aktivere", "qr", "brikke", "skann", "tag"] },
  { intent: "QRTagContactInfo", category: "QR-brikke", subcategory: "Er kontaktinformasjonen synlig ved skanning?", slug: "kontaktinfo-synlig", description: "Synlighet av kontaktinfo ved skanning", keywords: ["kontaktinfo", "synlig", "tilgjengelig", "qr", "skann"] },
  { intent: "QRScanResult", category: "QR-brikke", subcategory: "Hva skjer når QR-koden skannes?", slug: "qr-skanning", description: "Hva som skjer ved skanning av QR-kode", keywords: ["skanne", "qr", "hva skjer", "resultat"] },
  { intent: "QRUpdateContact", category: "QR-brikke", subcategory: "Hvordan oppdatere kontaktinfo på QR-brikke?", slug: "qr-oppdater-kontakt", description: "Oppdatere kontaktinfo knyttet til QR-brikke", keywords: ["oppdatere", "kontaktinfo", "endre", "qr", "brikke"] },
  { intent: "QRBenefits", category: "QR-brikke", subcategory: "Hva er fordelen med DyreIDs QR-brikke?", slug: "qr-fordeler", description: "Fordeler med QR-brikke for ID-merkede dyr", keywords: ["fordel", "qr", "brikke", "hvorfor", "nytte"] },
  { intent: "QRTagLost", category: "QR-brikke", subcategory: "Jeg har mistet tag'en", slug: "mistet-qr", description: "Erstatte tapt QR-brikke", keywords: ["mistet", "tapt", "ny brikke", "erstatte", "qr tag"] },
  { intent: "TagSubscriptionExpiry", category: "QR-brikke", subcategory: "Hva skjer hvis abonnementet utløper?", slug: "abonnement-utloper", description: "Konsekvenser ved utløp av QR-abonnement", keywords: ["utløper", "abonnement", "slutt", "forny", "inaktiv"] },

  // ── Utenlandsregistrering (3) ─────────────────────────────
  { intent: "ForeignRegistration", category: "Utenlandsregistrering", subcategory: "Hvordan få dyret registrert i Norge?", slug: "registrering-norge", description: "Registreringsprosess for utenlandske dyr", keywords: ["registrere", "norge", "utenlands", "importert"] },
  { intent: "ForeignRegistrationCost", category: "Utenlandsregistrering", subcategory: "Hva koster det å registrere et dyr?", slug: "kostnad-registrering", description: "Registreringspriser og gebyrer", keywords: ["koster", "pris", "registrering", "gebyr", "676"] },
  { intent: "ForeignPedigree", category: "Utenlandsregistrering", subcategory: "Utenlandsk hund med stamtavle", slug: "utenlandsk-stamtavle", description: "Registrering av utenlandsk hund med stamtavle", keywords: ["stamtavle", "utenlandsk", "rasehund", "pedigree"] },

  // ── Savnet/Funnet (5) ─────────────────────────────────────
  { intent: "ReportLostPet", category: "Savnet/Funnet", subcategory: "Hvordan melde mitt kjæledyr savnet?", slug: "melde-savnet", description: "Prosess for savnetmelding", keywords: ["savnet", "mistet", "borte", "forsvunnet", "melde"] },
  { intent: "ReportFoundPet", category: "Savnet/Funnet", subcategory: "Kjæledyret har kommet til rette", slug: "funnet-igjen", description: "Markere kjæledyr som funnet", keywords: ["funnet", "til rette", "kommet hjem", "tilbake"] },
  { intent: "LostFoundInfo", category: "Savnet/Funnet", subcategory: "Hvordan fungerer Savnet & Funnet?", slug: "savnet-funnet-info", description: "Informasjon om Savnet & Funnet-tjenesten", keywords: ["savnet", "funnet", "hvordan", "fungerer", "tjeneste"] },
  { intent: "SearchableInfo", category: "Savnet/Funnet", subcategory: "Hvordan fungerer Søkbar på 1-2-3?", slug: "sokbar-123", description: "Informasjon om Søkbar på 1-2-3-tjenesten", keywords: ["søkbar", "1-2-3", "fungerer", "hvordan"] },
  { intent: "SearchableMisuse", category: "Savnet/Funnet", subcategory: "Kan Søkbar på 1-2-3 misbrukes?", slug: "sokbar-misbruk", description: "Sikkerhet rundt Søkbar på 1-2-3", keywords: ["misbruk", "søkbar", "sikkerhet", "1-2-3"] },

  // ── Familiedeling (8) ─────────────────────────────────────
  { intent: "FamilySharingBenefits", category: "Familiedeling", subcategory: "Hvorfor burde jeg ha familiedeling?", slug: "familiedeling-fordeler", description: "Fordeler med familiedeling", keywords: ["hvorfor", "familiedeling", "fordeler", "dele"] },
  { intent: "FamilySharingNonFamily", category: "Familiedeling", subcategory: "Kan jeg dele tilgang med andre enn familien?", slug: "dele-ikke-familie", description: "Deling utenfor familiekretsen", keywords: ["andre", "ikke familie", "venner", "dele", "tilgang"] },
  { intent: "FamilySharingRequirement", category: "Familiedeling", subcategory: "Trenger jeg DyreID+ for familiedeling?", slug: "familiedeling-krav", description: "Abonnementskrav for familiedeling", keywords: ["trenger", "dyreID+", "krav", "familiedeling", "abonnement"] },
  { intent: "FamilySharingRequest", category: "Familiedeling", subcategory: "Forespørsel ikke akseptert", slug: "familiedeling-foresporsel", description: "Hjelp med ubesvarte forespørsler om familiedeling", keywords: ["forespørsel", "akseptert", "venter", "invitasjon", "sendt"] },
  { intent: "FamilySharing", category: "Familiedeling", subcategory: "Hvordan dele tilgang med familiemedlemmer?", slug: "dele-tilgang", description: "Prosess for å dele tilgang med familiemedlemmer", keywords: ["familie", "deling", "del tilgang", "familiemedlem"] },
  { intent: "FamilySharingPermissions", category: "Familiedeling", subcategory: "Kan de jeg deler med gjøre endringer?", slug: "familiedeling-rettigheter", description: "Rettigheter for familiemedlemmer", keywords: ["endringer", "rettigheter", "redigere", "tillatelser", "deling"] },
  { intent: "FamilyAccessLost", category: "Familiedeling", subcategory: "Jeg ser ikke lenger kjæledyret som har blitt delt", slug: "deling-forsvunnet", description: "Tilgang til delt kjæledyr mistet", keywords: ["ser ikke", "delt", "mistet tilgang", "borte", "familiedeling"] },
  { intent: "FamilySharingExisting", category: "Familiedeling", subcategory: "Familiedeling med noen som allerede har kjæledyr?", slug: "familiedeling-eksisterende", description: "Deling med eksisterende dyreeiere", keywords: ["eksisterende", "allerede", "kjæledyr", "bruker", "deling"] },

  // ── Generelle/system-intents ──────────────────────────────
  { intent: "GeneralInquiry", category: "Generell", subcategory: "Generell henvendelse", slug: "generell", description: "Generelle spørsmål som ikke passer andre kategorier", keywords: ["hjelp", "spørsmål", "lurer på", "informasjon"] },
  { intent: "ViewMyPets", category: "Min side", subcategory: "Se mine dyr", slug: "mine-dyr", description: "Vise oversikt over egne dyr", keywords: ["mine dyr", "se dyr", "dyrene mine", "hvilke dyr", "vis dyr"] },
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
