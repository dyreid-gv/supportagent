import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  boolean,
  timestamp,
  real,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const rawTickets = pgTable("raw_tickets", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().unique(),
  category: text("category"),
  categoryId: integer("category_id"),
  subject: text("subject"),
  customerQuestion: text("customer_question"),
  agentAnswer: text("agent_answer"),
  messages: jsonb("messages"),
  resolution: text("resolution"),
  tags: text("tags"),
  autoClosed: boolean("auto_closed").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  closedAt: timestamp("closed_at"),
  processingStatus: text("processing_status").default("pending"),
  processedAt: timestamp("processed_at"),
});

export const scrubbedTickets = pgTable("scrubbed_tickets", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().unique(),
  category: text("category"),
  categoryId: integer("category_id"),
  subject: text("subject"),
  customerQuestion: text("customer_question"),
  agentAnswer: text("agent_answer"),
  messages: jsonb("messages"),
  resolution: text("resolution"),
  tags: text("tags"),
  autoClosed: boolean("auto_closed").default(false),
  categoryMappingStatus: text("category_mapping_status").default("pending"),
  hjelpesenterCategory: text("hjelpesenter_category"),
  hjelpesenterSubcategory: text("hjelpesenter_subcategory"),
  analysisStatus: text("analysis_status").default("pending"),
  hasAutoreply: boolean("has_autoreply"),
  autoreplyTemplateId: integer("autoreply_template_id"),
  autoreplyConfidence: real("autoreply_confidence"),
  humanResponseStartsAt: integer("human_response_starts_at"),
  dialogPattern: text("dialog_pattern"),
  messagesAfterAutoreply: integer("messages_after_autoreply").default(0),
  totalMessageCount: integer("total_message_count").default(0),
  scrubbedAt: timestamp("scrubbed_at").default(sql`CURRENT_TIMESTAMP`),
});

export const hjelpesenterCategories = pgTable("hjelpesenter_categories", {
  id: serial("id").primaryKey(),
  categoryName: text("category_name").notNull(),
  subcategoryName: text("subcategory_name").notNull(),
  urlSlug: text("url_slug"),
  description: text("description"),
});

export const categoryMappings = pgTable("category_mappings", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  pureserviceCategory: text("pureservice_category"),
  hjelpesenterCategory: text("hjelpesenter_category"),
  hjelpesenterSubcategory: text("hjelpesenter_subcategory"),
  confidence: real("confidence"),
  reasoning: text("reasoning"),
  mappedAt: timestamp("mapped_at").default(sql`CURRENT_TIMESTAMP`),
  needsReclassification: boolean("needs_reclassification").default(false),
  originalCategory: text("original_category"),
  reclassifiedCategory: text("reclassified_category"),
  reclassifiedSubcategory: text("reclassified_subcategory"),
  reclassificationConfidence: real("reclassification_confidence"),
  reclassificationReasoning: text("reclassification_reasoning"),
});

export const intentClassifications = pgTable("intent_classifications", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  intent: text("intent"),
  intentConfidence: real("intent_confidence"),
  isNewIntent: boolean("is_new_intent").default(false),
  keywords: text("keywords"),
  requiredRuntimeData: text("required_runtime_data"),
  requiredAction: text("required_action"),
  actionEndpoint: text("action_endpoint"),
  paymentRequired: boolean("payment_required").default(false),
  autoClosePossible: boolean("auto_close_possible").default(false),
  reasoning: text("reasoning"),
  classifiedAt: timestamp("classified_at").default(sql`CURRENT_TIMESTAMP`),
  resolutionExtracted: boolean("resolution_extracted").default(false),
  manuallyReviewed: boolean("manually_reviewed").default(false),
  reviewerEmail: text("reviewer_email"),
  reviewNotes: text("review_notes"),
  reviewedAt: timestamp("reviewed_at"),
  uncertaintyReviewed: boolean("uncertainty_reviewed").default(false),
});

export const resolutionPatterns = pgTable("resolution_patterns", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  intent: text("intent"),
  customerNeed: text("customer_need"),
  dataGathered: text("data_gathered"),
  resolutionSteps: text("resolution_steps"),
  successIndicators: text("success_indicators"),
  followUpNeeded: boolean("follow_up_needed").default(false),
  extractedAt: timestamp("extracted_at").default(sql`CURRENT_TIMESTAMP`),
});

