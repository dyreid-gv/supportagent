import { log } from "./index";

const PURESERVICE_BASE_URL = "https://dyreid.pureservice.com/agent/api";

interface PureserviceTicket {
  id: number;
  subject?: string;
  description?: string;
  status?: string;
  categoryId?: number;
  categoryName?: string;
  resolution?: string;
  tags?: string[];
  createdDate?: string;
  closedDate?: string;
  communications?: {
    from?: string;
    body?: string;
    direction?: string;
    createdDate?: string;
  }[];
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
    `${PURESERVICE_BASE_URL}/ticket?limit=${pageSize}&offset=${offset}&include=communications,category&sort=-createdDate`,
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

  const tickets: PureserviceTicket[] = (data.tickets || data.results || []).map(
    (t: any) => ({
      id: t.id,
      subject: t.subject || t.title || "",
      description: t.description || t.body || "",
      status: t.status?.name || t.statusName || "",
      categoryId: t.categoryId || t.category?.id,
      categoryName: t.category?.name || t.categoryName || "",
      resolution: t.resolution || "",
      tags: t.tags?.map((tag: any) => tag.name || tag) || [],
      createdDate: t.createdDate || t.created,
      closedDate: t.closedDate || t.closed,
      communications: (t.communications || []).map((c: any) => ({
        from: c.from || c.sender || "",
        body: c.body || c.content || "",
        direction: c.direction || c.type || "",
        createdDate: c.createdDate || c.created || "",
      })),
    })
  );

  const total = data.total || data.totalCount || tickets.length;
  return { tickets, total };
}

export function mapPureserviceToRawTicket(ticket: PureserviceTicket) {
  const customerMessages = (ticket.communications || []).filter(
    (c) => c.direction === "incoming" || c.direction === "in"
  );
  const agentMessages = (ticket.communications || []).filter(
    (c) => c.direction === "outgoing" || c.direction === "out"
  );

  return {
    ticketId: ticket.id,
    category: ticket.categoryName || null,
    categoryId: ticket.categoryId || null,
    subject: ticket.subject || null,
    customerQuestion:
      customerMessages.length > 0
        ? customerMessages[0].body || ticket.description || null
        : ticket.description || null,
    agentAnswer:
      agentMessages.length > 0
        ? agentMessages[agentMessages.length - 1].body || null
        : null,
    messages: ticket.communications || null,
    resolution: ticket.resolution || null,
    tags: (ticket.tags || []).join(", "),
    autoClosed: ticket.status?.toLowerCase().includes("auto") || false,
    createdAt: ticket.createdDate ? new Date(ticket.createdDate) : null,
    closedAt: ticket.closedDate ? new Date(ticket.closedDate) : null,
    processingStatus: "pending" as const,
  };
}
