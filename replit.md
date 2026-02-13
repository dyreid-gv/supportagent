# DyreID Support AI

## Overview
AI-powered support automation system for DyreID (Norway's national pet ID registry). Two integrated parts:

1. **Training Agent**: Ingests ~40,000 historical support tickets from Pureservice API, GDPR-scrubs them, maps to 9 help center categories, classifies intents, extracts resolution patterns, and builds a "Support Playbook"
2. **Customer Chatbot**: Uses the playbook to provide automated support, authenticates via Min Side OTP, retrieves owner/pet context, and executes actions

## Architecture
- **Stack**: Express + Vite + React + PostgreSQL + Drizzle ORM
- **AI**: Claude via Anthropic API (Haiku for training, Sonnet for chatbot)
- **Auth**: OTP-based via Min Side sandbox (demo phones: 91000001-91000005)

## Project Structure
```
shared/
  schema.ts          - Drizzle schema: 10 training tables + conversations/messages + training_runs
server/
  routes.ts          - API routes for training pipeline, chat, MinSide actions
  storage.ts         - IStorage interface + DatabaseStorage implementation
  training-agent.ts  - 6-step training pipeline: ingest > scrub > categorize > classify > extract > playbook
  chatbot.ts         - Streaming AI chatbot with playbook context and action execution
  pureservice.ts     - Pureservice API client for ticket fetching
  gdpr-scrubber.ts   - GDPR PII removal: names, phones, emails, addresses, chip numbers
  minside-sandbox.ts - Demo sandbox with 5 users simulating various pet/owner scenarios
  db.ts              - Database connection (Neon serverless)
client/src/
  App.tsx            - Sidebar layout with Dashboard and Chatbot routes
  pages/
    dashboard.tsx    - Training pipeline controls, stats, playbook viewer, run history
    chatbot.tsx      - Chat interface with streaming messages, OTP auth, suggestions
  components/
    theme-provider.tsx - Light/dark mode toggle
    theme-toggle.tsx
```

## Key Features
- **Training Pipeline**: 6-step SSE-streamed workflow with real-time progress
- **GDPR Compliance**: Regex-based PII masking before AI analysis
- **9 Help Center Categories**: Min side, Eierskifte, Registrering, QR Tag, Smart Tag, Abonnement, Savnet/Funnet, Familiedeling, App
- **Sandbox Users**: 5 demo profiles (91000001-91000005) with varied scenarios
- **Chatbot Actions**: Mark lost/found, activate QR, initiate transfers, send payment links
- **Streaming Responses**: SSE-based real-time AI responses

## Environment Variables
- `PURESERVICE_API_KEY` - API key for Pureservice ticket system
- `SESSION_SECRET` - Session encryption key
- `DATABASE_URL` - PostgreSQL connection string (auto-provided)
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` - Claude API key (auto-provided via integration)

## Recent Changes
- 2026-02-13: Initial build - complete schema, training pipeline, chatbot, MinSide sandbox, dashboard and chatbot UI