export const playbookEntries = pgTable("playbook_entries", {
  id: serial("id").primaryKey(),
  intent: text("intent").notNull().unique(),
  hjelpesenterCategory: text("hjelpesenter_category"),
  hjelpesenterSubcategory: text("hjelpesenter_subcategory"),
  keywords: text("keywords"),
  requiredRuntimeData: text("required_runtime_data"),
  primaryAction: text("primary_action"),
  primaryEndpoint: text("primary_endpoint"),
  resolutionSteps: text("resolution_steps"),
  successIndicators: text("success_indicators"),
  avgConfidence: real("avg_confidence"),
  ticketCount: integer("ticket_count").default(0),
  paymentRequiredProbability: real("payment_required_probability"),
  autoCloseProbability: real("auto_close_probability"),
  lastUpdated: timestamp("last_updated").default(sql`CURRENT_TIMESTAMP`),
  isActive: boolean("is_active").default(true),

  hasAutoreplyAvailable: boolean("has_autoreply_available").default(false),
  autoreplyTemplateId: integer("autoreply_template_id"),
  autoreplyTemplateName: text("autoreply_template_name"),
  autoreplyContent: text("autoreply_content"),

  typicalDialogPattern: text("typical_dialog_pattern"),
  avgMessagesAfterAutoreply: real("avg_messages_after_autoreply"),
  dialogPatternDistribution: jsonb("dialog_pattern_distribution"),

  wasReclassified: boolean("was_reclassified").default(false),
  originalCategories: text("original_categories").array(),
  reclassifiedFrom: jsonb("reclassified_from"),

  avgResolutionQuality: text("avg_resolution_quality"),
  qualityDistribution: jsonb("quality_distribution"),
  commonMissingElements: text("common_missing_elements").array(),
  commonPositiveElements: text("common_positive_elements").array(),
  needsImprovement: boolean("needs_improvement").default(false),

  helpCenterArticleId: integer("help_center_article_id"),
  helpCenterArticleUrl: text("help_center_article_url"),
  helpCenterArticleTitle: text("help_center_article_title"),
  officialProcedure: text("official_procedure").array(),
  helpCenterContentSummary: text("help_center_content_summary"),

  requiresLogin: boolean("requires_login").default(false),
  requiresAction: boolean("requires_action").default(false),
  actionType: text("action_type"),
  apiEndpoint: text("api_endpoint"),
  httpMethod: text("http_method"),
  requiredRuntimeDataArray: text("required_runtime_data_array").array(),
  paymentRequired: boolean("payment_required").default(false),
  paymentAmount: text("payment_amount"),

  chatbotSteps: text("chatbot_steps").array(),
  combinedResponse: text("combined_response"),

  successfulResolutions: integer("successful_resolutions").default(0),
  failedResolutions: integer("failed_resolutions").default(0),
  totalUses: integer("total_uses").default(0),
  successRate: real("success_rate").default(0.0),
  lastUsedAt: timestamp("last_used_at"),
});

export const uncategorizedThemes = pgTable("uncategorized_themes", {
  id: serial("id").primaryKey(),
  themeName: text("theme_name").notNull(),
  description: text("description"),
  ticketCount: integer("ticket_count").default(0),
  ticketIds: text("ticket_ids"),
  shouldBeNewCategory: boolean("should_be_new_category").default(false),
  suggestedExistingCategory: text("suggested_existing_category"),
  analyzedAt: timestamp("analyzed_at").default(sql`CURRENT_TIMESTAMP`),
  reviewed: boolean("reviewed").default(false),
  reviewerNotes: text("reviewer_notes"),
});

export const uncertaintyCases = pgTable("uncertainty_cases", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  uncertaintyType: text("uncertainty_type"),
  missingInformation: text("missing_information"),
  suggestedQuestions: text("suggested_questions"),
  needsHumanReview: boolean("needs_human_review").default(true),
  reviewPriority: text("review_priority").default("medium"),
  detectedAt: timestamp("detected_at").default(sql`CURRENT_TIMESTAMP`),
});

