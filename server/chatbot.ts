import OpenAI from "openai";
import { storage } from "./storage";
import { getMinSideContext, performAction, lookupOwnerByPhone } from "./minside-sandbox";
import type { PlaybookEntry, ServicePrice } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildSystemPrompt(playbook: PlaybookEntry[], ownerContext: any | null, storedUserContext: any | null, prices: ServicePrice[] = []): string {
  const isAuthenticated = !!(ownerContext || storedUserContext);

  let prompt = `Du er DyreID sin intelligente support-assistent. DyreID er Norges nasjonale kjæledyrregister.

DINE OPPGAVER:
1. Hjelpe kunder med spørsmål om registrering, eierskifte, QR-brikker, Smart Tags, abonnement, savnet/funnet, Min Side, familiedeling og appen
2. Identifisere kundens intent og veilede dem til løsning
3. Utføre handlinger når kunden er autentisert

REGLER:
- Svar ALLTID på norsk
- Vær hjelpsom, profesjonell og vennlig
- Ikke avslør personlig informasjon som ikke tilhører den innloggede brukeren
- Når handlinger krever autentisering, be kunden logge inn via OTP
- Forklar tydelig hva du gjør og hvorfor

VIKTIG OM AUTENTISERING:
- Noen handlinger krever at kunden er innlogget (identifisert via OTP)
- Før innlogging kan du svare på generelle spørsmål
- Etter innlogging kan du se kundens profil, dyr, tags, eierskap og utføre handlinger
- KUNDEN ER ${isAuthenticated ? "INNLOGGET" : "IKKE INNLOGGET"}

HANDLINGER DU KAN UTFØRE (etter autentisering):
- Vise kundens dyr og profil
- Melde dyr savnet/funnet
- Aktivere QR-brikke
- Starte eierskifte
- Sende betalingslink
- Oppdatere profilinformasjon
- Fornye abonnement

Når du identifiserer at en handling er nødvendig, inkluder en ACTION-blokk i svaret ditt:
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

  if (playbook.length > 0) {
    prompt += "\n\nSUPPORT PLAYBOOK (brukt til å veilede kunden):\n";
    for (const entry of playbook) {
      prompt += `\n--- ${entry.intent} ---`;
      prompt += `\nKategori: ${entry.hjelpesenterCategory} > ${entry.hjelpesenterSubcategory}`;
      prompt += `\nNøkkelord: ${entry.keywords}`;
      prompt += `\nHandling: ${entry.primaryAction}`;
      prompt += `\nLøsningssteg: ${entry.resolutionSteps}`;
      prompt += `\nBetaling påkrevd: ${entry.paymentRequiredProbability ? `${Math.round((entry.paymentRequiredProbability || 0) * 100)}%` : "Nei"}`;
      prompt += `\nKan lukkes automatisk: ${entry.autoCloseProbability ? `${Math.round((entry.autoCloseProbability || 0) * 100)}%` : "Nei"}`;
    }
  }

  if (prices.length > 0) {
    prompt += "\n\nGJELDENDE PRISER (oppdatert av admin, bruk ALLTID disse prisene i svar):\n";
    for (const p of prices) {
      prompt += `- ${p.serviceName}: ${p.price === 0 ? "Gratis" : `${p.price} ${p.currency}`}`;
      if (p.description) prompt += ` (${p.description})`;
      prompt += "\n";
    }
    prompt += "\nVIKTIG: Bruk KUN prisene listet over. Ikke oppgi priser du er usikker på.\n";
  }

  if (ownerContext) {
    prompt += "\n\nINNLOGGET BRUKER KONTEKST (fra sandbox):\n";
    prompt += `Eier: ${ownerContext.owner.firstName} ${ownerContext.owner.lastName}\n`;
    prompt += `Telefon: ${ownerContext.owner.phone}\n`;
    prompt += `E-post: ${ownerContext.owner.email}\n`;

    if (ownerContext.animals.length > 0) {
      prompt += "\nDyr:\n";
      for (const animal of ownerContext.animals) {
        prompt += `- ${animal.name} (${animal.species}, ${animal.breed}) - Status: ${animal.status}, Betaling: ${animal.paymentStatus}, Chip: ${animal.chipNumber}\n`;
      }
    }

    if (ownerContext.ownerships.length > 0) {
      prompt += "\nEierskap:\n";
      for (const o of ownerContext.ownerships) {
        prompt += `- ${o.animalName}: ${o.role}${o.pendingTransfer ? " (eierskifte pågår)" : ""}\n`;
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
        prompt += `- ${l.animalName}: Meldt savnet ${l.lostDate}, SMS: ${l.smsEnabled ? "Ja" : "Nei"}, Push: ${l.pushEnabled ? "Ja" : "Nei"}\n`;
      }
    }

    if (ownerContext.pendingActions) {
      const pa = ownerContext.pendingActions;
      if (pa.pendingPayments > 0 || pa.pendingTransfers > 0 || pa.inactiveTags > 0 || pa.missingProfileData.length > 0) {
        prompt += "\nVentende handlinger:\n";
        if (pa.pendingPayments > 0) prompt += `- ${pa.pendingPayments} ubetalte registreringer\n`;
        if (pa.pendingTransfers > 0) prompt += `- ${pa.pendingTransfers} pågående eierskifter\n`;
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
        if (pet.AnimalId) prompt += ` - ID: ${pet.AnimalId}`;
        prompt += "\n";
      }
    } else if (storedUserContext.NumberOfPets > 0) {
      prompt += `\nBrukeren har ${storedUserContext.NumberOfPets} registrerte dyr, men detaljerte dyredata er ikke tilgjengelig i denne sesjonen. Informer brukeren om at du vet de har dyr registrert, og at de kan se sine dyr på Min Side (minside.dyreid.no).\n`;
    }

    prompt += "\nMERK: Denne brukeren er logget inn via Min Side (produksjon). Du har tilgang til grunnleggende profilinformasjon. For handlinger som krever spesifikke dyre-IDer (som eierskifte, melde savnet), be brukeren oppgi dyrets navn eller ID.\n";
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

interface QuickPattern {
  regex: RegExp;
  unauthResponse: string;
  authResponse: string;
}

const QUICK_PATTERNS: QuickPattern[] = [
  {
    regex: /eierskift|selge|solgt|ny eier|overfør|kjøpt/i,
    unauthResponse: "For a hjelpe deg med eierskifte trenger jeg a se hvilke dyr du har registrert. Kan du logge inn forst via OTP-knappen overst?",
    authResponse: "Jeg kan hjelpe deg med eierskifte! Hvilket dyr gjelder det? Oppgi navnet pa dyret, sa hjelper jeg deg videre.",
  },
  {
    regex: /logg inn|passord|bankid|innlogg/i,
    unauthResponse: "Har du problemer med innlogging? Jeg kan hjelpe deg. Hvilken innloggingsmetode bruker du (BankID, OTP, e-post)?",
    authResponse: "Du er allerede innlogget! Har du problemer med innlogging pa en annen tjeneste? Hvilken innloggingsmetode gjelder det (BankID, OTP, e-post)?",
  },
  {
    regex: /qr.?tag|qr.?brikke|skann|aktivere tag/i,
    unauthResponse: "Jeg kan hjelpe deg med QR Tag! Har du allerede kjopt en, eller lurer du pa hvordan den fungerer?",
    authResponse: "Jeg kan hjelpe deg med QR Tag! Har du allerede kjopt en du vil aktivere, eller lurer du pa hvordan den fungerer?",
  },
  {
    regex: /savnet|mistet|funnet|borte|forsvunnet/i,
    unauthResponse: "Jeg hjelper deg gjerne med savnet/funnet. For a melde dyr savnet ma jeg vite hvilket dyr det gjelder. Kan du logge inn forst?",
    authResponse: "Jeg kan hjelpe deg med a melde dyr savnet eller funnet. Hvilket dyr gjelder det? Oppgi navnet pa dyret.",
  },
  {
    regex: /registrer|chip|søkbart|id.?merk/i,
    unauthResponse: "Jeg kan hjelpe med registrering! Er dyret allerede chipet, eller trenger du informasjon om ID-merking?",
    authResponse: "Jeg kan hjelpe med registrering! Er dyret allerede chipet, eller trenger du informasjon om ID-merking?",
  },
  {
    regex: /abonnement|avslutt|forny|oppsigelse/i,
    unauthResponse: "Jeg kan hjelpe med abonnement! Gjelder det QR Premium, Smart Tag eller DyreID+ appen?",
    authResponse: "Jeg kan hjelpe med abonnement! Gjelder det QR Premium, Smart Tag eller DyreID+ appen?",
  },
  {
    regex: /app|laste ned|installere|mobil/i,
    unauthResponse: "DyreID-appen finnes for iOS og Android. Har du problemer med innlogging eller vil du vite om funksjoner?",
    authResponse: "DyreID-appen finnes for iOS og Android. Har du problemer med innlogging eller vil du vite om funksjoner?",
  },
  {
    regex: /pris|kost|betale|gratis/i,
    unauthResponse: "Jeg kan gi deg prisinformasjon! Hva lurer du pa? Eierskifte, registrering, QR Tag eller app?",
    authResponse: "Jeg kan gi deg prisinformasjon! Hva lurer du pa? Eierskifte, registrering, QR Tag eller app?",
  },
  {
    regex: /veterinær|klinikk|dyrelege/i,
    unauthResponse: "Trenger du hjelp med veterinarregistrering eller skal du endre klinikk?",
    authResponse: "Trenger du hjelp med veterinarregistrering eller skal du endre klinikk?",
  },
  {
    regex: /smart.?tag|gps|sporing/i,
    unauthResponse: "Jeg kan hjelpe med Smart Tag! Gjelder det tilkobling, GPS, batteri eller noe annet?",
    authResponse: "Jeg kan hjelpe med Smart Tag! Gjelder det tilkobling, GPS, batteri eller noe annet?",
  },
  {
    regex: /familie|deling|del tilgang/i,
    unauthResponse: "Familiedeling lar andre se og administrere dyrene dine. Vil du legge til eller fjerne et familiemedlem?",
    authResponse: "Familiedeling lar andre se og administrere dyrene dine. Vil du legge til eller fjerne et familiemedlem?",
  },
  {
    regex: /mine dyr|se dyr|dyrene mine|hvilke dyr|vis dyr|har jeg/i,
    unauthResponse: "For at jeg skal kunne se dine registrerte dyr, ma du logge inn forst. Trykk pa innloggingsknappen og verifiser med OTP.",
    authResponse: "",
  },
];

function quickIntentMatch(message: string, isAuthenticated: boolean): string | null {
  for (const pattern of QUICK_PATTERNS) {
    if (pattern.regex.test(message)) {
      const response = isAuthenticated ? pattern.authResponse : pattern.unauthResponse;
      if (response === "") return null;
      return response;
    }
  }
  return null;
}

export async function* streamChatResponse(
  conversationId: number,
  userMessage: string,
  ownerId?: string | null,
  storedUserContext?: any | null
): AsyncGenerator<string, void, unknown> {
  await storage.createMessage({
    conversationId,
    role: "user",
    content: userMessage,
  });

  const isAuthenticated = !!(ownerId && (storedUserContext || getMinSideContext(ownerId)));

  const quickResponse = quickIntentMatch(userMessage, isAuthenticated);
  if (quickResponse) {
    await storage.createMessage({
      conversationId,
      role: "assistant",
      content: quickResponse,
      metadata: { quickMatch: true },
    });
    yield quickResponse;
    return;
  }

  const playbook = await storage.getActivePlaybookEntries();
  const activePrices = await storage.getActiveServicePrices();
  const sandboxContext = ownerId ? getMinSideContext(ownerId) : null;
  const systemPrompt = buildSystemPrompt(playbook, sandboxContext, sandboxContext ? null : storedUserContext, activePrices);

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

  await storage.createMessage({
    conversationId,
    role: "assistant",
    content: finalContent,
    metadata: actions.length > 0 ? { actions } : null,
  });
}
