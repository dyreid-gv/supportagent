# DyreID Support AI – Azure Handover & Deployment Guide

**Versjon:** 1.0
**Dato:** 1. mars 2026
**Prosjekt:** AI-drevet support-automatisering for DyreID

---

## 1. Systemarkitektur – Oversikt

```
┌─────────────────────────────────────────────────────────────────┐
│                         AZURE CLOUD                             │
│                                                                 │
│  ┌──────────────┐     ┌──────────────────┐    ┌──────────────┐  │
│  │  Azure App   │     │  Azure Database   │    │   Azure      │  │
│  │  Service     │────▶│  for PostgreSQL   │    │   Key Vault  │  │
│  │  (Node.js)   │     │  Flexible Server  │    │   (secrets)  │  │
│  └──────┬───────┘     └──────────────────┘    └──────────────┘  │
│         │                                                       │
│  ┌──────┴───────┐     ┌──────────────────┐                      │
│  │  Azure       │     │  Azure Static     │                     │
│  │  App Service │     │  Web Apps         │                     │
│  │  (Backend)   │     │  (Frontend React) │                     │
│  └──────────────┘     └──────────────────┘                      │
│         │                      │                                │
│         ▼                      ▼                                │
│  ┌──────────────────────────────────────────┐                   │
│  │          Ekstern Integrasjon             │                   │
│  │  ┌──────────┐ ┌───────────┐ ┌─────────┐ │                   │
│  │  │ OpenAI   │ │Pureservice│ │Min Side  │ │                   │
│  │  │ API      │ │ API v3    │ │(DyreID)  │ │                   │
│  │  └──────────┘ └───────────┘ └─────────┘ │                   │
│  └──────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

### Komponent-oversikt

| Komponent | Teknologi | Beskrivelse |
|-----------|-----------|-------------|
| **Backend** | Node.js 20 + Express 5 + TypeScript | REST API, chatbot-logikk, training agent |
| **Frontend** | React 18 + Vite + TailwindCSS | SPA med dashboard og chatbot-UI |
| **Database** | PostgreSQL 15+ | 23 tabeller, Drizzle ORM |
| **AI** | OpenAI API (gpt-4o, gpt-5-mini) | Intent-klassifisering, embeddings, playbook |
| **CRM** | Pureservice API v3 | Ticket-ingest og eskalering |
| **Auth** | Min Side (dyreid.no) | OTP-basert brukerautentisering |

---

## 2. Prosjektstruktur

```
dyreid-support-ai/
├── server/                          # Backend (Express)
│   ├── index.ts                     # Hovedinngang - starter server
│   ├── routes.ts                    # Alle API-endepunkter (~90 ruter)
│   ├── db.ts                        # Database-tilkobling
│   ├── storage.ts                   # Data-tilgangslag (IStorage)
│   ├── chatbot.ts                   # Chatbot-kjernlogikk (3500+ linjer)
│   ├── training-agent.ts            # Training Agent (2800+ linjer)
│   ├── canonical-intents.ts         # Intent-registeret
│   ├── embeddings.ts                # OpenAI embedding-generering
│   ├── intent-index.ts              # Semantisk intent-matching
│   ├── case-escalation.ts           # Pureservice-eskalering
│   ├── minside-client.ts            # Min Side HTTP-klient
│   ├── minside-sandbox.ts           # Sandbox for testing uten prod
│   ├── pureservice.ts               # Pureservice API-klient
│   ├── input-normalization.ts       # Brukerinput-normalisering
│   ├── logger.ts                    # Sentralisert logging
│   ├── static.ts                    # Statisk filserving (prod)
│   ├── vite.ts                      # Vite dev-middleware
│   ├── integrations/
│   │   └── pureservice-v3.ts        # Pureservice V3 adapter
│   └── ...andre moduler
├── client/                          # Frontend (React)
│   ├── index.html                   # HTML-mal
│   └── src/
│       ├── main.tsx                 # React-inngang
│       ├── App.tsx                  # Routing (wouter)
│       ├── pages/
│       │   ├── dashboard.tsx        # Training-dashboard
│       │   ├── chatbot.tsx          # Chatbot-UI
│       │   ├── admin.tsx            # Admin-panel
│       │   └── health.tsx           # Systemhelse
│       ├── components/
│       │   └── ui/                  # shadcn/ui komponent-bibliotek
│       ├── hooks/                   # Custom React hooks
│       └── lib/
│           ├── queryClient.ts       # TanStack Query oppsett
│           └── utils.ts             # Hjelpefunksjoner
├── shared/                          # Delt kode (frontend + backend)
│   ├── schema.ts                    # Database-skjema (Drizzle ORM)
│   └── intents.ts                   # Intent-definisjoner
├── scripts/                         # Standalone-skript
│   ├── run_categorize.ts            # Batch-kategorisering
│   └── run_combined_analysis.ts     # Batch-analyse
├── script/
│   └── build.ts                     # Build-pipeline
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
└── drizzle.config.ts
```

---

## 3. Database – PostgreSQL-skjema

### 3.1 Om T-SQL vs PostgreSQL

Prosjektet bruker **PostgreSQL** med Drizzle ORM. Drizzle genererer SQL automatisk,
men bruker noen PostgreSQL-spesifikke funksjoner:

| PostgreSQL-funksjon | T-SQL (Azure SQL) ekvivalent | Vurdering |
|---------------------|------------------------------|-----------|
| `jsonb` kolonner | `nvarchar(max)` + JSON-funksjoner | Mulig, men mister native operatorer |
| `text[]` (arrays) | Normaliserte tabeller eller JSON | Krever refaktorering |
| `real` type | `float` | Direkte erstatning |
| `serial` (auto-inkrement) | `int IDENTITY(1,1)` | Direkte erstatning |
| `CURRENT_TIMESTAMP` | `GETDATE()` eller `SYSDATETIME()` | Direkte erstatning |
| `pgvector` (embeddings) | Ikke tilgjengelig | Kritisk begrensning |
| Drizzle `pg-core` | Drizzle `mssql-core` (eksperimentell) | Ustabil / ufullstendig |

**Anbefaling:** Fortsett med **Azure Database for PostgreSQL – Flexible Server**.
Drizzle ORM har stabil PostgreSQL-støtte, og all eksisterende kode fungerer uten endring.
Migrering til T-SQL/Azure SQL krever:
- Omskriving av alle `text[]`-kolonner (ca. 15 stk) til normaliserte relasjoner eller JSON
- Erstatning av `jsonb`-operatorer med JSON-funksjoner
- Alternativ embeddings-løsning (Azure AI Search eller egen tabell)
- Bytte av Drizzle-dialect fra `postgresql` til `mssql` (eksperimentell status)

### 3.2 Tabelloversikt (23 tabeller)

#### Kjerne – Training Pipeline

| Tabell | Beskrivelse | Viktige kolonner |
|--------|-------------|------------------|
| `raw_tickets` | Rå Pureservice-tickets | ticket_id (unique), subject, customer_question, agent_answer, messages (jsonb) |
| `scrubbed_tickets` | GDPR-skrubbede tickets | ticket_id (unique), category_mapping_status, analysis_status, dialog_pattern |
| `category_mappings` | Hjelpesenter-kategorimapping | ticket_id, hjelpesenter_category, confidence, needs_reclassification |
| `intent_classifications` | Intent-klassifisering per ticket | ticket_id, intent, intent_confidence, is_new_intent, keywords |
| `resolution_patterns` | Løsningsmønstre | ticket_id, resolution_steps, quality_score |
| `uncertainty_cases` | Usikre klassifiseringer | ticket_id, uncertainty_reason |
| `uncategorized_themes` | Tema fra ukategoriserte tickets | theme_name, ticket_count |
| `training_runs` | Logg over treningskjøringer | workflow, status, total_tickets, processed_tickets |
| `review_queue` | Manuell gjennomgangskø | review_type, data (jsonb), status, decision |

#### Kjerne – Playbook & Intents

| Tabell | Beskrivelse | Viktige kolonner |
|--------|-------------|------------------|
| `canonical_intents` | Godkjente intents (source of truth) | intent_id (unique), category, description, keywords, embedding (vector), approved |
| `playbook_entries` | Aktive chatbot-svar | intent (unique), combined_response, action_type, requires_login, help_center_article_url |
| `playbook_candidates` | Kandidater for nye entries | intent_id, status, combined_response |
| `discovered_intents` | AI-oppdagede intents | intent_name, cluster_id, status |
| `discovered_clusters` | Klynger fra intent discovery | cluster_label, ticket_count |
| `hjelpesenter_categories` | Hjelpesenter-taksonomi | category_name, subcategory_name, url_slug |
| `help_center_articles` | Skrapede artikler | article_id, url, title, body_text |

#### Kjerne – Chatbot Runtime

| Tabell | Beskrivelse | Viktige kolonner |
|--------|-------------|------------------|
| `conversations` | Chat-sesjoner | id, session_type, owner_id, authenticated, user_context (jsonb) |
| `messages` | Chat-meldinger | conversation_id (FK), role, content, metadata (jsonb) |
| `chatbot_interactions` | Detaljert interaksjonslogg | conversation_id, matched_intent, response_method, feedback_result |
| `chatbot_created_cases` | Saker opprettet av chatbot | session_id, intent_id, collected_data (jsonb), status |
| `escalations_outbox` | Eskaleringskø til Pureservice | conversation_id, intent_id, user_email, subject, status |

#### Konfigurasjon

| Tabell | Beskrivelse | Viktige kolonner |
|--------|-------------|------------------|
| `service_prices` | Dynamiske priser | service_key (unique), price, currency, is_active |
| `response_templates` | Pureservice autosvar-maler | template_id, name, content |

### 3.3 Migrering av database

Eksporter hele databasen:
```bash
# Fra Replit / nåværende miljø:
pg_dump $DATABASE_URL --no-owner --no-acl > dyreid_full_dump.sql

