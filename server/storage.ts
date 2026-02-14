import { db } from "./db";
import { eq, desc, sql, count, and, isNull, lt, or } from "drizzle-orm";
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
  updateConversationAuth(id: number, ownerId: string, userContext?: any): Promise<void>;

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

  logChatbotInteraction(interaction: InsertChatbotInteraction): Promise<typeof chatbotInteractions.$inferSelect>;
  updateInteractionFeedback(id: number, feedbackResult: string, feedbackComment?: string): Promise<void>;
  getChatbotInteractions(limit?: number): Promise<typeof chatbotInteractions.$inferSelect[]>;
  getFlaggedInteractions(): Promise<typeof chatbotInteractions.$inferSelect[]>;
  getFeedbackStats(): Promise<{ total: number; resolved: number; partial: number; notResolved: number; nofeedback: number; byIntent: Record<string, { total: number; resolved: number; notResolved: number; partial: number }> }>;
  getInteractionsByIntent(intent: string): Promise<typeof chatbotInteractions.$inferSelect[]>;
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

  async upsertPlaybookEntry(entry: InsertPlaybookEntry): Promise<void> {
    await db
      .insert(playbookEntries)
      .values(entry)
      .onConflictDoNothing();
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

  async updateConversationAuth(id: number, ownerId: string, userContext?: any): Promise<void> {
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
}

export const storage = new DatabaseStorage();