export const reviewQueue = pgTable("review_queue", {
  id: serial("id").primaryKey(),
  reviewType: text("review_type").notNull(),
  referenceId: integer("reference_id"),
  priority: text("priority").default("medium"),
  data: jsonb("data"),
  status: text("status").default("pending"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  decision: text("decision"),
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  sessionType: text("session_type").default("customer"),
  ownerId: text("owner_id"),
  authenticated: boolean("authenticated").default(false),
  userContext: jsonb("user_context"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const servicePrices = pgTable("service_prices", {
  id: serial("id").primaryKey(),
  serviceKey: text("service_key").notNull().unique(),
  serviceName: text("service_name").notNull(),
  price: real("price").notNull(),
  currency: text("currency").default("NOK"),
  description: text("description"),
  category: text("category"),
  sourceTemplate: text("source_template"),
  effectiveDate: timestamp("effective_date").default(sql`CURRENT_TIMESTAMP`),
  isActive: boolean("is_active").default(true),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const responseTemplates = pgTable("response_templates", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().unique(),
  name: text("name").notNull(),
  subject: text("subject"),
  bodyHtml: text("body_html"),
  bodyText: text("body_text"),
  hjelpesenterCategory: text("hjelpesenter_category"),
  hjelpesenterSubcategory: text("hjelpesenter_subcategory"),
  ticketType: text("ticket_type"),
  intent: text("intent"),
  keyPoints: jsonb("key_points"),
  keywords: text("keywords").array(),
  isActive: boolean("is_active").default(true),
  fetchedAt: timestamp("fetched_at").default(sql`CURRENT_TIMESTAMP`),
});

export const helpCenterArticles = pgTable("help_center_articles", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").unique(),
  url: text("url").notNull().unique(),
  urlSlug: text("url_slug"),
  title: text("title").notNull(),
  bodyHtml: text("body_html"),
  bodyText: text("body_text"),
  hjelpesenterCategory: text("hjelpesenter_category"),
  hjelpesenterSubcategory: text("hjelpesenter_subcategory"),
  categoryPath: text("category_path"),
  relatedArticleUrls: jsonb("related_article_urls"),
  scrapedAt: timestamp("scraped_at").default(sql`CURRENT_TIMESTAMP`),
});

export const chatbotInteractions = pgTable("chatbot_interactions", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id"),
  messageId: integer("message_id"),
  userQuestion: text("user_question").notNull(),
  botResponse: text("bot_response").notNull(),
  responseMethod: text("response_method").default("ai"),
  matchedIntent: text("matched_intent"),
  matchedCategory: text("matched_category"),
  actionsExecuted: jsonb("actions_executed"),
  feedbackResult: text("feedback_result"),
  feedbackComment: text("feedback_comment"),
  flaggedForReview: boolean("flagged_for_review").default(false),
  authenticated: boolean("authenticated").default(false),
  responseTimeMs: integer("response_time_ms"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  feedbackAt: timestamp("feedback_at"),
});

export const ticketHelpCenterMatches = pgTable("ticket_help_center_matches", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  articleId: integer("article_id").notNull(),
  matchConfidence: real("match_confidence").notNull(),
  matchReason: text("match_reason"),
  followsOfficialProcedure: boolean("follows_official_procedure"),
  alignmentQuality: text("alignment_quality"),
  missingFromAgent: text("missing_from_agent").array(),
  addedByAgent: text("added_by_agent").array(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const resolutionQuality = pgTable("resolution_quality", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  qualityLevel: text("quality_level").notNull(),
  confidence: real("confidence").notNull(),
  missingElements: text("missing_elements").array(),
  positiveElements: text("positive_elements").array(),
  reasoning: text("reasoning"),
  hadAutoreply: boolean("had_autoreply"),
  dialogPattern: text("dialog_pattern"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const minsideFieldMappings = pgTable("minside_field_mappings", {
  id: serial("id").primaryKey(),
  minsidePage: text("minside_page").notNull(),
  minsideField: text("minside_field").notNull(),
  fieldDescription: text("field_description").notNull(),
  dataType: text("data_type").notNull(),
  actionType: text("action_type").notNull(),
  hjelpesenterCategory: text("hjelpesenter_category"),
  intent: text("intent"),
  chatbotCapability: text("chatbot_capability"),
  minsideUrl: text("minside_url"),
  adminNotes: text("admin_notes"),
  isActive: boolean("is_active").default(true),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const trainingRuns = pgTable("training_runs", {
  id: serial("id").primaryKey(),
  workflow: text("workflow").notNull(),
  status: text("status").default("pending"),
  totalTickets: integer("total_tickets").default(0),
  processedTickets: integer("processed_tickets").default(0),
  errorCount: integer("error_count").default(0),
  startedAt: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`),
  completedAt: timestamp("completed_at"),
  errorLog: text("error_log"),
});

export const insertResolutionQualitySchema = createInsertSchema(resolutionQuality).omit({ id: true });
export const insertTicketHelpCenterMatchSchema = createInsertSchema(ticketHelpCenterMatches).omit({ id: true });
export const discoveredIntents = pgTable("discovered_intents", {
  id: serial("id").primaryKey(),
  clusterName: text("cluster_name").notNull(),
  suggestedIntent: text("suggested_intent").notNull(),
  description: text("description"),
  category: text("category"),
  ticketCount: integer("ticket_count").default(0),
  ticketIds: text("ticket_ids"),
  sampleMessages: jsonb("sample_messages"),
  resolutionSteps: text("resolution_steps"),
  agentActions: text("agent_actions"),
  actionable: boolean("actionable").default(false),
  requiresOtp: boolean("requires_otp").default(false),
  affectsRegister: boolean("affects_register").default(false),
  affectsOwnership: boolean("affects_ownership").default(false),
  affectsPayment: boolean("affects_payment").default(false),
  confidence: real("confidence").default(0),
  keywords: text("keywords"),
  requiredFields: text("required_fields"),
  actionEndpoint: text("action_endpoint"),
  normalizedIntent: text("normalized_intent"),
  isNewIntentCandidate: boolean("is_new_intent_candidate").default(true),
  similarityScore: real("similarity_score").default(0),
  matchedExistingIntent: text("matched_existing_intent"),
  status: text("status").default("pending"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  promotedToPlaybook: boolean("promoted_to_playbook").default(false),
  discoveredAt: timestamp("discovered_at").default(sql`CURRENT_TIMESTAMP`),
  clusterId: integer("cluster_id"),
  discoveryRunId: integer("discovery_run_id"),
});

export const insertDiscoveredIntentSchema = createInsertSchema(discoveredIntents).omit({ id: true });

export const canonicalIntents = pgTable("canonical_intents", {
  id: serial("id").primaryKey(),
  intentId: text("intent_id").notNull().unique(),
  category: text("category").notNull(),
  subcategory: text("subcategory"),
  source: text("source").notNull(),
  actionable: boolean("actionable").default(false),
  requiredFields: jsonb("required_fields"),
  endpoint: text("endpoint"),
  infoText: text("info_text"),
  approved: boolean("approved").default(false),
  embedding: jsonb("embedding"),
  keywords: text("keywords"),
  description: text("description"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const insertCanonicalIntentSchema = createInsertSchema(canonicalIntents).omit({ id: true });

export const discoveredClusters = pgTable("discovered_clusters", {
  id: serial("id").primaryKey(),
  clusterId: text("cluster_id").notNull(),
  clusterName: text("cluster_name"),
  suggestedIntent: text("suggested_intent"),
  description: text("description"),
  category: text("category"),
  ticketCount: integer("ticket_count").default(0),
  ticketIds: jsonb("ticket_ids"),
  topKeywords: jsonb("top_keywords"),
  sampleMessages: jsonb("sample_messages"),
  exampleSubjects: jsonb("example_subjects"),
  sampleSnippets: jsonb("sample_snippets"),
  centroidEmbedding: jsonb("centroid_embedding"),
  actionable: boolean("actionable").default(false),
  confidence: real("confidence").default(0),
  normalizedIntent: text("normalized_intent"),
  isNewCandidate: boolean("is_new_candidate").default(true),
  similarityScore: real("similarity_score").default(0),
  matchedCanonicalIntent: text("matched_canonical_intent"),
  status: text("status").default("pending"),
  discoveryRunId: integer("discovery_run_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const insertDiscoveredClusterSchema = createInsertSchema(discoveredClusters).omit({ id: true });

export const escalationsOutbox = pgTable("escalations_outbox", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  sessionId: text("session_id"),
  intentId: text("intent_id"),
  matchedBy: text("matched_by"),
  semanticScore: real("semantic_score"),
  userEmail: text("user_email").notNull(),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  category1Id: text("category1_id"),
  category2Id: text("category2_id"),
  category3Id: text("category3_id"),
  pureserviceTicketId: text("pureservice_ticket_id"),
  status: text("status").default("pending").notNull(),
  chatTranscript: text("chat_transcript"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  postedAt: timestamp("posted_at"),
  errorMessage: text("error_message"),
});

export const insertEscalationSchema = createInsertSchema(escalationsOutbox).omit({ id: true, createdAt: true, postedAt: true });

export const insertChatbotInteractionSchema = createInsertSchema(chatbotInteractions).omit({ id: true });
export const insertHelpCenterArticleSchema = createInsertSchema(helpCenterArticles).omit({ id: true });
export const insertResponseTemplateSchema = createInsertSchema(responseTemplates).omit({ id: true });
export const insertServicePriceSchema = createInsertSchema(servicePrices).omit({ id: true });
export const insertRawTicketSchema = createInsertSchema(rawTickets).omit({ id: true });
export const insertScrubbedTicketSchema = createInsertSchema(scrubbedTickets).omit({ id: true });
export const insertCategoryMappingSchema = createInsertSchema(categoryMappings).omit({ id: true });
export const insertIntentClassificationSchema = createInsertSchema(intentClassifications).omit({ id: true });
export const insertResolutionPatternSchema = createInsertSchema(resolutionPatterns).omit({ id: true });
export const insertPlaybookEntrySchema = createInsertSchema(playbookEntries).omit({ id: true });
export const insertUncategorizedThemeSchema = createInsertSchema(uncategorizedThemes).omit({ id: true });
export const insertUncertaintyCaseSchema = createInsertSchema(uncertaintyCases).omit({ id: true });
export const insertReviewQueueSchema = createInsertSchema(reviewQueue).omit({ id: true });
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertMinsideFieldMappingSchema = createInsertSchema(minsideFieldMappings).omit({ id: true });
export const insertTrainingRunSchema = createInsertSchema(trainingRuns).omit({ id: true });

export type RawTicket = typeof rawTickets.$inferSelect;
export type InsertRawTicket = z.infer<typeof insertRawTicketSchema>;
export type ScrubbedTicket = typeof scrubbedTickets.$inferSelect;
export type InsertScrubbedTicket = z.infer<typeof insertScrubbedTicketSchema>;
export type HjelpesenterCategory = typeof hjelpesenterCategories.$inferSelect;
export type CategoryMapping = typeof categoryMappings.$inferSelect;
export type InsertCategoryMapping = z.infer<typeof insertCategoryMappingSchema>;
export type IntentClassification = typeof intentClassifications.$inferSelect;
export type InsertIntentClassification = z.infer<typeof insertIntentClassificationSchema>;
export type ResolutionPattern = typeof resolutionPatterns.$inferSelect;
export type InsertResolutionPattern = z.infer<typeof insertResolutionPatternSchema>;
export type PlaybookEntry = typeof playbookEntries.$inferSelect;
export type InsertPlaybookEntry = z.infer<typeof insertPlaybookEntrySchema>;
export type UncategorizedTheme = typeof uncategorizedThemes.$inferSelect;
export type UncertaintyCase = typeof uncertaintyCases.$inferSelect;
export type ReviewQueueItem = typeof reviewQueue.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type ChatbotInteraction = typeof chatbotInteractions.$inferSelect;
export type InsertChatbotInteraction = z.infer<typeof insertChatbotInteractionSchema>;
export type HelpCenterArticle = typeof helpCenterArticles.$inferSelect;
export type InsertHelpCenterArticle = z.infer<typeof insertHelpCenterArticleSchema>;
export type ResponseTemplate = typeof responseTemplates.$inferSelect;
export type InsertResponseTemplate = z.infer<typeof insertResponseTemplateSchema>;
export type ServicePrice = typeof servicePrices.$inferSelect;
export type InsertServicePrice = z.infer<typeof insertServicePriceSchema>;
export type ResolutionQualityRecord = typeof resolutionQuality.$inferSelect;
export type InsertResolutionQuality = z.infer<typeof insertResolutionQualitySchema>;
export type TicketHelpCenterMatch = typeof ticketHelpCenterMatches.$inferSelect;
export type InsertTicketHelpCenterMatch = z.infer<typeof insertTicketHelpCenterMatchSchema>;
export type MinsideFieldMapping = typeof minsideFieldMappings.$inferSelect;
export type InsertMinsideFieldMapping = z.infer<typeof insertMinsideFieldMappingSchema>;
export type TrainingRun = typeof trainingRuns.$inferSelect;
export type DiscoveredIntent = typeof discoveredIntents.$inferSelect;
export type InsertDiscoveredIntent = z.infer<typeof insertDiscoveredIntentSchema>;
export type CanonicalIntent = typeof canonicalIntents.$inferSelect;
export type InsertCanonicalIntent = z.infer<typeof insertCanonicalIntentSchema>;
export type DiscoveredCluster = typeof discoveredClusters.$inferSelect;
export type InsertDiscoveredCluster = z.infer<typeof insertDiscoveredClusterSchema>;
export type EscalationOutbox = typeof escalationsOutbox.$inferSelect;
export type InsertEscalation = z.infer<typeof insertEscalationSchema>;
