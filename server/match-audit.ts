import { db } from "./db";
import { sql } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface AuditMatch {
  newIntentId: string;
  ticketCount: number;
  matchedCanonicalId: string;
  matchMethod: "regex" | "semantic" | "fuzzy" | "keyword";
  matchScore: number | null;
  exampleQueries: string[];
  playbookTitle: string;
  playbookResponsePreview: string;
  classification: "CORRECT" | "INCORRECT" | "AMBIGUOUS";
  classificationReason: string;
  proposedFix?: {
    type: "tighten_regex" | "adjust_normalization" | "add_disambiguation";
    suggestedRegex?: string;
    normalizationReplacements?: Record<string, string>;
    disambiguationQuestion?: string;
    disambiguationOptions?: string[];
  };
}

interface PromotionCandidate {
  intentId: string;
  ticketCount: number;
  avgConfidence: number;
  category: string;
  subcategory: string;
  isTransactional: boolean;
  endpointReadiness: "exists" | "TODO";
  recommendedAction: "create_canonical_now" | "wait" | "merge_with_existing";
  mergeTarget?: string;
  reasoning: string;
}

const INTENT_PATTERNS: { intent: string; regex: RegExp }[] = [
  { intent: "WhyIDMark", regex: /hvorfor.*id.?merk|bør.*(?:id.?)?merk|fordel.*(?:chip|id.?merk)|id.?merk.*(?:fordel|viktig)|poenget med.*id|viktig.*id.?merk|hvorfor.*chippe/i },
  { intent: "CheckContactData", regex: /kontrollere.*kontakt|kontaktdata.*(?:riktig|oppdater)|sjekke.*kontakt|verifisere.*kontakt|kontaktinfo|stemmer.*kontakt/i },
  { intent: "InactiveRegistration", regex: /ikke søkbar|kjaledyr.*søkbar|dyr.*søkbar|inaktiv.*registr|registrering.*inaktiv|dukker ikke opp.*søk|finnes ikke.*søk/i },
  { intent: "AppTargetAudience", regex: /hvem.*(?:passer|kan bruke|laget for|bør (?:laste|bruke|ha)|målgrupp).*(?:app|appen|dyreid)|(?:app|appen).*(?:for meg|for alle|for hundeeier|for katteeier)|hvem.*bør.*laste.*ned/i },
  { intent: "AppMinSide", regex: /min side.*(?:app|appen)|(?:app|appen).*min side|profil.*appen|min side.*funksjon|funksjon.*(?:app|appen).*min side|administrere.*min side.*app/i },
  { intent: "AppAccess", regex: /laste ned.*(?:app|dyreid)|installere.*(?:app|dyreid)|tilgang.*app|(?:app|dyreid).*nedlast|hente.*app|(?:app|dyreid).*(?:iphone|android)/i },
  { intent: "AppLoginIssue", regex: /(?:app|appen).*(?:logg|login|innlogg)|(?:logg|login|innlogg).*(?:app|appen)|(?:app|appen).*(?:nekter|feiler)/i },
  { intent: "AppBenefits", regex: /(?:hvorfor|fordel|funksjoner|bra med|tilbyr|nytte|nyttig|hva får).*(?:app|appen)|(?:app|appen).*(?:fordel|funksjoner|nytte)/i },
  { intent: "FamilySharingRequirement", regex: /(?:treng|krev|forutsett|behøv|må|nødvendig|påkrevd).*(?:dyreID.?(?:\+|pluss)|abonnement|premium).*(?:familie|del)|familiedeling.*(?:dyreID.?(?:\+|pluss)|abonnement|krav|uten)|(?:dyreID.?(?:\+|pluss)).*(?:krav|nødvendig|familiedeling|deling|familie)|(?:familiedeling|dele).*uten.*(?:dyreID|abonnement)/i },
  { intent: "SubscriptionComparison", regex: /basis.*(?:plus|pluss|\+)|(?:dyreID\+|dyreID pluss)(?!.*(?:familie|del))|forskjell.*abonnement|sammenlign.*(?:abonnement|dyreID)|(?:vs|kontra|forskjell).*(?:dyreID|abonnement)|inkludert i.*dyreID\+|skiller.*dyreID/i },
  { intent: "AppCost", regex: /koster.*(?:app|appen|dyreID)|(?:app|appen|dyreID).*(?:gratis|kost|pris)|pris.*(?:app|appen)|abonnementspris|betale.*(?:app|appen)/i },
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
  { intent: "OwnershipTransferApp", regex: /eierskift.*(?:app|mobil)|(?:app|appen|mobil(?:app)?).*eierskift|overf[øo]r.*(?:i |via |gjennom |med )?(?:app|appen)|(?:app|appen).*(?:overf[øo]r|bytte eier)|eieroverføring.*(?:app|appen)|bytte eier.*(?:via|i|gjennom).*(?:app|appen)/i },
  { intent: "OwnershipTransferCost", regex: /(?:kost|pris|gebyr|avgift|betale|gratis|billig|dyrt).*(?:eierskift|overf[øo]r.*eier|eieroverføring)|(?:eierskift|overf[øo]r.*eier|eieroverføring).*(?:kost|pris|gebyr|betale|gratis|avgift)|hva (?:koster|må.*betale).*(?:eierskift|bytte eier|overf[øo]r)|pris.*eieroverføring/i },
  { intent: "NKKOwnership", regex: /nkk|norsk kennel|stambokført|rasehund.*eierskift/i },
  { intent: "OwnershipTransferWeb", regex: /eierskift.*min side|via min side|eierskift|selge|solgt|ny eier|overfør.*eier|bytte eier|overf[øo]re.*(?:hund|katt|dyr|eierskap)|eieroverføring/i },
  { intent: "SmartTagQRActivation", regex: /qr.*smart.?tag|smart.?tag.*qr|aktivere.*qr.*tag|qr.?kode.*smart/i },
  { intent: "SmartTagActivation", regex: /aktivere.*smart.?tag|smart.?tag.*(?:aktivere|setup|oppsett)|sette opp.*smart|komme i gang.*smart|(?:bruke|starte|ta i bruk).*smart.?tag|smart.?tag.*(?:kom i gang)/i },
  { intent: "SmartTagMultiple", regex: /flere.*(?:smart\s*)?tag|bare.*(?:en|én).*(?:tag|kobl)|smart.?tag.*flere|koblet til én|koble.*flere|(?:to|tre|nummer to|nummer 2|andre).*smart.?tag|smart.?tag.*nummer|(?:kan ikke|får ikke).*koble.*(?:til )?flere/i },
  { intent: "SmartTagConnection", regex: /koble.*smart.?tag|smart.?tag.*kobl|bluetooth.*(?:tag|smart)|(?:kan ikke|får ikke).*koble|legge til.*smart|smart.?tag.*(?:pairing|tilkobling|bluetooth)|tilkobling.*smart/i },
  { intent: "SmartTagMissing", regex: /(?:finner ikke|forsvunnet|borte|vises ikke|mistet).*smart.?tag|smart.?tag.*(?:forsvunnet|borte|vises ikke|forsvant)/i },
  { intent: "SmartTagPosition", regex: /(?:posisjon|lokasjon|plassering|gps|sporing).*(?:smart.?tag|oppdater)|smart.?tag.*(?:posisjon|lokasjon|plassering|gps|sporing)/i },
  { intent: "SmartTagSound", regex: /(?:smart.?tag|tag).*(?:lyd|piper?|bråk|alarm|ringer|lager lyd)|(?:lyd|piper?|bråk).*(?:smart.?tag|tag)/i },
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
  { intent: "UnregisteredChip578", regex: /578|uregistrert.*(?:brikke|chip)|(?:norsk|norge).*chip.*ikke|chip.*(?:uregistrert|ikke registrert|ikke funnet|ikke i|mangler)|ikke.*forhåndsbetalt/i },
  { intent: "ForeignRegistrationCost", regex: /(?:kost|pris|gebyr|avgift|betale|gratis).*(?:registrer|utenlandsregistrering)|(?:utenlandsregistrering|utenlands.*registrer).*(?:kost|pris|gebyr|avgift)|hva koster.*registrer|676|registreringsavgift.*(?:utenlandsk|utland)|(?:utenlandsk|utland).*(?:dyr|hund|katt).*(?:gratis|kost|pris|gebyr|avgift)|registrering.*kost|kost.*registrering/i },
  { intent: "ForeignPedigree", regex: /stamtavle|pedigree|fci|rasehund.*(?:utland|import)|(?:utland|import).*rasehund|utenlandsk rasehund/i },
  { intent: "ForeignRegistration", regex: /registrer.*(?:i )?norge|(?:utenlands|import|utland).*registrer|registrer.*(?:utland|import)|(?:hund|katt|dyr).*(?:fra )?utland/i },
  { intent: "LostFoundInfo", regex: /savnet.*funnet.*(?:fungerer|tjenest|virker|info)|hvordan.*savnet.*funnet|savnet og funnet|savnet.funnet.*(?:info|tjenest)|informasjon.*savnet/i },
  { intent: "SearchableMisuse", regex: /misbruk.*søkbar|søkbar.*(?:misbruk|sikkerhet|trygt)|(?:kan|noen).*misbruk.*søkbar/i },
  { intent: "SearchableInfo", regex: /søkbar.*1-?2-?3|hvordan.*søkbar/i },
  { intent: "ReportFoundPet", regex: /(?:funnet|kommet til rette|kommet hjem|funnet igjen|er tilbake|kom tilbake|kom hjem).*(?:dyr|hund|katt|kjæledyr)|(?:dyr|hund|katt|kjæledyr).*(?:funnet|kommet til rette|kommet hjem|er tilbake)|avmelde.*savnet/i },
  { intent: "ReportLostPet", regex: /savnet|melde.*(?:savnet|borte)|(?:hund|katt|dyr|kjæledyr).*(?:borte|forsvunnet|rømte|stakk av|forsvant)|mistet.*(?:hund|katt|dyr)|rapportere.*(?:savnet|borte)/i },
  { intent: "FamilySharingBenefits", regex: /(?:hvorfor|fordel|nytte|verdt|bra med|grunner|hva (?:er|får)).*familiedeling|familiedeling.*(?:fordel|nytte|verdt|verdi)/i },
  { intent: "FamilySharingNonFamily", regex: /(?:dele|deling|familiedeling).*(?:venn|nabo|hundelufter|ikke.*familie|bare.*for.*familie)|(?:dele|deling|familiedeling).*andre(?!.*(?:gjøre|endre|tilgang|rettighet))|(?:andre|venn|nabo).*(?:dele|tilgang|familiedeling)|(?:ikke|utenfor|bare).*(?:familie|familiemedlem).*(?:dele|tilgang)|(?:hvem).*(?:jeg )?dele.*med/i },
  { intent: "FamilySharingRequest", regex: /(?:forespørsel|invitasjon).*(?:familie|akseptert|godkjen|avvist|venter|mottatt|status|problem)|(?:familie|deling).*(?:forespørsel|invitasjon)|(?:sendt|ikke mottatt|venter).*(?:forespørsel|invitasjon)/i },
  { intent: "FamilySharingPermissions", regex: /(?:rettigheter|tillatelser|begrensninger).*(?:deling|familie|delt)|(?:kan|hva kan).*(?:de|den|delt.*(?:bruker|person)|familiemedlem).*(?:endre|gjøre|tilgang|se)|gjøre endringer.*deling|rettigheter.*delt|hva kan.*(?:andre|de|delt)|familiedeling.*(?:tillatels|rettighet|begrens|hva kan)|(?:delt|familiemedlem).*(?:bruker|person).*(?:endre|gjøre)|kan.*delt.*(?:endre|gjøre|oppdatere)|(?:hva har|hva kan).*(?:de|dem|delt|deler).*(?:tilgang|gjøre|endre|se)|(?:jeg )?deler med.*tilgang/i },
  { intent: "FamilySharing", regex: /sette opp.*(?:deling|familie)|(?:dele|deling).*(?:tilgang|familie)|familiemedlem|(?:legge til|invitere).*(?:familiemedlem|partner|familie)|gi.*(?:partner|familie).*tilgang|(?:hvordan|komme i gang|steg).*dele|familiedeling/i },
  { intent: "FamilyAccessLost", regex: /ser ikke.*delt|mistet.*tilgang.*deling|familie.*borte/i },
  { intent: "FamilySharingExisting", regex: /familiedeling.*eksisterende|deling.*allerede.*kjæledyr/i },
  { intent: "WrongOwner", regex: /(?:feil|gal|annen).*(?:eier|person).*(?:registrert|står)|registrert.*(?:på|hos).*(?:feil|gal|annen)|(?:dyr|hund|katt).*(?:på|tilhører|står på).*(?:feil|gal|annen|noen andre)|feil.*eier|(?:eier|eierskap).*feil/i },
  { intent: "PetNotInSystem", regex: /finnes ikke.*(?:system|register)|(?:dyr|hund|katt).*(?:finnes|dukker|er).*ikke|finner ikke.*(?:dyr|hund|katt)|ikke (?:i )?(?:registeret|systemet)|mangler.*register|(?:hund|katt|dyr).*ikke registrert/i },
  { intent: "ChipLookup", regex: /chip.?(?:nummer|søk|sjekk|oppslag|registrering)|søke?.*(?:opp )?chip|finne.*(?:eier.*chip|dyr.*chip)|(?:slå|søke?).*opp.*(?:chip|id)|id.?(?:nummer|søk).*(?:søk|oppslag)|(?:hvem|finne).*eier.*chip|fant.*(?:en|et).*(?:katt|hund|dyr).*chip/i },
  { intent: "NewRegistration", regex: /registrere.*(?:nytt?|ny).*(?:dyr|hund|katt|valp|kattunge)|(?:nytt?|ny).*(?:dyr|hund|katt|valp|kattunge).*registrer|ny.*registrering|(?:nyregistrering|førstegangsregistrering)|(?:hvordan|første gang).*registrer|^registrer.*(?:hund|katt|dyr|valp)$|registrere.*(?:hund|katt|dyr|valp)(?:\s+(?:i|hos|på)\s+)?(?:DyreID)?$/i },
  { intent: "GeneralInquiry", regex: /generell|hjelp med|lurer på|spørsmål om/i },
];

