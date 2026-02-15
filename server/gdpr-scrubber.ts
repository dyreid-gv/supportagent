const PHONE_REGEX = /\b(\+?47\s?)?[2-9]\d{7}\b/g;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const CHIP_REGEX = /\b5780\d{11}\b/g;
const FOREIGN_CHIP_REGEX = /\b\d{3}0\d{11}\b/g;
const SSN_REGEX = /\b\d{6}\s?\d{5}\b/g;
const POSTAL_CODE_REGEX = /\b\d{4}\s+[A-ZÆØÅ][a-zæøå]+\b/g;
const ADDRESS_REGEX = /\b[A-ZÆØÅ][a-zæøå]+(?:veien|gata|gate|vegen|vei|gt|pl|plass)\s*\d+[a-zA-Z]?\b/gi;
const KID_REGEX = /\bKID[\s:]*\d{5,25}\b/gi;
const PAYMENT_REF_REGEX = /\b(?:ref|referanse|betalingsref)[\s.:]*[\w-]{6,}\b/gi;
const IP_REGEX = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const ACCOUNT_REGEX = /\b\d{4}[\s.]?\d{2}[\s.]?\d{5}\b/g;
const BROAD_PHONE_REGEX = /\b\d{8,15}\b/g;
const BROAD_CHIP_REGEX = /\b\d{15}\b/g;
const REQUEST_NUMBER_REGEX = /requestNumber:\s*\S+/g;
const SENDER_ID_REGEX = /senderId:\s*\S+/g;

const NORWEGIAN_NAMES = [
  "Ola", "Kari", "Per", "Anne", "Lars", "Marit", "Erik", "Ingrid",
  "Jan", "Liv", "Hans", "Bente", "Tor", "Hilde", "Anders", "Grete",
  "Jon", "Solveig", "Bjørn", "Randi", "Svein", "Astrid", "Geir",
  "Silje", "Trond", "Berit", "Morten", "Nina", "Gunnar", "Tone",
  "Helge", "Kristin", "Arne", "Elisabeth", "Olav", "Kirsten",
  "Terje", "Wenche", "Øyvind", "Turid", "Rune", "Eva", "Steinar",
  "Marianne", "Kjell", "Jorunn", "Harald", "Vigdis",
  "Hansen", "Johansen", "Olsen", "Larsen", "Andersen", "Pedersen",
  "Nilsen", "Kristiansen", "Jensen", "Karlsen", "Johnsen", "Pettersen",
  "Eriksen", "Berg", "Haugen", "Hagen", "Johannessen", "Andreassen",
  "Jacobsen", "Dahl", "Jørgensen", "Henriksen", "Lund", "Halvorsen",
  "Sørensen", "Jakobsen", "Moen", "Gundersen", "Iversen", "Strand",
  "Solberg", "Svendsen", "Eide", "Knutsen",
];

function buildNameRegex(): RegExp {
  const escaped = NORWEGIAN_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

const NAME_REGEX = buildNameRegex();

export function scrubText(text: string | null | undefined): string {
  if (!text) return "";

  let scrubbed = text;

  scrubbed = scrubbed.replace(EMAIL_REGEX, "<EMAIL>");
  scrubbed = scrubbed.replace(CHIP_REGEX, "<CHIP_ID>");
  scrubbed = scrubbed.replace(FOREIGN_CHIP_REGEX, "<CHIP_ID>");
  scrubbed = scrubbed.replace(PHONE_REGEX, "<PHONE>");
  scrubbed = scrubbed.replace(SSN_REGEX, "<SSN>");
  scrubbed = scrubbed.replace(IP_REGEX, "<IP>");
  scrubbed = scrubbed.replace(ACCOUNT_REGEX, "<ACCOUNT>");
  scrubbed = scrubbed.replace(KID_REGEX, "<PAYMENT_REF>");
  scrubbed = scrubbed.replace(PAYMENT_REF_REGEX, "<PAYMENT_REF>");
  scrubbed = scrubbed.replace(ADDRESS_REGEX, "<ADDRESS>");
  scrubbed = scrubbed.replace(POSTAL_CODE_REGEX, "<POSTAL>");
  scrubbed = scrubbed.replace(REQUEST_NUMBER_REGEX, "<REQ>");
  scrubbed = scrubbed.replace(SENDER_ID_REGEX, "<SENDER>");
  scrubbed = scrubbed.replace(BROAD_CHIP_REGEX, "<CHIP_ID>");
  scrubbed = scrubbed.replace(BROAD_PHONE_REGEX, "<PHONE>");
  scrubbed = scrubbed.replace(NAME_REGEX, "<PERSON>");

  return scrubbed;
}

export function scrubTicket(ticket: {
  subject?: string | null;
  customerQuestion?: string | null;
  agentAnswer?: string | null;
  messages?: any;
}) {
  return {
    subject: scrubText(ticket.subject),
    customerQuestion: scrubText(ticket.customerQuestion),
    agentAnswer: scrubText(ticket.agentAnswer),
    messages: ticket.messages
      ? JSON.parse(
          JSON.stringify(ticket.messages, (key, value) => {
            if (typeof value === "string" && (key === "body" || key === "content" || key === "from")) {
              return scrubText(value);
            }
            return value;
          })
        )
      : null,
  };
}
