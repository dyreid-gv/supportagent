# DyreID Support AI

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
The system is built on a modern web stack comprising Express, Vite, React, PostgreSQL, and Drizzle ORM. AI capabilities are powered by OpenAI, utilizing different models for training workflows (gpt-5-nano, gpt-5-mini) and the chatbot (gpt-4o). Authentication is handled via an OTP-based system integrated with the Min Side platform, with a sandbox environment for development and testing.

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
*   **Uncategorized Ticket Analysis**: Cluster analysis for theme identification.
*   **Intent Classification**: Classifies customer intent using 62 predefined intents across 10 categories.
*   **Resolution Extraction**: Extracts step-by-step resolution patterns from dialogues.
*   **Uncertainty Detector**: Flags low-confidence classifications for manual review.
*   **Playbook Builder**: Aggregates all processed data into the final Support Playbook, now data-driven rather than AI-generated, incorporating autoreply templates, dialog patterns, reclassification tracking, resolution quality analysis, and chatbot feedback.
*   **Manual Review Handler**: Provides a UI for human review of uncertain cases and new intents.

**Chatbot Features:**
*   **OTP Authentication**: Secure login via Min Side with sandbox support. Login dialog with phone/OTP steps and inline login prompts for Min Side-related questions.
*   **Session Lifecycle**: When a user closes the chat ("Avslutt") or deletes a conversation, the Min Side session is automatically cleared (server-side logout via `POST /api/chat/conversations/:id/logout`), and the chatbot session state is reset.
*   **Modern Chat UI**: Rounded message bubbles, species-specific pet icons (Dog/Cat/PawPrint), intent-specific action icons, quick action grid on welcome screen, sidebar auth panel with pet cards, and feedback widgets.
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