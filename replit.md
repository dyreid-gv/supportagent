# DyreID Support AI

## Aktiv utviklingstråd — Discovery + Continuous Learning (feb 2026)

> **Status**: Pågående implementering — Steg 0–11
> **Sist oppdatert**: 16. februar 2026
> **Tråd-ID**: DISCOVERY-CL-001

### Tråd-historikk (kronologisk)
1. **Intent Normalization Layer (ferdig)** — Implementerte semantisk sammenligning av oppdagede intents mot Help Center + Playbook. Auto-map > 0.75, new candidate < 0.75. Dashboard med 4 stat-kort, auto-mapped seksjon med promote-knapper.
2. **Pureservice-struktur gjennomgang** — Kartla ticket-feltene (category1Id, communications[], etc.) og TEMPLATE_CATEGORY_MAPPING (21 hardkodede template-IDer → kategori/intent).
3. **9-stegs implementasjonsplan (diskutert)** — Bruker ga detaljert steg-for-steg for ukategoriserte saker: identifiser → cluster-tekst → HDBSCAN → oppsummering → GPT intent-forslag → normalisering → review → promote → test.
4. **Full implementasjonsprompt (diskutert, ikke startet)** — Utvidet til 12 steg (0–11) med: Canonical Intent Registry, embedding-basert clustering, continuous learning, pilot batch test, runtime safety. Kjerneprinsipp: trening = AI-assistert, runtime = deterministisk + voktet.

### Hva gjenstår å implementere
- **Steg 0**: `canonical_intents`-tabell med embedding-vektor + migrering av alle eksisterende intents
- **Steg 1**: `isUncategorized(ticket)` predikat-funksjon
- **Steg 2**: Deterministisk `cluster_text`-konstruksjon
- **Steg 3**: Embeddings + HDBSCAN clustering (erstatte GPT-basert)
- **Steg 4**: `discovered_clusters`-tabell med oppsummeringskort
- **Steg 5**: GPT intent-forslag per cluster (kun label/type, ingen prosedyrer)
- **Steg 6**: Normalisering mot `canonical_intents` (embedding similarity)
- **Steg 7**: Utvidet review-UI (subcategory, infoText, endpoint-blokkering, provenance)
- **Steg 8**: Promote + continuous learning (refresh embedding index)
- **Steg 9**: Pilot batch test (1000 tickets, rapport)
- **Steg 10**: Runtime safety verification (30 testspørsmål)
- **Steg 11**: Continuous learning regler (aldri auto-promote)

### Viktige designbeslutninger (denne tråden)
- `canonical_intents` erstatter spredte intent-kilder (TEMPLATE_CATEGORY_MAPPING, INTENT_DEFINITIONS, Playbook)
- Runtime bruker KUN `canonical_intents WHERE approved=true`
- GPT i trening: kun label/type-forslag, aldri prosedyrer/endpoints/prising
- Embedding-basert clustering (HDBSCAN) som default, GPT-clustering som fallback via env toggle
- All læring må gjennom menneskelig godkjenning

---

## Overview
This project is an AI-powered support automation system for DyreID, Norway's national pet ID registry. It consists of two main components:

1.  **Training Agent**: A sophisticated 9-workflow pipeline designed to ingest historical support tickets, perform GDPR scrubbing, categorize them, classify user intents, extract resolution patterns, detect uncertainties, and ultimately build a comprehensive Support Playbook. This process involves analyzing large datasets of customer interactions to create a robust knowledge base for automated support.
2.  **Customer Chatbot**: This component utilizes the generated Support Playbook to provide automated customer support. It features user authentication, retrieval of owner and pet context, and the ability to execute specific actions based on user requests, significantly streamlining support operations.

The overarching goal is to enhance DyreID's customer service efficiency, reduce response times, and provide consistent, high-quality support through advanced AI capabilities.

## User Preferences
I prefer clear and concise communication.
I value an iterative development process.
I want to be consulted before any major architectural or feature changes are implemented.
I expect detailed explanations for complex technical decisions.
Do not make changes to files in the `shared/` folder without explicit approval.