function tryRegexMatch(query: string): { intent: string } | null {
  for (const p of INTENT_PATTERNS) {
    if (p.regex.test(query)) return { intent: p.intent };
  }
  return null;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    dimensions: 1536,
  });
  return response.data[0].embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

function fuzzyLabelScore(newIntent: string, canonicalId: string): number {
  const a = newIntent.toLowerCase().replace(/[_-]/g, '');
  const b = canonicalId.toLowerCase().replace(/[_-]/g, '');
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const levScore = 1 - (levenshteinDistance(a, b) / maxLen);
  const aTokens = new Set(newIntent.replace(/([A-Z])/g, ' $1').toLowerCase().split(/[\s_-]+/).filter(t => t.length > 2));
  const bTokens = new Set(canonicalId.replace(/([A-Z])/g, ' $1').toLowerCase().split(/[\s_-]+/).filter(t => t.length > 2));
  const intersection = new Set(Array.from(aTokens).filter(t => bTokens.has(t)));
  const union = new Set(Array.from(aTokens).concat(Array.from(bTokens)));
  const jaccardScore = union.size > 0 ? intersection.size / union.size : 0;
  return (levScore * 0.4) + (jaccardScore * 0.6);
}

export async function runMatchCorrectnessAudit(
  onProgress?: (msg: string, pct: number) => void
): Promise<{
  auditMatches: AuditMatch[];
  unmatchedIntents: PromotionCandidate[];
  summary: {
    totalNewIntents: number;
    matchedCount: number;
    unmatchedCount: number;
    correctCount: number;
    incorrectCount: number;
    ambiguousCount: number;
  };
}> {
  onProgress?.("Loading new intents from review queue...", 0);

  const newIntentRows = await db.execute(sql`
    SELECT ic.intent, COUNT(*) as ticket_count, 
      AVG(ic.intent_confidence) as avg_confidence,
      bool_or(ic.auto_close_possible) as any_auto_closeable
    FROM intent_classifications ic
    WHERE ic.is_new_intent = true
    GROUP BY ic.intent
    ORDER BY COUNT(*) DESC
  `);
  const newIntents = newIntentRows.rows as any[];
  onProgress?.(`Found ${newIntents.length} distinct new intents`, 5);

  const canonicalRows = await db.execute(sql`
    SELECT ci.intent_id, ci.category, ci.subcategory, ci.description, ci.keywords, ci.actionable, ci.endpoint,
      pe.combined_response, pe.help_center_content_summary, pe.help_center_article_title,
      pe.action_type, pe.hjelpesenter_category, pe.hjelpesenter_subcategory
    FROM canonical_intents ci
    LEFT JOIN playbook_entries pe ON pe.intent = ci.intent_id AND pe.is_active = true
    WHERE ci.approved = true
  `);
  const canonicals = canonicalRows.rows as any[];
  onProgress?.(`Loaded ${canonicals.length} canonical intents`, 10);

  const canonicalEmbeddings = new Map<string, number[]>();
  const batchSize = 100;
  const canonicalTexts = canonicals.map(c => {
    const parts = [c.intent_id, c.category, c.subcategory, c.description].filter(Boolean);
    if (c.keywords) {
      try {
        const kw = typeof c.keywords === 'string' ? JSON.parse(c.keywords) : c.keywords;
        if (Array.isArray(kw)) parts.push(...kw.slice(0, 5));
      } catch {}
    }
    return parts.join(' ');
  });

  for (let i = 0; i < canonicalTexts.length; i += batchSize) {
    const batch = canonicalTexts.slice(i, i + batchSize);
    const resp = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
      dimensions: 1536,
    });
    for (let j = 0; j < resp.data.length; j++) {
      canonicalEmbeddings.set(canonicals[i + j].intent_id, resp.data[j].embedding);
    }
    onProgress?.(`Embedded ${Math.min(i + batchSize, canonicals.length)}/${canonicals.length} canonical intents`, 15 + ((i / canonicals.length) * 15));
  }

  const auditMatches: AuditMatch[] = [];
  const unmatchedIntents: PromotionCandidate[] = [];

  for (let idx = 0; idx < newIntents.length; idx++) {
    const ni = newIntents[idx];
    const pct = 30 + ((idx / newIntents.length) * 60);
    onProgress?.(`Analyzing ${ni.intent} (${idx + 1}/${newIntents.length})...`, pct);

    const exampleRows = await db.execute(sql`
      SELECT st.customer_question, st.subject
      FROM intent_classifications ic
      JOIN scrubbed_tickets st ON st.ticket_id = ic.ticket_id
      WHERE ic.intent = ${ni.intent} AND ic.is_new_intent = true
        AND st.customer_question IS NOT NULL 
        AND st.customer_question != '' 
        AND st.customer_question != 'No contents'
      LIMIT 5
    `);
    const examples = (exampleRows.rows as any[]).map(r => (r.customer_question || r.subject || '').substring(0, 200));

    let bestMatch: { canonicalId: string; method: "regex" | "semantic" | "fuzzy" | "keyword"; score: number } | null = null;

    for (const ex of examples) {
      if (!ex) continue;
      const regexResult = tryRegexMatch(ex);
      if (regexResult) {
        bestMatch = { canonicalId: regexResult.intent, method: "regex", score: 1.0 };
        break;
      }
    }

    if (!bestMatch) {
      const queryText = `${ni.intent.replace(/([A-Z])/g, ' $1').trim()} ${examples[0] || ''}`.substring(0, 500);
      try {
        const queryEmb = await generateEmbedding(queryText);
        let bestSim = 0;
        let bestCanonicalId = '';
        for (const [cId, cEmb] of Array.from(canonicalEmbeddings.entries())) {
          const sim = cosineSimilarity(queryEmb, cEmb);
          if (sim > bestSim) {
            bestSim = sim;
            bestCanonicalId = cId;
          }
        }
        if (bestSim >= 0.78) {
          bestMatch = { canonicalId: bestCanonicalId, method: "semantic", score: bestSim };
        } else if (bestSim >= 0.60) {
          for (const canonical of canonicals) {
            const fuzzyScore = fuzzyLabelScore(ni.intent, canonical.intent_id);
            if (fuzzyScore >= 0.75) {
              bestMatch = { canonicalId: canonical.intent_id, method: "fuzzy", score: fuzzyScore };
              break;
            }
          }
          if (!bestMatch) {
            let bestFuzzy = 0;
            let bestFuzzyId = '';
            for (const canonical of canonicals) {
              const fuzzyScore = fuzzyLabelScore(ni.intent, canonical.intent_id);
              if (fuzzyScore > bestFuzzy) {
                bestFuzzy = fuzzyScore;
                bestFuzzyId = canonical.intent_id;
              }
            }
            if (bestFuzzy >= 0.50) {
              bestMatch = { canonicalId: bestFuzzyId, method: "fuzzy", score: bestFuzzy };
            }
          }
        }
      } catch (err: any) {
        console.warn(`[Audit] Embedding error for ${ni.intent}:`, err.message);
      }
    }

    if (bestMatch) {
      const canonical = canonicals.find(c => c.intent_id === bestMatch!.canonicalId);
      const playbookResponse = canonical?.combined_response || canonical?.help_center_content_summary || '';
      const playbookTitle = canonical?.help_center_article_title || canonical?.hjelpesenter_subcategory || canonical?.intent_id || '';

      let classification: "CORRECT" | "INCORRECT" | "AMBIGUOUS" = "AMBIGUOUS";
      let classificationReason = "";

      const intentTokens = ni.intent.replace(/([A-Z])/g, ' $1').toLowerCase().split(/\s+/).filter((t: string) => t.length > 2);
      const canonicalTokens = bestMatch.canonicalId.replace(/([A-Z])/g, ' $1').toLowerCase().split(/\s+/).filter((t: string) => t.length > 2);
      const tokenOverlap = intentTokens.filter((t: string) => canonicalTokens.some((ct: string) => ct.includes(t) || t.includes(ct)));

      if (bestMatch.method === "regex" && bestMatch.score >= 1.0) {
        const labelSimilarity = fuzzyLabelScore(ni.intent, bestMatch.canonicalId);
        if (labelSimilarity >= 0.60 || tokenOverlap.length >= 2) {
          classification = "CORRECT";
          classificationReason = `Regex match validated by label similarity (${labelSimilarity.toFixed(3)}): "${ni.intent}" → "${bestMatch.canonicalId}"`;
        } else if (labelSimilarity >= 0.35 || tokenOverlap.length >= 1) {
          classification = "AMBIGUOUS";
          classificationReason = `Regex match but weak label similarity (${labelSimilarity.toFixed(3)}): regex may be too broad, catching "${ni.intent}" queries under "${bestMatch.canonicalId}"`;
        } else {
          classification = "INCORRECT";
          classificationReason = `Regex overmatch: "${ni.intent}" queries caught by "${bestMatch.canonicalId}" regex (label similarity ${labelSimilarity.toFixed(3)}). Regex is too broad.`;
        }
      } else if (bestMatch.method === "semantic" && bestMatch.score >= 0.85) {
        classification = "CORRECT";
        classificationReason = `High semantic similarity (${bestMatch.score.toFixed(3)}) with strong conceptual overlap`;
      } else if (bestMatch.method === "semantic" && bestMatch.score >= 0.78) {
        if (tokenOverlap.length >= 2) {
          classification = "CORRECT";
          classificationReason = `Semantic match (${bestMatch.score.toFixed(3)}) confirmed by label token overlap: [${tokenOverlap.join(', ')}]`;
        } else {
          classification = "AMBIGUOUS";
          classificationReason = `Semantic match (${bestMatch.score.toFixed(3)}) but low label overlap. May be related but distinct concept.`;
        }
      } else if (bestMatch.method === "fuzzy") {
        if (bestMatch.score >= 0.85) {
          classification = "CORRECT";
          classificationReason = `Strong fuzzy label match (${bestMatch.score.toFixed(3)}): naming variant of same intent`;
        } else if (bestMatch.score >= 0.65) {
          classification = "AMBIGUOUS";
          classificationReason = `Moderate fuzzy match (${bestMatch.score.toFixed(3)}): possibly related but may need disambiguation`;
        } else {
          classification = "INCORRECT";
          classificationReason = `Weak fuzzy match (${bestMatch.score.toFixed(3)}): likely distinct intent incorrectly matched`;
        }
      }

      const auditEntry: AuditMatch = {
        newIntentId: ni.intent,
        ticketCount: parseInt(ni.ticket_count),
        matchedCanonicalId: bestMatch.canonicalId,
        matchMethod: bestMatch.method,
        matchScore: bestMatch.score,
        exampleQueries: examples,
        playbookTitle,
        playbookResponsePreview: playbookResponse.substring(0, 200),
        classification,
        classificationReason,
      };

      if (classification === "INCORRECT" || classification === "AMBIGUOUS") {
        if (bestMatch.method === "regex") {
          const matchedPattern = INTENT_PATTERNS.find(p => p.intent === bestMatch!.canonicalId);
          const regexStr = matchedPattern ? matchedPattern.regex.source : 'unknown';
          const newIntentKeywords = ni.intent.replace(/([A-Z])/g, ' $1').toLowerCase().trim().split(/\s+/).filter((t: string) => t.length > 2);
          const exclusionTerms = newIntentKeywords.filter((t: string) => !canonicalTokens.some((ct: string) => ct.includes(t)));
          const suggestedExclusion = exclusionTerms.length > 0 ? `(?!.*(?:${exclusionTerms.join('|')}))` : '';

          auditEntry.proposedFix = {
            type: "tighten_regex",
            suggestedRegex: `Add negative lookahead to ${bestMatch!.canonicalId} regex: ${suggestedExclusion} — or add dedicated regex for ${ni.intent}. Current regex: /${regexStr.substring(0, 150)}/i`,
          };
        } else if (classification === "INCORRECT") {
          auditEntry.proposedFix = {
            type: "adjust_normalization",
            normalizationReplacements: {
              [ni.intent.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')]: ni.intent,
            },
          };
        } else {
          auditEntry.proposedFix = {
            type: "add_disambiguation",
            disambiguationQuestion: `Du spør om "${ni.intent.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}". Mener du:`,
            disambiguationOptions: [
              `${bestMatch.canonicalId} (eksisterende)`,
              `${ni.intent} (nytt tema)`,
              "Noe annet",
            ],
          };
        }
      }

      auditMatches.push(auditEntry);
    } else {
      const category = inferCategory(ni.intent);
      const isTransactional = inferTransactional(ni.intent);
      const endpointReadiness = inferEndpointReadiness(ni.intent);

      const bestFuzzyForUnmatched = findClosestCanonical(ni.intent, canonicals);
      const shouldMerge = bestFuzzyForUnmatched && bestFuzzyForUnmatched.score >= 0.60;

      unmatchedIntents.push({
        intentId: ni.intent,
        ticketCount: parseInt(ni.ticket_count),
        avgConfidence: parseFloat(ni.avg_confidence),
        category: category.category,
        subcategory: category.subcategory,
        isTransactional,
        endpointReadiness,
        recommendedAction: shouldMerge ? "merge_with_existing" : (parseInt(ni.ticket_count) >= 5 ? "create_canonical_now" : "wait"),
        mergeTarget: shouldMerge ? bestFuzzyForUnmatched!.canonicalId : undefined,
        reasoning: shouldMerge
          ? `Fuzzy match (${bestFuzzyForUnmatched!.score.toFixed(2)}) to ${bestFuzzyForUnmatched!.canonicalId}—consider mapping`
          : (parseInt(ni.ticket_count) >= 5
            ? `${ni.ticket_count} tickets, high frequency—ready for canonical creation`
            : `Only ${ni.ticket_count} ticket(s)—wait for more data`),
      });
    }
  }

  onProgress?.("Generating report...", 95);

  const correctCount = auditMatches.filter(m => m.classification === "CORRECT").length;
  const incorrectCount = auditMatches.filter(m => m.classification === "INCORRECT").length;
  const ambiguousCount = auditMatches.filter(m => m.classification === "AMBIGUOUS").length;

  onProgress?.("Audit complete!", 100);

  return {
    auditMatches,
    unmatchedIntents: unmatchedIntents.sort((a, b) => b.ticketCount - a.ticketCount),
    summary: {
      totalNewIntents: newIntents.length,
      matchedCount: auditMatches.length,
      unmatchedCount: unmatchedIntents.length,
      correctCount,
      incorrectCount,
      ambiguousCount,
    },
  };
}

