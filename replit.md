# DyreID Support AI

## Overview
AI-powered support automation system for DyreID (Norway's national pet ID registry). Two integrated parts:

1. **Training Agent (DEL 1)**: 9-workflow pipeline that ingests ~40,000 historical support tickets from Pureservice API, GDPR-scrubs them, maps to 9 help center categories, analyzes uncategorized tickets, classifies intents (34 known intents), extracts resolution patterns, detects uncertainty, builds a Support Playbook, and provides manual review UI
2. **Customer Chatbot (DEL 2)**: Uses the playbook to provide automated support, authenticates via Min Side OTP, retrieves owner/pet context, and executes actions

## Architecture
- **Stack**: Express + Vite + React + PostgreSQL + Drizzle ORM
- **AI**: OpenAI via egen API-nøkkel (gpt-5-nano for training workflows, gpt-5-mini for complex analysis, gpt-4o for chatbot)
- **Auth**: OTP-based via Min Side sandbox (demo phones: 91000001-91000005)

## Project Structure
```
shared/
  schema.ts          - Drizzle schema: 14 tables (raw_tickets, scrubbed_tickets, hjelpesenter_categories, category_mappings, intent_classifications, resolution_patterns, playbook_entries, uncategorized_themes, uncertainty_cases, review_queue, conversations/messages, training_runs, service_prices, response_templates)
server/
  routes.ts          - API routes: 9 SSE training endpoints, review queue, chat, MinSide actions
  storage.ts         - IStorage interface + DatabaseStorage with full CRUD for all 14 tables
  training-agent.ts  - 9-workflow pipeline with all workflow functions + manual review handler
  chatbot.ts         - Streaming AI chatbot with playbook context and action execution
  pureservice.ts     - Pureservice API client for ticket and template fetching, category mapping
  gdpr-scrubber.ts   - GDPR PII removal: names, phones, emails, addresses, chip numbers, IPs, payment refs
  minside-sandbox.ts - Demo sandbox with 5 users simulating various pet/owner scenarios
  db.ts              - Database connection (Neon serverless)
client/src/
  App.tsx            - Sidebar layout with Dashboard and Chatbot routes
  pages/
    dashboard.tsx    - 9-workflow pipeline controls, 9 stat cards, 8 tabs (Pipeline, Playbook, Review Queue, Themes, Uncertainty, History, Priser, Autosvar)
    chatbot.tsx      - Chat interface with streaming messages, OTP auth, suggestions
  components/
    theme-provider.tsx - Light/dark mode toggle
    theme-toggle.tsx
```

## 9 Training Workflows
1. **Pureservice Ticket Ingestion** - Fetch closed tickets from Pureservice API with pagination
2. **GDPR Scrubbing** - Remove PII (phones, emails, chips, names, addresses, postcodes, IPs, payment refs)
3. **Hjelpesenter Category Mapping** - Map to 9 DyreID categories via Claude AI (categories loaded from CSV)
4. **Uncategorized Ticket Analysis** - Cluster analysis of "Ukategorisert" tickets for theme identification
5. **Intent Classification** - Classify customer intent using 34 known intents via Claude AI
6. **Resolution Extraction** - Extract step-by-step resolution patterns from ticket dialogues
7. **Uncertainty Detector** - Identify low-confidence classifications and flag for review
8. **Playbook Builder** - Aggregate all data into final Support Playbook
9. **Manual Review Handler** - Human review of uncertain cases via Review Queue UI

## Key Features
- **9-Step Pipeline**: SSE-streamed workflows with real-time progress monitoring
- **GDPR Compliance**: Regex-based PII masking before AI analysis
- **CSV-Loaded Categories**: 9 hjelpesenter categories with 36 subcategories loaded from CSV file
- **34 Known Intents**: Comprehensive intent classification (LoginIssue, OwnershipTransfer, QRTagActivation, etc.)
- **Batch Processing**: Intent classification sends 5 tickets per Claude call (5x faster)
- **Review Queue**: Manual review UI for uncertain classifications and new intents
- **OTP Auth**: Two-step OTP login via Min Side (minside.dyreid.no) with sandbox fallback for demo phones
- **Quick Intent Matching**: 11 regex patterns for instant responses (<1s) before falling back to Claude
- **Sandbox Users**: 5 demo profiles (91000001-91000005) with varied scenarios
- **Chatbot Actions**: Mark lost/found, activate QR, initiate transfers, send payment links
- **Streaming Responses**: SSE-based real-time AI responses

## API Endpoints
### Training Pipeline
- POST /api/training/ingest (SSE)
- POST /api/training/scrub (SSE)
- POST /api/training/categorize (SSE)
- POST /api/training/analyze-uncategorized (SSE)
- POST /api/training/classify (SSE) - batch mode: 5 tickets per Claude call
- POST /api/training/extract-resolutions (SSE)
- POST /api/training/detect-uncertainty (SSE)
- POST /api/training/generate-playbook (SSE)
- GET /api/training/review-queue
- POST /api/training/submit-review
- GET /api/training/uncategorized-themes
- GET /api/training/uncertainty-cases
- GET /api/training/stats

### OTP Authentication (proxy to Min Side)
- POST /api/auth/send-otp - Send OTP to phone/email (proxied via backend, sandbox fallback)
- POST /api/auth/verify-otp - Verify OTP code and get user context
- GET /api/auth/user-context - Get user details by contact method

### Data
- GET /api/playbook
- GET /api/categories
- POST /api/categories/reload-csv

### Admin/Export
- GET /api/admin/tables - Table overview with row counts
- GET /api/admin/export/:table - Export table as JSON or CSV
- GET /api/admin/export-all - Export all tables as JSON
- GET /api/admin/schema - Database schema info

## Environment Variables
- `PURESERVICE_API_KEY` - API key for Pureservice ticket system
- `SESSION_SECRET` - Session encryption key
- `DATABASE_URL` - PostgreSQL connection string (auto-provided)
- `OPENAI_API_KEY` - OpenAI API key (user-provided, used by both training agent and chatbot)

### Combined Batch Analysis
- POST /api/training/test-combined (SSE) - Combined batch analysis: category + intent + resolution in one API call per 10 tickets, 5x parallel

### Feedback Loop System
- POST /api/feedback - Submit feedback (resolved/partial/not_resolved) for a chatbot interaction
- GET /api/feedback/stats - Feedback statistics with per-intent breakdown
- GET /api/feedback/flagged - Flagged interactions (not_resolved) for review
- GET /api/feedback/interactions - Recent chatbot interactions

## Recent Changes
- 2026-02-14: Feedback loop system - chatbot_interactions table logs all user/bot exchanges with response method, matched intent, timing. Feedback widget on assistant messages (thumbs up/down/neutral). Dashboard Tilbakemelding tab with stats cards, flagged interactions, per-intent breakdown, and recent interaction log. Interactions flagged when marked "not_resolved".
- 2026-02-14: Combined batch analysis with 5x parallel processing. Category + intent + resolution in ONE API call per 10 tickets using gpt-5-mini with JSON mode. Autosvar detection, dialog pattern classification, resolution quality scoring. Test endpoint resets and re-analyzes tickets. Dashboard button for triggering combined analysis. Estimated <20 hours for 40K tickets.
- 2026-02-14: Downloaded all 22 Pureservice auto-response templates, mapped to hjelpesenter categories/intents, stored in response_templates table. Integrated into chatbot system prompt as official response guidelines. Autosvar tab on dashboard shows templates grouped by category with expandable body/key points.
- 2026-02-14: Added service_prices table with admin UI (Priser tab) for configurable pricing. 10 identified prices from Pureservice templates. Prices injected into chatbot system prompt. CRUD API at /api/prices.
- 2026-02-14: Switched training agent AI from Claude (Anthropic) to OpenAI via Replit AI Integrations. claude-haiku-4-5 → gpt-5-nano, claude-sonnet-4-5 → gpt-5-mini. Chatbot remains on Claude.
- 2026-02-14: Fixed chatbot auth context - user context from OTP login now stored in DB (conversations.userContext jsonb) and passed to AI system prompt. Quick intent patterns are auth-aware. Chatbot correctly identifies logged-in users and their pets.
- 2026-02-14: OTP integration with Min Side (minside.dyreid.no) via backend proxy, quick intent matching (11 patterns), batch intent classification (5x faster), admin panel with data export
- 2026-02-13: Complete 9-workflow Training Agent with dashboard, review queue UI, CSV-loaded categories, 34 known intents, uncertainty detection, uncategorized theme analysis
