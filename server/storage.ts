import { db } from "./db";
import { eq, desc, sql, count, and, isNull, lt, or, ilike } from "drizzle-orm";
import {
  rawTickets,
  scrubbedTickets,
  hjelpesenterCategories,
  categoryMappings,
  intentClassifications,
  resolutionPatterns,
  playbookEntries,
  uncategorizedThemes,
  uncertaintyCases,
  reviewQueue,
  conversations,
  messages,
  trainingRuns,
  servicePrices,
  responseTemplates,
  helpCenterArticles,
  chatbotInteractions,
  ticketHelpCenterMatches,
  resolutionQuality,
  minsideFieldMappings,
  type InsertRawTicket,
  type InsertHelpCenterArticle,
  type InsertScrubbedTicket,
  type InsertCategoryMapping,
  type InsertIntentClassification,
  type InsertResolutionPattern,
  type InsertPlaybookEntry,
  type InsertConversation,
  type InsertMessage,
  type InsertServicePrice,
  type InsertResponseTemplate,
  type InsertChatbotInteraction,
  type InsertTicketHelpCenterMatch,
  type InsertResolutionQuality,
  type InsertMinsideFieldMapping,
} from "@shared/schema";

export interface IStorage {
  insertRawTickets(tickets: InsertRawTicket[]): Promise<void>;
  getRawTicketCount(): Promise<number>;
  getUnprocessedRawTickets(limit: number): Promise<typeof rawTickets.$inferSelect[]>;
  markRawTicketProcessed(ticketId: number): Promise<void>;

  insertScrubbedTicket(ticket: InsertScrubbedTicket): Promise<void>;
  getScrubbedTicketCount(): Promise<number>;
  getUnmappedScrubbedTickets(limit: number): Promise<typeof scrubbedTickets.$inferSelect[]>;
  getUnclassifiedScrubbedTickets(limit: number): Promise<typeof scrubbedTickets.$inferSelect[]>;
  getUncategorizedScrubbedTickets(limit: number): Promise<typeof scrubbedTickets.$inferSelect[]>;
  updateScrubbedTicketMapping(ticketId: number, category: string, subcategory: string): Promise<void>;
  updateScrubbedTicketAnalysis(ticketId: number, status: string): Promise<void>;

  getHjelpesenterCategories(): Promise<typeof hjelpesenterCategories.$inferSelect[]>;
  seedHjelpesenterCategories(categories: { categoryName: string; subcategoryName: string; urlSlug: string; description: string }[]): Promise<void>;
  replaceHjelpesenterCategories(categories: { categoryName: string; subcategoryName: string; urlSlug: string; description: string }[]): Promise<void>;

  insertCategoryMapping(mapping: InsertCategoryMapping): Promise<void>;
  getCategoryMappingCount(): Promise<number>;
  getCategoryMappingByTicketId(ticketId: number): Promise<typeof categoryMappings.$inferSelect | null>;

  insertIntentClassification(classification: InsertIntentClassification): Promise<void>;
  getIntentClassificationCount(): Promise<number>;
  getIntentClassificationByTicketId(ticketId: number): Promise<typeof intentClassifications.$inferSelect | null>;
  getClassifiedTicketsWithoutResolution(limit: number): Promise<typeof intentClassifications.$inferSelect[]>;
  getLowConfidenceClassifications(limit: number): Promise<typeof intentClassifications.$inferSelect[]>;
  updateIntentClassificationReview(ticketId: number, data: { intent?: string; manuallyReviewed: boolean; reviewerEmail: string; reviewNotes: string; uncertaintyReviewed: boolean }): Promise<void>;
  markResolutionExtracted(ticketId: number): Promise<void>;

  insertResolutionPattern(pattern: InsertResolutionPattern): Promise<void>;
  getResolutionPatternCount(): Promise<number>;
  getResolutionPatternByTicketId(ticketId: number): Promise<typeof resolutionPatterns.$inferSelect | null>;

  getPlaybookEntries(): Promise<typeof playbookEntries.$inferSelect[]>;
  getActivePlaybookEntries(): Promise<typeof playbookEntries.$inferSelect[]>;
  getPlaybookByIntent(intent: string): Promise<typeof playbookEntries.$inferSelect | null>;
  searchPlaybookByKeywords(message: string): Promise<(typeof playbookEntries.$inferSelect & { keywordMatches: number }) | null>;
  upsertPlaybookEntry(entry: InsertPlaybookEntry): Promise<void>;
  getPlaybookEntryCount(): Promise<number>;

  insertUncategorizedTheme(theme: { themeName: string; description: string; ticketCount: number; ticketIds: string; shouldBeNewCategory: boolean; suggestedExistingCategory: string | null }): Promise<number>;
  getUncategorizedThemes(): Promise<typeof uncategorizedThemes.$inferSelect[]>;
  getUncategorizedThemeCount(): Promise<number>;
  updateThemeReview(id: number, reviewed: boolean, reviewerNotes: string): Promise<void>;

  insertUncertaintyCase(uc: { ticketId: number; uncertaintyType: string; missingInformation: string; suggestedQuestions: string; needsHumanReview: boolean; reviewPriority: string }): Promise<void>;
  getUncertaintyCases(): Promise<typeof uncertaintyCases.$inferSelect[]>;
  getUncertaintyCaseCount(): Promise<number>;

  insertReviewQueueItem(item: { reviewType: string; referenceId: number; priority: string; data: any }): Promise<number>;
  getPendingReviewItems(): Promise<typeof reviewQueue.$inferSelect[]>;
  getReviewQueueCount(): Promise<number>;
  submitReview(id: number, reviewedBy: string, decision: string): Promise<void>;

  getTrainingStats(): Promise<{
    rawTickets: number;
    scrubbedTickets: number;
    categoryMappings: number;
    intentClassifications: number;
    resolutionPatterns: number;
    playbookEntries: number;
    uncertaintyCases: number;
    uncategorizedThemes: number;
    reviewQueuePending: number;
  }>;

  createTrainingRun(workflow: string, totalTickets: number): Promise<number>;
  updateTrainingRunProgress(id: number, processed: number): Promise<void>;
  completeTrainingRun(id: number, errorCount: number, errorLog?: string): Promise<void>;
  getLatestTrainingRuns(limit: number): Promise<typeof trainingRuns.$inferSelect[]>;

  createConversation(data: InsertConversation): Promise<typeof conversations.$inferSelect>;
  getConversation(id: number): Promise<typeof conversations.$inferSelect | undefined>;
  getAllConversations(): Promise<typeof conversations.$inferSelect[]>;
  deleteConversation(id: number): Promise<void>;
  updateConversationAuth(id: number, ownerId: string | null, userContext?: any): Promise<void>;

  createMessage(data: InsertMessage): Promise<typeof messages.$inferSelect>;
  getMessagesByConversation(conversationId: number): Promise<typeof messages.$inferSelect[]>;

