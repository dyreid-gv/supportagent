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
  runUncategorizedAnalysis,
  runIntentClassification,
  runResolutionExtraction,
  runUncertaintyDetection,
  runPlaybookGeneration,
  submitManualReview,
} from "./training-agent";
import fs from "fs";
import path from "path";

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

const reviewSubmitSchema = z.object({
  queueId: z.number(),
  reviewerEmail: z.string().email(),
  decision: z.object({
    approved: z.boolean(),
    correctIntent: z.string().optional(),
    correctCategory: z.string().optional(),
    notes: z.string().optional(),
    addToPlaybook: z.boolean().optional(),
  }),
});

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function loadCategoriesFromCsv(): { categoryName: string; subcategoryName: string; urlSlug: string; description: string }[] {
  const csvPath = path.resolve("attached_assets/hjelpesenter_categories_1771024423412.csv");
  if (!fs.existsSync(csvPath)) {
    console.log("CSV file not found, using fallback categories");
    return [];
  }
  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.trim().split("\n").slice(1);
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = parseCsvLine(line);
      return {
        categoryName: parts[0] || "",
        subcategoryName: parts[1] || "",
        urlSlug: parts[2] || "",
        description: parts[3] || "",
      };
    })
    .filter((c) => c.categoryName && c.subcategoryName);
}

function sseHeaders(res: any) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const csvCategories = loadCategoriesFromCsv();
  if (csvCategories.length > 0) {
    await storage.seedHjelpesenterCategories(csvCategories);
  }

  // ─── TRAINING STATS ──────────────────────────────────────────────
  app.get("/api/training/stats", async (_req, res) => {
    try {
      const stats = await storage.getTrainingStats();
      const runs = await storage.getLatestTrainingRuns(20);
      res.json({ stats, runs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── WORKFLOW 1: INGESTION ────────────────────────────────────────
  app.post("/api/training/ingest", async (_req, res) => {
    sseHeaders(res);
    const runId = await storage.createTrainingRun("ingestion", 0);

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

  // ─── WORKFLOW 2: GDPR SCRUBBING ──────────────────────────────────
  app.post("/api/training/scrub", async (_req, res) => {
    sseHeaders(res);
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

  // ─── WORKFLOW 3: CATEGORY MAPPING ────────────────────────────────
  app.post("/api/training/categorize", async (_req, res) => {
    sseHeaders(res);
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

  // ─── WORKFLOW 4: UNCATEGORIZED ANALYSIS ──────────────────────────
  app.post("/api/training/analyze-uncategorized", async (_req, res) => {
    sseHeaders(res);
    const runId = await storage.createTrainingRun("uncategorized_analysis", 0);

    try {
      const result = await runUncategorizedAnalysis((msg, pct) => {
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

  // ─── WORKFLOW 5: INTENT CLASSIFICATION ───────────────────────────
  app.post("/api/training/classify", async (_req, res) => {
    sseHeaders(res);
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

  // ─── WORKFLOW 6: RESOLUTION EXTRACTION ───────────────────────────
  app.post("/api/training/extract-resolutions", async (_req, res) => {
    sseHeaders(res);
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

  // ─── WORKFLOW 7: UNCERTAINTY DETECTION ───────────────────────────
  app.post("/api/training/detect-uncertainty", async (_req, res) => {
    sseHeaders(res);
    const runId = await storage.createTrainingRun("uncertainty_detection", 0);

    try {
      const result = await runUncertaintyDetection((msg, pct) => {
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

  // ─── WORKFLOW 8: PLAYBOOK GENERATION ─────────────────────────────
  app.post("/api/training/generate-playbook", async (_req, res) => {
    sseHeaders(res);
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

  // ─── WORKFLOW 9: MANUAL REVIEW ───────────────────────────────────
  app.get("/api/training/review-queue", async (_req, res) => {
    try {
      const items = await storage.getPendingReviewItems();
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/training/submit-review", async (req, res) => {
    try {
      const parsed = reviewSubmitSchema.parse(req.body);
      const result = await submitManualReview(
        parsed.queueId,
        parsed.reviewerEmail,
        parsed.decision
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ─── UNCATEGORIZED THEMES ────────────────────────────────────────
  app.get("/api/training/uncategorized-themes", async (_req, res) => {
    try {
      const themes = await storage.getUncategorizedThemes();
      res.json(themes);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── UNCERTAINTY CASES ───────────────────────────────────────────
  app.get("/api/training/uncertainty-cases", async (_req, res) => {
    try {
      const cases = await storage.getUncertaintyCases();
      res.json(cases);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── PLAYBOOK & CATEGORIES ──────────────────────────────────────
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

  app.post("/api/categories/reload-csv", async (_req, res) => {
    try {
      const cats = loadCategoriesFromCsv();
      if (cats.length === 0) {
        return res.status(400).json({ error: "No categories found in CSV" });
      }
      await storage.replaceHjelpesenterCategories(cats);
      res.json({ loaded: cats.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── CHAT / CONVERSATIONS ──────────────────────────────────────
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

      sseHeaders(res);

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