# Importer til Azure PostgreSQL:
psql "host=<server>.postgres.database.azure.com dbname=dyreid \
  user=<admin> password=<pass> sslmode=require" < dyreid_full_dump.sql
```

Alternativt bruk Drizzle til å opprette skjema i ny database:
```bash
DATABASE_URL="postgresql://..." npx drizzle-kit push
```

---

## 4. Backend – Express API

### 4.1 Arkitektur

Serveren starter via `server/index.ts` som:
1. Initialiserer databasetilkobling (`db.ts`)
2. Laster intent-indeks med embeddings
3. Registrerer alle API-ruter (`routes.ts`)
4. I dev-modus: setter opp Vite middleware for HMR
5. I prod-modus: serverer statiske filer fra `dist/public`

### 4.2 Database-tilkobling – VIKTIG FOR AZURE

Nåværende kode bruker `@neondatabase/serverless` (Neon-spesifikk WebSocket-driver):

```typescript
// server/db.ts (nåværende)
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

export const db = drizzle({
  connection: process.env.DATABASE_URL,
  schema,
  ws: ws,
});
```

**For Azure PostgreSQL må dette endres til standard `pg`-driver:**

```typescript
// server/db.ts (Azure-versjon)
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });
```

**Nødvendige pakkeendringer:**
```bash
npm uninstall @neondatabase/serverless
npm install drizzle-orm/node-postgres
# pg er allerede installert
```

**Oppdater drizzle.config.ts:**
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
```

