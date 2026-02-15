export interface MinSideOwner {
  ownerId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  gdprConsent: boolean;
  marketingConsent: boolean;
}

export interface MinSideAnimal {
  animalId: string;
  name: string;
  species: "dog" | "cat" | "other";
  breed: string;
  chipNumber: string;
  dateOfBirth: string;
  gender: "male" | "female";
  neutered: boolean;
  status: "active" | "deceased";
  registeredByVet: boolean;
  paymentStatus: "paid" | "unpaid" | "pending";
  foreignChip: boolean;
  activationStatus: "active" | "inactive";
}

export interface MinSideOwnership {
  ownershipId: string;
  ownerId: string;
  animalId: string;
  animalName: string;
  role: "primary" | "co-owner";
  pendingTransfer: boolean;
  transferStatus: "none" | "pending" | "completed" | "rejected";
}

export interface MinSideTag {
  tagId: string;
  type: "qr" | "smart";
  activated: boolean;
  subscriptionStatus: "active" | "expired" | "none";
  lastSeen: string | null;
  assignedAnimalId: string | null;
  assignedAnimalName: string | null;
}

export interface MinSideLostStatus {
  animalId: string;
  animalName: string;
  lost: boolean;
  lostDate: string | null;
  alertActive: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
}

export interface MinSideContext {
  owner: MinSideOwner;
  animals: MinSideAnimal[];
  ownerships: MinSideOwnership[];
  tags: MinSideTag[];
  lostStatuses: MinSideLostStatus[];
  pendingActions: {
    pendingPayments: number;
    pendingTransfers: number;
    missingProfileData: string[];
    inactiveTags: number;
  };
  paymentHistory: {
    id: string;
    description: string;
    amount: number;
    date: string;
    status: "paid" | "unpaid" | "refunded";
  }[];
}

const SANDBOX_DATA: Map<string, MinSideContext> = new Map();

