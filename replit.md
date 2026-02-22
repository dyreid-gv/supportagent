# DyreID Support AI

## Overview
This project is an AI-powered support automation system for DyreID, Norway's national pet ID registry. It aims to enhance customer service efficiency, reduce response times, and provide consistent, high-quality support through advanced AI capabilities. The system comprises two main components: a **Training Agent** that processes historical support tickets to build a comprehensive Support Playbook, and a **Customer Chatbot** that utilizes this Playbook to provide automated, authenticated customer support. The business vision is to streamline support operations and improve customer satisfaction for DyreID.

## User Preferences
I prefer clear and concise communication.
I value an iterative development process.
I want to be consulted before any major architectural or feature changes are implemented.
I expect detailed explanations for complex technical decisions.
Do not make changes to files in the `shared/` folder without explicit approval.

## System Architecture
The system is built on an Express, Vite, React, PostgreSQL, and Drizzle ORM stack. AI capabilities are powered by OpenAI, utilizing different models for training workflows and runtime intent classification. Authentication is handled via an OTP-based system integrated with the Min Side platform.

**Core Architectural Decisions:**
- The chatbot is a **closed-domain action agent**, not an open-domain reasoning chatbot, performing authenticated operations via OTP login.
- **No runtime OpenAI fallback** for generating procedures, pricing, or resolution logic; instead, a BLOCK response escalates to human support.
- **Runtime GPT usage is strictly gated**: allowed for intent interpretation, fuzzy semantic understanding, and guarded paraphrasing of informational content. It must NOT explain procedures, suggest actions, infer pricing, or describe ownership transfer steps.
- **Transactional vs. Informational intent separation**: Transactional intents require authentication, modify register data, and trigger specific actions (without GPT involvement in execution). Informational intents do not modify data and allow guarded GPT paraphrasing of existing Playbook info.
- All **learning requires human approval**; the system never auto-promotes.
- **Response hierarchy**: Regex match → Playbook keyword → GPT intent interpretation (confidence >= 0.7) → Category menu → BLOCK/escalation.
- **Paraphrase guardrails**: GPT paraphrasing is restricted from generating sensitive information or outputs exceeding 2.5x original length.

**UI/UX Decisions:**
The client is a React single-page application with a sidebar navigation for Dashboard and Chatbot interfaces. The Dashboard provides real-time monitoring, statistics, and analytical tabs. The Chatbot features streaming messages, OTP authentication, interactive suggestions, species-specific pet icons, and feedback widgets. A light/dark mode is available.

**Technical Implementations & Feature Specifications:**
- **Training Agent Workflows**: Includes Pureservice ticket ingestion, GDPR scrubbing, AI-driven Help Center category mapping, uncategorized ticket analysis with an Intent Normalization Layer for semantic comparison and auto-mapping/new candidate flagging, intent classification, resolution extraction, uncertainty detection, and a Playbook Builder.
- **Chatbot Features**: OTP authentication with session management, a modern chat UI, chip lookup with SMS functionality for ownership transfer contact (sandbox guarded), quick intent matching via regex, contextual understanding, action execution (e.g., marking lost/found pets), streaming responses, feedback system, and **Case Escalation** ("Løste dette saken?" flow with email collection, GDPR-scrubbed transcript, dedupe/rate-limit, and Pureservice outbox).
- **System Design Choices**: Drizzle ORM manages 14 tables. Centralized intent definitions. Batch processing for efficiency. Combined API endpoints for analysis. Dynamic pricing via a `service_prices` table. Autoreply detection, dialog pattern analysis, reclassification, and resolution quality assessment. Real Min Side integration with HTML parsing and session caching.

## External Dependencies
*   **OpenAI API**: Used for various AI tasks including intent classification, resolution extraction, uncertainty detection, and Playbook generation.
*   **Pureservice API**: Used for ingesting historical support tickets.
*   **PostgreSQL (Neon Serverless)**: Primary database.
*   **Min Side (DyreID's user portal)**: Used for OTP-based user authentication and retrieving user/pet context, integrated via a backend proxy and sandbox.