### 4.3 API-endepunkter (komplett oversikt)

#### Training Pipeline (POST, SSE-strømming)

| Endepunkt | Metode | Beskrivelse |
|-----------|--------|-------------|
| `/api/training/stats` | GET | Samlede statistikker |
| `/api/training/ingest` | POST | Hent tickets fra Pureservice |
| `/api/training/scrub` | POST | GDPR-skrubbing |
| `/api/training/categorize` | POST | Kategori-mapping |
| `/api/training/classify` | POST | Intent-klassifisering |
| `/api/training/extract-resolutions` | POST | Ekstraher løsningsmønstre |
| `/api/training/detect-uncertainty` | POST | Finn usikre klassifiseringer |
| `/api/training/generate-playbook` | POST | Generer playbook-entries |
| `/api/training/combined-analysis` | POST | Kombinert analyse (effektiv) |
| `/api/training/staging-ingest` | POST | Staging-ingest (5000 tickets) |
| `/api/training/staging-cluster` | POST | Klyngeanalyse |
| `/api/training/import-from-staging` | POST | Importer fra staging |
| `/api/training/review-queue` | GET | Gjennomgangskø |
| `/api/training/submit-review` | POST | Send beslutning |

#### Chatbot (kjøretid)

| Endepunkt | Metode | Beskrivelse |
|-----------|--------|-------------|
| `/api/chat/conversations` | POST | Opprett samtale |
| `/api/chat/conversations` | GET | List samtaler |
| `/api/chat/conversations/:id` | GET | Hent samtale med meldinger |
| `/api/chat/conversations/:id` | DELETE | Slett samtale |
| `/api/chat/conversations/:id/messages` | POST | Send melding (SSE-strøm) |
| `/api/chat/conversations/:id/auth` | POST | Autentiser bruker |
| `/api/chat/conversations/:id/logout` | POST | Logg ut |
| `/api/chat/test-intent` | POST | Test intent-matching |
| `/api/feedback` | POST | Send tilbakemelding |
| `/api/feedback/stats` | GET | Tilbakemeldings-statistikk |

