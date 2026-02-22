import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { count, sql, eq } from "drizzle-orm";
import { discoveredClusters } from "@shared/schema";
import axios from "axios";
import { db } from "./db";
import { storage } from "./storage";
import { streamChatResponse, getLastInteractionId, clearSession as clearChatSession, ensurePriceCache, getPrice } from "./chatbot";
import { scrapeHjelpesenter } from "./hjelpesenter-scraper";
import { getMinSideContext, lookupOwnerByPhone, getAllSandboxPhones, performAction, lookupByChipNumber, getSmsLog } from "./minside-sandbox";
import { authenticateWithOTP, fetchPetList, fetchPaymentHistory, storeSession, getStoredSession, clearSession as clearMinsideSession, type MinSidePet } from "./minside-client";
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
  runCombinedBatchAnalysis,
  runHelpCenterMatching,
  generateTemplateKeywords,
  runAutoReplyDetection,
  runDialogPatternAnalysis,
  runReclassification,
  runQualityAssessment,
  runInfoTextPopulation,
  runDomainDiscovery,
  type BatchMetrics,
} from "./training-agent";
import { generateAndStoreEmbedding } from "./canonical-intents";
import { refreshIntentIndex } from "./intent-index";
import {
  rawTickets,
  scrubbedTickets,
  hjelpesenterCategories as hjelpesenterCategoriesTable,
  categoryMappings,
  intentClassifications,
  resolutionPatterns,
  playbookEntries,
  uncategorizedThemes,
  uncertaintyCases,
  reviewQueue as reviewQueueTable,
  trainingRuns,
  servicePrices,
  responseTemplates,
} from "@shared/schema";
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

  await ensurePriceCache();

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

  // ─── DIAGNOSTIC: PAGINATION TEST ──────────────────────────────────
  app.post("/api/training/diagnostic-pagination", async (_req, res) => {
    try {
      const { runPaginationDiagnostic } = await import("./diagnostic-pagination");
      const report = await runPaginationDiagnostic();
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── STAGING: 5000 TICKET INGEST + ANALYSIS ─────────────────────
  app.post("/api/training/staging-ingest", async (_req, res) => {
    sseHeaders(res);
    try {
      const { runStagingIngest } = await import("./staging-ingest");
      const result = await runStagingIngest((msg, progress) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress })}\n\n`);
      });
      res.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`);
      res.end();
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  app.post("/api/training/staging-cluster", async (_req, res) => {
    sseHeaders(res);
    try {
      const { runStagingClustering } = await import("./staging-cluster");
      const result = await runStagingClustering((msg, progress) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress })}\n\n`);
      });
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.write(`data: ${JSON.stringify(result)}\n\n`);
      res.end();
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  app.get("/api/training/staging-analysis", async (_req, res) => {
    try {
      const { runStagingAnalysis } = await import("./staging-ingest");
      const report = await runStagingAnalysis();
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── WORKFLOW 1: INGESTION ────────────────────────────────────────
  app.post("/api/training/ingest", async (req, res) => {
    sseHeaders(res);
    const maxTickets = req.body?.maxTickets;
    const runId = await storage.createTrainingRun("ingestion", 0);

    try {
      const result = await runIngestion((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      }, maxTickets);
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

  // ─── COMBINED BATCH ANALYSIS (optimized: category+intent+resolution in 1 call) ──
  app.post("/api/training/combined-analysis", async (req, res) => {
    sseHeaders(res);
    const ticketLimit = req.body?.ticketLimit || undefined;
    const runId = await storage.createTrainingRun("combined_batch_analysis", 0);

    try {
      const result = await runCombinedBatchAnalysis((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      }, ticketLimit);
      await storage.completeTrainingRun(runId, result.metrics.errors);
      res.write(`data: ${JSON.stringify({ done: true, metrics: result.metrics })}\n\n`);
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

  // ─── INTENT DISCOVERY PIPELINE ──────────────────────────────────
  let lastDiscoveryResult: any = null;

  app.post("/api/admin/intent-discovery", async (_req, res) => {
    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const { runIntentDiscovery } = await import("./intent-discovery");

      const result = await runIntentDiscovery((msg, pct) => {
        res.write(`data: ${JSON.stringify({ progress: pct, message: msg })}\n\n`);
      });

      lastDiscoveryResult = result;

      res.write(`data: ${JSON.stringify({ done: true, result })}\n\n`);
    } catch (error: any) {
      console.error("[IntentDiscovery] Error:", error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.get("/api/admin/intent-discovery/results", async (_req, res) => {
    if (!lastDiscoveryResult) {
      return res.json({ status: "no_results", message: "No intent discovery has been run yet. Trigger via POST /api/admin/intent-discovery" });
    }
    res.json(lastDiscoveryResult);
  });

  // ─── MATCH CORRECTNESS AUDIT ────────────────────────────────────
  let lastAuditResult: any = null;

  app.post("/api/admin/match-audit", async (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    try {
      const { runMatchCorrectnessAudit, formatAuditReport } = await import("./match-audit");
      const result = await runMatchCorrectnessAudit((message, progress) => {
        res.write(`data: ${JSON.stringify({ message, progress })}\n\n`);
      });

      lastAuditResult = result;
      const report = formatAuditReport(result);

      res.write(`data: ${JSON.stringify({ done: true, result, report })}\n\n`);
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.get("/api/admin/match-audit/results", async (_req, res) => {
    if (!lastAuditResult) {
      return res.json({ status: "no_results", message: "No match audit has been run yet." });
    }
    const { formatAuditReport } = await import("./match-audit");
    const report = formatAuditReport(lastAuditResult);
    res.json({ ...lastAuditResult, report });
  });

  // ─── CASE ESCALATION ─────────────────────────────────────────────
  app.get("/api/admin/escalations", async (_req, res) => {
    try {
      const { getEscalations } = await import("./case-escalation");
      const limit = parseInt(String(_req.query.limit)) || 50;
      const offset = parseInt(String(_req.query.offset)) || 0;
      const items = await getEscalations(limit, offset);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/escalation-stats", async (_req, res) => {
    try {
      const { getEscalationStats } = await import("./case-escalation");
      const stats = await getEscalationStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/admin/escalations/:id/status", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, errorMessage } = req.body;
      if (!status || !["pending", "posted", "failed", "cancelled"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const { updateEscalationStatus } = await import("./case-escalation");
      await updateEscalationStatus(id, status, errorMessage);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/escalation-qc", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 200;
      const { generateQCReport } = await import("./case-escalation");
      const report = await generateQCReport(Math.min(limit, 500));
      res.json(report);
    } catch (error: any) {
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

  // ─── HJELPESENTER ARTICLES ─────────────────────────────────────
  app.post("/api/hjelpesenter/scrape", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const result = await scrapeHjelpesenter((msg, pct) => {
        send({ message: msg, progress: pct });
      });
      send({ message: "Ferdig!", progress: 100, result });
      res.end();
    } catch (error: any) {
      send({ error: error.message });
      res.end();
    }
  });

  app.get("/api/hjelpesenter/articles", async (_req, res) => {
    try {
      const articles = await storage.getHelpCenterArticles();
      res.json(articles);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/hjelpesenter/articles/count", async (_req, res) => {
    try {
      const count = await storage.getHelpCenterArticleCount();
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/hjelpesenter/articles/category/:category", async (req, res) => {
    try {
      const articles = await storage.getHelpCenterArticlesByCategory(req.params.category);
      res.json(articles);
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
      const conv = await storage.getConversation(parseInt(req.params.id));
      if (conv?.ownerId) {
        clearMinsideSession(conv.ownerId);
        clearChatSession(parseInt(req.params.id));
      }
      await storage.deleteConversation(parseInt(req.params.id));
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chat/conversations/:id/logout", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conv = await storage.getConversation(conversationId);
      if (conv?.ownerId) {
        clearMinsideSession(conv.ownerId);
        clearChatSession(conversationId);
        await storage.updateConversationAuth(conversationId, null);
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chip-lookup", async (req, res) => {
    try {
      const { chipNumber } = req.body;
      if (!chipNumber || typeof chipNumber !== "string") {
        return res.status(400).json({ error: "chipNumber is required" });
      }
      const result = lookupByChipNumber(chipNumber);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sms-log", async (_req, res) => {
    try {
      res.json(getSmsLog());
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
        conversation.ownerId,
        conversation.userContext
      );

      for await (const chunk of generator) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      const interactionId = getLastInteractionId();
      res.write(`data: ${JSON.stringify({ done: true, interactionId })}\n\n`);
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

  app.post("/api/feedback", async (req, res) => {
    try {
      const { interactionId, result, comment } = req.body;
      if (!interactionId || !result) {
        return res.status(400).json({ error: "interactionId and result required" });
      }
      if (!["resolved", "partial", "not_resolved"].includes(result)) {
        return res.status(400).json({ error: "result must be resolved, partial, or not_resolved" });
      }
      await storage.updateInteractionFeedback(interactionId, result, comment);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/feedback/stats", async (_req, res) => {
    try {
      const stats = await storage.getFeedbackStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/feedback/flagged", async (_req, res) => {
    try {
      const flagged = await storage.getFlaggedInteractions();
      res.json(flagged);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/feedback/interactions", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const interactions = await storage.getChatbotInteractions(limit);
      res.json(interactions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── MIN SIDE OTP PROXY ──────────────────────────────────────────
  const MINSIDE_URL = "https://minside.dyreid.no";

  app.post("/api/auth/send-otp", async (req, res) => {
    try {
      const { contactMethod } = req.body;
      if (!contactMethod) {
        return res.status(400).json({ error: "contactMethod er påkrevd" });
      }

      const sandboxOwner = lookupOwnerByPhone(contactMethod);
      if (sandboxOwner) {
        return res.json({ success: true, mode: "sandbox", message: `OTP sendt til ${contactMethod} (sandbox-modus)` });
      }

      const isEmail = contactMethod.includes("@");

      const detailResponse = await axios.post(
        `${MINSIDE_URL}/Security/GetDetailfromEmailorPhone?emailOrContactNumber=${encodeURIComponent(contactMethod)}`,
        {},
        {
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
        }
      );

      const detailData = detailResponse.data;
      if (!detailData.Success || !detailData.UserId) {
        return res.status(404).json({ error: "Fant ingen bruker med dette nummeret/e-posten. Sjekk at du har riktig nummer." });
      }

      const userId = detailData.UserId;

      const sendResponse = await axios.post(
        `${MINSIDE_URL}/Security/SendOTPForLoginViaPassCode`,
        {
          UserId: userId,
          emailOrContactNumber: contactMethod,
          isEmail: isEmail,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
        }
      );

      const sendData = sendResponse.data;
      if (sendData.Success) {
        res.json({ success: true, mode: "production", userId, message: `Engangskode sendt til ${contactMethod}` });
      } else {
        res.status(400).json({ error: sendData.Message || "Kunne ikke sende engangskode" });
      }
    } catch (error: any) {
      const errData = error.response?.data;
      const errMsg = typeof errData === "string" && errData.includes("<html")
        ? "Kunne ikke kontakte Min Side-serveren. Prøv igjen senere."
        : errData?.Message || errData || error.message;
      console.error("Send OTP error:", errMsg);
      res.status(error.response?.status || 500).json({ error: errMsg });
    }
  });

  app.post("/api/auth/verify-otp", async (req, res) => {
    try {
      const { contactMethod, otpCode, conversationId, userId } = req.body;
      if (!contactMethod || !otpCode) {
        return res.status(400).json({ error: "contactMethod og otpCode er påkrevd" });
      }

      const sandboxOwner = lookupOwnerByPhone(contactMethod);
      if (sandboxOwner) {
        const context = getMinSideContext(sandboxOwner.ownerId);
        if (conversationId) {
          await storage.updateConversationAuth(parseInt(conversationId), sandboxOwner.ownerId);
        }
        return res.json({
          success: true,
          mode: "sandbox",
          userContext: {
            FirstName: sandboxOwner.firstName,
            LastName: sandboxOwner.lastName,
            Email: sandboxOwner.email,
            Phone: sandboxOwner.phone,
            OwnerId: sandboxOwner.ownerId,
            Pets: context?.animals.map(a => ({
              Name: a.name,
              Species: a.species,
              Breed: a.breed,
              ChipNumber: a.chipNumber,
              AnimalId: a.animalId,
            })) || [],
          },
        });
      }

      let resolvedUserId = userId;
      if (!resolvedUserId) {
        const detailResponse = await axios.post(
          `${MINSIDE_URL}/Security/GetDetailfromEmailorPhone?emailOrContactNumber=${encodeURIComponent(contactMethod)}`,
          {},
          { headers: { "Content-Type": "application/json" }, timeout: 15000 }
        );
        resolvedUserId = detailResponse.data?.UserId;
      }

      if (!resolvedUserId) {
        return res.status(404).json({ error: "Fant ingen bruker med dette nummeret/e-posten." });
      }

      const session = await authenticateWithOTP(contactMethod, otpCode, resolvedUserId);
      if (!session) {
        return res.status(401).json({ success: false, error: "Feil engangskode. Prøv igjen." });
      }

      storeSession(session.ownerId, session.cookies, session.ownerInfo);

      let petList: { Name: string; Species: string; Breed: string; ChipNumber: string; PetId: string; DateOfBirth: string; Gender: string }[] = [];
      try {
        const pets = await fetchPetList(session.cookies);
        petList = pets.map(p => ({
          Name: p.name,
          Species: p.species,
          Breed: p.breed,
          ChipNumber: p.chipNumber,
          PetId: p.petId,
          DateOfBirth: p.dateOfBirth,
          Gender: p.gender,
        }));
        console.log(`Fetched ${petList.length} pets from Min Side for ${session.ownerInfo.name}`);
      } catch (petErr: any) {
        console.log("Could not fetch pet list (non-critical):", petErr.message);
      }

      const userContextData = {
        FirstName: session.ownerInfo.firstName,
        LastName: session.ownerInfo.lastName,
        Phone: contactMethod,
        OwnerId: session.ownerId,
        NumberOfPets: session.ownerInfo.numberOfPets,
        Pets: petList.length > 0 ? petList : undefined,
      };

      if (conversationId) {
        await storage.updateConversationAuth(parseInt(conversationId), session.ownerId, userContextData);
      }

      return res.json({
        success: true,
        mode: "production",
        userContext: userContextData,
      });
    } catch (error: any) {
      const errData = error.response?.data;
      const errMsg = typeof errData === "string" && errData.includes("<html")
        ? "Kunne ikke verifisere koden. Prøv igjen."
        : errData?.Message || errData || error.message;
      console.error("Verify OTP error:", errMsg);
      res.status(error.response?.status || 500).json({
        success: false,
        error: errMsg,
      });
    }
  });

  app.get("/api/auth/user-context", async (req, res) => {
    try {
      const { contactMethod } = req.query;
      if (!contactMethod) {
        return res.status(400).json({ error: "contactMethod er påkrevd" });
      }

      const sandboxOwner = lookupOwnerByPhone(contactMethod as string);
      if (sandboxOwner) {
        const context = getMinSideContext(sandboxOwner.ownerId);
        return res.json({
          FirstName: sandboxOwner.firstName,
          LastName: sandboxOwner.lastName,
          Pets: context?.animals.map(a => ({
            Name: a.name,
            Species: a.species,
            Breed: a.breed,
          })) || [],
        });
      }

      const response = await axios.get(
        `${MINSIDE_URL}/Security/GetOwnerDetailforOTPScreen?emailOrContactNumber=${encodeURIComponent(contactMethod as string)}`,
        { timeout: 15000 }
      );
      res.json(response.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json({
        error: error.response?.data || "Kunne ikke hente brukerdata",
      });
    }
  });

  // ─── ADMIN EXPORT ENDPOINTS ─────────────────────────────────────
  const tableMap: Record<string, any> = {
    raw_tickets: rawTickets,
    scrubbed_tickets: scrubbedTickets,
    hjelpesenter_categories: hjelpesenterCategoriesTable,
    category_mappings: categoryMappings,
    intent_classifications: intentClassifications,
    resolution_patterns: resolutionPatterns,
    playbook_entries: playbookEntries,
    uncategorized_themes: uncategorizedThemes,
    uncertainty_cases: uncertaintyCases,
    review_queue: reviewQueueTable,
    training_runs: trainingRuns,
    service_prices: servicePrices,
    response_templates: responseTemplates,
  };

  app.get("/api/admin/tables", async (_req, res) => {
    try {
      const stats = await storage.getTrainingStats();
      const tables = [];
      for (const [name, table] of Object.entries(tableMap)) {
        const result = await db.select({ count: count() }).from(table);
        tables.push({ name, rows: result[0].count });
      }
      res.json({ tables, stats });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/export/:table", async (req, res) => {
    try {
      const tableName = req.params.table;
      const format = req.query.format || "json";
      const table = tableMap[tableName];
      if (!table) {
        return res.status(404).json({ error: `Tabell '${tableName}' finnes ikke` });
      }

      const rows = await db.select().from(table);

      if (format === "csv") {
        if (rows.length === 0) {
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader("Content-Disposition", `attachment; filename="${tableName}.csv"`);
          return res.send("");
        }
        const headers = Object.keys(rows[0]);
        const csvLines = [headers.join(",")];
        for (const row of rows) {
          const values = headers.map((h) => {
            const val = (row as any)[h];
            if (val === null || val === undefined) return "";
            const str = typeof val === "object" ? JSON.stringify(val) : String(val);
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          });
          csvLines.push(values.join(","));
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${tableName}.csv"`);
        return res.send(csvLines.join("\n"));
      }

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${tableName}.json"`);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/export-all", async (_req, res) => {
    try {
      const allData: Record<string, any[]> = {};
      for (const [name, table] of Object.entries(tableMap)) {
        allData[name] = await db.select().from(table);
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="dyreid_full_export.json"`);
      res.json(allData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/schema", async (_req, res) => {
    try {
      const schemaInfo = Object.entries(tableMap).map(([name]) => {
        const tableConfig = tableMap[name];
        const columns = Object.entries(tableConfig).filter(([key]) => !key.startsWith("_")).map(([key, col]: [string, any]) => ({
          name: key,
          dbName: col?.name || key,
          dataType: col?.dataType || "unknown",
          notNull: col?.notNull || false,
          hasDefault: col?.hasDefault || false,
        }));
        return { tableName: name, columns };
      });
      res.json(schemaInfo);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── SERVICE PRICES ──────────────────────────────────────────────
  app.get("/api/prices", async (_req, res) => {
    try {
      const prices = await storage.getServicePrices();
      res.json(prices);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/prices/active", async (_req, res) => {
    try {
      const prices = await storage.getActiveServicePrices();
      res.json(prices);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/prices", async (req, res) => {
    try {
      const { serviceKey, serviceName, price, currency, description, category, sourceTemplate, effectiveDate, isActive } = req.body;
      if (!serviceKey || !serviceName || price === undefined) {
        return res.status(400).json({ error: "serviceKey, serviceName og price er påkrevd" });
      }
      const result = await storage.upsertServicePrice({
        serviceKey,
        serviceName,
        price: parseFloat(price),
        currency: currency || "NOK",
        description: description || null,
        category: category || null,
        sourceTemplate: sourceTemplate || null,
        effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
        isActive: isActive !== false,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/prices/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates: any = {};
      if (req.body.serviceName !== undefined) updates.serviceName = req.body.serviceName;
      if (req.body.price !== undefined) updates.price = parseFloat(req.body.price);
      if (req.body.currency !== undefined) updates.currency = req.body.currency;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.category !== undefined) updates.category = req.body.category;
      if (req.body.effectiveDate !== undefined) updates.effectiveDate = new Date(req.body.effectiveDate);
      if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
      await storage.updateServicePrice(id, updates);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/prices/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteServicePrice(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/prices/seed", async (_req, res) => {
    try {
      const defaultPrices = [
        { serviceKey: "eierskifte", serviceName: "Eierskifte av kjæledyr", price: 390, category: "Eierskifte", description: "Overføring av eierskap mellom personer. Selger betaler.", sourceTemplate: "Eierskifte Hva koster eierskifte kvittering" },
        { serviceKey: "utenlandsregistrering", serviceName: "Registrering av dyr fra utlandet", price: 656, category: "Utenlandsregistrering", description: "Registrering av importert dyr med utenlandsk chip i norsk register", sourceTemplate: "Utendlandsregistrering Hva koster det å registrere et dyr i Norge?" },
        { serviceKey: "registrering_ny", serviceName: "Registrering av nytt dyr", price: 250, category: "Registrering", description: "Førstegangsregistrering av chippet dyr i DyreID", sourceTemplate: "Seed test data" },
        { serviceKey: "qr_brikke_ekstra", serviceName: "Ekstra QR-brikke", price: 99, category: "QR Brikke", description: "Tilleggsbestilling av QR-brikke (utover den første)", sourceTemplate: "Seed test data" },
        { serviceKey: "qr_brikke_erstatning", serviceName: "Erstatning QR-brikke", price: 0, category: "QR Brikke", description: "Erstatning ved defekt/uleselig QR-brikke (kostnadsfri)", sourceTemplate: "QR-brikke fungerer ikke" },
        { serviceKey: "abonnement_basis", serviceName: "Basis-abonnement (1 dyr)", price: 99, category: "Abonnement", description: "Månedlig abonnement for ett dyr", sourceTemplate: "Seed test data" },
        { serviceKey: "abonnement_standard", serviceName: "Standard-abonnement (2 dyr)", price: 199, category: "Abonnement", description: "Månedlig abonnement for to dyr", sourceTemplate: "Seed test data" },
        { serviceKey: "abonnement_familie", serviceName: "Familie-abonnement (opptil 5 dyr)", price: 399, category: "Abonnement", description: "Månedlig abonnement for opptil 5 dyr", sourceTemplate: "Seed test data" },
        { serviceKey: "smart_tag_ny", serviceName: "Smart Tag (ny kunde)", price: 349, category: "Smart Tag", description: "Smart Tag med Bluetooth-sporing for nye kunder", sourceTemplate: "Identifisert fra autosvar" },
        { serviceKey: "smart_tag_erstatning", serviceName: "Smart Tag (eksisterende kunde)", price: 249, category: "Smart Tag", description: "Erstatning Smart Tag til redusert pris. Batteriet kan ikke byttes.", sourceTemplate: "Smart Tag batteri" },
      ];

      const results = [];
      for (const p of defaultPrices) {
        const result = await storage.upsertServicePrice({
          ...p,
          currency: "NOK",
          effectiveDate: new Date("2026-01-01"),
          isActive: true,
        });
        results.push(result);
      }
      res.json({ success: true, count: results.length, prices: results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── INTENTS & CATEGORIES (for admin UI) ─────────────────────────
  app.get("/api/intents", async (_req, res) => {
    try {
      const { INTENT_DEFINITIONS } = await import("../shared/intents");
      const categories = Array.from(new Set(INTENT_DEFINITIONS.map(d => d.category)));
      res.json({ intents: INTENT_DEFINITIONS, categories });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── MIN SIDE FIELD MAPPINGS ─────────────────────────────────────
  app.get("/api/minside-mappings", async (_req, res) => {
    try {
      const mappings = await storage.getMinsideFieldMappings();
      res.json(mappings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/minside-mappings", async (req, res) => {
    try {
      const result = await storage.upsertMinsideFieldMapping(req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/minside-mappings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.updateMinsideFieldMapping(id, req.body);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/minside-mappings/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteMinsideFieldMapping(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/minside-mappings/seed", async (_req, res) => {
    try {
      const defaultMappings = [
        // ── MyPetList - Dyreliste ──
        { minsidePage: "MyPetList", minsideField: "petId", fieldDescription: "Unik ID for hvert dyr", dataType: "read", actionType: "identify", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Identifisere dyr for handlinger", minsideUrl: "/OwnersPets/Owner/MyPetList" },
        { minsidePage: "MyPetList", minsideField: "name", fieldDescription: "Dyrets navn", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Vise dyrets navn i samtale", minsideUrl: "/OwnersPets/Owner/MyPetList" },
        { minsidePage: "MyPetList", minsideField: "species", fieldDescription: "Dyreart (hund, katt, etc.)", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Vise dyreart", minsideUrl: "/OwnersPets/Owner/MyPetList" },
        { minsidePage: "MyPetList", minsideField: "breed", fieldDescription: "Rase", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Vise rase i kontekst", minsideUrl: "/OwnersPets/Owner/MyPetList" },
        { minsidePage: "MyPetList", minsideField: "chipNumber", fieldDescription: "Chipnummer for ID-merking", dataType: "read", actionType: "display", hjelpesenterCategory: "ID-søk", intent: "CheckContactData", chatbotCapability: "Vise chipnr, koble til betalinger og registreringer", minsideUrl: "/OwnersPets/Owner/MyPetList" },
        { minsidePage: "MyPetList", minsideField: "dateOfBirth", fieldDescription: "Fødselsdato", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Vise alder/fødselsdato", minsideUrl: "/OwnersPets/Owner/MyPetList" },
        { minsidePage: "MyPetList", minsideField: "gender", fieldDescription: "Kjønn (hann/hunn)", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Kontekstuell informasjon", minsideUrl: "/OwnersPets/Owner/MyPetList" },
        { minsidePage: "MyPetList", minsideField: "registeredDate", fieldDescription: "Registreringsdato i DyreID", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Verifisere registreringsstatus", minsideUrl: "/OwnersPets/Owner/MyPetList" },
        { minsidePage: "MyPetList", minsideField: "clinic", fieldDescription: "Registreringsklinikk", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Vise klinikkinfo", minsideUrl: "/OwnersPets/Owner/MyPetList" },

        // ── OwnerChange - Eierskifte ──
        { minsidePage: "OwnerChange", minsideField: "PetId", fieldDescription: "Velg dyr for eierskifte (dropdown)", dataType: "write", actionType: "execute", hjelpesenterCategory: "Eierskifte", intent: "OwnershipTransferWeb", chatbotCapability: "Starte eierskifte ved å velge dyr", minsideUrl: "/OwnerChange/OwnerSeller/ReportOwnerChange" },
        { minsidePage: "OwnerChange", minsideField: "OwnerChangeEmail", fieldDescription: "E-post til ny eier", dataType: "write", actionType: "execute", hjelpesenterCategory: "Eierskifte", intent: "OwnershipTransferWeb", chatbotCapability: "Samle inn ny eiers e-post for eierskifte", minsideUrl: "/OwnerChange/OwnerSeller/ReportOwnerChange" },
        { minsidePage: "OwnerChange", minsideField: "OwnerChangeContactNumber", fieldDescription: "Telefonnummer til ny eier", dataType: "write", actionType: "execute", hjelpesenterCategory: "Eierskifte", intent: "OwnershipTransferWeb", chatbotCapability: "Samle inn ny eiers telefonnr", minsideUrl: "/OwnerChange/OwnerSeller/ReportOwnerChange" },
        { minsidePage: "OwnerChange", minsideField: "OwnerFirstName", fieldDescription: "Fornavn til ny eier", dataType: "write", actionType: "execute", hjelpesenterCategory: "Eierskifte", intent: "OwnershipTransferWeb", chatbotCapability: "Samle inn ny eiers fornavn", minsideUrl: "/OwnerChange/OwnerSeller/ReportOwnerChange" },
        { minsidePage: "OwnerChange", minsideField: "OwnerLastName", fieldDescription: "Etternavn til ny eier", dataType: "write", actionType: "execute", hjelpesenterCategory: "Eierskifte", intent: "OwnershipTransferWeb", chatbotCapability: "Samle inn ny eiers etternavn", minsideUrl: "/OwnerChange/OwnerSeller/ReportOwnerChange" },
        { minsidePage: "OwnerChange", minsideField: "AddressLine1", fieldDescription: "Adresse til ny eier", dataType: "write", actionType: "execute", hjelpesenterCategory: "Eierskifte", intent: "OwnershipTransferWeb", chatbotCapability: "Samle inn ny eiers adresse", minsideUrl: "/OwnerChange/OwnerSeller/ReportOwnerChange" },
        { minsidePage: "OwnerChange", minsideField: "ZipCode", fieldDescription: "Postnummer til ny eier", dataType: "write", actionType: "execute", hjelpesenterCategory: "Eierskifte", intent: "OwnershipTransferWeb", chatbotCapability: "Samle inn postnummer", minsideUrl: "/OwnerChange/OwnerSeller/ReportOwnerChange" },
        { minsidePage: "OwnerChange", minsideField: "City", fieldDescription: "By/sted til ny eier", dataType: "write", actionType: "execute", hjelpesenterCategory: "Eierskifte", intent: "OwnershipTransferWeb", chatbotCapability: "Samle inn by/sted", minsideUrl: "/OwnerChange/OwnerSeller/ReportOwnerChange" },

        // ── PaymentHistory - Betalingshistorikk ──
        { minsidePage: "PaymentHistory", minsideField: "chipNumber", fieldDescription: "Chipnr koblet til betaling", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Koble betaling til dyr", minsideUrl: "/Shared/PaymentHistory" },
        { minsidePage: "PaymentHistory", minsideField: "amount", fieldDescription: "Betalingsbeløp", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Vise betalingsbeløp", minsideUrl: "/Shared/PaymentHistory" },
        { minsidePage: "PaymentHistory", minsideField: "status", fieldDescription: "Betalingsstatus (betalt/ubetalt)", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Sjekke betalingsstatus", minsideUrl: "/Shared/PaymentHistory" },
        { minsidePage: "PaymentHistory", minsideField: "type", fieldDescription: "Type tjeneste (eierskifte, registrering, etc.)", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Forklare hva betalingen gjelder", minsideUrl: "/Shared/PaymentHistory" },
        { minsidePage: "PaymentHistory", minsideField: "paidDate", fieldDescription: "Dato for betaling", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Vise betalingsdato", minsideUrl: "/Shared/PaymentHistory" },

        // ── LostFound - Savnet/Funnet ──
        { minsidePage: "LostFound", minsideField: "markLost", fieldDescription: "Merk dyr som savnet", dataType: "write", actionType: "execute", hjelpesenterCategory: "Savnet/Funnet", intent: "ReportLostPet", chatbotCapability: "Utføre savnetmelding direkte", minsideUrl: "/OwnersPets/Owner/MyPetList" },
        { minsidePage: "LostFound", minsideField: "markFound", fieldDescription: "Merk dyr som funnet igjen", dataType: "write", actionType: "execute", hjelpesenterCategory: "Savnet/Funnet", intent: "ReportFoundPet", chatbotCapability: "Fjerne savnetstatus", minsideUrl: "/OwnersPets/Owner/MyPetList" },

        // ── QR/Tag - Aktivering ──
        { minsidePage: "QRActivation", minsideField: "tagId", fieldDescription: "QR-brikke ID for aktivering", dataType: "write", actionType: "execute", hjelpesenterCategory: "QR-brikke", intent: "QRTagActivation", chatbotCapability: "Aktivere QR-brikke på valgt dyr", minsideUrl: "/Tag/Activate" },
        { minsidePage: "QRActivation", minsideField: "petId", fieldDescription: "Dyr å koble QR-brikke til", dataType: "write", actionType: "execute", hjelpesenterCategory: "QR-brikke", intent: "QRTagActivation", chatbotCapability: "Koble QR-brikke til dyr", minsideUrl: "/Tag/Activate" },

        // ── Owner Info - Eierinfo ──
        { minsidePage: "OwnerProfile", minsideField: "name", fieldDescription: "Eiers fulle navn", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "LoginIssue", chatbotCapability: "Identifisere og hilse på bruker", minsideUrl: "/Account/Profile" },
        { minsidePage: "OwnerProfile", minsideField: "numberOfPets", fieldDescription: "Antall registrerte dyr", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Verifisere antall dyr", minsideUrl: "/Account/Profile" },

        // ── PetProfile - Dyreprofil (detaljer) ──
        { minsidePage: "PetProfile", minsideField: "status", fieldDescription: "Dyrets status (aktiv/avdød)", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "PetDeceased", chatbotCapability: "Sjekke om dyret er registrert som avdød", minsideUrl: "/OwnersPets/Pet/PetDetails" },
        { minsidePage: "PetProfile", minsideField: "searchable", fieldDescription: "Om dyret er søkbart i ID-søk", dataType: "read", actionType: "display", hjelpesenterCategory: "ID-søk", intent: "InactiveRegistration", chatbotCapability: "Sjekke søkbarhet-status", minsideUrl: "/OwnersPets/Pet/PetDetails" },

        // ── SmartTag ──
        { minsidePage: "SmartTag", minsideField: "tagConnection", fieldDescription: "Koble Smart Tag via Bluetooth", dataType: "write", actionType: "guide", hjelpesenterCategory: "Smart Tag", intent: "SmartTagActivation", chatbotCapability: "Veilede gjennom Smart Tag-oppsett (krever app)", minsideUrl: null },
        { minsidePage: "SmartTag", minsideField: "tagPosition", fieldDescription: "Siste kjente posisjon", dataType: "read", actionType: "guide", hjelpesenterCategory: "Smart Tag", intent: "SmartTagPosition", chatbotCapability: "Forklare posisjonering (krever app)", minsideUrl: null },

        // ── FamilySharing - Familiedeling ──
        { minsidePage: "FamilySharing", minsideField: "inviteEmail", fieldDescription: "E-post for familiedeling-invitasjon", dataType: "write", actionType: "guide", hjelpesenterCategory: "Familiedeling", intent: "FamilySharing", chatbotCapability: "Veilede gjennom deling (krever app/web)", minsideUrl: null },

        // ── PaymentHistory - Resterende felt ──
        { minsidePage: "PaymentHistory", minsideField: "paidBy", fieldDescription: "Hvem som betalte", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Vise betalers navn", minsideUrl: "/Shared/PaymentHistory" },
        { minsidePage: "PaymentHistory", minsideField: "paymentMethod", fieldDescription: "Betalingsmetode (kort, Vipps, etc.)", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Vise betalingsmetode", minsideUrl: "/Shared/PaymentHistory" },
        { minsidePage: "PaymentHistory", minsideField: "orderNumber", fieldDescription: "Ordrenummer for betaling", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Referere til ordrenr ved henvendelser", minsideUrl: "/Shared/PaymentHistory" },
        { minsidePage: "PaymentHistory", minsideField: "transactionDate", fieldDescription: "Transaksjonsdato", dataType: "read", actionType: "display", hjelpesenterCategory: "Min side", intent: "ViewMyPets", chatbotCapability: "Vise transaksjonsdato", minsideUrl: "/Shared/PaymentHistory" },

        // ── OwnerChange - Resterende felt ──
        { minsidePage: "OwnerChange", minsideField: "CountryId", fieldDescription: "Land for ny eier", dataType: "write", actionType: "execute", hjelpesenterCategory: "Eierskifte", intent: "OwnershipTransferWeb", chatbotCapability: "Samle inn land", minsideUrl: "/OwnerChange/OwnerSeller/ReportOwnerChange" },

        // ── ForeignRegistration - Utenlandsregistrering ──
        { minsidePage: "ForeignRegistration", minsideField: "foreignChipNumber", fieldDescription: "Utenlandsk chipnummer for registrering", dataType: "write", actionType: "guide", hjelpesenterCategory: "Utenlandsregistrering", intent: "ForeignRegistration", chatbotCapability: "Veilede gjennom registreringsprosess", minsideUrl: null },
      ];

      const count = await storage.seedMinsideFieldMappings(defaultMappings);
      const all = await storage.getMinsideFieldMappings();
      res.json({ success: true, inserted: count, total: all.length, mappings: all });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── RESPONSE TEMPLATES (AUTOSVAR) ─────────────────────────────
  app.get("/api/templates", async (_req, res) => {
    try {
      const templates = await storage.getResponseTemplates();
      res.json(templates);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/templates/active", async (_req, res) => {
    try {
      const templates = await storage.getActiveResponseTemplates();
      res.json(templates);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/templates/count", async (_req, res) => {
    try {
      const count = await storage.getResponseTemplateCount();
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/templates/fetch", async (_req, res) => {
    try {
      const { fetchTemplatesFromPureservice, mapTemplateToResponseTemplate } = await import("./integrations/pureservice-v3");

      const templates = await fetchTemplatesFromPureservice();
      let stored = 0;

      for (const template of templates) {
        const mapped = mapTemplateToResponseTemplate(template);
        await storage.upsertResponseTemplate(mapped);
        stored++;
      }

      res.json({
        success: true,
        fetched: templates.length,
        stored,
        message: `${stored} autosvar-maler hentet fra Pureservice og lagret med kategorimapping`,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── SEED TEST DATA ─────────────────────────────────────────────
  app.post("/api/training/seed-test-data", async (req, res) => {
    try {
      const count = req.body?.count || 100;
      const append = req.body?.append || false;
      const existing = await storage.getTrainingStats();
      if (existing.rawTickets > 0 && !append) {
        return res.status(400).json({ error: "Det finnes allerede tickets i databasen. Bruk append:true for å legge til flere, eller tøm først." });
      }
      const startOffset = append ? existing.rawTickets : 0;

      await ensurePriceCache();

      const categories = [
        "Min side", "Eierskifte", "Registrering", "QR Tag",
        "Smart Tag", "Abonnement", "Savnet/Funnet", "Familiedeling", "App"
      ];

      const ticketTemplates = [
        { cat: "Min side", subject: "Kan ikke logge inn", q: "Hei, jeg klarer ikke å logge inn på Min Side. Har prøvd flere ganger med BankID men får feilmelding.", a: "Hei! Prøv å tømme nettleserens cache og informasjonskapsler, og prøv igjen. Hvis det fortsatt ikke fungerer, prøv en annen nettleser." },
        { cat: "Min side", subject: "Glemt passord", q: "Jeg har glemt passordet mitt til Min Side. Hvordan kan jeg tilbakestille det?", a: "Du kan tilbakestille passordet ved å trykke på 'Glemt passord' på innloggingssiden. Du vil da motta en e-post med lenke for å opprette nytt passord." },
        { cat: "Min side", subject: "Oppdatere kontaktinfo", q: "Jeg har byttet telefonnummer og e-post. Hvordan oppdaterer jeg dette på Min Side?", a: "Logg inn på Min Side og gå til 'Min profil'. Der kan du oppdatere telefonnummer, e-post og adresse." },
        { cat: "Min side", subject: "Finner ikke dyret mitt", q: "Jeg har registrert katten min men finner den ikke på Min Side. Chipnummer er 578xxx.", a: "Jeg ser at registreringen er under behandling. Det kan ta opptil 24 timer. Sjekk igjen i morgen." },
        { cat: "Min side", subject: "Problemer med BankID", q: "BankID fungerer ikke når jeg prøver å logge inn. Får bare hvit skjerm.", a: "Dette kan skyldes at BankID-appen trenger oppdatering. Sjekk at du har siste versjon av BankID-appen installert." },
        { cat: "Eierskifte", subject: "Overføre eierskap av hund", q: "Jeg har solgt hunden min og trenger å overføre eierskapet til ny eier. Hvordan gjør jeg det?", a: "Gå til Min Side, finn dyret og velg 'Overfør eierskap'. Du trenger ny eiers personnummer. Begge parter må godkjenne overføringen." },
        { cat: "Eierskifte", subject: "Mottatt dyr - godkjenne overføring", q: "Jeg har kjøpt en katt og forrige eier har startet eierskifte. Hvordan godkjenner jeg?", a: "Du skal ha mottatt en e-post eller SMS med lenke for å godkjenne eierskiftet. Logg inn på Min Side for å fullføre." },
        { cat: "Eierskifte", subject: "Eierskifte avvist", q: "Eierskiftet ble avvist. Hva kan være grunnen?", a: "Eierskifte kan avvises hvis chipnummeret ikke stemmer, eller hvis ny eier ikke har bekreftet innen fristen på 14 dager. Start prosessen på nytt." },
        { cat: "Eierskifte", subject: "Arvet dyr etter dødsfall", q: "Min far har gått bort og etterlatt seg en hund. Hvordan overfører vi eierskapet?", a: "Ved dødsfall kan eierskifte gjøres ved å sende inn kopi av skifteattest og utfylt eierskifteskjema til oss per e-post." },
        { cat: "Eierskifte", subject: "Oppdretter - registrere valpekull", q: "Jeg er oppdretter og har et nytt valpekull. Hvordan registrerer jeg alle valpene og overfører til nye eiere?", a: "Som oppdretter kan du bruke bulkregistrering på Min Side. Gå til 'Mine dyr' > 'Registrer kull'. Eierskifte til nye eiere gjøres når valpene hentes." },
        { cat: "Registrering", subject: "Registrere ny katt", q: "Jeg har fått en kattunge og vil registrere den i DyreID. Katten er chippet hos veterinær.", a: `Logg inn på Min Side og velg 'Registrer nytt dyr'. Du trenger chipnummer (15 siffer), rase, farge og fødselsdato. Registreringsavgift er ${getPrice("registrering_ny")}.` },
        { cat: "Registrering", subject: "Betaling for registrering", q: "Jeg prøvde å registrere hunden min men betalingen gikk ikke gjennom. Hva gjør jeg?", a: "Prøv igjen med et annet betalingskort, eller velg Vipps som betalingsmetode. Hvis problemet vedvarer, ta kontakt med banken din." },
        { cat: "Registrering", subject: "Feil chipnummer registrert", q: "Veterinæren registrerte feil chipnummer på katten min. Kan dette rettes?", a: "Ja, be veterinæren sende oss en bekreftelse på riktig chipnummer med dyrets signalement. Vi oppdaterer registreringen." },
        { cat: "Registrering", subject: "Importert dyr fra utlandet", q: "Jeg har importert en hund fra Sverige. Hvordan registrerer jeg den i DyreID?", a: "Importerte dyr registreres på vanlig måte, men du må også laste opp EU-pass eller helsesertifikat. Chipnummeret må være ISO-standard." },
        { cat: "Registrering", subject: "Dobbeltregistrering", q: "Det ser ut som hunden min er registrert to ganger med ulike chipnumre. Kan dere rydde opp?", a: "Jeg kan se overlappende registreringer. Send oss chipnumrene og vi slår sammen registreringene til én." },
        { cat: "QR Tag", subject: "Aktivere QR-brikke", q: "Jeg har mottatt QR-brikken men vet ikke hvordan jeg aktiverer den. Kan dere hjelpe?", a: "Skann QR-koden på brikken med mobilkameraet. Du blir sendt til en aktiveringsside. Logg inn og koble brikken til dyret ditt." },
        { cat: "QR Tag", subject: "QR-brikke fungerer ikke", q: "QR-brikken min skannes ikke. Koden er slitt og uleselig.", a: "Vi sender deg en ny QR-brikke kostnadsfritt. Oppgi adressen din og dyrets chipnummer så sender vi ny brikke i posten." },
        { cat: "QR Tag", subject: "Bestille ekstra QR-brikke", q: "Kan jeg bestille en ekstra QR-brikke til halsbåndet? Har allerede én på selen.", a: `Ja! Gå til Min Side > 'Dine dyr' > velg dyret > 'Bestill QR-brikke'. Ekstra brikker koster ${getPrice("qr_brikke_ekstra")}.` },
        { cat: "QR Tag", subject: "QR-brikke viser feil dyr", q: "Når noen skanner QR-brikken vises feil dyr. Brikken var koblet til forrige hund.", a: "Gå til Min Side og koble brikken til riktig dyr under 'QR-brikker'. Du kan flytte brikken mellom dine registrerte dyr." },
        { cat: "QR Tag", subject: "Mistet QR-brikke", q: "Hunden min har mistet QR-brikken fra halsbåndet. Kan dere sende ny?", a: "Bestill ny QR-brikke via Min Side under 'Dine dyr'. Velg dyret og klikk 'Ny QR-brikke'. Den gamle deaktiveres automatisk." },
        { cat: "Smart Tag", subject: "Koble Smart Tag til app", q: "Jeg har kjøpt en Smart Tag men klarer ikke å koble den til DyreID-appen. Bluetooth finner den ikke.", a: "Sørg for at Bluetooth er aktivert og at du er innenfor 2 meters rekkevidde. Hold inne knappen på taggen i 5 sekunder til lyset blinker blått. Prøv deretter å koble på nytt i appen." },
        { cat: "Smart Tag", subject: "Smart Tag batteri", q: "Hvor lenge varer batteriet på Smart Tag? Og kan det byttes?", a: "Batteriet varer ca. 1 år ved normal bruk. Batteriet kan ikke byttes – du bestiller ny Smart Tag til redusert pris som eksisterende kunde." },
        { cat: "Smart Tag", subject: "GPS-posisjon unøyaktig", q: "Smart Tag viser feil posisjon for katten min. Den sier katten er 500 meter unna men den ligger her.", a: "Smart Tag bruker Bluetooth-nettverk, ikke GPS. Nøyaktigheten avhenger av andre brukere i nærheten. I tettbygde strøk er den mer presis." },
        { cat: "Smart Tag", subject: "Smart Tag-varsling", q: "Jeg får ikke varsler når katten går utenfor sonen jeg har satt opp.", a: "Sjekk at varsler er aktivert i DyreID-appen under Innstillinger > Varsler. Sjekk også at appen har tillatelse til å sende varsler i telefonens innstillinger." },
        { cat: "Smart Tag", subject: "Overføre Smart Tag til nytt dyr", q: "Kan jeg bruke Smart Tag fra gammel hund på ny valp?", a: "Ja, gå til Min Side > Smart Tags og velg 'Koble til annet dyr'. Taggen nullstilles og kobles til det nye dyret." },
        { cat: "Abonnement", subject: "Si opp abonnement", q: "Jeg ønsker å si opp abonnementet mitt. Hunden min har dessverre gått bort.", a: "Kondolerer. Jeg har sagt opp abonnementet med umiddelbar virkning og refundert gjenstående periode. Takk for at du var kunde." },
        { cat: "Abonnement", subject: "Endre abonnementstype", q: "Kan jeg oppgradere fra Basis til Premium-abonnement?", a: "Ja, gå til Min Side > Abonnement > 'Endre plan'. Differansen beregnes automatisk for gjenstående periode." },
        { cat: "Abonnement", subject: "Faktura ikke mottatt", q: "Jeg har ikke mottatt faktura for abonnementet. Betaler jeg via AvtaleGiro?", a: "Ditt abonnement betales via AvtaleGiro. Neste trekk er 15. mars. Du finner alle fakturaer under Min Side > Betalingshistorikk." },
        { cat: "Abonnement", subject: "Dobbeltbelastning", q: "Jeg er trukket dobbelt for abonnementet denne måneden. Kan dere sjekke?", a: "Jeg ser at det er trukket to ganger. Vi refunderer det ekstra beløpet innen 3-5 virkedager til kontoen din." },
        { cat: "Abonnement", subject: "Legge til flere dyr i abonnement", q: "Jeg har tre katter nå. Kan alle dekkes av samme abonnement?", a: `Med Familie-abonnementet til ${getPrice("abonnement_familie")}/mnd dekkes opptil 5 dyr. Gå til Min Side > Abonnement > 'Legg til dyr'.` },
        { cat: "Savnet/Funnet", subject: "Hund savnet", q: "Hunden min har rømt! Kan dere hjelpe meg å melde den savnet? Schæfer, hannhund, 4 år.", a: "Jeg har registrert hunden som savnet i systemet. Alle som skanner chipnummeret eller QR-brikken vil nå se at dyret er meldt savnet med ditt kontaktnummer." },
        { cat: "Savnet/Funnet", subject: "Funnet katt", q: "Jeg har funnet en katt i hagen min. Den har chip. Chipnr: 578xxxxxxxxx. Kan dere finne eier?", a: "Takk for at du melder inn! Jeg har kontaktet eier via SMS og e-post. De er informert om at katten er funnet hos deg." },
        { cat: "Savnet/Funnet", subject: "Oppdatere savnet-status", q: "Vi fant hunden vår igjen! Kan dere fjerne savnet-meldingen?", a: "Så bra! Jeg har oppdatert statusen. Dyret er ikke lenger registrert som savnet i systemet." },
        { cat: "Savnet/Funnet", subject: "Savnet katt lenge", q: "Katten har vært savnet i 3 måneder nå. Er det noen som har funnet den?", a: "Savnet-meldingen er fortsatt aktiv. Ingen har skannet chipnummeret ennå. Anbefaler å dele på Dyrebar.no og sosiale medier i tillegg." },
        { cat: "Savnet/Funnet", subject: "Funnet skadet dyr", q: "Jeg fant en skadet fugl med ring. Kan DyreID hjelpe?", a: "DyreID registrerer hunder og katter med chip. For fugler med ring, kontakt Stavanger Museum eller ringmerkingssentralen." },
        { cat: "Familiedeling", subject: "Dele tilgang med partner", q: "Kan min samboer også se dyret på sin Min Side? Vi eier hunden sammen.", a: "Ja! Gå til Min Side > 'Familiedeling' > 'Inviter familiemedlem'. Din samboer får lesetilgang til dyrets profil." },
        { cat: "Familiedeling", subject: "Fjerne familiemedlem", q: "Jeg og min eks har gått fra hverandre. Kan dere fjerne hans tilgang til katten?", a: "Gå til Min Side > Familiedeling og klikk 'Fjern' ved personens navn. Tilgangen fjernes umiddelbart." },
        { cat: "Familiedeling", subject: "Familiedeling for barn", q: "Kan barnet mitt (14 år) få egen tilgang til å se hundeprofilen?", a: "Barn under 16 kan ikke ha egen konto, men du kan dele via familiedeling. Barnet trenger ikke BankID – de får en invitasjonslenke." },
        { cat: "Familiedeling", subject: "Problemer med invitasjon", q: "Invitasjonen til familiedeling kommer ikke frem til min svigermor.", a: "Sjekk at e-postadressen er riktig stavet. Invitasjonen kan havne i søppelpost. Jeg sender en ny invitasjon nå." },
        { cat: "App", subject: "App krasjer ved oppstart", q: "DyreID-appen krasjer hver gang jeg åpner den etter siste oppdatering. iPhone 13.", a: "Prøv å slette appen og installere den på nytt fra App Store. Hvis det ikke hjelper, sjekk at du har iOS 16 eller nyere." },
        { cat: "App", subject: "Push-varsler fungerer ikke", q: "Jeg får ikke push-varsler fra appen selv om de er skrudd på.", a: "Gå til Innstillinger > DyreID > Varsler på telefonen og sjekk at alle varseltyper er aktivert. Logg ut og inn igjen i appen." },
        { cat: "App", subject: "Kan ikke laste ned appen", q: "Finner ikke DyreID-appen i Google Play Store. Har Samsung Galaxy.", a: "Appen heter 'DyreID - Norsk Dyreregister'. Sjekk at telefonen har Android 10 eller nyere. Prøv å søke 'DyreID'." },
        { cat: "App", subject: "Appen viser feil språk", q: "Appen viser alt på engelsk. Hvordan endrer jeg til norsk?", a: "Gå til Settings (Innstillinger) i appen og velg 'Language/Språk' > Norsk. Appen vil starte på nytt med norsk tekst." },
        { cat: "Min side", subject: "Slette konto", q: "Jeg ønsker å slette kontoen min hos DyreID. Hvordan gjør jeg det?", a: "Du kan be om kontosletting via Min Side > Innstillinger > 'Slett konto'. Merk at dyreregistreringene beholdes i det nasjonale registeret." },
        { cat: "Registrering", subject: "Registrere kanin", q: "Kan jeg registrere kaninen min i DyreID? Den er chippet.", a: "DyreID støtter registrering av hund, katt, hest og frettdyr. Kaniner kan dessverre ikke registreres i systemet per nå." },
        { cat: "Eierskifte", subject: "Eierskifte koster penger?", q: "Koster det noe å overføre eierskapet av en hund?", a: `Ja, eierskifte koster ${getPrice("eierskifte")}. Gebyret dekkes av selgeren. Ny eier må ha eller opprette en konto på Min Side.` },
        { cat: "Min side", subject: "To-faktor autentisering", q: "Kan jeg aktivere to-faktor autentisering på Min Side for ekstra sikkerhet?", a: "Min Side bruker BankID som innlogging, som allerede er to-faktor. Du trenger ikke aktivere noe ekstra." },
        { cat: "Savnet/Funnet", subject: "Stjålet hund", q: "Vi tror hunden vår er stjålet fra hagen. Kan dere hjelpe?", a: "Jeg har registrert dyret som savnet/mulig stjålet. Anbefaler å anmelde forholdet til politiet. Alle som skanner chipen vil se savnet-melding." },
        { cat: "Abonnement", subject: "Priser og pakker", q: "Hva koster de ulike abonnementene? Har to hunder.", a: `Basis: ${getPrice("abonnement_basis")}/mnd (1 dyr), Standard: ${getPrice("abonnement_standard")}/mnd (2 dyr), Familie: ${getPrice("abonnement_familie")}/mnd (opptil 5 dyr). Med to hunder anbefaler vi Standard.` },
      ];

      const tickets = [];
      for (let i = 0; i < count; i++) {
        const template = ticketTemplates[i % ticketTemplates.length];
        const variation = Math.floor(i / ticketTemplates.length);
        const daysAgo = Math.floor(Math.random() * 365) + 30;
        const closedDaysAgo = daysAgo - Math.floor(Math.random() * 7) - 1;

        tickets.push({
          ticketId: 10000 + startOffset + i,
          category: template.cat,
          categoryId: categories.indexOf(template.cat) + 1,
          subject: variation > 0 ? `${template.subject} (${variation + 1})` : template.subject,
          customerQuestion: template.q,
          agentAnswer: template.a,
          messages: [
            { from: "customer", body: template.q, direction: "incoming", createdDate: new Date(Date.now() - daysAgo * 86400000).toISOString() },
            { from: "agent", body: template.a, direction: "outgoing", createdDate: new Date(Date.now() - closedDaysAgo * 86400000).toISOString() },
          ],
          resolution: template.a,
          tags: template.cat,
          autoClosed: false,
          createdAt: new Date(Date.now() - daysAgo * 86400000),
          closedAt: new Date(Date.now() - closedDaysAgo * 86400000),
          processingStatus: "pending" as const,
        });
      }

      const batchSize = 25;
      let inserted = 0;
      for (let i = 0; i < tickets.length; i += batchSize) {
        const batch = tickets.slice(i, i + batchSize);
        try {
          await storage.insertRawTickets(batch);
          inserted += batch.length;
        } catch (e: any) {
          console.log(`Seed batch error: ${e.message}`);
        }
      }

      res.json({ success: true, inserted, total: count });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/training/test-combined", async (req, res) => {
    sseHeaders(res);
    const ticketLimit = req.body?.ticketLimit || 100;

    try {
      res.write(`data: ${JSON.stringify({ message: `Tilbakestiller opptil ${ticketLimit} tickets for testing...`, progress: 0 })}\n\n`);

      await db.execute(sql`
        UPDATE scrubbed_tickets 
        SET category_mapping_status = 'pending', analysis_status = 'pending',
            hjelpesenter_category = NULL, hjelpesenter_subcategory = NULL
        WHERE ticket_id IN (
          SELECT ticket_id FROM scrubbed_tickets LIMIT ${ticketLimit}
        )
      `);

      await db.execute(sql`
        DELETE FROM category_mappings WHERE ticket_id IN (
          SELECT ticket_id FROM scrubbed_tickets LIMIT ${ticketLimit}
        )
      `);
      await db.execute(sql`
        DELETE FROM intent_classifications WHERE ticket_id IN (
          SELECT ticket_id FROM scrubbed_tickets LIMIT ${ticketLimit}
        )
      `);
      await db.execute(sql`
        DELETE FROM resolution_patterns WHERE ticket_id IN (
          SELECT ticket_id FROM scrubbed_tickets LIMIT ${ticketLimit}
        )
      `);

      res.write(`data: ${JSON.stringify({ message: "Tickets tilbakestilt. Starter kombinert batch-analyse...", progress: 5 })}\n\n`);

      const runId = await storage.createTrainingRun("test_combined_batch", 0);

      const result = await runCombinedBatchAnalysis((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      }, ticketLimit);

      await storage.completeTrainingRun(runId, result.metrics.errors);

      const m = result.metrics;
      const summary = {
        done: true,
        metrics: m,
        summary: {
          tickets_processed: m.processedTickets,
          api_calls: m.apiCalls,
          elapsed_seconds: ((m.elapsedMs || 0) / 1000).toFixed(1),
          estimated_cost_usd: m.estimatedCostUsd.toFixed(4),
          tickets_per_api_call: m.apiCalls > 0 ? (m.processedTickets / m.apiCalls).toFixed(1) : "N/A",
          estimated_40k_hours: m.processedTickets > 0
            ? ((40000 / m.processedTickets) * ((m.elapsedMs || 0) / 1000) / 3600).toFixed(1)
            : "N/A",
          estimated_40k_cost_usd: m.processedTickets > 0
            ? ((40000 / m.processedTickets) * m.estimatedCostUsd).toFixed(2)
            : "N/A",
        },
      };

      res.write(`data: ${JSON.stringify(summary)}\n\n`);
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.post("/api/training/resume-combined", async (req, res) => {
    const ticketLimit = req.body?.ticketLimit || 50000;
    const runId = await storage.createTrainingRun("test_combined_batch", 0);
    res.json({ started: true, runId, ticketLimit });

    runCombinedBatchAnalysis((msg, pct) => {
      console.log(`[resume] ${pct}% - ${msg}`);
    }, ticketLimit).then(async (result) => {
      await storage.completeTrainingRun(runId, result.metrics.errors);
      console.log(`[resume] DONE: ${result.metrics.processedTickets} tickets, ${result.metrics.apiCalls} API calls`);
    }).catch((err) => {
      console.error(`[resume] ERROR: ${err.message}`);
    });
  });

  // ─── WORKFLOW 3C: HELP CENTER MATCHING ──────────────────────────────
  app.post("/api/training/match-articles", async (_req, res) => {
    sseHeaders(res);
    const runId = await storage.createTrainingRun("help_center_matching", 0);

    try {
      const result = await runHelpCenterMatching((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      });

      await storage.completeTrainingRun(runId, result.errors);

      res.write(`data: ${JSON.stringify({
        done: true,
        matched: result.matched,
        noMatch: result.noMatch,
        errors: result.errors,
      })}\n\n`);
    } catch (error: any) {
      await storage.completeTrainingRun(runId, 1, error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.get("/api/training/help-center-match-stats", async (_req, res) => {
    try {
      const stats = await storage.getHelpCenterMatchStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/training/help-center-matches", async (_req, res) => {
    try {
      const matches = await storage.getTicketHelpCenterMatches(200);
      res.json(matches);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── INFORMATIONAL PLAYBOOK POPULATION ──────────────────────────────
  app.post("/api/training/populate-infotext", async (_req, res) => {
    sseHeaders(res);
    const runId = await storage.createTrainingRun("infotext_population", 0);

    try {
      const result = await runInfoTextPopulation((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      });

      await storage.completeTrainingRun(runId, result.errors);

      res.write(`data: ${JSON.stringify({
        done: true,
        populated: result.populated,
        skipped: result.skipped,
        noArticle: result.noArticle,
        errors: result.errors,
      })}\n\n`);
    } catch (error: any) {
      await storage.completeTrainingRun(runId, 1, error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.post("/api/training/generate-keywords", async (_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    try {
      const result = await generateTemplateKeywords((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      });
      res.write(`data: ${JSON.stringify({ message: `Ferdig! ${result.updated} templates oppdatert`, progress: 100, done: true })}\n\n`);
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.post("/api/training/detect-autoreply", async (_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    try {
      const result = await runAutoReplyDetection((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      });
      res.write(`data: ${JSON.stringify({ message: `Ferdig! ${result.withAutoReply} av ${result.total} med autosvar`, progress: 100, done: true })}\n\n`);
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.get("/api/training/autoreply-stats", async (_req, res) => {
    try {
      const stats = await storage.getAutoreplyStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/training/analyze-dialog-patterns", async (_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    try {
      const result = await runDialogPatternAnalysis((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      });
      res.write(`data: ${JSON.stringify({ message: `Ferdig! ${result.total} tickets analysert`, progress: 100, done: true })}\n\n`);
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.get("/api/training/dialog-pattern-stats", async (_req, res) => {
    try {
      const stats = await storage.getDialogPatternStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/training/reclassify", async (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    try {
      const limit = req.body?.limit || 1000;
      const result = await runReclassification((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      }, limit);
      res.write(`data: ${JSON.stringify({ message: "Reklassifisering fullført", progress: 100, done: true, metrics: result.metrics })}\n\n`);
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.get("/api/training/reclassification-stats", async (_req, res) => {
    try {
      const stats = await storage.getReclassificationStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── OPPGAVE D: RESOLUSJONS-KVALITET ──────────────────────────────
  app.post("/api/training/assess-quality", async (_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    try {
      const result = await runQualityAssessment((msg, pct) => {
        res.write(`data: ${JSON.stringify({ message: msg, progress: pct })}\n\n`);
      });
      res.write(`data: ${JSON.stringify({ message: "Kvalitetsvurdering fullført", progress: 100, done: true, metrics: result.metrics })}\n\n`);
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  });

  app.get("/api/training/quality-stats", async (_req, res) => {
    try {
      const stats = await storage.getResolutionQualityStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── DOMAIN DISCOVERY PIPELINE ──────────────────────────────────
  app.post("/api/training/domain-discovery", async (_req, res) => {
    sseHeaders(res);
    const runId = await storage.createTrainingRun("domain_discovery", 0);

    try {
      const result = await runDomainDiscovery((msg, pct) => {
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

  app.get("/api/discovered-intents", async (_req, res) => {
    try {
      const intents = await storage.getDiscoveredIntents();
      res.json(intents);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/discovered-intents/:id/approve", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { approvedBy, suggestedIntent, actionable, category, resolutionSteps, requiredFields, actionEndpoint } = req.body;
      await storage.approveDiscoveredIntent(id, approvedBy || "admin", {
        suggestedIntent, actionable, category, resolutionSteps, requiredFields, actionEndpoint,
      });
      res.json({ success: true, message: "Intent godkjent" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/discovered-intents/:id/reject", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { reason } = req.body;
      await storage.rejectDiscoveredIntent(id, reason || "Avvist uten begrunnelse");
      res.json({ success: true, message: "Intent avvist" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/discovered-intents/:id/promote", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.promoteDiscoveredIntentToPlaybook(id);
      res.json({ success: true, message: "Intent promotert til playbook" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/canonical-intents", async (_req, res) => {
    try {
      const intents = await storage.getCanonicalIntents();
      res.json(intents);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/canonical-intents/approved", async (_req, res) => {
    try {
      const intents = await storage.getApprovedCanonicalIntents();
      res.json(intents);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/canonical-intents/stats", async (req, res) => {
    try {
      const all = await storage.getCanonicalIntents();
      const approved = all.filter(i => i.approved);
      const bySource: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      for (const i of all) {
        bySource[i.source] = (bySource[i.source] || 0) + 1;
        if (i.category) byCategory[i.category] = (byCategory[i.category] || 0) + 1;
      }
      res.json({
        total: all.length,
        approved: approved.length,
        pending: all.filter(i => !i.approved).length,
        actionable: all.filter(i => i.actionable).length,
        bySource,
        byCategory,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/canonical-intents/:intentId", async (req, res) => {
    try {
      const intent = await storage.getCanonicalIntentById(req.params.intentId);
      if (!intent) return res.status(404).json({ error: "Intent not found" });
      res.json(intent);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/canonical-intents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const allowedFields = ["category", "subcategory", "source", "actionable", "requiredFields", "endpoint", "infoText", "approved", "keywords", "description"];
      const update: Record<string, any> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) update[key] = req.body[key];
      }
      await storage.updateCanonicalIntent(id, update);

      const embeddingRelevantFields = ["category", "subcategory", "description", "keywords", "infoText"];
      const needsReEmbed = embeddingRelevantFields.some(f => update[f] !== undefined);
      if (needsReEmbed || update.approved !== undefined) {
        const allIntents = await storage.getCanonicalIntents();
        const intent = allIntents.find(i => i.id === id);
        if (intent) {
          await generateAndStoreEmbedding(intent.intentId);
        }
        await refreshIntentIndex();
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/canonical-intents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteCanonicalIntent(id);
      await refreshIntentIndex();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/canonical-intents/seed", async (_req, res) => {
    try {
      const { seedCanonicalIntents } = await import("./canonical-intents");
      const result = await seedCanonicalIntents();

      try {
        const loadedCount = await refreshIntentIndex();
        console.log(`[IntentIndex] Index refreshed after seed – ${loadedCount} intents loaded`);
      } catch (refreshErr: any) {
        console.error(`[IntentIndex] ERROR: Index refresh failed after seed: ${refreshErr.message}`);
      }

      const { validateAndAlignCanonicalIntents } = await import("./chatbot");
      const alignment = await validateAndAlignCanonicalIntents();

      res.json({ success: true, ...result, alignment });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/canonical-intents/align-runtime", async (_req, res) => {
    try {
      const { validateAndAlignCanonicalIntents } = await import("./chatbot");
      const result = await validateAndAlignCanonicalIntents();
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/discovered-clusters", async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const clusters = await storage.getDiscoveredClusters(runId);
      res.json(clusters);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/discovered-clusters/:id/promote", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const clusters = await storage.getDiscoveredClusters();
      const cluster = clusters.find(c => c.id === id);
      if (!cluster) return res.status(404).json({ error: "Cluster not found" });
      if (cluster.status === "promoted") return res.status(400).json({ error: "Cluster er allerede promotert" });

      const intentId = cluster.suggestedIntent || cluster.clusterId;

      const existing = await storage.getCanonicalIntentById(intentId);
      if (existing) return res.status(400).json({ error: `Intent "${intentId}" finnes allerede i canonical registry` });

      await storage.upsertCanonicalIntent({
        intentId,
        category: cluster.category || "Ukategorisert",
        source: "DISCOVERED",
        actionable: cluster.actionable || false,
        approved: false,
        description: cluster.description || undefined,
        keywords: Array.isArray(cluster.topKeywords) ? (cluster.topKeywords as string[]).join(", ") : undefined,
      });

      await db.update(discoveredClusters)
        .set({ status: "promoted" })
        .where(eq(discoveredClusters.id, id));

      await generateAndStoreEmbedding(intentId);
      await refreshIntentIndex();

      res.json({ success: true, intentId, message: "Cluster promotert til canonical intent (venter på godkjenning)" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/pilot/enable", async (_req, res) => {
    try {
      const { enablePilot } = await import("./pilot-stats");
      enablePilot();
      res.json({ success: true, message: "Pilot mode enabled" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/pilot/disable", async (_req, res) => {
    try {
      const { disablePilot } = await import("./pilot-stats");
      disablePilot();
      res.json({ success: true, message: "Pilot mode disabled" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/pilot/report", async (_req, res) => {
    try {
      const { getPilotReport } = await import("./pilot-stats");
      const report = getPilotReport();
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/reports/pureservice-1000", async (_req, res) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const filePath = path.default.join(process.cwd(), "client", "public", "reports", "pureservice-1000-cases-report.json");
      if (!fs.default.existsSync(filePath)) {
        return res.status(404).json({ error: "Report not found" });
      }
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=pureservice-1000-cases-report.json");
      const fileStream = fs.default.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/reports/consolidation-proposal", async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { intentClassifications, scrubbedTickets, canonicalIntents, playbookEntries } = await import("@shared/schema");
      const { eq, sql, and, isNotNull } = await import("drizzle-orm");

      const unmappedRows = await db
        .select({
          intent: intentClassifications.intent,
          ticketId: intentClassifications.ticketId,
          confidence: intentClassifications.intentConfidence,
          keywords: intentClassifications.keywords,
          autoClose: intentClassifications.autoClosePossible,
          paymentRequired: intentClassifications.paymentRequired,
          requiredAction: intentClassifications.requiredAction,
          subject: scrubbedTickets.subject,
          question: scrubbedTickets.customerQuestion,
        })
        .from(intentClassifications)
        .innerJoin(scrubbedTickets, eq(scrubbedTickets.ticketId, intentClassifications.ticketId))
        .where(eq(intentClassifications.isNewIntent, true));

      const canonicals = await db
        .select()
        .from(canonicalIntents)
        .where(eq(canonicalIntents.approved, true));

      const playbook = await db
        .select({
          intent: playbookEntries.intent,
          endpoint: playbookEntries.primaryEndpoint,
          action: playbookEntries.primaryAction,
        })
        .from(playbookEntries)
        .where(isNotNull(playbookEntries.primaryEndpoint));

      const endpointMap = new Map<string, string>();
      for (const p of playbook) {
        if (p.endpoint) endpointMap.set(p.intent, p.endpoint);
      }

      const canonicalMap = new Map<string, typeof canonicals[0]>();
      for (const c of canonicals) canonicalMap.set(c.intentId, c);

      const clusterMap = new Map<string, typeof unmappedRows>();
      for (const row of unmappedRows) {
        const intent = row.intent as string;
        const list = clusterMap.get(intent) || [];
        list.push(row);
        clusterMap.set(intent, list);
      }

      const computeSimilarity = (variantName: string, canonicalId: string, canonicalKeywords: string | null): { score: number; method: string } => {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const v = norm(variantName);
        const c = norm(canonicalId);

        if (v === c) return { score: 1.0, method: "exact" };

        const vTokens = variantName.replace(/([A-Z])/g, ' $1').toLowerCase().trim().split(/\s+/);
        const cTokens = canonicalId.replace(/([A-Z])/g, ' $1').toLowerCase().trim().split(/\s+/);
        const overlap = vTokens.filter(t => cTokens.includes(t)).length;
        const union = new Set([...vTokens, ...cTokens]).size;
        const nameJaccard = union > 0 ? overlap / union : 0;

        let keywordBoost = 0;
        if (canonicalKeywords) {
          const ckw = canonicalKeywords.toLowerCase().split(',').map(k => k.trim());
          const matchedKw = vTokens.filter(t => ckw.some(k => k.includes(t)));
          keywordBoost = matchedKw.length > 0 ? 0.15 : 0;
        }

        if (v.includes(c) || c.includes(v)) {
          return { score: Math.min(0.95, 0.85 + keywordBoost), method: "substring" };
        }

        const score = Math.min(0.99, nameJaccard * 0.7 + keywordBoost + (nameJaccard > 0.3 ? 0.15 : 0));
        return { score: parseFloat(score.toFixed(3)), method: nameJaccard > 0.5 ? "semantic" : "keyword" };
      }

      interface MapCandidate {
        discovered_intent_name: string;
        count: number;
        avg_confidence: number;
        suggested_canonical_intent: string;
        similarityScore: number;
        matchMethod: string;
        risk_flag: boolean;
        risk_reason: string | null;
        example_questions: string[];
        example_ticket_ids: number[];
      }

      interface NewCanonicalCandidate {
        proposed_intentId: string;
        cluster_size: number;
        variant_labels: string[];
        top_keywords: string[];
        example_questions: string[];
        example_ticket_ids: number[];
        suggested_category: string;
        suggested_subcategory: string;
        type: "informational" | "transactional";
        has_endpoint: "ja" | "nei" | "TODO";
        avg_confidence: number;
        auto_closeable_pct: number;
      }

      const semanticGroups: Record<string, string[]> = {
        "AppLanguageSettings": ["AppLanguage", "AppChangeLanguage", "AppLanguageChange", "AppLanguageSetting", "AppSettings"],
        "AppPushNotificationIssue": ["AppPushNotifications", "AppNotifications", "PushNotifications", "PushNotificationsIssue", "PushNotificationIssue"],
        "SmartTagBatteryInfo": ["SmartTagBattery", "SmartTagBatteryInfo"],
        "SmartTagNotificationIssue": ["SmartTagNotifications"],
        "SubscriptionUpgrade": ["SubscriptionUpgrade", "UpgradeSubscription", "SubscriptionChange"],
        "AddPetToSubscription": ["AddPetsToSubscription", "AddPetToSubscription", "SubscriptionAddPet", "AddAnimalsToSubscription", "AddMorePetsToSubscription", "SubscriptionCoverage"],
        "AppCrashReport": ["AppCrash", "AppCrashOnStartup"],
        "DoubleChargeRefund": ["DoubleChargeRefund", "BillingRefund", "BillingDoubleCharge", "DoubleCharge", "DuplicateChargeRefund", "PaymentRefund", "RefundDoubleCharge", "RefundRequest", "SubscriptionRefund", "SubscriptionDoubleCharge", "SubscriptionDoubleCharge_Refund"],
        "InvoiceInquiry": ["BillingInquiry", "CheckPaymentMethod", "SubscriptionBilling", "InvoiceQuery", "InvoiceQuery_AvtaleGiro", "InvoiceNotReceived", "PaymentInquiry", "PaymentMethodInquiry"],
        "DuplicateRegistrationMerge": ["MergeDuplicateRegistrations", "DuplicateRegistration", "DuplicateRegistrationMerge", "MergeRegistrations"],
        "UpdateChipRecord": ["UpdateChipNumber", "CorrectRegisteredChip", "ChipReplacement", "RegistrationCorrection"],
        "SmartTagTransferPet": ["SmartTagTransfer", "SmartTagReassign", "SmartTagTransferToNewPet", "SmartTagTransferToAnotherPet"],
        "QRTagOrderExtra": ["QRTagOrder", "OrderExtraQRTag", "OrderExtraQR", "QROrder_ExtraTag", "QRTagOrderExtra", "QRTagPurchase", "QRTagPurchaseInfo"],
        "NonSupportedSpeciesHelp": ["NonSupportedSpeciesInquiry", "NonSupportedSpecies", "FoundNonSupportedSpecies", "FoundNonSupportedAnimal", "FoundNonDogCat", "FoundOtherSpecies", "NewRegistration_SpeciesUnsupported"],
        "QRTagReplaceDamaged": ["QRTagReplacement", "QRTagReplace", "QRTagDamaged"],
        "RegistrationPaymentFailure": ["RegistrationPaymentIssue", "RegistrationPaymentFailure", "PaymentFailureRegistration", "PaymentFailureDuringRegistration", "PaymentIssue"],
        "TwoFactorAuthInfo": ["TwoFactorAuth", "TwoFactorAuthQuestion", "TwoFactorInfo", "TwoFactorQuery"],
        "FamilyAccessRemoval": ["FamilyAccessRemoval", "FamilyAccessRemove", "RemoveFamilyMember"],
        "LostPetStatusCheck": ["LostPetStatus", "LostStatusCheck", "LostFoundResolved", "LostFoundStatusInquiry"],
        "QRTagReassignPet": ["QRTagReassign", "QRReassignTag", "QRAssignCorrection", "QRTagRelink"],
        "CancelSubscriptionDeceased": ["CancelSubscription", "CancelSubscriptionDueToDeceasedPet"],
        "PasswordResetHelp": ["PasswordReset"],
        "BreederLitterRegistration": ["BreederRegisterLitter"],
      };

      const mapToExistingCandidates: Record<string, string> = {
        "AppLanguageSettings": "AppLoginIssue",
        "AppCrashReport": "AppLoginIssue",
        "DoubleChargeRefund": "SubscriptionComparison",
        "InvoiceInquiry": "SubscriptionComparison",
        "DuplicateRegistrationMerge": "RegistrationError",
        "UpdateChipRecord": "RegistrationError",
        "CancelSubscriptionDeceased": "PetDeceased",
        "PasswordResetHelp": "LoginProblem",
        "LostPetStatusCheck": "ReportLostPet",
        "FamilyAccessRemoval": "FamilySharing",
        "QRTagReplaceDamaged": "QRTagLost",
        "QRTagReassignPet": "QRTagActivation",
      };

      const newCandidateConfig: Record<string, { category: string; subcategory: string; type: "informational" | "transactional" }> = {
        "SmartTagNotificationIssue": { category: "Smart Tag", subcategory: "Varsler fra Smart Tag", type: "informational" },
        "SmartTagBatteryInfo": { category: "Smart Tag", subcategory: "Batteri og levetid", type: "informational" },
        "SubscriptionUpgrade": { category: "Abonnement", subcategory: "Oppgradere abonnement", type: "transactional" },
        "AddPetToSubscription": { category: "Abonnement", subcategory: "Legge til dyr i abonnement", type: "transactional" },
        "AppPushNotificationIssue": { category: "DyreID-appen", subcategory: "Push-varsler feilsøking", type: "informational" },
        "SmartTagTransferPet": { category: "Smart Tag", subcategory: "Overføre Smart Tag til nytt dyr", type: "transactional" },
        "QRTagOrderExtra": { category: "QR-brikke", subcategory: "Bestille ekstra QR-brikke", type: "transactional" },
        "NonSupportedSpeciesHelp": { category: "ID-søk", subcategory: "Funnet dyr utenfor register", type: "informational" },
        "RegistrationPaymentFailure": { category: "Registrering", subcategory: "Betalingsfeil ved registrering", type: "transactional" },
        "TwoFactorAuthInfo": { category: "Min Side", subcategory: "To-faktor autentisering", type: "informational" },
        "BreederLitterRegistration": { category: "Registrering", subcategory: "Oppdretter valpekull", type: "transactional" },
        "AppLanguageSettings": { category: "DyreID-appen", subcategory: "Språkinnstillinger", type: "informational" },
      };

      const mapToExisting: MapCandidate[] = [];
      const newCandidates: NewCanonicalCandidate[] = [];

      for (const [groupId, variants] of Object.entries(semanticGroups)) {
        let allRows: typeof unmappedRows = [];
        for (const v of variants) {
          const rows = clusterMap.get(v);
          if (rows) allRows = allRows.concat(rows);
        }
        if (allRows.length === 0) continue;

        const targetCanonical = mapToExistingCandidates[groupId];
        const isNewCandidate = !targetCanonical || newCandidateConfig[groupId];

        if (targetCanonical && !newCandidateConfig[groupId]) {
          const canonical = canonicalMap.get(targetCanonical);
          const sim = computeSimilarity(groupId, targetCanonical, canonical?.keywords || null);

          const uniqueQuestions: string[] = [];
          const uniqueIds: number[] = [];
          const seen = new Set<string>();
          for (const r of allRows) {
            const q = r.question || r.subject || '';
            const short = q.substring(0, 80);
            if (!seen.has(short) && uniqueQuestions.length < 5) {
              seen.add(short);
              uniqueQuestions.push(q);
              uniqueIds.push(r.ticketId);
            }
          }

          for (const v of variants) {
            const vRows = clusterMap.get(v);
            if (!vRows || vRows.length === 0) continue;
            const avgConf = vRows.reduce((s, r) => s + (r.confidence ?? 0), 0) / vRows.length;
            const vSim = computeSimilarity(v, targetCanonical, canonical?.keywords || null);

            mapToExisting.push({
              discovered_intent_name: v,
              count: vRows.length,
              avg_confidence: parseFloat(avgConf.toFixed(3)),
              suggested_canonical_intent: targetCanonical,
              similarityScore: vSim.score,
              matchMethod: vSim.method,
              risk_flag: vSim.score >= 0.70 && vSim.score <= 0.78,
              risk_reason: vSim.score >= 0.70 && vSim.score <= 0.78 ? `Mellomsone-score ${vSim.score}: manuell verifisering anbefales` : null,
              example_questions: uniqueQuestions.slice(0, 3),
              example_ticket_ids: uniqueIds.slice(0, 3),
            });
          }
        }

        if (newCandidateConfig[groupId]) {
          const config = newCandidateConfig[groupId];
          const avgConf = allRows.reduce((s, r) => s + (r.confidence ?? 0), 0) / allRows.length;
          const autoCloseCount = allRows.filter(r => r.autoClose).length;

          const allKw = allRows.flatMap(r => (r.keywords || '').split(',').map(k => k.trim().toLowerCase())).filter(Boolean);
          const kwFreq = new Map<string, number>();
          for (const kw of allKw) kwFreq.set(kw, (kwFreq.get(kw) || 0) + 1);
          const topKeywords = Array.from(kwFreq.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([k]) => k);

          const uniqueQuestions: string[] = [];
          const uniqueIds: number[] = [];
          const seen = new Set<string>();
          for (const r of allRows) {
            const q = r.question || r.subject || '';
            const short = q.substring(0, 80);
            if (!seen.has(short) && uniqueQuestions.length < 5) {
              seen.add(short);
              uniqueQuestions.push(q);
              uniqueIds.push(r.ticketId);
            }
          }

          const hasEndpoint = endpointMap.has(groupId) ? "ja" : (config.type === "transactional" ? "TODO" : "nei");

          newCandidates.push({
            proposed_intentId: groupId,
            cluster_size: allRows.length,
            variant_labels: variants.filter(v => clusterMap.has(v)),
            top_keywords: topKeywords,
            example_questions: uniqueQuestions,
            example_ticket_ids: uniqueIds,
            suggested_category: config.category,
            suggested_subcategory: config.subcategory,
            type: config.type,
            has_endpoint: hasEndpoint,
            avg_confidence: parseFloat(avgConf.toFixed(3)),
            auto_closeable_pct: parseFloat(((autoCloseCount / allRows.length) * 100).toFixed(1)),
          });
        }
      }

      mapToExisting.sort((a, b) => b.count - a.count);
      newCandidates.sort((a, b) => b.cluster_size - a.cluster_size);

      const totalUnmappedTickets = unmappedRows.length;
      const totalUniqueVariants = clusterMap.size;
      const coveredByMap = mapToExisting.reduce((s, c) => s + c.count, 0);
      const coveredByNew = newCandidates.reduce((s, c) => s + c.cluster_size, 0);

      const report = {
        report_type: "Fragmentation Consolidation Proposal",
        generated_at: new Date().toISOString(),
        status: "READ_ONLY — Ingen auto-merge. Krever manuell godkjenning.",
        summary: {
          total_unmapped_tickets: totalUnmappedTickets,
          total_unique_ai_labels: totalUniqueVariants,
          existing_canonical_intents: canonicals.length,
          map_to_existing_candidates: mapToExisting.length,
          new_canonical_candidates: newCandidates.length,
          tickets_covered_by_mapping: coveredByMap,
          tickets_covered_by_new_canonicals: coveredByNew,
          tickets_remaining_uncovered: totalUnmappedTickets - coveredByMap - coveredByNew,
          risk_flagged_mappings: mapToExisting.filter(c => c.risk_flag).length,
        },
        A_MAP_TO_EXISTING: mapToExisting,
        B_NEW_CANONICAL_CANDIDATES: newCandidates,
        notes: [
          "Alle similarityScore er beregnet via navnlikhet (Jaccard + substring + keyword-boost). Score 0.70–0.78 flagges som mellomsone og krever manuell verifisering.",
          "Ingen endringer gjøres i databasen. Denne rapporten er kun et forslag til konsolidering.",
          "Etter godkjenning vil varianter merkes med canonical_intent_id og is_new_intent settes til false.",
          "NEW_CANONICAL_CANDIDATES med type 'transactional' og has_endpoint='TODO' trenger endepunkt-utvikling før produksjon.",
        ],
      };

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=fragmentation-consolidation-proposal.json");
      res.json(report);
    } catch (error: any) {
      console.error("Consolidation report error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/health", async (req, res) => {
    try {
      const periodMonths = parseInt(req.query.period as string) || 12;
      const now = new Date();
      const cutoff = new Date(now);
      if (periodMonths < 999) {
        cutoff.setMonth(cutoff.getMonth() - periodMonths);
      } else {
        cutoff.setFullYear(2000);
      }
      const cutoffStr = cutoff.toISOString();

      const scrubbedTotal = await db.execute(sql`
        SELECT count(*) as total,
          count(*) FILTER (WHERE auto_closed = true) as auto_closed,
          count(*) FILTER (WHERE auto_closed = false OR auto_closed IS NULL) as agent_handled,
          count(*) FILTER (WHERE total_message_count <= 1 AND auto_closed = true) as auto_resolved_strict
        FROM scrubbed_tickets WHERE scrubbed_at >= ${cutoffStr}::timestamp
      `);
      const st = scrubbedTotal.rows[0] || { total: 0, auto_closed: 0, agent_handled: 0, auto_resolved_strict: 0 };

      const coverageQuery = await db.execute(sql`
        SELECT 
          count(*) as total,
          count(*) FILTER (WHERE ci.intent_id IS NOT NULL) as mapped_to_canonical,
          count(*) FILTER (WHERE ci.intent_id IS NULL) as unmapped
        FROM intent_classifications ic
        LEFT JOIN canonical_intents ci ON ci.intent_id = ic.intent AND ci.approved = true
        WHERE ic.classified_at >= ${cutoffStr}::timestamp
      `);
      const cov = coverageQuery.rows[0] || { total: 0, mapped_to_canonical: 0, unmapped: 0 };

      const intentBreakdown = await db.execute(sql`
        SELECT 
          ic.intent,
          count(*) as total,
          count(*) FILTER (WHERE st.auto_closed = true) as auto_resolved,
          count(*) FILTER (WHERE st.auto_closed = false OR st.auto_closed IS NULL) as agent_handled,
          avg(ic.intent_confidence) as avg_confidence,
          count(*) FILTER (WHERE ic.auto_close_possible = true) as auto_close_possible,
          CASE WHEN ci.intent_id IS NOT NULL THEN true ELSE false END as is_canonical
        FROM intent_classifications ic
        LEFT JOIN scrubbed_tickets st ON ic.ticket_id = st.ticket_id
        LEFT JOIN canonical_intents ci ON ci.intent_id = ic.intent AND ci.approved = true
        WHERE ic.classified_at >= ${cutoffStr}::timestamp
        GROUP BY ic.intent, ci.intent_id
        ORDER BY count(*) DESC
      `);

      const canonicalTotal = await db.execute(sql`
        SELECT count(*) as total,
          count(*) FILTER (WHERE approved = true) as approved
        FROM canonical_intents
      `);
      const ct = canonicalTotal.rows[0] || { total: 0, approved: 0 };

      const playbookTotal = await db.execute(sql`
        SELECT count(*) as total,
          count(*) FILTER (WHERE is_active = true) as active,
          sum(total_uses) as total_uses,
          sum(successful_resolutions) as successful,
          sum(failed_resolutions) as failed
        FROM playbook_entries
      `);
      const pt = playbookTotal.rows[0] || { total: 0, active: 0, total_uses: 0, successful: 0, failed: 0 };

      const playbookPerIntent = await db.execute(sql`
        SELECT 
          pe.intent,
          pe.ticket_count,
          pe.auto_close_probability,
          pe.total_uses,
          pe.successful_resolutions,
          pe.failed_resolutions,
          pe.success_rate,
          pe.avg_resolution_quality,
          pe.avg_messages_after_autoreply,
          pe.is_active
        FROM playbook_entries pe
        WHERE pe.is_active = true
        ORDER BY pe.ticket_count DESC
      `);

      const chatbotTotal = await db.execute(sql`
        SELECT count(*) as total,
          count(DISTINCT matched_intent) as unique_intents,
          count(*) FILTER (WHERE matched_intent IS NOT NULL AND matched_intent != '') as matched,
          count(*) FILTER (WHERE matched_intent IS NULL OR matched_intent = '') as fallback,
          count(*) FILTER (WHERE flagged_for_review = true) as flagged,
          count(*) FILTER (WHERE feedback_result = 'positive') as positive_feedback,
          count(*) FILTER (WHERE feedback_result = 'negative') as negative_feedback
        FROM chatbot_interactions WHERE created_at >= ${cutoffStr}::timestamp
      `);
      const cbt = chatbotTotal.rows[0] || { total: 0, unique_intents: 0, matched: 0, fallback: 0, flagged: 0 };

      const escalationQuery = await db.execute(sql`
        SELECT 
          count(*) as total,
          count(*) FILTER (WHERE flagged_for_review = true) as flagged,
          count(*) FILTER (WHERE response_method = 'block' OR response_method = 'escalation') as blocked
        FROM chatbot_interactions WHERE created_at >= ${cutoffStr}::timestamp
      `);
      const esc = escalationQuery.rows[0] || { total: 0, flagged: 0, blocked: 0 };

      const categoryDist = await db.execute(sql`
        SELECT 
          COALESCE(st.hjelpesenter_category, 'Ukategorisert') as category,
          count(*) as total,
          count(*) FILTER (WHERE st.auto_closed = true) as auto_resolved
        FROM scrubbed_tickets st
        WHERE st.scrubbed_at >= ${cutoffStr}::timestamp
        GROUP BY st.hjelpesenter_category
        ORDER BY count(*) DESC
      `);

      const chatbotByIntent = await db.execute(sql`
        SELECT 
          COALESCE(matched_intent, 'Uklassifisert') as intent,
          count(*) as total,
          count(*) FILTER (WHERE feedback_result = 'positive') as positive,
          count(*) FILTER (WHERE feedback_result = 'negative') as negative,
          count(*) FILTER (WHERE flagged_for_review = true) as flagged,
          count(*) FILTER (WHERE response_method = 'block' OR response_method = 'escalation') as blocked
        FROM chatbot_interactions
        WHERE created_at >= ${cutoffStr}::timestamp
        GROUP BY matched_intent
        ORDER BY count(*) DESC
        LIMIT 30
      `);

      const trendMonthly = await db.execute(sql`
        SELECT 
          date_trunc('month', created_at)::date as month,
          count(*) as total,
          count(*) FILTER (WHERE matched_intent IS NOT NULL AND matched_intent != '') as matched,
          count(*) FILTER (WHERE matched_intent IS NULL OR matched_intent = '') as fallback,
          count(*) FILTER (WHERE flagged_for_review = true) as flagged,
          count(*) FILTER (WHERE response_method = 'block' OR response_method = 'escalation') as blocked
        FROM chatbot_interactions
        WHERE created_at >= ${cutoffStr}::timestamp
        GROUP BY date_trunc('month', created_at)
        ORDER BY month
      `);

      const trendDaily = await db.execute(sql`
        SELECT 
          date_trunc('day', created_at)::date as day,
          count(*) as total,
          count(*) FILTER (WHERE matched_intent IS NOT NULL AND matched_intent != '') as matched,
          count(*) FILTER (WHERE matched_intent IS NULL OR matched_intent = '') as fallback
        FROM chatbot_interactions
        WHERE created_at >= ${cutoffStr}::timestamp
        GROUP BY date_trunc('day', created_at)
        ORDER BY day
      `);

      const totalTickets = Number(st.total) || 0;
      const autoResolvedStrict = Number(st.auto_resolved_strict) || 0;
      const autoResolved = Number(st.auto_closed) || 0;
      const autoResolutionRate = totalTickets > 0 ? autoResolvedStrict / totalTickets : 0;

      const covTotal = Number(cov.total) || 0;
      const covMapped = Number(cov.mapped_to_canonical) || 0;
      const coverageScore = covTotal > 0 ? covMapped / covTotal : 0;

      const chatbotTotalN = Number(cbt.total) || 0;
      const chatbotMatched = Number(cbt.matched) || 0;
      const chatbotFallback = Number(cbt.fallback) || 0;

      const escTotal = Number(esc.total) || 0;
      const escFlagged = Number(esc.flagged) || 0;
      const escBlocked = Number(esc.blocked) || 0;
      const escalationRate = escTotal > 0 ? (escFlagged + escBlocked) / escTotal : 0;

      const reopenRate = 0;

      const healthScore = Math.round(
        (0.35 * Math.min(autoResolutionRate, 1)) * 100 +
        (0.25 * (1 - Math.min(reopenRate, 1))) * 100 +
        (0.20 * Math.min(coverageScore, 1)) * 100 +
        (0.20 * (1 - Math.min(escalationRate, 1))) * 100
      );

      const wilsonCI = (successes: number, n: number, z: number = 1.96): { lower: number; upper: number; margin: number } => {
        if (n === 0) return { lower: 0, upper: 0, margin: 0 };
        const p = successes / n;
        const denominator = 1 + z * z / n;
        const center = (p + z * z / (2 * n)) / denominator;
        const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denominator;
        const lower = Math.max(0, center - spread);
        const upper = Math.min(1, center + spread);
        return {
          lower: Math.round(lower * 1000) / 10,
          upper: Math.round(upper * 1000) / 10,
          margin: Math.round(spread * 1000) / 10,
        };
      }

      const ciAutoResolution = wilsonCI(autoResolvedStrict, totalTickets);
      const ciCoverage = wilsonCI(covMapped, covTotal);
      const ciEscalation = wilsonCI(escFlagged + escBlocked, escTotal);

      const baseline = {
        sampleSize: 200,
        healthScore: 58,
        autoResolutionRate: 0,
        coverageScore: 64.6,
        escalationRate: 0,
        coverageMapped: 128,
        coverageTotal: 198,
      };

      const delta = {
        healthScore: healthScore - baseline.healthScore,
        autoResolutionRate: Math.round(autoResolutionRate * 1000) / 10 - baseline.autoResolutionRate,
        coverageScore: Math.round(coverageScore * 1000) / 10 - baseline.coverageScore,
        escalationRate: Math.round(escalationRate * 1000) / 10 - baseline.escalationRate,
        sampleSize: totalTickets - baseline.sampleSize,
      };

      res.json({
        period: periodMonths,
        healthScore,
        confidenceIntervals: {
          autoResolution: ciAutoResolution,
          coverage: ciCoverage,
          escalation: ciEscalation,
        },
        baseline,
        delta,
        breakdown: {
          autoResolution: { rate: autoResolutionRate, score: Math.round(autoResolutionRate * 100), weight: 0.35 },
          reopenRate: { rate: reopenRate, score: Math.round((1 - reopenRate) * 100), weight: 0.25, note: "Reopen-data ikke tilgjengelig ennå" },
          coverage: { rate: coverageScore, score: Math.round(coverageScore * 100), weight: 0.20 },
          escalation: { rate: escalationRate, score: Math.round((1 - escalationRate) * 100), weight: 0.20 },
        },
        kpi: {
          totalTickets,
          autoResolved,
          autoResolvedStrict: autoResolvedStrict,
          agentHandled: Number(st.agent_handled) || 0,
          autoResolutionRate: Math.round(autoResolutionRate * 1000) / 10,
          coverageScore: Math.round(coverageScore * 1000) / 10,
          coverageMapped: covMapped,
          coverageTotal: covTotal,
          escalationRate: Math.round(escalationRate * 1000) / 10,
          escalationCount: escFlagged + escBlocked,
          reopenRate: 0,
          canonicalIntents: Number(ct.approved) || 0,
          canonicalTotal: Number(ct.total) || 0,
          playbookEntries: Number(pt.active) || 0,
          playbookTotalUses: Number(pt.total_uses) || 0,
          playbookSuccessful: Number(pt.successful) || 0,
          chatbotTotal: chatbotTotalN,
          chatbotMatched,
          chatbotFallback,
          chatbotFlagged: Number(cbt.flagged) || 0,
        },
        intentBreakdown: intentBreakdown.rows.map((r: any) => ({
          intent: r.intent,
          total: Number(r.total),
          autoResolved: Number(r.auto_resolved),
          agentHandled: Number(r.agent_handled),
          avgConfidence: Math.round((Number(r.avg_confidence) || 0) * 100) / 100,
          autoClosePossible: Number(r.auto_close_possible),
          isCanonical: r.is_canonical,
        })),
        playbookUtilization: playbookPerIntent.rows.map((r: any) => ({
          intent: r.intent,
          ticketCount: Number(r.ticket_count) || 0,
          autoCloseProbability: Math.round((Number(r.auto_close_probability) || 0) * 100),
          totalUses: Number(r.total_uses) || 0,
          successfulResolutions: Number(r.successful_resolutions) || 0,
          failedResolutions: Number(r.failed_resolutions) || 0,
          successRate: Math.round((Number(r.success_rate) || 0) * 100),
          avgMessages: Number(r.avg_messages_after_autoreply) || 0,
          qualityLevel: r.avg_resolution_quality || 'N/A',
          isActive: r.is_active,
        })),
        categoryDistribution: categoryDist.rows.map((r: any) => ({
          category: r.category,
          total: Number(r.total),
          autoResolved: Number(r.auto_resolved),
          autoRate: Number(r.total) > 0 ? Math.round((Number(r.auto_resolved) / Number(r.total)) * 1000) / 10 : 0,
        })),
        chatbotByIntent: chatbotByIntent.rows.map((r: any) => ({
          intent: r.intent,
          total: Number(r.total),
          positive: Number(r.positive),
          negative: Number(r.negative),
          flagged: Number(r.flagged),
          blocked: Number(r.blocked),
        })),
        trendMonthly: trendMonthly.rows.map((r: any) => ({
          month: r.month,
          total: Number(r.total),
          matched: Number(r.matched),
          fallback: Number(r.fallback),
          flagged: Number(r.flagged),
          blocked: Number(r.blocked),
          matchRate: Number(r.total) > 0 ? Math.round((Number(r.matched) / Number(r.total)) * 1000) / 10 : 0,
          escalationRate: Number(r.total) > 0 ? Math.round(((Number(r.flagged) + Number(r.blocked)) / Number(r.total)) * 1000) / 10 : 0,
        })),
        trendDaily: trendDaily.rows.map((r: any) => ({
          day: r.day,
          total: Number(r.total),
          matched: Number(r.matched),
          fallback: Number(r.fallback),
          matchRate: Number(r.total) > 0 ? Math.round((Number(r.matched) / Number(r.total)) * 1000) / 10 : 0,
        })),
      });
    } catch (error: any) {
      console.error("Health endpoint error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chat/test-intent", async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) return res.status(400).json({ error: "query required" });
      const { testIntentMatch } = await import("./chatbot");
      const result = await testIntentMatch(query);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chat/test-intent-batch", async (req, res) => {
    try {
      const { queries } = req.body;
      if (!Array.isArray(queries)) return res.status(400).json({ error: "queries array required" });
      const { testIntentMatch } = await import("./chatbot");
      const results = await Promise.all(
        queries.map(async (q: { query: string; expected: string }, idx: number) => {
          const start = Date.now();
          const result = await testIntentMatch(q.query);
          return { idx, query: q.query, expected: q.expected, ...result, elapsed: Date.now() - start };
        })
      );
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