  getServicePrices(): Promise<typeof servicePrices.$inferSelect[]>;
  getActiveServicePrices(): Promise<typeof servicePrices.$inferSelect[]>;
  upsertServicePrice(price: InsertServicePrice): Promise<typeof servicePrices.$inferSelect>;
  updateServicePrice(id: number, data: Partial<InsertServicePrice>): Promise<void>;
  deleteServicePrice(id: number): Promise<void>;

  getResponseTemplates(): Promise<typeof responseTemplates.$inferSelect[]>;
  getActiveResponseTemplates(): Promise<typeof responseTemplates.$inferSelect[]>;
  upsertResponseTemplate(template: InsertResponseTemplate): Promise<typeof responseTemplates.$inferSelect>;
  getResponseTemplateCount(): Promise<number>;
  deleteAllResponseTemplates(): Promise<void>;

  upsertHelpCenterArticle(article: InsertHelpCenterArticle): Promise<void>;
  getHelpCenterArticles(): Promise<typeof helpCenterArticles.$inferSelect[]>;
  getHelpCenterArticlesByCategory(category: string): Promise<typeof helpCenterArticles.$inferSelect[]>;
  getHelpCenterArticleCount(): Promise<number>;
  deleteAllHelpCenterArticles(): Promise<void>;

  insertTicketHelpCenterMatch(match: InsertTicketHelpCenterMatch): Promise<void>;
  getTicketHelpCenterMatches(limit?: number): Promise<typeof ticketHelpCenterMatches.$inferSelect[]>;
  getTicketHelpCenterMatchCount(): Promise<number>;
  getMatchedTicketIds(): Promise<number[]>;
  getHelpCenterMatchStats(): Promise<{
    totalMatches: number;
    avgConfidence: number;
    highAlignment: number;
    mediumAlignment: number;
    lowAlignment: number;
    contradicts: number;
    followsProcedure: number;
    topArticles: { articleId: number; title: string; matchCount: number }[];
    commonMissing: string[];
  }>;
  deleteAllTicketHelpCenterMatches(): Promise<void>;

  updateTemplateKeywords(templateId: number, keywords: string[]): Promise<void>;
  getScrubbedTicketsForAutoreply(limit: number): Promise<typeof scrubbedTickets.$inferSelect[]>;
  updateScrubbedTicketAutoreply(ticketId: number, data: { hasAutoreply: boolean; autoreplyTemplateId: number | null; autoreplyConfidence: number; humanResponseStartsAt: number | null }): Promise<void>;
  getAutoreplyStats(): Promise<{
    totalAnalyzed: number;
    withAutoreply: number;
    withoutAutoreply: number;
    unanalyzed: number;
    avgConfidence: number;
    templateDistribution: { templateId: number; templateName: string; count: number }[];
    onlyAutoreply: number;
  }>;

  getScrubbedTicketsForDialogPattern(limit: number): Promise<typeof scrubbedTickets.$inferSelect[]>;
  updateScrubbedTicketDialogPattern(ticketId: number, data: { dialogPattern: string; messagesAfterAutoreply: number; totalMessageCount: number }): Promise<void>;
  getDialogPatternStats(): Promise<{
    total: number;
    unanalyzed: number;
    patterns: { pattern: string; count: number; avgMessages: number; avgTotal: number }[];
    byCategory: { category: string; pattern: string; count: number }[];
    problematic: { category: string; count: number }[];
  }>;

  getTicketsForQualityAssessment(limit: number): Promise<any[]>;
  insertResolutionQuality(data: InsertResolutionQuality): Promise<void>;
  getResolutionQualityStats(): Promise<{
    total: number;
    unassessed: number;
    byQuality: { level: string; count: number; avgConfidence: number }[];
    byCategory: { category: string; level: string; count: number }[];
    byPattern: { pattern: string; level: string; count: number }[];
    missingElements: { element: string; count: number }[];
    problematic: { category: string; lowNoneCount: number; totalCount: number; pct: number }[];
    examples: { level: string; subject: string | null; reasoning: string | null; missingElements: string[] | null; positiveElements: string[] | null }[];
  }>;

  identifyGeneralTickets(): Promise<number>;
  getTicketsForReclassification(limit: number): Promise<any[]>;
  updateReclassification(mappingId: number, data: { reclassifiedCategory: string | null; reclassifiedSubcategory: string | null; reclassificationConfidence: number; reclassificationReasoning: string }): Promise<void>;
  getReclassificationStats(): Promise<{
    totalGeneral: number;
    reclassified: number;
    remainGeneral: number;
    unprocessed: number;
    avgConfidence: number;
    byCategory: { category: string; subcategory: string | null; count: number; avgConfidence: number }[];
    trulyGeneral: { subject: string; reasoning: string }[];
  }>;

  logChatbotInteraction(interaction: InsertChatbotInteraction): Promise<typeof chatbotInteractions.$inferSelect>;
  updateInteractionFeedback(id: number, feedbackResult: string, feedbackComment?: string): Promise<void>;
  getChatbotInteractions(limit?: number): Promise<typeof chatbotInteractions.$inferSelect[]>;
  getFlaggedInteractions(): Promise<typeof chatbotInteractions.$inferSelect[]>;
  getFeedbackStats(): Promise<{ total: number; resolved: number; partial: number; notResolved: number; nofeedback: number; byIntent: Record<string, { total: number; resolved: number; notResolved: number; partial: number }> }>;
  getInteractionsByIntent(intent: string): Promise<typeof chatbotInteractions.$inferSelect[]>;

  getMinsideFieldMappings(): Promise<typeof minsideFieldMappings.$inferSelect[]>;
  getActiveMinsideFieldMappings(): Promise<typeof minsideFieldMappings.$inferSelect[]>;
  upsertMinsideFieldMapping(mapping: InsertMinsideFieldMapping): Promise<typeof minsideFieldMappings.$inferSelect>;
  updateMinsideFieldMapping(id: number, data: Partial<InsertMinsideFieldMapping>): Promise<void>;
  deleteMinsideFieldMapping(id: number): Promise<void>;
  seedMinsideFieldMappings(mappings: InsertMinsideFieldMapping[]): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  async insertRawTickets(tickets: InsertRawTicket[]): Promise<void> {
    if (tickets.length === 0) return;
    await db.insert(rawTickets).values(tickets).onConflictDoNothing();
  }

  async getRawTicketCount(): Promise<number> {
    const result = await db.select({ count: count() }).from(rawTickets);
    return result[0].count;
  }

  async getUnprocessedRawTickets(limit: number) {
    return db
      .select()
      .from(rawTickets)
      .where(eq(rawTickets.processingStatus, "pending"))
      .limit(limit);
  }

  async markRawTicketProcessed(ticketId: number): Promise<void> {
    await db
      .update(rawTickets)
      .set({ processingStatus: "processed", processedAt: new Date() })
      .where(eq(rawTickets.ticketId, ticketId));
  }

  async insertScrubbedTicket(ticket: InsertScrubbedTicket): Promise<void> {
    await db.insert(scrubbedTickets).values(ticket).onConflictDoNothing();
  }

  async getScrubbedTicketCount(): Promise<number> {
    const result = await db.select({ count: count() }).from(scrubbedTickets);
    return result[0].count;
  }

