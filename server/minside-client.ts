import axios from "axios";

const MINSIDE_URL = "https://minside.dyreid.no";

export interface MinSidePet {
  petId: string;
  name: string;
  species: string;
  breed: string;
  chipNumber: string;
  dateOfBirth: string;
  gender: string;
  registeredDate: string;
  clinic: string;
}

export interface MinSidePayment {
  chipNumber: string;
  paidBy: string;
  type: string;
  paymentMethod: string;
  orderNumber: string;
  amount: string;
  status: string;
  paidDate: string;
  transactionDate: string;
}

export interface MinSideOwnerInfo {
  name: string;
  firstName: string;
  lastName: string;
  ownerId: string;
  numberOfPets: number;
}

export interface MinSideSession {
  cookies: string;
  ownerId: string;
  ownerInfo: MinSideOwnerInfo;
}

export interface MinSideFullContext {
  owner: MinSideOwnerInfo;
  pets: MinSidePet[];
  payments: MinSidePayment[];
}

function collectCookies(resp: any): string[] {
  const sc = resp.headers["set-cookie"];
  if (!sc) return [];
  return Array.isArray(sc) ? sc : [sc];
}

function mergeCookies(existing: string, newHeaders: string[]): string {
  const cookieMap = new Map<string, string>();
  for (const c of existing.split("; ").filter(Boolean)) {
    const [key] = c.split("=");
    if (key) cookieMap.set(key, c);
  }
  for (const header of newHeaders) {
    const cookiePart = header.split(";")[0];
    const [key] = cookiePart.split("=");
    if (key) cookieMap.set(key, cookiePart);
  }
  return Array.from(cookieMap.values()).join("; ");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#230;/g, "æ")
    .replace(/&#248;/g, "ø")
    .replace(/&#229;/g, "å")
    .replace(/&#198;/g, "Æ")
    .replace(/&#216;/g, "Ø")
    .replace(/&#197;/g, "Å")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export async function authenticateWithOTP(
  contactMethod: string,
  otpCode: string,
  userId: string
): Promise<MinSideSession | null> {
  try {
    const verifyResp = await axios.post(
      `${MINSIDE_URL}/Security/LoginWithPasscode`,
      {
        Userid: userId,
        Otp: otpCode,
        emailorPhone: contactMethod,
        LostFoundPageRequest: false,
        loginViaLink: 0,
        applicationValue: "",
        returnUrl: "",
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
        maxRedirects: 0,
        validateStatus: (s: number) => s < 500,
      }
    );

    if (!verifyResp.data?.IsSuccess) {
      return null;
    }

    let cookies = collectCookies(verifyResp)
      .map((c: string) => c.split(";")[0])
      .join("; ");

    if (verifyResp.data.viewUrl) {
      const viewResp = await axios.get(
        `${MINSIDE_URL}${verifyResp.data.viewUrl}`,
        {
          headers: { Cookie: cookies },
          timeout: 15000,
          maxRedirects: 10,
          validateStatus: (s: number) => s < 500,
        }
      );
      cookies = mergeCookies(cookies, collectCookies(viewResp));
    }

    let ownerName = "";
    let numberOfPets = 0;
    try {
      const ownerResp = await axios.post(
        `${MINSIDE_URL}/Security/GetOwnerDetailforOTPScreen?emailOrContactNumber=${encodeURIComponent(contactMethod)}`,
        {},
        {
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
        }
      );
      if (ownerResp.data?.Success) {
        ownerName = ownerResp.data.OwnerName || "";
        numberOfPets = ownerResp.data.NumberOfPets || 0;
      }
    } catch {}

    const nameParts = ownerName.split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    return {
      cookies,
      ownerId: userId,
      ownerInfo: {
        name: ownerName,
        firstName,
        lastName,
        ownerId: userId,
        numberOfPets,
      },
    };
  } catch (err: any) {
    console.error("Min Side auth error:", err.message);
    return null;
  }
}

export async function fetchPetList(cookies: string): Promise<MinSidePet[]> {
  try {
    const resp = await axios.get(
      `${MINSIDE_URL}/OwnersPets/Owner/MyPetList`,
      {
        headers: { Cookie: cookies },
        timeout: 20000,
        maxRedirects: 10,
        validateStatus: (s: number) => s < 500,
      }
    );

    if (resp.status !== 200 || typeof resp.data !== "string") {
      console.log("MyPetList returned status:", resp.status);
      return [];
    }

    return parsePetListHTML(resp.data);
  } catch (err: any) {
    console.error("Failed to fetch pet list:", err.message);
    return [];
  }
}

export function parsePetListHTML(html: string): MinSidePet[] {
  let pets = parsePetListPrimary(html);
  if (pets.length === 0) {
    pets = parsePetListFallback(html);
  }
  return pets;
}

function parsePetListPrimary(html: string): MinSidePet[] {
  const pets: MinSidePet[] = [];

  const panelPattern = /<!-- strat here -->([\s\S]*?)(?=<!-- strat here -->|<footer|$)/gi;
  let panelMatch;

  while ((panelMatch = panelPattern.exec(html)) !== null) {
    const section = panelMatch[1];

    const petIdMatch = section.match(/PetId=(\d+)/);
    if (!petIdMatch) continue;
    const petId = petIdMatch[1];

    const nameMatch = section.match(
      /<h1>\s*<a[^>]*PetId=\d+[^>]*>\s*([^<]+?)\s*<\/a>\s*<\/h1>/i
    );

    const fieldText = decodeHtmlEntities(
      section
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
    );

    const getField = (label: string): string => {
      const re = new RegExp(
        `<span[^>]*>\\s*${label}\\s*<\\/span>\\s*([^<]+)`,
        "i"
      );
      const m = fieldText.match(re);
      return m ? decodeHtmlEntities(m[1].trim()) : "";
    };

    const pet: MinSidePet = {
      petId,
      name: nameMatch ? decodeHtmlEntities(nameMatch[1].trim()) : "",
      species: getField("Art"),
      breed: getField("Rase"),
      chipNumber: getField("Chip\\s*nr"),
      dateOfBirth: getField("Født"),
      gender: getField("Kjønn"),
      registeredDate: getField("Registrert"),
      clinic: getField("Klinikk"),
    };

    if (pet.name || pet.chipNumber) {
      pets.push(pet);
    }
  }

  return pets;
}

function parsePetListFallback(html: string): MinSidePet[] {
  const pets: MinSidePet[] = [];
  const seen = new Set<string>();

  const linkPattern = /<a[^>]*href="[^"]*PetId=(\d+)[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/gi;
  let m;
  while ((m = linkPattern.exec(html)) !== null) {
    const petId = m[1];
    const text = decodeHtmlEntities(m[2].trim());
    if (seen.has(petId)) continue;
    if (!text || text.length < 2 || text.length > 40) continue;
    if (/merk|tapt|profil|rediger|slett|endre/i.test(text)) continue;

    seen.add(petId);

    const idx = m.index;
    const contextStart = Math.max(0, idx - 200);
    const contextEnd = Math.min(html.length, idx + 1500);
    const context = html.substring(contextStart, contextEnd);
    const cleanCtx = decodeHtmlEntities(
      context.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
    );

    const getCtxField = (label: string): string => {
      const re = new RegExp(`<span[^>]*>\\s*${label}\\s*<\\/span>\\s*([^<]+)`, "i");
      const fm = cleanCtx.match(re);
      return fm ? decodeHtmlEntities(fm[1].trim()) : "";
    };

    pets.push({
      petId,
      name: text,
      species: getCtxField("Art"),
      breed: getCtxField("Rase"),
      chipNumber: getCtxField("Chip\\s*nr"),
      dateOfBirth: getCtxField("Født"),
      gender: getCtxField("Kjønn"),
      registeredDate: getCtxField("Registrert"),
      clinic: getCtxField("Klinikk"),
    });
  }

  return pets;
}

export async function fetchPaymentHistory(
  cookies: string
): Promise<MinSidePayment[]> {
  try {
    const resp = await axios.get(`${MINSIDE_URL}/Shared/PaymentHistory`, {
      headers: { Cookie: cookies },
      timeout: 20000,
      maxRedirects: 10,
      validateStatus: (s: number) => s < 500,
    });

    if (resp.status !== 200 || typeof resp.data !== "string") {
      return [];
    }

    return parsePaymentHistoryHTML(resp.data);
  } catch (err: any) {
    console.error("Failed to fetch payment history:", err.message);
    return [];
  }
}

export function parsePaymentHistoryHTML(html: string): MinSidePayment[] {
  const payments: MinSidePayment[] = [];

  const tablePattern = /<table[\s\S]*?<\/table>/gi;
  const tables = html.match(tablePattern);
  if (!tables || tables.length === 0) return payments;

  const HEADER_MAP: Record<string, keyof MinSidePayment> = {
    chip: "chipNumber",
    chipnr: "chipNumber",
    "chip nr": "chipNumber",
    betalt: "paidBy",
    "betalt av": "paidBy",
    type: "type",
    betalingsmåte: "paymentMethod",
    "betalings metode": "paymentMethod",
    ordrenummer: "orderNumber",
    "ordre nr": "orderNumber",
    beløp: "amount",
    amount: "amount",
    status: "status",
    "betalt dato": "paidDate",
    dato: "paidDate",
    transaksjonsdato: "transactionDate",
    transaksjon: "transactionDate",
  };

  for (const table of tables) {
    const rows: string[][] = [];
    let rowMatch;
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    while ((rowMatch = rowPattern.exec(table)) !== null) {
      const cells: string[] = [];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(decodeHtmlEntities(cellMatch[1].replace(/<[^>]+>/g, "").trim()));
      }
      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length < 2) continue;

    const headerRow = rows[0].map(h => h.toLowerCase().trim());
    const hasAmount = headerRow.some(h => h.includes("beløp") || h.includes("amount"));
    if (!hasAmount) continue;

    const colMap: Record<number, keyof MinSidePayment> = {};
    for (let ci = 0; ci < headerRow.length; ci++) {
      const h = headerRow[ci];
      for (const [pattern, field] of Object.entries(HEADER_MAP)) {
        if (h.includes(pattern)) {
          colMap[ci] = field;
          break;
        }
      }
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 3) continue;

      const payment: MinSidePayment = {
        chipNumber: "", paidBy: "", type: "", paymentMethod: "",
        orderNumber: "", amount: "", status: "", paidDate: "", transactionDate: "",
      };

      for (const [colIdx, field] of Object.entries(colMap)) {
        const idx = parseInt(colIdx);
        if (idx < row.length) {
          payment[field] = row[idx];
        }
      }

      if (payment.amount || payment.chipNumber) {
        payments.push(payment);
      }
    }
  }

  return payments;
}

export async function fetchFullContext(
  cookies: string,
  ownerInfo: MinSideOwnerInfo
): Promise<MinSideFullContext> {
  const [pets, payments] = await Promise.all([
    fetchPetList(cookies),
    fetchPaymentHistory(cookies),
  ]);

  return {
    owner: ownerInfo,
    pets,
    payments,
  };
}

const SESSION_STORE = new Map<
  string,
  { cookies: string; expiresAt: number; ownerInfo: MinSideOwnerInfo }
>();

export function storeSession(
  ownerId: string,
  cookies: string,
  ownerInfo: MinSideOwnerInfo
): void {
  SESSION_STORE.set(ownerId, {
    cookies,
    ownerInfo,
    expiresAt: Date.now() + 55 * 60 * 1000,
  });
}

export function getStoredSession(
  ownerId: string
): { cookies: string; ownerInfo: MinSideOwnerInfo } | null {
  const session = SESSION_STORE.get(ownerId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    SESSION_STORE.delete(ownerId);
    return null;
  }
  return { cookies: session.cookies, ownerInfo: session.ownerInfo };
}

export function clearSession(ownerId: string): void {
  SESSION_STORE.delete(ownerId);
}