#### Admin & Intent-styring

| Endepunkt | Metode | Beskrivelse |
|-----------|--------|-------------|
| `/api/canonical-intents` | GET | Alle intents |
| `/api/canonical-intents/approved` | GET | Godkjente intents |
| `/api/canonical-intents/stats` | GET | Intent-statistikk |
| `/api/canonical-intents/:id` | PUT | Oppdater intent |
| `/api/canonical-intents/seed` | POST | Seed intents |
| `/api/admin/playbook-candidates` | GET | List kandidater |
| `/api/admin/playbook-candidates/:id/approve` | POST | Godkjenn kandidat |
| `/api/admin/escalations` | GET | List eskaleringer |
| `/api/admin/escalation-stats` | GET | Eskalerings-statistikk |
| `/api/admin/health` | GET | Systemhelse-rapport |
| `/api/admin/export-all` | GET | Eksporter hele databasen |

#### Autentisering & Min Side

| Endepunkt | Metode | Beskrivelse |
|-----------|--------|-------------|
| `/api/auth/send-otp` | POST | Send OTP-kode |
| `/api/auth/verify-otp` | POST | Verifiser OTP |
| `/api/auth/user-context` | GET | Hent brukerdata/kjæledyr |
| `/api/chip-lookup` | POST | Chipnummer-oppslag |
| `/api/minside/action` | POST | Utfør Min Side-handling |

#### Data & Konfigurasjon

| Endepunkt | Metode | Beskrivelse |
|-----------|--------|-------------|
| `/api/prices` | GET | Alle priser |
| `/api/prices/active` | GET | Aktive priser |
| `/api/prices` | POST | Opprett/oppdater pris |
| `/api/playbook` | GET | Aktive playbook-entries |
| `/api/categories` | GET | Hjelpesenter-kategorier |
| `/api/reports/consolidation-proposal` | GET | Konsolideringsrapport |

### 4.4 Build & Start

```bash
# Bygg (frontend + backend)
npm run build

# Produksjon
NODE_ENV=production node dist/index.cjs

# Utvikling
NODE_ENV=development npx tsx server/index.ts
```

Build-prosessen (`script/build.ts`) gjør:
1. Vite-bygger frontend → `dist/public/`
2. esbuild bundler backend → `dist/index.cjs`

---

## 5. Frontend – React SPA

### 5.1 Arkitektur

- **Rammeverk:** React 18 med TypeScript
- **Bygging:** Vite 7
- **Styling:** TailwindCSS 3 + shadcn/ui (Radix primitives)
- **Routing:** wouter (lettvekts client-side routing)
- **State/data:** TanStack Query v5
- **Tema:** Lys/mørk modus via ThemeProvider

### 5.2 Sider

| Rute | Fil | Beskrivelse |
|------|-----|-------------|
| `/` | `pages/dashboard.tsx` | Training-dashboard med statistikk |
| `/chatbot` | `pages/chatbot.tsx` | Chatbot-grensesnitt |
| `/admin` | `pages/admin.tsx` | Admin-panel |
| `/health` | `pages/health.tsx` | Systemhelse |

### 5.3 Separat frontend-deploy (Azure Static Web Apps)

Siden dere vil bygge frontend og backend separat:

```bash
# Bygg kun frontend
npx vite build --outDir dist/public

# Output: dist/public/ inneholder index.html + JS/CSS assets
```

**Viktig for separat deploy:** Frontend-en må konfigureres med backend-URL.
Legg til i `.env.production`:
```
VITE_API_URL=https://dyreid-backend.azurewebsites.net
```