  async getUnmappedScrubbedTickets(limit: number) {
    return db
      .select()
      .from(scrubbedTickets)
      .where(eq(scrubbedTickets.categoryMappingStatus, "pending"))
      .limit(limit);
  }

  async getUnclassifiedScrubbedTickets(limit: number) {
    return db
      .select()
      .from(scrubbedTickets)
      .where(
        and(
          eq(scrubbedTickets.categoryMappingStatus, "mapped"),
          eq(scrubbedTickets.analysisStatus, "pending")
        )
      )
      .limit(limit);
  }

  async getUncategorizedScrubbedTickets(limit: number) {
    return db
      .select()
      .from(scrubbedTickets)
      .where(
        and(
          eq(scrubbedTickets.hjelpesenterCategory, "Ukategorisert"),
          eq(scrubbedTickets.analysisStatus, "pending")
        )
      )
      .limit(limit);
  }

  async updateScrubbedTicketMapping(ticketId: number, category: string, subcategory: string): Promise<void> {
    await db
      .update(scrubbedTickets)
      .set({
        categoryMappingStatus: "mapped",
        hjelpesenterCategory: category,
        hjelpesenterSubcategory: subcategory,
      })
      .where(eq(scrubbedTickets.ticketId, ticketId));
  }

  async updateScrubbedTicketAnalysis(ticketId: number, status: string): Promise<void> {
    await db
      .update(scrubbedTickets)
      .set({ analysisStatus: status })
      .where(eq(scrubbedTickets.ticketId, ticketId));
  }

  async getHjelpesenterCategories() {
    return db.select().from(hjelpesenterCategories);
  }

  async seedHjelpesenterCategories(categories: { categoryName: string; subcategoryName: string; urlSlug: string; description: string }[]): Promise<void> {
    const existing = await db.select({ count: count() }).from(hjelpesenterCategories);
    if (existing[0].count > 0) return;
    await db.insert(hjelpesenterCategories).values(categories);
  }

  async replaceHjelpesenterCategories(categories: { categoryName: string; subcategoryName: string; urlSlug: string; description: string }[]): Promise<void> {
    await db.delete(hjelpesenterCategories);
    if (categories.length > 0) {
      await db.insert(hjelpesenterCategories).values(categories);
    }
  }

  async insertCategoryMapping(mapping: InsertCategoryMapping): Promise<void> {
    await db.insert(categoryMappings).values(mapping);
  }

  async getCategoryMappingCount(): Promise<number> {
    const result = await db.select({ count: count() }).from(categoryMappings);
    return result[0].count;
  }

  async getCategoryMappingByTicketId(ticketId: number): Promise<typeof categoryMappings.$inferSelect | null> {
    const result = await db.select().from(categoryMappings).where(eq(categoryMappings.ticketId, ticketId)).limit(1);
    return result[0] || null;
  }

  async insertIntentClassification(classification: InsertIntentClassification): Promise<void> {
    await db.insert(intentClassifications).values(classification);
  }

  async getIntentClassificationByTicketId(ticketId: number): Promise<typeof intentClassifications.$inferSelect | null> {
    const result = await db.select().from(intentClassifications).where(eq(intentClassifications.ticketId, ticketId)).limit(1);
    return result[0] || null;
  }

  async getIntentClassificationCount(): Promise<number> {
    const result = await db.select({ count: count() }).from(intentClassifications);
    return result[0].count;
  }

  async getClassifiedTicketsWithoutResolution(limit: number) {
    return db
      .select()
      .from(intentClassifications)
      .where(
        and(
          eq(intentClassifications.resolutionExtracted, false),
          sql`${intentClassifications.intentConfidence} > 0.7`
        )
      )
      .limit(limit);
  }

  async getLowConfidenceClassifications(limit: number) {
    return db
      .select()
      .from(intentClassifications)
      .where(
        and(
          eq(intentClassifications.uncertaintyReviewed, false),
          or(
            sql`${intentClassifications.intentConfidence} < 0.7`,
            eq(intentClassifications.isNewIntent, true)
          )
        )
      )
      .limit(limit);
  }

  async updateIntentClassificationReview(ticketId: number, data: { intent?: string; manuallyReviewed: boolean; reviewerEmail: string; reviewNotes: string; uncertaintyReviewed: boolean }): Promise<void> {
    const updateData: any = {
      manuallyReviewed: data.manuallyReviewed,
      reviewerEmail: data.reviewerEmail,
      reviewNotes: data.reviewNotes,
      reviewedAt: new Date(),
      uncertaintyReviewed: data.uncertaintyReviewed,
    };
    if (data.intent) {
      updateData.intent = data.intent;
    }
    await db
      .update(intentClassifications)
      .set(updateData)
      .where(eq(intentClassifications.ticketId, ticketId));
  }

  async markResolutionExtracted(ticketId: number): Promise<void> {
    await db
      .update(intentClassifications)
      .set({ resolutionExtracted: true })
      .where(eq(intentClassifications.ticketId, ticketId));
  }

  async insertResolutionPattern(pattern: InsertResolutionPattern): Promise<void> {
    await db.insert(resolutionPatterns).values(pattern);
  }

  async getResolutionPatternCount(): Promise<number> {
    const result = await db.select({ count: count() }).from(resolutionPatterns);
    return result[0].count;
  }

  async getResolutionPatternByTicketId(ticketId: number): Promise<typeof resolutionPatterns.$inferSelect | null> {
    const result = await db.select().from(resolutionPatterns).where(eq(resolutionPatterns.ticketId, ticketId)).limit(1);
    return result[0] || null;
  }

  async getPlaybookEntries() {
    return db.select().from(playbookEntries).orderBy(desc(playbookEntries.ticketCount));
  }

  async getActivePlaybookEntries() {
    return db.select().from(playbookEntries).where(eq(playbookEntries.isActive, true));
  }

  async getPlaybookByIntent(intent: string) {
    const rows = await db.select().from(playbookEntries)
      .where(sql`LOWER(${playbookEntries.intent}) = LOWER(${intent}) AND ${playbookEntries.isActive} = true`)
      .limit(1);
    return rows[0] || null;
  }

  async searchPlaybookByKeywords(message: string): Promise<(typeof playbookEntries.$inferSelect & { keywordMatches: number }) | null> {
    const entries = await db.select().from(playbookEntries)
      .where(eq(playbookEntries.isActive, true));

    const lowerMsg = message.toLowerCase();
    let bestMatch: (typeof playbookEntries.$inferSelect & { keywordMatches: number }) | null = null;
    let bestCount = 0;

    for (const entry of entries) {
      if (!entry.keywords) continue;
      const keywords = entry.keywords.split(",").map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
      let matchCount = 0;
      for (const kw of keywords) {
        if (lowerMsg.includes(kw)) matchCount++;
      }
      if (matchCount > bestCount) {
        bestCount = matchCount;
        bestMatch = { ...entry, keywordMatches: matchCount };
      }
    }

    return bestCount >= 2 ? bestMatch : null;
  }

