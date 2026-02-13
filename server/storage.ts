import { db } from "./db";
import { eq, desc, sql, count, and, isNull } from "drizzle-orm";
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
  type InsertRawTicket,
  type InsertScrubbedTicket,
  type InsertCategoryMapping,
  type InsertIntentClassification,
  type InsertResolutionPattern,
  type InsertPlaybookEntry,
  type InsertConversation,
  type InsertMessage,
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
  updateScrubbedTicketMapping(ticketId: number, category: string, subcategory: string): Promise<void>;
  updateScrubbedTicketAnalysis(ticketId: number, status: string): Promise<void>;

  getHjelpesenterCategories(): Promise<typeof hjelpesenterCategories.$inferSelect[]>;
  seedHjelpesenterCategories(categories: { categoryName: string; subcategoryName: string; urlSlug: string; description: string }[]): Promise<void>;

  insertCategoryMapping(mapping: InsertCategoryMapping): Promise<void>;
  getCategoryMappingCount(): Promise<number>;

  insertIntentClassification(classification: InsertIntentClassification): Promise<void>;
  getIntentClassificationCount(): Promise<number>;
  getClassifiedTicketsWithoutResolution(limit: number): Promise<typeof intentClassifications.$inferSelect[]>;

  insertResolutionPattern(pattern: InsertResolutionPattern): Promise<void>;
  getResolutionPatternCount(): Promise<number>;

  getPlaybookEntries(): Promise<typeof playbookEntries.$inferSelect[]>;
  getActivePlaybookEntries(): Promise<typeof playbookEntries.$inferSelect[]>;
  upsertPlaybookEntry(entry: InsertPlaybookEntry): Promise<void>;
  getPlaybookEntryCount(): Promise<number>;

  getTrainingStats(): Promise<{
    rawTickets: number;
    scrubbedTickets: number;
    categoryMappings: number;
    intentClassifications: number;
    resolutionPatterns: number;
    playbookEntries: number;
    uncertaintyCases: number;
  }>;

  createTrainingRun(workflow: string, totalTickets: number): Promise<number>;
  updateTrainingRunProgress(id: number, processed: number): Promise<void>;
  completeTrainingRun(id: number, errorCount: number, errorLog?: string): Promise<void>;
  getLatestTrainingRuns(limit: number): Promise<typeof trainingRuns.$inferSelect[]>;

  createConversation(data: InsertConversation): Promise<typeof conversations.$inferSelect>;
  getConversation(id: number): Promise<typeof conversations.$inferSelect | undefined>;
  getAllConversations(): Promise<typeof conversations.$inferSelect[]>;
  deleteConversation(id: number): Promise<void>;
  updateConversationAuth(id: number, ownerId: string): Promise<void>;

  createMessage(data: InsertMessage): Promise<typeof messages.$inferSelect>;
  getMessagesByConversation(conversationId: number): Promise<typeof messages.$inferSelect[]>;
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
      .where(eq(scrubbedTickets.analysisStatus, "pending"))
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

  async insertCategoryMapping(mapping: InsertCategoryMapping): Promise<void> {
    await db.insert(categoryMappings).values(mapping);
  }

  async getCategoryMappingCount(): Promise<number> {
    const result = await db.select({ count: count() }).from(categoryMappings);
    return result[0].count;
  }

  async insertIntentClassification(classification: InsertIntentClassification): Promise<void> {
    await db.insert(intentClassifications).values(classification);
  }

  async getIntentClassificationCount(): Promise<number> {
    const result = await db.select({ count: count() }).from(intentClassifications);
    return result[0].count;
  }

  async getClassifiedTicketsWithoutResolution(limit: number) {
    return db
      .select()
      .from(intentClassifications)
      .where(eq(intentClassifications.resolutionExtracted, false))
      .limit(limit);
  }

  async insertResolutionPattern(pattern: InsertResolutionPattern): Promise<void> {
    await db.insert(resolutionPatterns).values(pattern);
  }

  async getResolutionPatternCount(): Promise<number> {
    const result = await db.select({ count: count() }).from(resolutionPatterns);
    return result[0].count;
  }

  async getPlaybookEntries() {
    return db.select().from(playbookEntries);
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

  async getTrainingStats() {
    const [raw, scrubbed, catMap, intents, resolutions, playbook, uncertainty] = await Promise.all([
      db.select({ count: count() }).from(rawTickets),
      db.select({ count: count() }).from(scrubbedTickets),
      db.select({ count: count() }).from(categoryMappings),
      db.select({ count: count() }).from(intentClassifications),
      db.select({ count: count() }).from(resolutionPatterns),
      db.select({ count: count() }).from(playbookEntries),
      db.select({ count: count() }).from(uncertaintyCases),
    ]);
    return {
      rawTickets: raw[0].count,
      scrubbedTickets: scrubbed[0].count,
      categoryMappings: catMap[0].count,
      intentClassifications: intents[0].count,
      resolutionPatterns: resolutions[0].count,
      playbookEntries: playbook[0].count,
      uncertaintyCases: uncertainty[0].count,
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

  async updateConversationAuth(id: number, ownerId: string): Promise<void> {
    await db
      .update(conversations)
      .set({ authenticated: true, ownerId })
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
}

export const storage = new DatabaseStorage();
