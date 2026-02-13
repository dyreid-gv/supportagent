import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import { streamChatResponse } from "./chatbot";
import { getMinSideContext, lookupOwnerByPhone, getAllSandboxPhones, performAction } from "./minside-sandbox";
import {
  runIngestion,
  runGdprScrubbing,
  runCategoryMapping,
  runIntentClassification,
  runResolutionExtraction,
  runPlaybookGeneration,
} from "./training-agent";

const createConversationSchema = z.object({
  title: z.string().min(1).max(200).optional().default("Ny samtale"),
  sessionType: z.enum(["customer", "admin"]).optional().default("customer"),
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(10000),
});

const authSchema = z.object({
  phone: z.string().min(8).max(15).regex(/^\d+$/),
});

const actionSchema = z.object({
  ownerId: z.string().min(1),
  action: z.string().min(1),
  params: z.record(z.string()).optional().default({}),
});

const HJELPESENTER_CATEGORIES_DATA = [
  { categoryName: "Min side", subcategoryName: "Logg inn på Min side", urlSlug: "logg-inn", description: "Hvordan logge inn på Min side" },
  { categoryName: "Min side", subcategoryName: "Hvorfor har jeg fått sms/e-post?", urlSlug: "sms-epost", description: "Informasjon om mottatte meldinger" },
  { categoryName: "Min side", subcategoryName: "Har jeg en Min side?", urlSlug: "har-min-side", description: "Verifisere om profil eksisterer" },
  { categoryName: "Min side", subcategoryName: "Hvorfor får jeg ikke logget meg inn?", urlSlug: "login-problem", description: "Feilsøke innloggingsproblemer" },
  { categoryName: "Min side", subcategoryName: "Det mangler et kjæledyr på Min side", urlSlug: "mangler-dyr", description: "Dyr vises ikke i profil" },
  { categoryName: "Min side", subcategoryName: "Kjæledyret mitt er dødt", urlSlug: "dyr-dod", description: "Håndtere avdøde kjæledyr" },
  { categoryName: "Min side", subcategoryName: "Slett meg", urlSlug: "gdpr-slett", description: "GDPR sletting av profil" },
  { categoryName: "Min side", subcategoryName: "Eksporter mine data", urlSlug: "gdpr-eksport", description: "GDPR dataeksport" },
  { categoryName: "Eierskifte", subcategoryName: "Hva koster eierskifte?", urlSlug: "kostnad-eierskifte", description: "Priser for eierskifte" },
  { categoryName: "Eierskifte", subcategoryName: "Hvordan foreta eierskifte?", urlSlug: "eierskifte-prosess", description: "Prosess for eierskifte" },
  { categoryName: "Eierskifte", subcategoryName: "Eierskifte når eier er død", urlSlug: "eier-dod", description: "Eierskifte ved dødsfall" },
  { categoryName: "Eierskifte", subcategoryName: "Eierskifte av NKK-registrert hund", urlSlug: "nkk-eierskifte", description: "NKK-spesifikk prosess" },
  { categoryName: "Registrering", subcategoryName: "Kjæledyret mitt er ikke søkbart", urlSlug: "ikke-sokbart", description: "Dyr ikke synlig i søk" },
  { categoryName: "Registrering", subcategoryName: "Hvordan få dyret registrert i Norge?", urlSlug: "registrering-norge", description: "Registreringsprosess" },
  { categoryName: "Registrering", subcategoryName: "Hva koster det å registrere et dyr?", urlSlug: "kostnad-registrering", description: "Registreringspriser" },
  { categoryName: "Registrering", subcategoryName: "Utenlandsregistrering", urlSlug: "utenlands-chip", description: "Registrere utenlandsk chip" },
  { categoryName: "Produkter - QR Tag", subcategoryName: "Hvordan aktivere QR-brikken?", urlSlug: "aktivere-qr", description: "Aktivering av QR-brikke" },
  { categoryName: "Produkter - QR Tag", subcategoryName: "Er kontaktinformasjonen min tilgjengelig?", urlSlug: "kontaktinfo-synlig", description: "Synlighet av kontaktinfo" },
  { categoryName: "Produkter - QR Tag", subcategoryName: "Jeg har mistet tag'en", urlSlug: "mistet-qr", description: "Erstatte tapt QR-brikke" },
  { categoryName: "Produkter - QR Tag", subcategoryName: "Hva skjer hvis abonnementet utløper?", urlSlug: "abonnement-utloper", description: "Konsekvenser ved utløp" },
  { categoryName: "Produkter - Smart Tag", subcategoryName: "Kan ikke koble til taggen", urlSlug: "smarttag-kobling", description: "Koblingsproblemer Smart Tag" },
  { categoryName: "Produkter - Smart Tag", subcategoryName: "Taggen var lagt til før men jeg finner den ikke", urlSlug: "smarttag-forsvunnet", description: "Smart Tag ikke synlig" },
  { categoryName: "Produkter - Smart Tag", subcategoryName: "Posisjonen har ikke oppdatert seg", urlSlug: "smarttag-posisjon", description: "Posisjonsproblemer" },
  { categoryName: "Produkter - Smart Tag", subcategoryName: "Flere tagger men får bare koblet til en", urlSlug: "smarttag-flere", description: "Flere tagger samtidig" },
  { categoryName: "Abonnement", subcategoryName: "DyreID basis vs DyreID+", urlSlug: "basis-vs-plus", description: "Forskjeller mellom planer" },
  { categoryName: "Abonnement", subcategoryName: "Koster appen noe?", urlSlug: "app-kostnad", description: "Priser for app" },
  { categoryName: "Abonnement", subcategoryName: "Avslutte abonnement", urlSlug: "avslutte-abo", description: "Oppsigelse av abonnement" },
  { categoryName: "Savnet/Funnet", subcategoryName: "Hvordan melde mitt kjæledyr savnet?", urlSlug: "melde-savnet", description: "Prosess for savnetmelding" },
  { categoryName: "Savnet/Funnet", subcategoryName: "Kjæledyret har kommet til rette", urlSlug: "funnet-igjen", description: "Markere som funnet" },
  { categoryName: "Savnet/Funnet", subcategoryName: "Hvordan fungerer Savnet & Funnet?", urlSlug: "savnet-funnet-info", description: "Informasjon om tjenesten" },
  { categoryName: "Familiedeling", subcategoryName: "Hvordan dele tilgang med familiemedlemmer?", urlSlug: "dele-tilgang", description: "Prosess for deling" },
  { categoryName: "Familiedeling", subcategoryName: "Kan jeg bruke familiedeling med noen som har kjæledyr?", urlSlug: "familiedeling-eksisterende", description: "Deling med eksisterende brukere" },
  { categoryName: "Familiedeling", subcategoryName: "Jeg ser ikke lenger kjæledyret som har blitt delt", urlSlug: "deling-forsvunnet", description: "Tilgang mistet" },
  { categoryName: "App", subcategoryName: "Hvordan få tilgang til DyreID-appen?", urlSlug: "app-tilgang", description: "Laste ned og logge inn" },
  { categoryName: "App", subcategoryName: "Innlogging app", urlSlug: "app-login", description: "Innloggingsprosess i app" },
  { categoryName: "App", subcategoryName: "Hvorfor app?", urlSlug: "app-fordeler", description: "Fordeler med app" },
];

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await storage.seedHjelpesenterCategories(HJELPESENTER_CATEGORIES_DATA);

  app.get("/api/training/stats", async (_req, res) => {
    try {
      const stats = await storage.getTrainingStats();
      const runs = await storage.getLatestTrainingRuns(10);
      res.json({ stats, runs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/training/ingest", async (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const runId = await storage.createTrainingRun("ingestion", 0);
    let errorCount = 0;

    try {
      const result = await runIngestion((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      });
      await storage.completeTrainingRun(runId, result.errors);
      res.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`);
    } catch (error: any) {
      await storage.completeTrainingRun(runId, 1, error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.post("/api/training/scrub", async (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const runId = await storage.createTrainingRun("gdpr_scrubbing", 0);

    try {
      const result = await runGdprScrubbing((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      });
      await storage.completeTrainingRun(runId, result.errors);
      res.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`);
    } catch (error: any) {
      await storage.completeTrainingRun(runId, 1, error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.post("/api/training/categorize", async (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const runId = await storage.createTrainingRun("category_mapping", 0);

    try {
      const result = await runCategoryMapping((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      });
      await storage.completeTrainingRun(runId, result.errors);
      res.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`);
    } catch (error: any) {
      await storage.completeTrainingRun(runId, 1, error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.post("/api/training/classify", async (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const runId = await storage.createTrainingRun("intent_classification", 0);

    try {
      const result = await runIntentClassification((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      });
      await storage.completeTrainingRun(runId, result.errors);
      res.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`);
    } catch (error: any) {
      await storage.completeTrainingRun(runId, 1, error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.post("/api/training/extract-resolutions", async (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const runId = await storage.createTrainingRun("resolution_extraction", 0);

    try {
      const result = await runResolutionExtraction((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      });
      await storage.completeTrainingRun(runId, result.errors);
      res.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`);
    } catch (error: any) {
      await storage.completeTrainingRun(runId, 1, error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.post("/api/training/generate-playbook", async (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const runId = await storage.createTrainingRun("playbook_generation", 0);

    try {
      const result = await runPlaybookGeneration((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      });
      await storage.completeTrainingRun(runId, 0);
      res.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`);
    } catch (error: any) {
      await storage.completeTrainingRun(runId, 1, error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.get("/api/playbook", async (_req, res) => {
    try {
      const entries = await storage.getPlaybookEntries();
      res.json(entries);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/categories", async (_req, res) => {
    try {
      const categories = await storage.getHjelpesenterCategories();
      res.json(categories);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chat/conversations", async (req, res) => {
    try {
      const parsed = createConversationSchema.parse(req.body);
      const conversation = await storage.createConversation({
        title: parsed.title,
        sessionType: parsed.sessionType,
      });
      res.status(201).json(conversation);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/chat/conversations", async (_req, res) => {
    try {
      const conversations = await storage.getAllConversations();
      res.json(conversations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/chat/conversations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const conversation = await storage.getConversation(id);
      if (!conversation) return res.status(404).json({ error: "Not found" });
      const msgs = await storage.getMessagesByConversation(id);
      res.json({ ...conversation, messages: msgs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/chat/conversations/:id", async (req, res) => {
    try {
      await storage.deleteConversation(parseInt(req.params.id));
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chat/conversations/:id/messages", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const parsed = sendMessageSchema.parse(req.body);
      const content = parsed.content;
      const conversation = await storage.getConversation(conversationId);
      if (!conversation) return res.status(404).json({ error: "Not found" });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const generator = streamChatResponse(
        conversationId,
        content,
        conversation.ownerId
      );

      for await (const chunk of generator) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error: any) {
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });

  app.post("/api/chat/conversations/:id/auth", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const parsed = authSchema.parse(req.body);
      const phone = parsed.phone;

      const owner = lookupOwnerByPhone(phone);
      if (!owner) {
        return res.status(404).json({ error: "Bruker ikke funnet. For demo, bruk: 91000001-91000005" });
      }

      await storage.updateConversationAuth(conversationId, owner.ownerId);
      const context = getMinSideContext(owner.ownerId);

      res.json({
        authenticated: true,
        owner: {
          ownerId: owner.ownerId,
          firstName: owner.firstName,
          lastName: owner.lastName,
        },
        animalCount: context?.animals.length || 0,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/minside/context/:ownerId", async (req, res) => {
    try {
      const context = getMinSideContext(req.params.ownerId);
      if (!context) return res.status(404).json({ error: "Not found" });
      res.json(context);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/minside/action", async (req, res) => {
    try {
      const parsed = actionSchema.parse(req.body);
      const result = performAction(parsed.ownerId, parsed.action, parsed.params);
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sandbox/phones", async (_req, res) => {
    res.json(getAllSandboxPhones());
  });

  return httpServer;
}