## System Architecture
The system is built on a modern web stack comprising Express, Vite, React, PostgreSQL, and Drizzle ORM. AI capabilities are powered by OpenAI, utilizing different models for training workflows (gpt-5-nano, gpt-5-mini) and runtime intent classification (gpt-4o). Authentication is handled via an OTP-based system integrated with the Min Side platform, with a sandbox environment for development and testing.

**Architecture Decisions (Feb 2026):**
*   **Closed-domain action agent**: The chatbot is NOT an open-domain reasoning chatbot. It is a stateful action agent that performs authenticated operations via OTP login to Min Side.
*   **No runtime OpenAI fallback**: GPT is NEVER used to generate procedures, pricing, or resolution logic at runtime. The old OpenAI streaming fallback has been replaced with a BLOCK response that escalates to human support.
*   **Runtime GPT usage — what is allowed vs blocked**:
    *   OpenAI must NOT be used for runtime resolution generation.
    *   It MAY be used for: (1) Intent interpretation — classifying user messages to allowlisted intents with confidence scoring, (2) Fuzzy semantic understanding — tolerating typos and varied phrasing, (3) Paraphrasing of existing Playbook informational content (with guardrails).
    *   It must NOT: explain procedures, suggest actions, infer pricing, describe ownership transfer steps.
*   **Transactional vs Informational intent separation**:
    *   **Transactional intents** (e.g. OwnershipTransferWeb, LostPetReport, QRTagActivation, CancelSubscription, ForeignChipRegistration): Require OTP authentication, modify register data, may trigger payment. GPT may ONLY interpret intent + return match with confidence. GPT must NOT explain procedure, suggest next steps, or describe how to perform the operation. Runtime must: collect requiredData → execute actionEndpoint — without GPT involvement.
    *   **Informational intents** (e.g. OwnershipTransferPrice, DyreIDPlusInfo, QRSubscriptionInfo, FamilySharingExplanation): Do not modify register data, based on Help Center content. GPT MAY paraphrase existing Playbook infoText and adapt tone to user message. GPT must NOT generate new procedures, infer pricing not present in Playbook, or suggest operational steps.
    *   **Runtime rule**: `if (playbook.actionable) → transactional flow (collectRequiredData → executeEndpoint)` else `→ informational flow (paraphrase infoText)`.
*   **Training agent extracts structured data**: Step 6 (Resolution Extraction) now extracts actionable/informational classification, required data fields, action endpoints, and guidance steps — NOT natural-language agent replies.
*   **Response hierarchy**: 1. Regex match → 2. Playbook keyword → 3. GPT intent interpretation (confidence >= 0.7) → 4. Category menu → 5. BLOCK/escalation.
*   **Paraphrase guardrails**: GPT paraphrasing rejects output containing veterinær, chip insertion, new pricing, or contact support if not in original text. Rejects if output > 2.5x original length.

**UI/UX Decisions:**
The client-side application is a React-based single-page application.
The UI features a sidebar layout for navigation between a Dashboard and Chatbot interface.
The Dashboard provides real-time monitoring of the 9-workflow pipeline, statistics, and various analytical tabs (Playbook, Review Queue, Themes, Uncertainty, History, Prices, Autoreply).
The Chatbot interface includes streaming messages, OTP authentication, and interactive suggestions for enhanced user experience.
A light/dark mode toggle is available for user preference.

**Technical Implementations & Feature Specifications:**
**Training Agent Workflows:**
*   **Pureservice Ticket Ingestion**: Fetches closed tickets with pagination.
*   **GDPR Scrubbing**: Regex-based PII masking for compliance.
*   **Hjelpesenter Category Mapping**: AI-driven categorization using 9 DyreID categories and 60 subcategories loaded from CSV.
*   **Uncategorized Ticket Analysis / Domain Discovery**: Cluster analysis for theme identification. Includes Intent Normalization Layer (Step 2B) that uses GPT-4o to compare discovered intent clusters against both Help Center intents (INTENT_DEFINITIONS) and existing Playbook entries. Auto-maps when semantic similarity > 0.75 (inheriting operational properties from matched intents) or flags as new candidates requiring human review when < 0.75. Auto-mapped intents inherit actionable, requiredFields, endpoint, category from matched Playbook entries, or category from Help Center intents. Dashboard shows 4 stat cards (New Candidates, Auto-mapped, Approved, Rejected) and auto-mapped section with original→normalized mapping, similarity scores, and promote buttons.
*   **Intent Classification**: Classifies customer intent using 62 predefined intents across 10 categories.
*   **Resolution Extraction**: Extracts step-by-step resolution patterns from dialogues.
*   **Uncertainty Detector**: Flags low-confidence classifications for manual review.
*   **Playbook Builder**: Aggregates all processed data into the final Support Playbook, now data-driven rather than AI-generated, incorporating autoreply templates, dialog patterns, reclassification tracking, resolution quality analysis, and chatbot feedback.
*   **Manual Review Handler**: Provides a UI for human review of uncertain cases and new intents.

