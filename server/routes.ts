import type { Express } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { count } from "drizzle-orm";
import axios from "axios";
import { db } from "./db";
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
          {
            headers: { "Content-Type": "application/json" },
            timeout: 15000,
          }
        );
        resolvedUserId = detailResponse.data?.UserId;
      }

      console.log("Verify OTP calling LoginWithPasscode with:", {
        Userid: resolvedUserId,
        Otp: otpCode,
        emailorPhone: contactMethod,
      });

      const verifyResponse = await axios.post(
        `${MINSIDE_URL}/Security/LoginWithPasscode`,
        {
          Userid: resolvedUserId,
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
          validateStatus: (status: number) => status < 500,
        }
      );

      console.log("LoginWithPasscode response status:", verifyResponse.status, "data:", JSON.stringify(verifyResponse.data).substring(0, 500));

      const verifyData = verifyResponse.data;
      if (verifyData.IsSuccess) {
        let userData: any = null;

        try {
          const cookies = verifyResponse.headers["set-cookie"];
          const cookieHeader = cookies ? (Array.isArray(cookies) ? cookies.join("; ") : cookies) : "";

          const ownerResponse = await axios.get(
            `${MINSIDE_URL}/Security/GetOwnerDetailforOTPScreen?emailOrContactNumber=${encodeURIComponent(contactMethod)}`,
            {
              timeout: 15000,
              headers: cookieHeader ? { Cookie: cookieHeader } : {},
              maxRedirects: 0,
              validateStatus: (status: number) => status < 500,
            }
          );

          if (ownerResponse.status === 200 && ownerResponse.data && typeof ownerResponse.data === "object") {
            userData = ownerResponse.data;
          }
        } catch (detailErr: any) {
          console.log("Could not fetch owner details after OTP verify (non-critical):", detailErr.message);
        }

        const ownerId = userData?.OwnerId || resolvedUserId || `MINSIDE-${contactMethod}`;

        if (conversationId) {
          await storage.updateConversationAuth(parseInt(conversationId), ownerId);
        }

        return res.json({
          success: true,
          mode: "production",
          userContext: userData || {
            Phone: contactMethod,
            OwnerId: ownerId,
            FirstName: "Bruker",
            Pets: [],
          },
        });
      }

      res.status(401).json({ success: false, error: verifyData.viewMessage || "Feil engangskode. Prøv igjen." });
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

  // ─── SEED TEST DATA ─────────────────────────────────────────────
  app.post("/api/training/seed-test-data", async (req, res) => {
    try {
      const count = req.body?.count || 100;
      const existing = await storage.getTrainingStats();
      if (existing.rawTickets > 0) {
        return res.status(400).json({ error: "Det finnes allerede tickets i databasen. Tøm først om du vil seede på nytt." });
      }

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
        { cat: "Registrering", subject: "Registrere ny katt", q: "Jeg har fått en kattunge og vil registrere den i DyreID. Katten er chippet hos veterinær.", a: "Logg inn på Min Side og velg 'Registrer nytt dyr'. Du trenger chipnummer (15 siffer), rase, farge og fødselsdato. Registreringsavgift er 250 kr." },
        { cat: "Registrering", subject: "Betaling for registrering", q: "Jeg prøvde å registrere hunden min men betalingen gikk ikke gjennom. Hva gjør jeg?", a: "Prøv igjen med et annet betalingskort, eller velg Vipps som betalingsmetode. Hvis problemet vedvarer, ta kontakt med banken din." },
        { cat: "Registrering", subject: "Feil chipnummer registrert", q: "Veterinæren registrerte feil chipnummer på katten min. Kan dette rettes?", a: "Ja, be veterinæren sende oss en bekreftelse på riktig chipnummer med dyrets signalement. Vi oppdaterer registreringen." },
        { cat: "Registrering", subject: "Importert dyr fra utlandet", q: "Jeg har importert en hund fra Sverige. Hvordan registrerer jeg den i DyreID?", a: "Importerte dyr registreres på vanlig måte, men du må også laste opp EU-pass eller helsesertifikat. Chipnummeret må være ISO-standard." },
        { cat: "Registrering", subject: "Dobbeltregistrering", q: "Det ser ut som hunden min er registrert to ganger med ulike chipnumre. Kan dere rydde opp?", a: "Jeg kan se overlappende registreringer. Send oss chipnumrene og vi slår sammen registreringene til én." },
        { cat: "QR Tag", subject: "Aktivere QR-brikke", q: "Jeg har mottatt QR-brikken men vet ikke hvordan jeg aktiverer den. Kan dere hjelpe?", a: "Skann QR-koden på brikken med mobilkameraet. Du blir sendt til en aktiveringsside. Logg inn og koble brikken til dyret ditt." },
        { cat: "QR Tag", subject: "QR-brikke fungerer ikke", q: "QR-brikken min skannes ikke. Koden er slitt og uleselig.", a: "Vi sender deg en ny QR-brikke kostnadsfritt. Oppgi adressen din og dyrets chipnummer så sender vi ny brikke i posten." },
        { cat: "QR Tag", subject: "Bestille ekstra QR-brikke", q: "Kan jeg bestille en ekstra QR-brikke til halsbåndet? Har allerede én på selen.", a: "Ja! Gå til Min Side > 'Dine dyr' > velg dyret > 'Bestill QR-brikke'. Ekstra brikker koster 99 kr." },
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
        { cat: "Abonnement", subject: "Legge til flere dyr i abonnement", q: "Jeg har tre katter nå. Kan alle dekkes av samme abonnement?", a: "Med Familie-abonnementet til 399 kr/mnd dekkes opptil 5 dyr. Gå til Min Side > Abonnement > 'Legg til dyr'." },
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
        { cat: "Eierskifte", subject: "Eierskifte koster penger?", q: "Koster det noe å overføre eierskapet av en hund?", a: "Eierskifte er gratis for dyr som allerede er registrert i DyreID. Ny eier må ha eller opprette en konto på Min Side." },
        { cat: "Min side", subject: "To-faktor autentisering", q: "Kan jeg aktivere to-faktor autentisering på Min Side for ekstra sikkerhet?", a: "Min Side bruker BankID som innlogging, som allerede er to-faktor. Du trenger ikke aktivere noe ekstra." },
        { cat: "Savnet/Funnet", subject: "Stjålet hund", q: "Vi tror hunden vår er stjålet fra hagen. Kan dere hjelpe?", a: "Jeg har registrert dyret som savnet/mulig stjålet. Anbefaler å anmelde forholdet til politiet. Alle som skanner chipen vil se savnet-melding." },
        { cat: "Abonnement", subject: "Priser og pakker", q: "Hva koster de ulike abonnementene? Har to hunder.", a: "Basis: 99 kr/mnd (1 dyr), Standard: 199 kr/mnd (2 dyr), Familie: 399 kr/mnd (opptil 5 dyr). Med to hunder anbefaler vi Standard." },
      ];

      const tickets = [];
      for (let i = 0; i < count; i++) {
        const template = ticketTemplates[i % ticketTemplates.length];
        const variation = Math.floor(i / ticketTemplates.length);
        const daysAgo = Math.floor(Math.random() * 365) + 30;
        const closedDaysAgo = daysAgo - Math.floor(Math.random() * 7) - 1;

        tickets.push({
          ticketId: 10000 + i,
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

  return httpServer;
}
