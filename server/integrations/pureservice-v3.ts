import { log } from "../index";

const BASE = "https://dyreid.pureservice.com/agent/api";

interface PureserviceCommunication {
  text?: string;
  subject?: string;
  direction?: number;
  type?: number;
  created?: string;
  senderId?: number;
}

interface PureserviceTicket {
  id: number;
  requestNumber?: number;
  subject?: string;
  description?: string;
  statusId?: number;
  category1Id?: number | null;
  category2Id?: number | null;
  category3Id?: number | null;
  solution?: string | null;
  emailAddress?: string;
  created?: string;
  closed?: string | null;
  communications?: PureserviceCommunication[];
}

export async function getClosedTickets(
  page: number = 1,
  pageSize: number = 50
): Promise<{ tickets: PureserviceTicket[]; total: number }> {
  const apiKey = process.env.PURESERVICE_API_KEY;
  if (!apiKey) {
    throw new Error("PURESERVICE_API_KEY not configured");
  }

  const offset = (page - 1) * pageSize;

  const res = await fetch(
    `${BASE}/ticket?limit=${pageSize}&offset=${offset}&include=communications`,
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pureservice API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  const tickets: PureserviceTicket[] = Array.isArray(data)
    ? data
    : data.tickets || data.results || [];

  let total: number;
  if (Array.isArray(data)) {
    total =
      tickets.length < pageSize
        ? offset + tickets.length
        : offset + tickets.length + 1;
  } else {
    total = data.total || data.totalCount || tickets.length;
  }

  return { tickets, total };
}

interface PureserviceTemplate {
  id: number;
  name: string;
  subject: string | null;
  body: string;
  system: boolean;
  type: number;
  trigger: number;
}

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

export async function fetchTemplatesFromPureservice(): Promise<PureserviceTemplate[]> {
  const apiKey = process.env.PURESERVICE_API_KEY;
  if (!apiKey) {
    throw new Error("PURESERVICE_API_KEY not configured");
  }

  const res = await fetch(
    `${BASE}/template?limit=200`,
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pureservice API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const templates: PureserviceTemplate[] = Array.isArray(data) ? data : (data.templates || data.results || []);
  return templates.filter(t => !t.system);
}

function stripHtml(html: string): string {
  let clean = html.replace(/<[^>]+>/g, '\n');
  clean = clean.replace(/&nbsp;/g, ' ');
  clean = clean.replace(/&amp;/g, '&');
  clean = clean.replace(/&lt;/g, '<');
  clean = clean.replace(/&gt;/g, '>');
  clean = clean.replace(/&quot;/g, '"');
  clean = clean.replace(/&#39;/g, "'");
  clean = clean.replace(/\{\{[^}]+\}\}/g, '');
  clean = clean.replace(/\{\{\{[^}]+\}\}\}/g, '');
  clean = clean.replace(/\n\s*\n/g, '\n');
  clean = clean.replace(/  +/g, ' ');
  return clean.trim();
}

function extractKeyPoints(bodyText: string): string[] {
  const points: string[] = [];
  const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 10);

  for (const line of lines) {
    if (/^\d+\./.test(line) || /^[A-Z]\)/.test(line) || /^-\s/.test(line) || /^•/.test(line)) {
      points.push(line);
    }
    if (/koster|pris|kr |NOK|gebyr|betaling/i.test(line)) {
      points.push(line);
    }
    if (/klikk her|logg inn|gå til|registrer|kontakt/i.test(line)) {
      points.push(line);
    }
  }

  const unique = Array.from(new Set(points));
  return unique.slice(0, 15);
}

export function mapTemplateToResponseTemplate(template: PureserviceTemplate) {
  const mapping = TEMPLATE_CATEGORY_MAPPING[template.id];
  const bodyText = template.body ? stripHtml(template.body) : "";
  const keyPoints = bodyText ? extractKeyPoints(bodyText) : [];

  return {
    templateId: template.id,
    name: template.name,
    subject: template.subject || null,
    bodyHtml: template.body || null,
    bodyText: bodyText || null,
    hjelpesenterCategory: mapping?.category || "Ukategorisert",
    hjelpesenterSubcategory: mapping?.subcategory || null,
    ticketType: mapping?.ticketType || null,
    intent: mapping?.intent || null,
    keyPoints,
    isActive: true,
  };
}

export function mapPureserviceToRawTicket(ticket: PureserviceTicket) {
  const communications = ticket.communications || [];
  const customerMessages = communications.filter(
    (c) => c.direction === 1 || c.direction === 0
  );
  const agentMessages = communications.filter((c) => c.direction === 2);

  const mappedComms = communications.map((c) => ({
    from: c.direction === 1 || c.direction === 0 ? "customer" : "agent",
    body: c.text || "",
    direction: c.direction === 1 || c.direction === 0 ? "incoming" : "outgoing",
    createdDate: c.created || "",
  }));

  return {
    ticketId: ticket.id,
    category: null as string | null,
    categoryId: ticket.category1Id || null,
    subject: ticket.subject || null,
    customerQuestion:
      customerMessages.length > 0
        ? customerMessages[0].text || ticket.description || null
        : ticket.description || null,
    agentAnswer:
      agentMessages.length > 0
        ? agentMessages[agentMessages.length - 1].text || null
        : null,
    messages: mappedComms.length > 0 ? mappedComms : null,
    resolution: ticket.solution || null,
    tags: "",
    autoClosed: false,
    createdAt: ticket.created ? new Date(ticket.created) : null,
    closedAt: ticket.closed ? new Date(ticket.closed) : null,
    processingStatus: "pending" as const,
  };
}