Og oppdater `client/src/lib/queryClient.ts` til å bruke denne:
```typescript
const API_BASE = import.meta.env.VITE_API_URL || "";
```

**Azure Static Web Apps konfigurasjon (`staticwebapp.config.json`):**
```json
{
  "navigationFallback": {
    "rewrite": "/index.html"
  },
  "globalHeaders": {
    "Cache-Control": "no-cache"
  }
}
```

### 5.4 CORS-konfigurasjon for separat deploy

Backend må tillate forespørsler fra frontend-domenet. Legg til i `server/index.ts`:
```typescript
import cors from "cors";

app.use(cors({
  origin: process.env.FRONTEND_URL || "https://dyreid-frontend.azurestaticapps.net",
  credentials: true,
}));
```

Installer: `npm install cors @types/cors`

---

## 6. Miljøvariabler

### 6.1 Påkrevde variabler

| Variabel | Beskrivelse | Eksempel |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@server.postgres.database.azure.com:5432/dyreid?sslmode=require` |
| `OPENAI_API_KEY` | OpenAI API-nøkkel | `sk-proj-...` |
| `PURESERVICE_API_KEY` | Pureservice API-nøkkel | `Bearer ...` |
| `SESSION_SECRET` | Express session secret | Tilfeldig 64-tegn streng |
| `PORT` | Server-port (default 5000) | `8080` |
| `NODE_ENV` | Miljø | `production` |

### 6.2 Valgfrie variabler

| Variabel | Beskrivelse | Default |
|----------|-------------|---------|
| `ENABLE_CASE_ESCALATION` | Aktiver eskalering til Pureservice | `false` |
| `ENABLE_PURESERVICE_POST` | Tillat skriving til Pureservice | `false` |
| `ENABLE_INPUT_NORMALIZATION` | Aktiver input-normalisering | `false` |
| `RUNTIME_DEBUG` | Verbose chatbot-logging | `false` |
| `FRONTEND_URL` | Frontend-URL for CORS | (ingen) |

### 6.3 Azure Key Vault

Lagre alle sensitive variabler i Azure Key Vault:
```bash
az keyvault secret set --vault-name dyreid-kv \
  --name DATABASE-URL \
  --value "postgresql://..."

az keyvault secret set --vault-name dyreid-kv \
  --name OPENAI-API-KEY \
  --value "sk-proj-..."

az keyvault secret set --vault-name dyreid-kv \
  --name PURESERVICE-API-KEY \
  --value "Bearer ..."

az keyvault secret set --vault-name dyreid-kv \
  --name SESSION-SECRET \
  --value "$(openssl rand -hex 32)"
```

---

## 7. Azure Deployment – Steg for steg

### 7.1 Ressursgruppe og infrastruktur

```bash
# 1. Opprett ressursgruppe
az group create --name rg-dyreid-support --location norwayeast

# 2. Opprett PostgreSQL Flexible Server
az postgres flexible-server create \
  --resource-group rg-dyreid-support \
  --name dyreid-pg-server \
  --location norwayeast \
  --sku-name Standard_B2ms \
  --storage-size 32 \
  --version 15 \
  --admin-user dyreidadmin \
  --admin-password "<sterkt-passord>"

# 3. Opprett database
az postgres flexible-server db create \
  --resource-group rg-dyreid-support \
  --server-name dyreid-pg-server \
  --database-name dyreid

# 4. Tillat Azure-tjenester
az postgres flexible-server firewall-rule create \
  --resource-group rg-dyreid-support \
  --name dyreid-pg-server \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0

# 5. Aktiver pgvector-utvidelsen (for embeddings)
az postgres flexible-server parameter set \
  --resource-group rg-dyreid-support \
  --server-name dyreid-pg-server \
  --name azure.extensions \
  --value vector
```

### 7.2 Backend – Azure App Service

```bash
# 1. Opprett App Service Plan
az appservice plan create \
  --resource-group rg-dyreid-support \
  --name asp-dyreid-backend \
  --location norwayeast \
  --sku B2 \
  --is-linux

# 2. Opprett Web App
az webapp create \
  --resource-group rg-dyreid-support \
  --plan asp-dyreid-backend \
  --name dyreid-backend \
  --runtime "NODE:20-lts"