function initSandbox() {
  if (SANDBOX_DATA.size > 0) return;

  const owners: {
    phone: string;
    email: string;
    data: MinSideContext;
  }[] = [
    {
      phone: "91000001",
      email: "demo1@dyreid.no",
      data: {
        owner: {
          ownerId: "OWN-001",
          firstName: "Demo",
          lastName: "Bruker",
          email: "demo1@dyreid.no",
          phone: "91000001",
          address: "Eksempelveien 1",
          postalCode: "0001",
          city: "Oslo",
          country: "NO",
          gdprConsent: true,
          marketingConsent: true,
        },
        animals: [
          {
            animalId: "ANI-001",
            name: "Bella",
            species: "dog",
            breed: "Labrador Retriever",
            chipNumber: "578000000001",
            dateOfBirth: "2020-03-15",
            gender: "female",
            neutered: true,
            status: "active",
            registeredByVet: true,
            paymentStatus: "paid",
            foreignChip: false,
            activationStatus: "active",
          },
          {
            animalId: "ANI-002",
            name: "Max",
            species: "dog",
            breed: "Schæfer",
            chipNumber: "578000000002",
            dateOfBirth: "2019-07-22",
            gender: "male",
            neutered: false,
            status: "active",
            registeredByVet: true,
            paymentStatus: "paid",
            foreignChip: false,
            activationStatus: "active",
          },
        ],
        ownerships: [
          { ownershipId: "OWS-001", ownerId: "OWN-001", animalId: "ANI-001", animalName: "Bella", role: "primary", pendingTransfer: false, transferStatus: "none" },
          { ownershipId: "OWS-002", ownerId: "OWN-001", animalId: "ANI-002", animalName: "Max", role: "primary", pendingTransfer: true, transferStatus: "pending" },
        ],
        tags: [
          { tagId: "TAG-001", type: "qr", activated: true, subscriptionStatus: "active", lastSeen: null, assignedAnimalId: "ANI-001", assignedAnimalName: "Bella" },
          { tagId: "TAG-002", type: "smart", activated: true, subscriptionStatus: "active", lastSeen: "2025-02-10T10:30:00Z", assignedAnimalId: "ANI-002", assignedAnimalName: "Max" },
        ],
        lostStatuses: [
          { animalId: "ANI-001", animalName: "Bella", lost: false, lostDate: null, alertActive: false, smsEnabled: true, pushEnabled: true },
          { animalId: "ANI-002", animalName: "Max", lost: false, lostDate: null, alertActive: false, smsEnabled: true, pushEnabled: true },
        ],
        pendingActions: { pendingPayments: 0, pendingTransfers: 1, missingProfileData: [], inactiveTags: 0 },
        paymentHistory: [
          { id: "PAY-001", description: "Registrering Bella", amount: 350, date: "2020-04-01", status: "paid" },
          { id: "PAY-002", description: "QR Tag Bella", amount: 249, date: "2021-01-15", status: "paid" },
        ],
      },
    },
    {
      phone: "91000002",
      email: "demo2@dyreid.no",
      data: {
        owner: {
          ownerId: "OWN-002",
          firstName: "Test",
          lastName: "Person",
          email: "demo2@dyreid.no",
          phone: "91000002",
          address: "Testgata 5",
          postalCode: "5003",
          city: "Bergen",
          country: "NO",
          gdprConsent: true,
          marketingConsent: false,
        },
        animals: [
          {
            animalId: "ANI-003",
            name: "Luna",
            species: "cat",
            breed: "Norsk Skogkatt",
            chipNumber: "578000000003",
            dateOfBirth: "2021-11-08",
            gender: "female",
            neutered: true,
            status: "active",
            registeredByVet: true,
            paymentStatus: "unpaid",
            foreignChip: false,
            activationStatus: "inactive",
          },
        ],
        ownerships: [
          { ownershipId: "OWS-003", ownerId: "OWN-002", animalId: "ANI-003", animalName: "Luna", role: "primary", pendingTransfer: false, transferStatus: "none" },
        ],
        tags: [
          { tagId: "TAG-003", type: "qr", activated: false, subscriptionStatus: "none", lastSeen: null, assignedAnimalId: "ANI-003", assignedAnimalName: "Luna" },
        ],
        lostStatuses: [
          { animalId: "ANI-003", animalName: "Luna", lost: false, lostDate: null, alertActive: false, smsEnabled: false, pushEnabled: false },
        ],
        pendingActions: { pendingPayments: 1, pendingTransfers: 0, missingProfileData: [], inactiveTags: 1 },
        paymentHistory: [],
      },
    },
    {
      phone: "91000003",
      email: "demo3@dyreid.no",
      data: {
        owner: {
          ownerId: "OWN-003",
          firstName: "Savnet",
          lastName: "Eier",
          email: "demo3@dyreid.no",
          phone: "91000003",
          address: "Savnetveien 10",
          postalCode: "7010",
          city: "Trondheim",
          country: "NO",
          gdprConsent: true,
          marketingConsent: true,
        },
        animals: [
          {
            animalId: "ANI-004",
            name: "Rex",
            species: "dog",
            breed: "Border Collie",
            chipNumber: "578000000004",
            dateOfBirth: "2018-05-30",
            gender: "male",
            neutered: true,
            status: "active",
            registeredByVet: true,
            paymentStatus: "paid",
            foreignChip: false,
            activationStatus: "active",
          },
        ],
        ownerships: [
          { ownershipId: "OWS-004", ownerId: "OWN-003", animalId: "ANI-004", animalName: "Rex", role: "primary", pendingTransfer: false, transferStatus: "none" },
        ],
        tags: [
          { tagId: "TAG-004", type: "smart", activated: true, subscriptionStatus: "expired", lastSeen: "2025-01-05T14:20:00Z", assignedAnimalId: "ANI-004", assignedAnimalName: "Rex" },
        ],
        lostStatuses: [
          { animalId: "ANI-004", animalName: "Rex", lost: true, lostDate: "2025-02-01", alertActive: true, smsEnabled: true, pushEnabled: false },
        ],
        pendingActions: { pendingPayments: 0, pendingTransfers: 0, missingProfileData: [], inactiveTags: 0 },
        paymentHistory: [
          { id: "PAY-003", description: "Registrering Rex", amount: 350, date: "2018-06-15", status: "paid" },
          { id: "PAY-004", description: "Smart Tag Rex", amount: 499, date: "2023-06-01", status: "paid" },
          { id: "PAY-005", description: "Smart Tag abonnement", amount: 99, date: "2024-06-01", status: "paid" },
        ],
      },
    },
    {
      phone: "91000004",
      email: "demo4@dyreid.no",
      data: {
        owner: {
          ownerId: "OWN-004",
          firstName: "Utenlands",
          lastName: "Registrering",
          email: "demo4@dyreid.no",
          phone: "91000004",
          address: "Importveien 3",
          postalCode: "4006",
          city: "Stavanger",
          country: "NO",
          gdprConsent: true,
          marketingConsent: false,
        },
        animals: [
          {
            animalId: "ANI-005",
            name: "Charlie",
            species: "dog",
            breed: "Golden Retriever",
            chipNumber: "276098100012345",
            dateOfBirth: "2022-01-12",
            gender: "male",
            neutered: false,
            status: "active",
            registeredByVet: false,
            paymentStatus: "unpaid",
            foreignChip: true,
            activationStatus: "inactive",
          },
        ],
        ownerships: [
          { ownershipId: "OWS-005", ownerId: "OWN-004", animalId: "ANI-005", animalName: "Charlie", role: "primary", pendingTransfer: false, transferStatus: "none" },
        ],
        tags: [],
        lostStatuses: [
          { animalId: "ANI-005", animalName: "Charlie", lost: false, lostDate: null, alertActive: false, smsEnabled: false, pushEnabled: false },
        ],
        pendingActions: { pendingPayments: 1, pendingTransfers: 0, missingProfileData: ["veterinær registrering"], inactiveTags: 0 },
        paymentHistory: [],
      },
    },
    {
      phone: "91000005",
      email: "demo5@dyreid.no",
      data: {
        owner: {
          ownerId: "OWN-005",
          firstName: "App",
          lastName: "Bruker",
          email: "demo5@dyreid.no",
          phone: "91000005",
          address: "Appveien 7",
          postalCode: "1000",
          city: "Oslo",
          country: "NO",
          gdprConsent: true,
          marketingConsent: true,
        },
        animals: [
          {
            animalId: "ANI-006",
            name: "Milo",
            species: "cat",
            breed: "Maine Coon",
            chipNumber: "578000000006",
            dateOfBirth: "2023-04-20",
            gender: "male",
            neutered: true,
            status: "active",
            registeredByVet: true,
            paymentStatus: "paid",
            foreignChip: false,
            activationStatus: "active",
          },
          {
            animalId: "ANI-007",
            name: "Nala",
            species: "cat",
            breed: "Bengal",
            chipNumber: "578000000007",
            dateOfBirth: "2023-08-10",
            gender: "female",
            neutered: true,
            status: "active",
            registeredByVet: true,
            paymentStatus: "paid",
            foreignChip: false,
            activationStatus: "active",
          },
          {
            animalId: "ANI-008",
            name: "Buddy",
            species: "dog",
            breed: "Cavalier King Charles Spaniel",
            chipNumber: "578000000008",
            dateOfBirth: "2020-12-01",
            gender: "male",
            neutered: false,
            status: "deceased",
            registeredByVet: true,
            paymentStatus: "paid",
            foreignChip: false,
            activationStatus: "inactive",
          },
        ],
        ownerships: [
          { ownershipId: "OWS-006", ownerId: "OWN-005", animalId: "ANI-006", animalName: "Milo", role: "primary", pendingTransfer: false, transferStatus: "none" },
          { ownershipId: "OWS-007", ownerId: "OWN-005", animalId: "ANI-007", animalName: "Nala", role: "primary", pendingTransfer: false, transferStatus: "none" },
          { ownershipId: "OWS-008", ownerId: "OWN-005", animalId: "ANI-008", animalName: "Buddy", role: "primary", pendingTransfer: false, transferStatus: "none" },
        ],
        tags: [
          { tagId: "TAG-005", type: "qr", activated: true, subscriptionStatus: "active", lastSeen: null, assignedAnimalId: "ANI-006", assignedAnimalName: "Milo" },
          { tagId: "TAG-006", type: "qr", activated: true, subscriptionStatus: "active", lastSeen: null, assignedAnimalId: "ANI-007", assignedAnimalName: "Nala" },
        ],
        lostStatuses: [
          { animalId: "ANI-006", animalName: "Milo", lost: false, lostDate: null, alertActive: false, smsEnabled: true, pushEnabled: true },
          { animalId: "ANI-007", animalName: "Nala", lost: false, lostDate: null, alertActive: false, smsEnabled: true, pushEnabled: true },
        ],
        pendingActions: { pendingPayments: 0, pendingTransfers: 0, missingProfileData: [], inactiveTags: 0 },
        paymentHistory: [
          { id: "PAY-006", description: "Registrering Milo", amount: 350, date: "2023-05-01", status: "paid" },
          { id: "PAY-007", description: "Registrering Nala", amount: 350, date: "2023-09-01", status: "paid" },
          { id: "PAY-008", description: "QR Tag Milo", amount: 249, date: "2023-06-01", status: "paid" },
          { id: "PAY-009", description: "QR Tag Nala", amount: 249, date: "2023-10-01", status: "paid" },
        ],
      },
    },
  ];

  for (const o of owners) {
    SANDBOX_DATA.set(o.phone, o.data);
    SANDBOX_DATA.set(o.email, o.data);
    SANDBOX_DATA.set(o.data.owner.ownerId, o.data);
  }
}