  async upsertPlaybookEntry(entry: InsertPlaybookEntry): Promise<void> {
    await db
      .insert(playbookEntries)
      .values(entry)
      .onConflictDoUpdate({
        target: playbookEntries.intent,
        set: {
          hjelpesenterCategory: entry.hjelpesenterCategory,
          hjelpesenterSubcategory: entry.hjelpesenterSubcategory,
          keywords: entry.keywords,
          requiredRuntimeData: entry.requiredRuntimeData,
          primaryAction: entry.primaryAction,
          primaryEndpoint: entry.primaryEndpoint,
          resolutionSteps: entry.resolutionSteps,
          successIndicators: entry.successIndicators,
          avgConfidence: entry.avgConfidence,
          ticketCount: entry.ticketCount,
          paymentRequiredProbability: entry.paymentRequiredProbability,
          autoCloseProbability: entry.autoCloseProbability,
          isActive: entry.isActive,
          hasAutoreplyAvailable: entry.hasAutoreplyAvailable,
          autoreplyTemplateId: entry.autoreplyTemplateId,
          autoreplyTemplateName: entry.autoreplyTemplateName,
          autoreplyContent: entry.autoreplyContent,
          typicalDialogPattern: entry.typicalDialogPattern,
          avgMessagesAfterAutoreply: entry.avgMessagesAfterAutoreply,
          dialogPatternDistribution: entry.dialogPatternDistribution,
          wasReclassified: entry.wasReclassified,
          originalCategories: entry.originalCategories,
          reclassifiedFrom: entry.reclassifiedFrom,
          avgResolutionQuality: entry.avgResolutionQuality,
          qualityDistribution: entry.qualityDistribution,
          commonMissingElements: entry.commonMissingElements,
          commonPositiveElements: entry.commonPositiveElements,
          needsImprovement: entry.needsImprovement,
          helpCenterArticleId: entry.helpCenterArticleId,
          helpCenterArticleUrl: entry.helpCenterArticleUrl,
          helpCenterArticleTitle: entry.helpCenterArticleTitle,
          officialProcedure: entry.officialProcedure,
          helpCenterContentSummary: entry.helpCenterContentSummary,
          requiresLogin: entry.requiresLogin,
          requiresAction: entry.requiresAction,
          actionType: entry.actionType,
          apiEndpoint: entry.apiEndpoint,
          httpMethod: entry.httpMethod,
          requiredRuntimeDataArray: entry.requiredRuntimeDataArray,
          paymentRequired: entry.paymentRequired,
          paymentAmount: entry.paymentAmount,
          chatbotSteps: entry.chatbotSteps,
          combinedResponse: entry.combinedResponse,
          successfulResolutions: entry.successfulResolutions,
          failedResolutions: entry.failedResolutions,
          totalUses: entry.totalUses,
          successRate: entry.successRate,
          lastUpdated: sql`CURRENT_TIMESTAMP`,
        },
      });
  }

  async getPlaybookEntryCount(): Promise<number> {
    const result = await db.select({ count: count() }).from(playbookEntries);
    return result[0].count;
  }

  async insertUncategorizedTheme(theme: { themeName: string; description: string; ticketCount: number; ticketIds: string; shouldBeNewCategory: boolean; suggestedExistingCategory: string | null }): Promise<number> {
    const [row] = await db.insert(uncategorizedThemes).values(theme).returning();
    return row.id;
  }

  async getUncategorizedThemes() {
    return db.select().from(uncategorizedThemes).orderBy(desc(uncategorizedThemes.ticketCount));
  }

  async getUncategorizedThemeCount(): Promise<number> {
    const result = await db.select({ count: count() }).from(uncategorizedThemes);
    return result[0].count;
  }

  async updateThemeReview(id: number, reviewed: boolean, reviewerNotes: string): Promise<void> {
    await db
      .update(uncategorizedThemes)
      .set({ reviewed, reviewerNotes })
      .where(eq(uncategorizedThemes.id, id));
  }

  async insertUncertaintyCase(uc: { ticketId: number; uncertaintyType: string; missingInformation: string; suggestedQuestions: string; needsHumanReview: boolean; reviewPriority: string }): Promise<void> {
    await db.insert(uncertaintyCases).values(uc);
  }

  async getUncertaintyCases() {
    return db.select().from(uncertaintyCases).orderBy(desc(uncertaintyCases.detectedAt));
  }

  async getUncertaintyCaseCount(): Promise<number> {
    const result = await db.select({ count: count() }).from(uncertaintyCases);
    return result[0].count;
  }

  async insertReviewQueueItem(item: { reviewType: string; referenceId: number; priority: string; data: any }): Promise<number> {
    const [row] = await db.insert(reviewQueue).values(item).returning();
    return row.id;
  }

  async getPendingReviewItems() {
    return db
      .select()
      .from(reviewQueue)
      .where(eq(reviewQueue.status, "pending"))
      .orderBy(
        sql`CASE WHEN ${reviewQueue.priority} = 'high' THEN 1 WHEN ${reviewQueue.priority} = 'medium' THEN 2 ELSE 3 END`,
        desc(reviewQueue.createdAt)
      );
  }