# 3. Konfigurer miljøvariabler
az webapp config appsettings set \
  --resource-group rg-dyreid-support \
  --name dyreid-backend \
  --settings \
    NODE_ENV=production \
    PORT=8080 \
    DATABASE_URL="postgresql://dyreidadmin:<pass>@dyreid-pg-server.postgres.database.azure.com:5432/dyreid?sslmode=require" \
    OPENAI_API_KEY="@Microsoft.KeyVault(SecretUri=https://dyreid-kv.vault.azure.net/secrets/OPENAI-API-KEY)" \
    PURESERVICE_API_KEY="@Microsoft.KeyVault(SecretUri=https://dyreid-kv.vault.azure.net/secrets/PURESERVICE-API-KEY)" \
    SESSION_SECRET="@Microsoft.KeyVault(SecretUri=https://dyreid-kv.vault.azure.net/secrets/SESSION-SECRET)" \
    ENABLE_CASE_ESCALATION=false \
    ENABLE_PURESERVICE_POST=false

# 4. Konfigurer startup-kommando
az webapp config set \
  --resource-group rg-dyreid-support \
  --name dyreid-backend \
  --startup-file "node dist/index.cjs"

# 5. Deploy
az webapp deployment source config-zip \
  --resource-group rg-dyreid-support \
  --name dyreid-backend \
  --src dist.zip
```

### 7.3 Frontend – Azure Static Web Apps

```bash
# 1. Opprett Static Web App
az staticwebapp create \
  --resource-group rg-dyreid-support \
  --name dyreid-frontend \
  --location westeurope \
  --sku Standard

# 2. Sett miljøvariabler for frontend
az staticwebapp appsettings set \
  --resource-group rg-dyreid-support \
  --name dyreid-frontend \
  --setting-names \
    VITE_API_URL=https://dyreid-backend.azurewebsites.net
```

### 7.4 Database-migrering

```bash
# 1. Eksporter fra nåværende database (Neon)
pg_dump $DATABASE_URL \
  --no-owner --no-acl \
  --format=plain \
  > dyreid_backup.sql

# 2. Importer til Azure PostgreSQL
psql "host=dyreid-pg-server.postgres.database.azure.com \
  dbname=dyreid user=dyreidadmin \
  password=<pass> sslmode=require" \
  < dyreid_backup.sql

# Alternativ: bruk Drizzle for tom database + importer data separat
DATABASE_URL="postgresql://..." npx drizzle-kit push
```

---

## 8. Kodeendringer for Azure

### 8.1 Obligatoriske endringer

#### 1. Database-driver (server/db.ts)

Bytt fra Neon WebSocket til standard pg:

```typescript
// FRA:
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
export const db = drizzle({ connection: process.env.DATABASE_URL, schema, ws });

// TIL:
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
});

export const db = drizzle(pool, { schema });
```

#### 2. Pakker

```bash
npm uninstall @neondatabase/serverless ws
npm install cors @types/cors
# pg er allerede installert
```

#### 3. CORS (server/index.ts)

Legg til CORS-middleware for separat frontend:
```typescript
import cors from "cors";
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
}));
```

#### 4. Frontend API-base (client/src/lib/queryClient.ts)

Oppdater fetch-funksjoner til å bruke konfigurerbar base-URL:
```typescript
const API_BASE = import.meta.env.VITE_API_URL || "";

async function throwIfResNotOk(res: Response) { /* uendret */ }

export async function apiRequest(method: string, url: string, data?: unknown) {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
  await throwIfResNotOk(res);
  return res;
}
```

Oppdater TanStack Query default fetcher tilsvarende.

### 8.2 Anbefalte endringer

#### 5. Fjern Replit-spesifikke avhengigheter

Disse pakkene er kun for Replit og kan fjernes:
```bash
npm uninstall @replit/vite-plugin-cartographer \
  @replit/vite-plugin-dev-banner \
  @replit/vite-plugin-runtime-error-modal
