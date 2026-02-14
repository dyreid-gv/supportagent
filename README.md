# DyreID Support AI - Treningsagent (DEL 1)

AI-drevet treningssystem for DyreID (Norsk Dyreregister) som analyserer historiske supporthenvendelser og bygger en Support Playbook for automatisert kundeservice.

## Hva systemet gjor

Systemet tar inn tusenvis av historiske supporthenvendelser fra Pureservice, renser dem for persondata (GDPR), sorterer dem i kategorier, klassifiserer kundenes intensjoner, trekker ut losningsmonster, og bygger en komplett "Support Playbook" - en kunnskapsbase som kan brukes til a automatisere fremtidig kundesupport.

## 9-stegs treningspipeline

| Steg | Navn | Beskrivelse |
|------|------|-------------|
| 1 | **Ticket-innhenting** | Henter lukkede supporthenvendelser fra Pureservice API |
| 2 | **GDPR-rensing** | Fjerner persondata (telefon, e-post, adresser, chipnumre, IP, betalingsreferanser) |
| 3 | **Kategorimapping** | Sorterer tickets i 9 hjelpesenter-kategorier med 36 underkategorier via AI |
| 4 | **Ukategorisert-analyse** | Analyserer tickets som ikke passer noen kategori og identifiserer nye temaer |
| 5 | **Intent-klassifisering** | Klassifiserer kundeintent med 34 forhåndsdefinerte intensjoner via AI |
| 6 | **Losningsekstraksjon** | Trekker ut steg-for-steg losninger fra supportdialoger |
| 7 | **Usikkerhetsdeteksjon** | Flagger lavkonfidensklassifiseringer for manuell gjennomgang |
| 8 | **Playbook Builder** | Aggregerer alt til en ferdig Support Playbook |
| 9 | **Manuell Review** | Grensesnitt for a godkjenne/korrigere usikre klassifiseringer |

## 9 hjelpesenter-kategorier (fra CSV)

- Min side
- Eierskifte
- Registrering
- QR Tag
- Smart Tag
- Abonnement
- Savnet/Funnet
- Familiedeling
- App

## 34 kjente intents

LoginIssue, PasswordReset, ProfileUpdate, AccountDeletion, TwoFactorAuth, OwnershipTransfer, OwnershipReceive, OwnershipRejected, InheritancePetTransfer, BreederRegistration, NewPetRegistration, RegistrationPayment, ChipNumberCorrection, DuplicateRegistration, QRTagActivation, QRTagNotWorking, QRTagOrder, QRTagReassign, QRTagLost, SmartTagConnection, SmartTagBattery, SmartTagGPSIssue, SmartTagNotification, SmartTagReassign, SubscriptionCancel, SubscriptionChange, InvoiceIssue, DoubleBilling, AddPetToSubscription, LostPet, FoundPet, UpdateLostStatus, StolenPet, FamilyShareAccess, FamilyShareRemove, ChildAccess, InvitationIssue, AppCrash, PushNotification, AppDownload, AppLanguage, PetNotFound, GeneralInquiry, TaskAssistance

## Teknisk arkitektur

```
Frontend:  React + Vite + TailwindCSS + shadcn/ui
Backend:   Express.js + TypeScript
Database:  PostgreSQL (Neon) + Drizzle ORM
AI:        Claude (Anthropic) - Haiku for treningsworkflows, Sonnet for analyse
```

## Databasetabeller

| Tabell | Beskrivelse |
|--------|-------------|
| `raw_tickets` | Ra tickets hentet fra Pureservice |
| `scrubbed_tickets` | GDPR-rensede tickets |
| `hjelpesenter_categories` | 9 kategorier med 36 underkategorier (kodeverk) |
| `category_mappings` | Mapping fra Pureservice-kategorier til hjelpesenter |
| `intent_classifications` | Intent-klassifiseringer med confidence score |
| `resolution_patterns` | Uttrukne losningsmonster |
| `playbook_entries` | Ferdig Support Playbook |
| `uncategorized_themes` | Identifiserte temaer fra ukategoriserte tickets |
| `uncertainty_cases` | Saker flagget for usikkerhet |
| `review_queue` | Ko for manuell gjennomgang |
| `training_runs` | Logg over treningskjoringer |

## Sider i applikasjonen

| Side | Sti | Beskrivelse |
|------|-----|-------------|
| Dashboard | `/` | 9-stegs pipeline, statistikk, playbook, review-ko, temaer, usikkerhet, historikk |
| Chatbot | `/chat` | AI-chatbot som bruker playbooken (DEL 2) |
| Admin | `/admin` | Eksporter data (JSON/CSV), se databaseskjema, kvalitetssikring |

## API-endepunkter

### Treningspipeline (SSE-streamet)
- `POST /api/training/ingest` - Hent tickets fra Pureservice
- `POST /api/training/scrub` - GDPR-rensing
- `POST /api/training/categorize` - Kategorimapping
- `POST /api/training/analyze-uncategorized` - Ukategorisert-analyse
- `POST /api/training/classify` - Intent-klassifisering
- `POST /api/training/extract-resolutions` - Losningsekstraksjon
- `POST /api/training/detect-uncertainty` - Usikkerhetsdeteksjon
- `POST /api/training/generate-playbook` - Playbook-generering

### Data og review
- `GET /api/training/stats` - Statistikk og kjoringshistorikk
- `GET /api/training/review-queue` - Ventende review-saker
- `POST /api/training/submit-review` - Send inn review-beslutning
- `GET /api/training/uncategorized-themes` - Identifiserte temaer
- `GET /api/training/uncertainty-cases` - Usikkerhetssaker
- `GET /api/playbook` - Playbook-oppslag
- `GET /api/categories` - Hjelpesenter-kategorier

### Admin/eksport
- `GET /api/admin/tables` - Oversikt over alle tabeller med radtelling
- `GET /api/admin/export/:table` - Eksporter enkelt tabell (JSON eller CSV)
- `GET /api/admin/export-all` - Eksporter hele databasen som JSON
- `GET /api/admin/schema` - Databaseskjema-informasjon

### Testdata
- `POST /api/training/seed-test-data` - Legg inn 100 realistiske test-tickets

## Miljovariabler

| Variabel | Beskrivelse |
|----------|-------------|
| `PURESERVICE_API_KEY` | API-nokkel for Pureservice ticket-system |
| `SESSION_SECRET` | Sesjonsnokkel |
| `DATABASE_URL` | PostgreSQL-tilkoblingsstreng (satt automatisk) |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Claude API-nokkel (satt automatisk via integrasjon) |

## Slik bruker du systemet

1. Apne dashboardet pa `/`
2. Klikk "Legg inn 100 test-saker" for testdata (eller kjor steg 1 for ekte data fra Pureservice)
3. Kjor stegene i rekkefolge: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
4. Ga til Review-fanen for steg 9 (manuell gjennomgang)
5. Bruk Admin-panelet (`/admin`) for a eksportere og kvalitetssikre data

## GDPR-rensing

Folgende persondata fjernes automatisk for AI-analyse:
- Telefonnumre (norske og internasjonale)
- E-postadresser
- Personnumre og fodselsnumre
- Chipnumre (15-sifrede)
- Gateadresser og postnumre
- IP-adresser
- Betalingsreferanser
- Personnavn (erstattes med [NAVN])