function inferCategory(intentId: string): { category: string; subcategory: string } {
  const lower = intentId.toLowerCase();
  if (lower.includes('smarttag')) return { category: "Smart Tag", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('qrtag') || lower.includes('qr')) return { category: "QR-brikke", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('subscription') || lower.includes('billing') || lower.includes('invoice') || lower.includes('payment') || lower.includes('charge') || lower.includes('refund')) return { category: "Betaling/Abonnement", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('app')) return { category: "DyreID-appen", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('ownership') || lower.includes('transfer')) return { category: "Eierskifte", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('registration') || lower.includes('register')) return { category: "Registrering", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('chip') || lower.includes('update')) return { category: "ID-søk", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('family')) return { category: "Familiedeling", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('login') || lower.includes('password') || lower.includes('twofactor')) return { category: "Min Side", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('lost') || lower.includes('found') || lower.includes('savnet')) return { category: "Savnet/Funnet", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('push') || lower.includes('notification')) return { category: "DyreID-appen", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('breeder') || lower.includes('litter')) return { category: "Registrering", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('species') || lower.includes('nonsupported')) return { category: "Registrering", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('duplicate') || lower.includes('merge')) return { category: "Registrering", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  if (lower.includes('cancel')) return { category: "Betaling/Abonnement", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
  return { category: "Ukategorisert", subcategory: intentId.replace(/([A-Z])/g, ' $1').trim() };
}

function inferTransactional(intentId: string): boolean {
  const lower = intentId.toLowerCase();
  const transactionalKeywords = ['update', 'change', 'transfer', 'cancel', 'refund', 'merge', 'add', 'remove', 'correct', 'replace', 'reassign', 'register', 'order'];
  return transactionalKeywords.some(kw => lower.includes(kw));
}

function inferEndpointReadiness(intentId: string): "exists" | "TODO" {
  const existingEndpoints = ['ChipLookup', 'OwnershipTransferWeb', 'ReportLostPet', 'ReportFoundPet', 'NewRegistration', 'ForeignRegistration', 'ViewMyPets'];
  const lower = intentId.toLowerCase();
  for (const ep of existingEndpoints) {
    if (lower.includes(ep.toLowerCase())) return "exists";
  }
  return "TODO";
}

function findClosestCanonical(intentId: string, canonicals: any[]): { canonicalId: string; score: number } | null {
  let best = { canonicalId: '', score: 0 };
  for (const c of canonicals) {
    const score = fuzzyLabelScore(intentId, c.intent_id);
    if (score > best.score) {
      best = { canonicalId: c.intent_id, score };
    }
  }
  return best.score > 0 ? best : null;
}

export function formatAuditReport(result: Awaited<ReturnType<typeof runMatchCorrectnessAudit>>): string {
  const lines: string[] = [];
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("  MATCH CORRECTNESS AUDIT + PROMOTION PLAN");
  lines.push("  DyreID Support AI — Intent Coverage Analysis");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("");

  lines.push("╔═══════════════════════════════════════════════════════════════╗");
  lines.push("║  SUMMARY                                                     ║");
  lines.push("╚═══════════════════════════════════════════════════════════════╝");
  lines.push(`  Total new intents in review queue: ${result.summary.totalNewIntents}`);
  lines.push(`  Matched to existing canonical:     ${result.summary.matchedCount}`);
  lines.push(`  Unmatched (truly new):              ${result.summary.unmatchedCount}`);
  lines.push(`  ── Match Classifications ──`);
  lines.push(`  ✅ CORRECT:    ${result.summary.correctCount}`);
  lines.push(`  ❌ INCORRECT:  ${result.summary.incorrectCount}`);
  lines.push(`  ⚠️  AMBIGUOUS:  ${result.summary.ambiguousCount}`);
  lines.push("");

  lines.push("╔═══════════════════════════════════════════════════════════════╗");
  lines.push("║  PART 1: MATCH CORRECTNESS AUDIT                             ║");
  lines.push("╚═══════════════════════════════════════════════════════════════╝");
  lines.push("");

  const sorted = [...result.auditMatches].sort((a, b) => {
    const order = { INCORRECT: 0, AMBIGUOUS: 1, CORRECT: 2 };
    return order[a.classification] - order[b.classification] || b.ticketCount - a.ticketCount;
  });

  for (const match of sorted) {
    const emoji = match.classification === "CORRECT" ? "✅" : match.classification === "INCORRECT" ? "❌" : "⚠️";
    lines.push(`${emoji} ${match.newIntentId} → ${match.matchedCanonicalId}`);
    lines.push(`   Classification: ${match.classification} | Method: ${match.matchMethod} | Score: ${match.matchScore?.toFixed(3) ?? 'N/A'} | Tickets: ${match.ticketCount}`);
    lines.push(`   Reason: ${match.classificationReason}`);
    lines.push(`   Playbook: "${match.playbookTitle}" — ${match.playbookResponsePreview.substring(0, 150)}...`);
    lines.push(`   Example queries:`);
    for (const ex of match.exampleQueries.slice(0, 5)) {
      lines.push(`     • "${ex.substring(0, 120)}${ex.length > 120 ? '...' : ''}"`);
    }
    if (match.proposedFix) {
      lines.push(`   ── Proposed Fix ──`);
      if (match.proposedFix.type === "tighten_regex") {
        lines.push(`   Type: Tighten regex`);
        lines.push(`   Suggested: ${match.proposedFix.suggestedRegex}`);
      } else if (match.proposedFix.type === "adjust_normalization") {
        lines.push(`   Type: Adjust normalization dictionary`);
        if (match.proposedFix.normalizationReplacements) {
          for (const [k, v] of Object.entries(match.proposedFix.normalizationReplacements)) {
            lines.push(`   ${k} → ${v}`);
          }
        }
      } else if (match.proposedFix.type === "add_disambiguation") {
        lines.push(`   Type: Add disambiguation question`);
        lines.push(`   Q: "${match.proposedFix.disambiguationQuestion}"`);
        for (const opt of match.proposedFix.disambiguationOptions || []) {
          lines.push(`     · ${opt}`);
        }
      }
    }
    lines.push("");
  }

  lines.push("╔═══════════════════════════════════════════════════════════════╗");
  lines.push("║  PART 2: PRIORITIZED FIX LIST                                ║");
  lines.push("╚═══════════════════════════════════════════════════════════════╝");
  lines.push("");
  
  const fixes = sorted.filter(m => m.classification !== "CORRECT");
  if (fixes.length === 0) {
    lines.push("  No fixes needed — all matches are correct!");
  } else {
    lines.push(`  ${fixes.length} items need attention:`);
    lines.push("");
    for (let i = 0; i < fixes.length; i++) {
      const f = fixes[i];
      lines.push(`  ${i + 1}. [${f.classification}] ${f.newIntentId} → ${f.matchedCanonicalId} (${f.ticketCount} tickets)`);
      lines.push(`     Fix: ${f.proposedFix?.type || 'manual review'}`);
      if (f.proposedFix?.type === "add_disambiguation") {
        lines.push(`     Disambiguation: "${f.proposedFix.disambiguationQuestion}"`);
      }
    }
  }
  lines.push("");

  lines.push("╔═══════════════════════════════════════════════════════════════╗");
  lines.push("║  PART 3: PROMOTION PLAN (Top 15 Unmatched Intents)           ║");
  lines.push("╚═══════════════════════════════════════════════════════════════╝");
  lines.push("");

  const top15 = result.unmatchedIntents.slice(0, 15);
  lines.push(`  Rank | Intent ID                      | Tickets | Category             | Type  | Endpoint | Action`);
  lines.push(`  ─────┼────────────────────────────────┼─────────┼──────────────────────┼───────┼──────────┼───────────────────────`);
  for (let i = 0; i < top15.length; i++) {
    const u = top15[i];
    const typeStr = u.isTransactional ? "TRANS" : "INFO ";
    const epStr = u.endpointReadiness === "exists" ? "EXISTS" : "TODO  ";
    const actionStr = u.recommendedAction === "create_canonical_now" ? "CREATE NOW" : u.recommendedAction === "merge_with_existing" ? `MERGE→${u.mergeTarget}` : "WAIT";
    lines.push(`  ${String(i + 1).padStart(4)} | ${u.intentId.padEnd(30)} | ${String(u.ticketCount).padStart(7)} | ${u.category.padEnd(20)} | ${typeStr} | ${epStr}   | ${actionStr}`);
  }
  lines.push("");

  lines.push("  ── Detailed Promotion Candidates ──");
  lines.push("");
  for (let i = 0; i < top15.length; i++) {
    const u = top15[i];
    lines.push(`  ${i + 1}. ${u.intentId}`);
    lines.push(`     Tickets: ${u.ticketCount} | Confidence: ${u.avgConfidence.toFixed(3)} | Category: ${u.category} / ${u.subcategory}`);
    lines.push(`     Type: ${u.isTransactional ? "Transactional" : "Informational"} | Endpoint: ${u.endpointReadiness}`);
    lines.push(`     Action: ${u.recommendedAction.toUpperCase()}${u.mergeTarget ? ` (→ ${u.mergeTarget})` : ''}`);
    lines.push(`     Reasoning: ${u.reasoning}`);
    lines.push("");
  }

  lines.push("  ── Remaining Unmatched (not in top 15) ──");
  const remaining = result.unmatchedIntents.slice(15);
  if (remaining.length === 0) {
    lines.push("  None — all unmatched intents are in the top 15.");
  } else {
    for (const u of remaining) {
      lines.push(`  · ${u.intentId} (${u.ticketCount} tickets) — ${u.recommendedAction}${u.mergeTarget ? ` → ${u.mergeTarget}` : ''}`);
    }
  }
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("  END OF REPORT");
  lines.push("═══════════════════════════════════════════════════════════════");

  return lines.join("\n");
}