```

Fjern tilhørende imports i `vite.config.ts`.

#### 6. Fjern Replit AI Integrations

Hele mappen `server/replit_integrations/` og tilhørende klient-kode kan fjernes.
Disse bruker Replits interne AI-proxy og fungerer ikke utenfor Replit.

---

## 9. AI-modeller i bruk

| Kontekst | Modell | Bruk |
|----------|--------|------|
| **Chatbot runtime** | `gpt-4o` | Intent-tolkning, guarded paraphrasing |
| **Training agent** | `gpt-5-mini` | Batch-klassifisering, playbook-generering |
| **Embeddings** | `text-embedding-3-small` | Semantisk intent-matching (1536 dimensjoner) |
| **Scripts** | `gpt-5-mini` | Batch-kategorisering og analyse |

All OpenAI-kommunikasjon går via `openai` npm-pakken med standard API-nøkkel.
Ingen Azure OpenAI-spesifikk kode er nødvendig med mindre dere velger å bruke
Azure OpenAI Service i stedet.

### Azure OpenAI (valgfritt alternativ)

Hvis dere vil bruke Azure OpenAI i stedet for OpenAI direkte:

```typescript
import { AzureOpenAI } from "openai";

const openai = new AzureOpenAI({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  apiVersion: "2024-10-21",
});
```

Krev deployment av modellene `gpt-4o` og `text-embedding-3-small` i Azure OpenAI-ressursen.

---

## 10. Ekstern integrasjon

### 10.1 Pureservice API

- **Base URL:** `https://api.pureservice.com/v3`
- **Auth:** Bearer token i `PURESERVICE_API_KEY`
- **Brukes til:**
  - Hente historiske tickets (training)
  - Poste nye saker (eskalering fra chatbot)
  - Hente response templates
- **Filer:** `server/pureservice.ts`, `server/integrations/pureservice-v3.ts`, `server/case-escalation.ts`
- **Feature-flagg:** `ENABLE_PURESERVICE_POST` og `ENABLE_CASE_ESCALATION` styrer om skriving er aktiv

### 10.2 Min Side (DyreID Portal)

- **Base URL:** `https://minside.dyreid.no`
- **Auth:** OTP via SMS/e-post, cookie-baserte sesjoner
- **Brukes til:**
  - Autentisere chatbot-brukere
  - Hente kjæledyr-data, eierinfo, betalingshistorikk
  - Utføre handlinger (rapportere savnet/funnet, eierskifte)
- **Filer:** `server/minside-client.ts`, `server/minside-sandbox.ts`
- **Sandbox:** For testing uten prod-data – kontrolleres av `minside-sandbox.ts`

### 10.3 DyreID Hjelpesenter

- **URL:** `https://www.dyreid.no/hjelp-*`
- **Brukes til:** Skraping av artikler for playbook-referanser
- **Fil:** `server/hjelpesenter-scraper.ts`

---

## 11. Chatbot-arkitektur – Nøkkelkonsepter

### 11.1 Intent-matching (respons-hierarki)

```
Brukermelding
    │
    ▼
1. Regex-match (INTENT_PATTERNS) ──── direkte match, 0 latens
    │ fant ikke
    ▼
2. Playbook keyword-match ──────────── søk i keywords-felt
    │ fant ikke
    ▼
3. GPT intent-tolkning ─────────────── confidence >= 0.78
    │ for lav score
    ▼
4. Kategori-meny ───────────────────── vis relevante valg
    │ ingen match
    ▼
5. BLOCK / eskalering ─────────────── "Beklager, dette må vi se nærmere på"
```

### 11.2 Action Types

| Type | Beskrivelse | Eksempel |
|------|-------------|---------|
| `INFO_ONLY` | Informativt svar, ingen handling | AppLanguageSettings |
| `PURESERVICE_CREATE` | Multi-turn datainnsamling → sak i Pureservice | RefundRequest, GDPRDelete |
| `API_CALL` | Kaller Min Side API | UpdateContactInfo |
| `STATEFUL_FLOW` | Kompleks flertrinnsflyt | OwnershipTransferWeb |

### 11.3 INTENT_ALIASES (42 mappinger)

Aliases ruter variante intent-navn til kanoniske. Vedlikeholdes i `server/chatbot.ts`.
Nøkkelmappinger:
- AddPetsToSubscription → AddSmartTagPetToSubscription
- SmartTagReassign → SmartTagTransferPet
- QRTagDamaged/QRTagOrder → QRTagOrderExtra
- SubscriptionChange → SubscriptionUpgrade
- NonSupportedSpecies → NonSupportedSpeciesHelp
- AppLanguage → AppLanguageSettings

### 11.4 Nåværende status