export function getMinSideContext(identifier: string): MinSideContext | null {
  initSandbox();
  return SANDBOX_DATA.get(identifier) || null;
}

export function lookupOwnerByPhone(phone: string): MinSideOwner | null {
  initSandbox();
  const ctx = SANDBOX_DATA.get(phone);
  return ctx?.owner || null;
}

export function getAllSandboxPhones(): string[] {
  initSandbox();
  return Array.from(SANDBOX_DATA.entries())
    .filter(([key]) => /^\d+$/.test(key))
    .map(([key]) => key);
}

export interface ChipLookupResult {
  found: boolean;
  animal?: {
    name: string;
    species: string;
    breed: string;
    gender: string;
    chipNumber: string;
    color?: string;
    dateOfBirth?: string;
  };
  owner?: {
    name: string;
    address: string;
    postalCode: string;
    city: string;
    phone: string;
  };
}

const CHIP_LOOKUP_DATA: Map<string, ChipLookupResult> = new Map([
  ["978456111111111", {
    found: true,
    animal: {
      name: "Agora",
      species: "Hund",
      breed: "Blandingshund",
      gender: "Hannkjønn",
      chipNumber: "978456111111111",
      dateOfBirth: "2019-05-10",
    },
    owner: {
      name: "Gudbrand Vatn",
      address: "Ørneveien 25",
      postalCode: "1640",
      city: "Råde",
      phone: "91341434",
    },
  }],
  ["578000000001", {
    found: true,
    animal: {
      name: "Bella",
      species: "Hund",
      breed: "Labrador Retriever",
      gender: "Hunnkjønn",
      chipNumber: "578000000001",
      dateOfBirth: "2020-03-15",
    },
    owner: {
      name: "Demo Bruker",
      address: "Eksempelveien 1",
      postalCode: "0001",
      city: "Oslo",
      phone: "91000001",
    },
  }],
  ["578000000003", {
    found: true,
    animal: {
      name: "Luna",
      species: "Katt",
      breed: "Norsk Skogkatt",
      gender: "Hunnkjønn",
      chipNumber: "578000000003",
      dateOfBirth: "2021-11-08",
    },
    owner: {
      name: "Test Person",
      address: "Testgata 5",
      postalCode: "5003",
      city: "Bergen",
      phone: "91000002",
    },
  }],
]);