  async getReviewQueueCount(): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(reviewQueue)
      .where(eq(reviewQueue.status, "pending"));
    return result[0].count;
  }

  async submitReview(id: number, reviewedBy: string, decision: string): Promise<void> {
    await db
      .update(reviewQueue)
      .set({
        status: "reviewed",
        reviewedBy,
        reviewedAt: new Date(),
        decision,
      })
      .where(eq(reviewQueue.id, id));
  }

  async getTrainingStats() {
    const [raw, scrubbed, catMap, intents, resolutions, playbook, uncertainty, uncat, pendingReview] = await Promise.all([
      db.select({ count: count() }).from(rawTickets),
      db.select({ count: count() }).from(scrubbedTickets),
      db.select({ count: count() }).from(categoryMappings),
      db.select({ count: count() }).from(intentClassifications),
      db.select({ count: count() }).from(resolutionPatterns),
      db.select({ count: count() }).from(playbookEntries),
      db.select({ count: count() }).from(uncertaintyCases),
      db.select({ count: count() }).from(uncategorizedThemes),
      db.select({ count: count() }).from(reviewQueue).where(eq(reviewQueue.status, "pending")),
    ]);
    return {
      rawTickets: raw[0].count,
      scrubbedTickets: scrubbed[0].count,
      categoryMappings: catMap[0].count,
      intentClassifications: intents[0].count,
      resolutionPatterns: resolutions[0].count,
      playbookEntries: playbook[0].count,
      uncertaintyCases: uncertainty[0].count,
      uncategorizedThemes: uncat[0].count,
      reviewQueuePending: pendingReview[0].count,
    };
  }

  async createTrainingRun(workflow: string, totalTickets: number): Promise<number> {
    const [run] = await db
      .insert(trainingRuns)
      .values({ workflow, totalTickets, status: "running" })
      .returning();
    return run.id;
  }

  async updateTrainingRunProgress(id: number, processed: number): Promise<void> {
    await db
      .update(trainingRuns)
      .set({ processedTickets: processed })
      .where(eq(trainingRuns.id, id));
  }

  async completeTrainingRun(id: number, errorCount: number, errorLog?: string): Promise<void> {
    await db
      .update(trainingRuns)
      .set({
        status: errorCount > 0 ? "completed_with_errors" : "completed",
        errorCount,
        errorLog,
        completedAt: new Date(),
      })
      .where(eq(trainingRuns.id, id));
  }

  async getLatestTrainingRuns(limit: number) {
    return db
      .select()
      .from(trainingRuns)
      .orderBy(desc(trainingRuns.startedAt))
      .limit(limit);
  }

  async createConversation(data: InsertConversation) {
    const [conversation] = await db.insert(conversations).values(data).returning();
    return conversation;
  }

  async getConversation(id: number) {
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conversation;
  }

  async getAllConversations() {
    return db.select().from(conversations).orderBy(desc(conversations.createdAt));
  }

  async deleteConversation(id: number): Promise<void> {
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
  }

  async updateConversationAuth(id: number, ownerId: string | null, userContext?: any): Promise<void> {
    if (ownerId === null) {
      await db
        .update(conversations)
        .set({ authenticated: false, ownerId: null, userContext: null })
        .where(eq(conversations.id, id));
      return;
    }
    const updateData: any = { authenticated: true, ownerId };
    if (userContext) {
      updateData.userContext = userContext;
    }
    await db
      .update(conversations)
      .set(updateData)
      .where(eq(conversations.id, id));
  }

  async createMessage(data: InsertMessage) {
    const [message] = await db.insert(messages).values(data).returning();
    return message;
  }

  async getMessagesByConversation(conversationId: number) {
    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }

  async getServicePrices() {
    return db.select().from(servicePrices).orderBy(servicePrices.category, servicePrices.serviceName);
  }

  async getActiveServicePrices() {
    return db.select().from(servicePrices).where(eq(servicePrices.isActive, true)).orderBy(servicePrices.category, servicePrices.serviceName);
  }

  async upsertServicePrice(price: InsertServicePrice) {
    const [result] = await db
      .insert(servicePrices)
      .values({ ...price, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: servicePrices.serviceKey,
        set: {
          serviceName: price.serviceName,
          price: price.price,
          currency: price.currency,
          description: price.description,
          category: price.category,
          sourceTemplate: price.sourceTemplate,
          effectiveDate: price.effectiveDate,
          isActive: price.isActive,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async updateServicePrice(id: number, data: Partial<InsertServicePrice>) {
    await db
      .update(servicePrices)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(servicePrices.id, id));
  }

  async deleteServicePrice(id: number) {
    await db.delete(servicePrices).where(eq(servicePrices.id, id));
  }

  async getResponseTemplates() {
    return db.select().from(responseTemplates).orderBy(responseTemplates.hjelpesenterCategory, responseTemplates.name);
  }

  async getActiveResponseTemplates() {
    return db.select().from(responseTemplates).where(eq(responseTemplates.isActive, true)).orderBy(responseTemplates.hjelpesenterCategory, responseTemplates.name);
  }

  async upsertResponseTemplate(template: InsertResponseTemplate) {
    const [result] = await db
      .insert(responseTemplates)
      .values(template)
      .onConflictDoUpdate({
        target: responseTemplates.templateId,
        set: {
          name: template.name,
          subject: template.subject,
          bodyHtml: template.bodyHtml,
          bodyText: template.bodyText,
          hjelpesenterCategory: template.hjelpesenterCategory,
          hjelpesenterSubcategory: template.hjelpesenterSubcategory,
          ticketType: template.ticketType,
          intent: template.intent,
          keyPoints: template.keyPoints,
          isActive: template.isActive,
          fetchedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async getResponseTemplateCount() {
    const result = await db.select({ count: count() }).from(responseTemplates);
    return result[0].count;
  }

  async deleteAllResponseTemplates() {
    await db.delete(responseTemplates);
  }

  async upsertHelpCenterArticle(article: InsertHelpCenterArticle): Promise<void> {
    await db
      .insert(helpCenterArticles)
      .values(article)
      .onConflictDoUpdate({
        target: helpCenterArticles.url,
        set: {
          articleId: article.articleId,
          urlSlug: article.urlSlug,
          title: article.title,
          bodyHtml: article.bodyHtml,
          bodyText: article.bodyText,
          hjelpesenterCategory: article.hjelpesenterCategory,
          hjelpesenterSubcategory: article.hjelpesenterSubcategory,
          categoryPath: article.categoryPath,
          relatedArticleUrls: article.relatedArticleUrls,
          scrapedAt: new Date(),
        },
      });
  }

  async getHelpCenterArticles() {
    return db.select().from(helpCenterArticles).orderBy(helpCenterArticles.hjelpesenterCategory);
  }

  async getHelpCenterArticlesByCategory(category: string) {
    return db.select().from(helpCenterArticles).where(eq(helpCenterArticles.hjelpesenterCategory, category));
  }

  async getHelpCenterArticleCount() {
    const result = await db.select({ count: count() }).from(helpCenterArticles);
    return result[0].count;
  }

  async deleteAllHelpCenterArticles() {
    await db.delete(helpCenterArticles);
  }

  async updateTemplateKeywords(templateId: number, keywords: string[]) {
    await db.update(responseTemplates)
      .set({ keywords })
      .where(eq(responseTemplates.templateId, templateId));
  }

  async getScrubbedTicketsForAutoreply(limit: number) {
    return db.select().from(scrubbedTickets)
      .where(isNull(scrubbedTickets.hasAutoreply))
      .orderBy(scrubbedTickets.id)
      .limit(limit);
  }

  async updateScrubbedTicketAutoreply(ticketId: number, data: { hasAutoreply: boolean; autoreplyTemplateId: number | null; autoreplyConfidence: number; humanResponseStartsAt: number | null }) {
    await db.update(scrubbedTickets)
      .set({
        hasAutoreply: data.hasAutoreply,
        autoreplyTemplateId: data.autoreplyTemplateId,
        autoreplyConfidence: data.autoreplyConfidence,
        humanResponseStartsAt: data.humanResponseStartsAt,
      })
      .where(eq(scrubbedTickets.ticketId, ticketId));
  }

  async getAutoreplyStats() {
    const totalResult = await db.select({ count: count() }).from(scrubbedTickets).where(sql`has_autoreply IS NOT NULL`);
    const totalAnalyzed = totalResult[0].count;

    const withResult = await db.select({ count: count() }).from(scrubbedTickets).where(eq(scrubbedTickets.hasAutoreply, true));
    const withAutoreply = withResult[0].count;

    const withoutResult = await db.select({ count: count() }).from(scrubbedTickets).where(eq(scrubbedTickets.hasAutoreply, false));
    const withoutAutoreply = withoutResult[0].count;

    const unanalyzedResult = await db.select({ count: count() }).from(scrubbedTickets).where(isNull(scrubbedTickets.hasAutoreply));
    const unanalyzed = unanalyzedResult[0].count;

    const avgResult = await db.execute(sql`SELECT COALESCE(AVG(autoreply_confidence), 0) as avg FROM scrubbed_tickets WHERE has_autoreply = true`);
    const avgConfidence = Number((avgResult as any).rows?.[0]?.avg || (avgResult as any)[0]?.avg || 0);

    const distResult = await db.execute(sql`
      SELECT st.autoreply_template_id as template_id, rt.name as template_name, COUNT(*)::int as count
      FROM scrubbed_tickets st
      LEFT JOIN response_templates rt ON st.autoreply_template_id = rt.template_id
      WHERE st.has_autoreply = true AND st.autoreply_template_id IS NOT NULL
      GROUP BY st.autoreply_template_id, rt.name
      ORDER BY count DESC
    `);
    const rows = (distResult as any).rows || distResult;
    const templateDistribution = (Array.isArray(rows) ? rows : []).map((r: any) => ({
      templateId: r.template_id,
      templateName: r.template_name || `Template ${r.template_id}`,
      count: Number(r.count),
    }));

    const onlyAutoResult = await db.select({ count: count() }).from(scrubbedTickets)
      .where(and(eq(scrubbedTickets.hasAutoreply, true), isNull(scrubbedTickets.humanResponseStartsAt)));
    const onlyAutoreply = onlyAutoResult[0].count;

    return { totalAnalyzed, withAutoreply, withoutAutoreply, unanalyzed, avgConfidence, templateDistribution, onlyAutoreply };
  }

  async getScrubbedTicketsForDialogPattern(limit: number) {
    return db.select().from(scrubbedTickets)
      .where(isNull(scrubbedTickets.dialogPattern))
      .orderBy(scrubbedTickets.id)
      .limit(limit);
  }

  async updateScrubbedTicketDialogPattern(ticketId: number, data: { dialogPattern: string; messagesAfterAutoreply: number; totalMessageCount: number }) {
    await db.update(scrubbedTickets)
      .set({
        dialogPattern: data.dialogPattern,
        messagesAfterAutoreply: data.messagesAfterAutoreply,
        totalMessageCount: data.totalMessageCount,
      })
      .where(eq(scrubbedTickets.ticketId, ticketId));
  }

  async getDialogPatternStats() {
    const totalResult = await db.select({ count: count() }).from(scrubbedTickets).where(sql`dialog_pattern IS NOT NULL`);
    const total = totalResult[0].count;

    const unanalyzedResult = await db.select({ count: count() }).from(scrubbedTickets).where(isNull(scrubbedTickets.dialogPattern));
    const unanalyzed = unanalyzedResult[0].count;

    const patternResult = await db.execute(sql`
      SELECT 
        dialog_pattern as pattern,
        COUNT(*)::int as count,
        COALESCE(AVG(messages_after_autoreply), 0)::real as avg_messages,
        COALESCE(AVG(total_message_count), 0)::real as avg_total
      FROM scrubbed_tickets
      WHERE dialog_pattern IS NOT NULL
      GROUP BY dialog_pattern
      ORDER BY count DESC
    `);
    const patternRows = (patternResult as any).rows || patternResult;
    const patterns = (Array.isArray(patternRows) ? patternRows : []).map((r: any) => ({
      pattern: r.pattern,
      count: Number(r.count),
      avgMessages: Number(Number(r.avg_messages).toFixed(1)),
      avgTotal: Number(Number(r.avg_total).toFixed(1)),
    }));

    const byCategoryResult = await db.execute(sql`
      SELECT 
        COALESCE(hjelpesenter_category, 'Ukjent') as category,
        dialog_pattern as pattern,
        COUNT(*)::int as count
      FROM scrubbed_tickets
      WHERE dialog_pattern IS NOT NULL
      GROUP BY hjelpesenter_category, dialog_pattern
      ORDER BY category, count DESC
    `);
    const byCatRows = (byCategoryResult as any).rows || byCategoryResult;
    const byCategory = (Array.isArray(byCatRows) ? byCatRows : []).map((r: any) => ({
      category: r.category,
      pattern: r.pattern,
      count: Number(r.count),
    }));

    const problematicResult = await db.execute(sql`
      SELECT 
        COALESCE(hjelpesenter_category, 'Ukjent') as category,
        COUNT(*)::int as count
      FROM scrubbed_tickets
      WHERE dialog_pattern = 'autosvar_only'
      GROUP BY hjelpesenter_category
      ORDER BY count DESC
      LIMIT 10
    `);
    const probRows = (problematicResult as any).rows || problematicResult;
    const problematic = (Array.isArray(probRows) ? probRows : []).map((r: any) => ({
      category: r.category,
      count: Number(r.count),
    }));

    return { total, unanalyzed, patterns, byCategory, problematic };
  }

  async identifyGeneralTickets(): Promise<number> {
    const generalMappings = await db
      .select({ id: categoryMappings.id, category: categoryMappings.hjelpesenterCategory })
      .from(categoryMappings)
      .where(
        or(
          ilike(categoryMappings.hjelpesenterCategory, '%generell%'),
          ilike(categoryMappings.hjelpesenterCategory, '%general%'),
          ilike(categoryMappings.hjelpesenterCategory, '%annet%'),
          ilike(categoryMappings.hjelpesenterCategory, '%other%')
        )
      );

    for (const mapping of generalMappings) {
      await db
        .update(categoryMappings)
        .set({
          needsReclassification: true,
          originalCategory: mapping.category,
        })
        .where(eq(categoryMappings.id, mapping.id));
    }

    return generalMappings.length;
  }

  async getTicketsForReclassification(limit: number): Promise<any[]> {
    const results = await db
      .select({
        mappingId: categoryMappings.id,
        ticketId: categoryMappings.ticketId,
        originalCategory: categoryMappings.originalCategory,
        subject: scrubbedTickets.subject,
        customerQuestion: scrubbedTickets.customerQuestion,
        agentAnswer: scrubbedTickets.agentAnswer,
      })
      .from(categoryMappings)
      .innerJoin(scrubbedTickets, eq(scrubbedTickets.id, categoryMappings.ticketId))
      .where(
        and(
          eq(categoryMappings.needsReclassification, true),
          isNull(categoryMappings.reclassifiedCategory),
          isNull(categoryMappings.reclassificationConfidence)
        )
      )
      .orderBy(categoryMappings.id)
      .limit(limit);

    return results;
  }

  async updateReclassification(mappingId: number, data: {
    reclassifiedCategory: string | null;
    reclassifiedSubcategory: string | null;
    reclassificationConfidence: number;
    reclassificationReasoning: string;
  }): Promise<void> {
    await db
      .update(categoryMappings)
      .set({
        reclassifiedCategory: data.reclassifiedCategory,
        reclassifiedSubcategory: data.reclassifiedSubcategory,
        reclassificationConfidence: data.reclassificationConfidence,
        reclassificationReasoning: data.reclassificationReasoning,
      })
      .where(eq(categoryMappings.id, mappingId));
  }

  async getReclassificationStats() {
    const totalGeneralResult = await db
      .select({ count: count() })
      .from(categoryMappings)
      .where(eq(categoryMappings.needsReclassification, true));
    const totalGeneral = totalGeneralResult[0].count;

    const reclassifiedResult = await db
      .select({ count: count() })
      .from(categoryMappings)
      .where(
        and(
          eq(categoryMappings.needsReclassification, true),
          sql`${categoryMappings.reclassifiedCategory} IS NOT NULL`
        )
      );
    const reclassified = reclassifiedResult[0].count;

    const processedResult = await db
      .select({ count: count() })
      .from(categoryMappings)
      .where(
        and(
          eq(categoryMappings.needsReclassification, true),
          sql`${categoryMappings.reclassificationConfidence} IS NOT NULL`
        )
      );
    const processed = processedResult[0].count;
    const remainGeneral = processed - reclassified;
    const unprocessed = totalGeneral - processed;

    const avgConfResult = await db
      .select({ avg: sql<number>`COALESCE(AVG(${categoryMappings.reclassificationConfidence}), 0)` })
      .from(categoryMappings)
      .where(
        and(
          eq(categoryMappings.needsReclassification, true),
          sql`${categoryMappings.reclassificationConfidence} IS NOT NULL`
        )
      );
    const avgConfidence = Number(avgConfResult[0].avg);

    const byCategoryResult = await db
      .select({
        category: categoryMappings.reclassifiedCategory,
        subcategory: categoryMappings.reclassifiedSubcategory,
        count: count(),
        avgConfidence: sql<number>`AVG(${categoryMappings.reclassificationConfidence})`,
      })
      .from(categoryMappings)
      .where(
        and(
          eq(categoryMappings.needsReclassification, true),
          sql`${categoryMappings.reclassifiedCategory} IS NOT NULL`
        )
      )
      .groupBy(categoryMappings.reclassifiedCategory, categoryMappings.reclassifiedSubcategory)
      .orderBy(desc(count()));

    const byCategory = byCategoryResult.map((r) => ({
      category: r.category!,
      subcategory: r.subcategory,
      count: r.count,
      avgConfidence: Number(r.avgConfidence),
    }));

    const trulyGeneralResult = await db
      .select({
        subject: scrubbedTickets.subject,
        reasoning: categoryMappings.reclassificationReasoning,
      })
      .from(categoryMappings)
      .innerJoin(scrubbedTickets, eq(scrubbedTickets.id, categoryMappings.ticketId))
      .where(
        and(
          eq(categoryMappings.needsReclassification, true),
          sql`${categoryMappings.reclassificationConfidence} IS NOT NULL`,
          isNull(categoryMappings.reclassifiedCategory)
        )
      )
      .limit(30);

    const trulyGeneral = trulyGeneralResult.map((r) => ({
      subject: r.subject || '',
      reasoning: r.reasoning || '',
    }));

    return { totalGeneral, reclassified, remainGeneral, unprocessed, avgConfidence, byCategory, trulyGeneral };
  }

  async logChatbotInteraction(interaction: InsertChatbotInteraction) {
    const [result] = await db.insert(chatbotInteractions).values(interaction).returning();
    return result;
  }

  async updateInteractionFeedback(id: number, feedbackResult: string, feedbackComment?: string) {
    const flagged = feedbackResult === "not_resolved";
    await db
      .update(chatbotInteractions)
      .set({
        feedbackResult,
        feedbackComment: feedbackComment || null,
        flaggedForReview: flagged,
        feedbackAt: new Date(),
      })
      .where(eq(chatbotInteractions.id, id));
  }

  async getChatbotInteractions(limit = 100) {
    return db
      .select()
      .from(chatbotInteractions)
      .orderBy(desc(chatbotInteractions.createdAt))
      .limit(limit);
  }

  async getFlaggedInteractions() {
    return db
      .select()
      .from(chatbotInteractions)
      .where(eq(chatbotInteractions.flaggedForReview, true))
      .orderBy(desc(chatbotInteractions.createdAt));
  }

  async getFeedbackStats() {
    const all = await db.select().from(chatbotInteractions);
    let resolved = 0, partial = 0, notResolved = 0, nofeedback = 0;
    const byIntent: Record<string, { total: number; resolved: number; notResolved: number; partial: number }> = {};

    for (const row of all) {
      const intent = row.matchedIntent || "unknown";
      if (!byIntent[intent]) byIntent[intent] = { total: 0, resolved: 0, notResolved: 0, partial: 0 };
      byIntent[intent].total++;

      switch (row.feedbackResult) {
        case "resolved": resolved++; byIntent[intent].resolved++; break;
        case "partial": partial++; byIntent[intent].partial++; break;
        case "not_resolved": notResolved++; byIntent[intent].notResolved++; break;
        default: nofeedback++; break;
      }
    }

    return { total: all.length, resolved, partial, notResolved, nofeedback, byIntent };
  }

  async getInteractionsByIntent(intent: string) {
    return db
      .select()
      .from(chatbotInteractions)
      .where(eq(chatbotInteractions.matchedIntent, intent))
      .orderBy(desc(chatbotInteractions.createdAt));
  }

  async insertTicketHelpCenterMatch(match: InsertTicketHelpCenterMatch) {
    await db.insert(ticketHelpCenterMatches).values(match);
  }

  async getTicketHelpCenterMatches(limit = 200) {
    return db.select().from(ticketHelpCenterMatches).orderBy(desc(ticketHelpCenterMatches.matchConfidence)).limit(limit);
  }

  async getTicketHelpCenterMatchCount() {
    const result = await db.select({ count: count() }).from(ticketHelpCenterMatches);
    return result[0].count;
  }

  async getMatchedTicketIds(): Promise<number[]> {
    const rows = await db.select({ ticketId: ticketHelpCenterMatches.ticketId }).from(ticketHelpCenterMatches);
    return rows.map(r => r.ticketId);
  }

  async getHelpCenterMatchStats() {
    const matches = await db.select().from(ticketHelpCenterMatches);
    const articles = await db.select().from(helpCenterArticles);
    const articleMap = new Map(articles.map(a => [a.id, a.title]));

    let totalConfidence = 0;
    let highAlignment = 0, mediumAlignment = 0, lowAlignment = 0, contradicts = 0, followsProcedure = 0;
    const articleCounts: Record<number, number> = {};
    const missingCounts: Record<string, number> = {};

    for (const m of matches) {
      totalConfidence += m.matchConfidence;
      switch (m.alignmentQuality) {
        case "high": highAlignment++; break;
        case "medium": mediumAlignment++; break;
        case "low": lowAlignment++; break;
        case "contradicts": contradicts++; break;
      }
      if (m.followsOfficialProcedure) followsProcedure++;
      articleCounts[m.articleId] = (articleCounts[m.articleId] || 0) + 1;
      if (m.missingFromAgent) {
        for (const item of m.missingFromAgent) {
          missingCounts[item] = (missingCounts[item] || 0) + 1;
        }
      }
    }

    const topArticles = Object.entries(articleCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([artId, cnt]) => ({ articleId: Number(artId), title: articleMap.get(Number(artId)) || "Ukjent", matchCount: cnt }));

    const commonMissing = Object.entries(missingCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([item]) => item);

    return {
      totalMatches: matches.length,
      avgConfidence: matches.length > 0 ? totalConfidence / matches.length : 0,
      highAlignment,
      mediumAlignment,
      lowAlignment,
      contradicts,
      followsProcedure,
      topArticles,
      commonMissing,
    };
  }

  async deleteAllTicketHelpCenterMatches() {
    await db.delete(ticketHelpCenterMatches);
  }

  async getTicketsForQualityAssessment(limit: number) {
    const assessed = db.select({ ticketId: resolutionQuality.ticketId }).from(resolutionQuality);
    const rows = await db
      .select({
        id: scrubbedTickets.id,
        ticketId: scrubbedTickets.ticketId,
        subject: scrubbedTickets.subject,
        customerQuestion: scrubbedTickets.customerQuestion,
        agentAnswer: scrubbedTickets.agentAnswer,
        messages: scrubbedTickets.messages,
        autoClosed: scrubbedTickets.autoClosed,
        hasAutoreply: scrubbedTickets.hasAutoreply,
        dialogPattern: scrubbedTickets.dialogPattern,
      })
      .from(scrubbedTickets)
      .where(sql`${scrubbedTickets.id} NOT IN (${assessed})`)
      .orderBy(scrubbedTickets.id)
      .limit(limit);
    return rows;
  }

  async insertResolutionQuality(data: InsertResolutionQuality) {
    await db.insert(resolutionQuality).values(data);
  }

  async getResolutionQualityStats() {
    const allRq = await db.select().from(resolutionQuality);
    const totalScrubbed = await this.getScrubbedTicketCount();
    const unassessed = totalScrubbed - allRq.length;

    const qualityMap: Record<string, { count: number; totalConf: number }> = {};
    const catMap: Record<string, Record<string, number>> = {};
    const patternMap: Record<string, Record<string, number>> = {};
    const missingMap: Record<string, number> = {};
    const catTotals: Record<string, { total: number; lowNone: number }> = {};

    for (const rq of allRq) {
      if (!qualityMap[rq.qualityLevel]) qualityMap[rq.qualityLevel] = { count: 0, totalConf: 0 };
      qualityMap[rq.qualityLevel].count++;
      qualityMap[rq.qualityLevel].totalConf += rq.confidence;

      if (rq.dialogPattern) {
        if (!patternMap[rq.dialogPattern]) patternMap[rq.dialogPattern] = {};
        patternMap[rq.dialogPattern][rq.qualityLevel] = (patternMap[rq.dialogPattern][rq.qualityLevel] || 0) + 1;
      }

      if (rq.missingElements) {
        for (const elem of rq.missingElements) {
          missingMap[elem] = (missingMap[elem] || 0) + 1;
        }
      }
    }

    const catMappings = await db.select({
      ticketId: categoryMappings.ticketId,
      category: categoryMappings.hjelpesenterCategory,
    }).from(categoryMappings);
    const ticketCatMap = new Map(catMappings.map(c => [c.ticketId, c.category]));

    for (const rq of allRq) {
      const cat = ticketCatMap.get(rq.ticketId) || "Ukjent";
      if (!catMap[cat]) catMap[cat] = {};
      catMap[cat][rq.qualityLevel] = (catMap[cat][rq.qualityLevel] || 0) + 1;
      if (!catTotals[cat]) catTotals[cat] = { total: 0, lowNone: 0 };
      catTotals[cat].total++;
      if (rq.qualityLevel === "low" || rq.qualityLevel === "none") catTotals[cat].lowNone++;
    }

    const byQuality = ["high", "medium", "low", "none"].map(level => ({
      level,
      count: qualityMap[level]?.count || 0,
      avgConfidence: qualityMap[level] ? qualityMap[level].totalConf / qualityMap[level].count : 0,
    }));

    const byCategory: { category: string; level: string; count: number }[] = [];
    for (const [cat, levels] of Object.entries(catMap)) {
      for (const [level, cnt] of Object.entries(levels)) {
        byCategory.push({ category: cat, level, count: cnt });
      }
    }

    const byPattern: { pattern: string; level: string; count: number }[] = [];
    for (const [pattern, levels] of Object.entries(patternMap)) {
      for (const [level, cnt] of Object.entries(levels)) {
        byPattern.push({ pattern, level, count: cnt });
      }
    }

    const missingElements = Object.entries(missingMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([element, cnt]) => ({ element, count: cnt }));

    const problematic = Object.entries(catTotals)
      .filter(([, v]) => v.lowNone > 0)
      .map(([category, v]) => ({ category, lowNoneCount: v.lowNone, totalCount: v.total, pct: Math.round((v.lowNone / v.total) * 100) }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 10);

    const exampleRows = await db
      .select({
        level: resolutionQuality.qualityLevel,
        subject: scrubbedTickets.subject,
        reasoning: resolutionQuality.reasoning,
        missingElements: resolutionQuality.missingElements,
        positiveElements: resolutionQuality.positiveElements,
      })
      .from(resolutionQuality)
      .innerJoin(scrubbedTickets, eq(resolutionQuality.ticketId, scrubbedTickets.id))
      .orderBy(sql`RANDOM()`)
      .limit(12);

    return {
      total: allRq.length,
      unassessed,
      byQuality,
      byCategory,
      byPattern,
      missingElements,
      problematic,
      examples: exampleRows,
    };
  }

  async getMinsideFieldMappings() {
    return db.select().from(minsideFieldMappings).orderBy(minsideFieldMappings.minsidePage, minsideFieldMappings.minsideField);
  }

  async getActiveMinsideFieldMappings() {
    return db.select().from(minsideFieldMappings).where(eq(minsideFieldMappings.isActive, true)).orderBy(minsideFieldMappings.minsidePage, minsideFieldMappings.minsideField);
  }

  async upsertMinsideFieldMapping(mapping: InsertMinsideFieldMapping) {
    const [result] = await db
      .insert(minsideFieldMappings)
      .values({ ...mapping, updatedAt: new Date() })
      .returning();
    return result;
  }

  async updateMinsideFieldMapping(id: number, data: Partial<InsertMinsideFieldMapping>) {
    await db
      .update(minsideFieldMappings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(minsideFieldMappings.id, id));
  }

  async deleteMinsideFieldMapping(id: number) {
    await db.delete(minsideFieldMappings).where(eq(minsideFieldMappings.id, id));
  }

  async seedMinsideFieldMappings(mappings: InsertMinsideFieldMapping[]) {
    let inserted = 0;
    for (const m of mappings) {
      const existing = await db.select().from(minsideFieldMappings)
        .where(and(
          eq(minsideFieldMappings.minsidePage, m.minsidePage),
          eq(minsideFieldMappings.minsideField, m.minsideField),
        ))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(minsideFieldMappings).values({ ...m, updatedAt: new Date() });
        inserted++;
      }
    }
    return inserted;
  }
}

export const storage = new DatabaseStorage();