| Metrikk | Verdi |
|---------|-------|
| Godkjente canonical intents | 113 |
| Aktive playbook entries | 88 |
| PURESERVICE_CREATE intents | 13 |
| INTENT_ALIASES | 42 |
| Embeddings generert | 113/113 |
| Tickets klassifisert | 2192/2192 |

---

## 12. Gjenværende arbeid

Følgende er identifisert men ikke implementert:

| # | Oppgave | Prioritet | Beskrivelse |
|---|---------|-----------|-------------|
| 1 | **Kjør Playbook Builder** | Høy | Generer/oppdater playbook-entries basert på 2192 klassifiserte tickets |
| 2 | **BreederLitterRegistration** | Lav | Parkert – avklar funksjonalitet for valpekull-registrering |
| 3 | **Prod Min Side-integrasjon** | Høy | Bytt fra sandbox til prod-miljø for OTP og brukerdata |
| 4 | **Pureservice-posting** | Høy | Aktiver `ENABLE_PURESERVICE_POST` og test med reelle kategori-ID-er |
| 5 | **Rate limiting** | Medium | Legg til rate limiting på chat-endepunkter |
| 6 | **Logging / monitoring** | Medium | Integrer med Azure Application Insights |
| 7 | **Backup-strategi** | Høy | Konfigurer automatisk backup for Azure PostgreSQL |
| 8 | **SSL/TLS** | Høy | Konfigurer custom domain med SSL-sertifikat |

---

## 13. Sikkerhet & GDPR

### Implementert

- GDPR-skrubbing av alle treningsdata (personnavn, telefon, e-post, adresser erstattes med plassholdere)
- OTP-basert autentisering for sensitiv data
- Sandbox-modus for testing uten produksjonsdata
- Ingen lagring av OTP-koder eller passord
- Chat-transkripter skrubbes før eskalering

### Anbefalinger for Azure

- Aktiver Azure PostgreSQL TDE (Transparent Data Encryption)
- Bruk Azure Key Vault for alle hemmeligheter
- Aktiver Azure AD-autentisering for database
- Konfigurer NSG (Network Security Groups) for å begrense tilgang
- Aktiver diagnostikk-logging til Log Analytics
- Vurder Azure Private Link for databasetilkobling

---

## 14. Avhengigheter (package.json)

### Produksjon (viktigste)

| Pakke | Versjon | Bruk |
|-------|---------|------|
| express | ^5.0.1 | HTTP-server |
| openai | ^6.22.0 | OpenAI API-klient |
| drizzle-orm | ^0.39.3 | Database ORM |
| pg | ^8.16.3 | PostgreSQL-driver |
| axios | ^1.13.5 | HTTP-klient (Min Side, Pureservice) |
| react | ^18.3.1 | Frontend-rammeverk |
| @tanstack/react-query | ^5.60.5 | Datahenting |
| wouter | ^3.3.5 | Client-side routing |
| zod | ^3.25.76 | Validering |
| express-session | ^1.18.1 | Sesjonshåndtering |
| tailwindcss | ^3.4.17 | CSS-rammeverk |

### Fjernes for Azure (Replit-spesifikke)

| Pakke | Grunn |
|-------|-------|
| @neondatabase/serverless | Erstattes av pg direkte |
| @replit/vite-plugin-* | Replit dev-verktøy |
| @anthropic-ai/sdk | Replit AI-integrasjon |
| @octokit/rest | GitHub-integrasjon via Replit |

---

## 15. Viktige filer for gjennomgang

For utviklere som overtar prosjektet, anbefales å lese i denne rekkefølgen:

1. **`shared/schema.ts`** – Hele datamodellen
2. **`server/chatbot.ts`** – All chatbot-logikk (3500 linjer, godt strukturert)
3. **`server/routes.ts`** – Alle API-endepunkter
4. **`server/storage.ts`** – Database-operasjoner (IStorage interface)
5. **`server/training-agent.ts`** – Training pipeline
6. **`server/canonical-intents.ts`** – Intent-registeret
7. **`server/embeddings.ts`** – Embedding-generering
8. **`server/intent-index.ts`** – Semantisk matching-motor
9. **`server/case-escalation.ts`** – Pureservice-eskalering
10. **`client/src/pages/chatbot.tsx`** – Frontend chatbot-UI

---

*Dokumentet er generert fra kodebasen per 1. mars 2026.*
*Kontakt utviklingsteamet for spørsmål om implementasjonsdetaljer.*