export function lookupByChipNumber(chipNumber: string): ChipLookupResult {
  initSandbox();
  const cleaned = chipNumber.replace(/\s+/g, "").trim();
  const result = CHIP_LOOKUP_DATA.get(cleaned);
  if (result) return result;

  const entries = Array.from(SANDBOX_DATA.entries());
  for (const [, ctx] of entries) {
    if (typeof ctx === "object" && ctx.animals) {
      for (const animal of ctx.animals) {
        if (animal.chipNumber === cleaned) {
          return {
            found: true,
            animal: {
              name: animal.name,
              species: animal.species === "dog" ? "Hund" : animal.species === "cat" ? "Katt" : "Annet",
              breed: animal.breed,
              gender: animal.gender === "male" ? "Hannkjønn" : "Hunnkjønn",
              chipNumber: animal.chipNumber,
              dateOfBirth: animal.dateOfBirth,
            },
            owner: {
              name: `${ctx.owner.firstName} ${ctx.owner.lastName}`,
              address: ctx.owner.address,
              postalCode: ctx.owner.postalCode,
              city: ctx.owner.city,
              phone: ctx.owner.phone,
            },
          };
        }
      }
    }
  }

  return { found: false };
}

export interface SmsSendResult {
  success: boolean;
  message: string;
  simulatedSms?: {
    to: string;
    body: string;
  };
}

const SMS_LOG: { timestamp: string; to: string; body: string }[] = [];

