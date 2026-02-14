import { log } from "./index";

const PURESERVICE_BASE_URL = "https://dyreid.pureservice.com/agent/api";

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

export async function fetchTicketsFromPureservice(
  page: number = 1,
  pageSize: number = 50
): Promise<{ tickets: PureserviceTicket[]; total: number }> {
  const apiKey = process.env.PURESERVICE_API_KEY;
  if (!apiKey) {
    throw new Error("PURESERVICE_API_KEY not configured");
  }

  const offset = (page - 1) * pageSize;

  const response = await fetch(
    `${PURESERVICE_BASE_URL}/ticket?limit=${pageSize}&offset=${offset}&include=communications&sort=-created`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pureservice API error ${response.status}: ${text}`);
  }

  const data = await response.json();

  const tickets: PureserviceTicket[] = Array.isArray(data) ? data : (data.tickets || data.results || []);

  let total: number;
  if (Array.isArray(data)) {
    total = tickets.length < pageSize ? offset + tickets.length : offset + tickets.length + 1;
  } else {
    total = data.total || data.totalCount || tickets.length;
  }

  return { tickets, total };
}

export function mapPureserviceToRawTicket(ticket: PureserviceTicket) {
  const communications = ticket.communications || [];
  const customerMessages = communications.filter(
    (c) => c.direction === 1 || c.direction === 0
  );
  const agentMessages = communications.filter(
    (c) => c.direction === 2
  );

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