**Chatbot Features:**
*   **OTP Authentication**: Secure login via Min Side with sandbox support. Login dialog with phone/OTP steps and inline login prompts for Min Side-related questions.
*   **Session Lifecycle**: When a user closes the chat ("Avslutt") or deletes a conversation, the Min Side session is automatically cleared (server-side logout via `POST /api/chat/conversations/:id/logout`), and the chatbot session state is reset.
*   **Modern Chat UI**: Rounded message bubbles, species-specific pet icons (Dog/Cat/PawPrint), intent-specific action icons, quick action grid on welcome screen, sidebar auth panel with pet cards, and feedback widgets.
*   **Chip Lookup (ID-søk)**: Multi-turn flow for looking up pets by chip number (ID-nummer). Presents structured pet/owner info from dyreid.no registry (sandbox mode). Offers to send SMS to registered owner for ownership transfer contact. SMS template: "Hei - vi er blitt kontaktet av [kundens navn] vedrørende eierskifte av [dyrets navn]. Vennligst ta direkte kontakt på [kundens mob]. Med vennlig hilsen DyreID". Sandbox safety guard: SMS only sent to test number 91341434.
*   **Quick Intent Matching**: 62 regex patterns for instant responses, falling back to OpenAI.
*   **Contextual Understanding**: Utilizes user and pet context from authentication for personalized responses.
*   **Action Execution**: Can mark lost/found pets, activate QR codes, initiate transfers, and send payment links.
*   **Streaming Responses**: Provides real-time AI responses using Server-Sent Events (SSE).
*   **Feedback System**: Logs chatbot interactions, user feedback, and flags problematic interactions for review.

**System Design Choices:**
*   **Database Schema**: Drizzle ORM manages 14 tables, including raw/scrubbed tickets, category mappings, intent classifications, resolution patterns, playbook entries, conversation logs, and training run metadata.
*   **Centralized Intent Definitions**: 62 intents are defined in `shared/intents.ts` as a single source of truth.
*   **Batch Processing**: Intent classification processes multiple tickets per API call for efficiency.
*   **Combined Batch Analysis**: A unified API endpoint for simultaneous category, intent, and resolution analysis, including autoreply detection, dialog pattern classification, and resolution quality scoring.
*   **Dynamic Pricing**: A `service_prices` table with an admin UI allows for configurable pricing information to be injected into the chatbot's system prompt.
*   **Autoreply Detection**: Identifies and categorizes autoreply patterns in ticket dialogues, generating keywords for response templates.
*   **Dialog Pattern Analysis**: Classifies dialogue patterns in tickets to identify efficient vs. problematic resolution flows.
*   **Reclassification**: AI-driven reclassification of generic tickets to standard categories.
*   **Resolution Quality Assessment**: AI assesses resolution quality for tickets, providing insights into problematic categories and missing elements.
*   **Real Min Side Integration**: Direct integration with Min Side for real-time pet list, payment history, and owner information retrieval via HTML parsing, caching session cookies for efficiency.

## External Dependencies
*   **OpenAI API**: Used for various AI tasks including intent classification, resolution extraction, uncertainty detection, playbook generation, autoreply keyword generation, dialog pattern analysis, reclassification, and resolution quality assessment.
*   **Pureservice API**: Used for ingesting historical support tickets and fetching response templates.
*   **PostgreSQL (Neon Serverless)**: The primary database for storing all project data.
*   **Min Side (DyreID's user portal)**: Used for OTP-based user authentication and retrieving user/pet context, integrated via a backend proxy for real users and a sandbox for development.