export function sendOwnershipTransferSms(
  registeredOwnerPhone: string,
  registeredOwnerName: string,
  customerName: string,
  customerPhone: string,
  petName: string
): SmsSendResult {
  const SAFE_TEST_PHONE = "91341434";

  if (registeredOwnerPhone !== SAFE_TEST_PHONE) {
    return {
      success: false,
      message: `SMS kan kun sendes til testnummeret (${SAFE_TEST_PHONE}) i sandbox-modus. Registrert eiers telefon: ${registeredOwnerPhone}`,
    };
  }

  const smsBody = `Hei - vi er blitt kontaktet av ${customerName} vedrørende eierskifte av ${petName}. Vennligst ta direkte kontakt på ${customerPhone}. Med vennlig hilsen DyreID`;

  SMS_LOG.push({
    timestamp: new Date().toISOString(),
    to: registeredOwnerPhone,
    body: smsBody,
  });

  console.log(`[SMS SENDT] Til: ${registeredOwnerPhone}`);
  console.log(`[SMS INNHOLD] ${smsBody}`);

  return {
    success: true,
    message: `SMS sendt til ${registeredOwnerName} (${registeredOwnerPhone})`,
    simulatedSms: {
      to: registeredOwnerPhone,
      body: smsBody,
    },
  };
}

export function getSmsLog(): typeof SMS_LOG {
  return [...SMS_LOG];
}

export function performAction(
  ownerId: string,
  action: string,
  params: Record<string, any>
): { success: boolean; message: string; data?: any } {
  initSandbox();
  const ctx = SANDBOX_DATA.get(ownerId);
  if (!ctx) return { success: false, message: "Eier ikke funnet" };

  switch (action) {
    case "mark_lost": {
      const animal = ctx.lostStatuses.find((l) => l.animalId === params.animalId);
      if (animal) {
        animal.lost = true;
        animal.lostDate = new Date().toISOString().split("T")[0];
        animal.alertActive = true;
        animal.smsEnabled = true;
        animal.pushEnabled = true;
        return { success: true, message: `${animal.animalName} er nå meldt savnet`, data: animal };
      }
      return { success: false, message: "Dyr ikke funnet" };
    }

    case "mark_found": {
      const animal = ctx.lostStatuses.find((l) => l.animalId === params.animalId);
      if (animal) {
        animal.lost = false;
        animal.alertActive = false;
        return { success: true, message: `${animal.animalName} er markert som funnet`, data: animal };
      }
      return { success: false, message: "Dyr ikke funnet" };
    }

    case "activate_qr": {
      const tag = ctx.tags.find((t) => t.tagId === params.tagId);
      if (tag) {
        tag.activated = true;
        tag.subscriptionStatus = "active";
        return { success: true, message: `QR Tag ${tag.tagId} er nå aktivert`, data: tag };
      }
      return { success: false, message: "Tag ikke funnet" };
    }

    case "initiate_transfer": {
      const ownership = ctx.ownerships.find((o) => o.animalId === params.animalId);
      if (ownership) {
        ownership.pendingTransfer = true;
        ownership.transferStatus = "pending";
        return {
          success: true,
          message: `Eierskifteforespørsel opprettet for ${ownership.animalName}. Betalingslink sendt til ny eier.`,
          data: { ownership, paymentLink: `https://dyreid.no/pay/transfer-${ownership.ownershipId}` },
        };
      }
      return { success: false, message: "Eierskap ikke funnet" };
    }

    case "send_payment_link": {
      return {
        success: true,
        message: "Betalingslink sendt via SMS",
        data: { paymentLink: `https://dyreid.no/pay/${params.paymentType || "registration"}-${Date.now()}` },
      };
    }

    case "update_profile": {
      if (params.email) ctx.owner.email = params.email;
      if (params.phone) ctx.owner.phone = params.phone;
      if (params.address) ctx.owner.address = params.address;
      return { success: true, message: "Profil oppdatert", data: ctx.owner };
    }

    case "renew_subscription": {
      const tag = ctx.tags.find((t) => t.tagId === params.tagId);
      if (tag) {
        tag.subscriptionStatus = "active";
        return {
          success: true,
          message: `Abonnement fornyet for tag ${tag.tagId}`,
          data: { tag, paymentLink: `https://dyreid.no/pay/subscription-${tag.tagId}` },
        };
      }
      return { success: false, message: "Tag ikke funnet" };
    }

    default:
      return { success: false, message: `Ukjent handling: ${action}` };
  }
}
