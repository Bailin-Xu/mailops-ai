# MailOps AI — Next-Stage Product Requirements and Roadmap

## 1. Purpose and Product Decision

This document defines the direction after the local MVP foundation. It does not
discard the existing parser, domain model, review workflow, or PostgreSQL data.
Where this document and `06-production-integration-foundation.md` describe
different future product priorities, this document governs the next stage; the
provider-neutral and safety foundations from that earlier document remain valid.

The next product goal is a **Gmail-first, provider-neutral, deployable email
operations service** with a reviewer web application and protected APIs for
external systems.

The product should be generic by default. Organization-specific knowledge,
mailboxes, terminology, and reply style must be configuration or data, not
hard-coded application behavior.

## 2. Important Technical Clarifications

### Gmail replaces manual upload as the main entry, not the parser

Users should not need to upload `.eml` files during normal operation. Gmail API
sync becomes the primary inbound channel. The existing `.eml` parser remains
useful as:

- the normalized parsing path behind provider adapters;
- a safe test and development input;
- a manual recovery or historical-import tool restricted to administrators.

Gmail push notifications are change signals, not complete email payloads. The
service must receive a Google Pub/Sub notification, use Gmail history/message APIs
to fetch the change, and then pass the result through the internal ingestion
pipeline. Gmail watches expire and must be renewed. Because notifications can be
duplicated, delayed, or missed, ingestion must be idempotent and include periodic
reconciliation.

### A deployable microservice is not automatically a multi-tenant SaaS

The first production-capable version should support **one organization per
deployment**. This keeps mailbox credentials, data ownership, authorization, and
operations understandable. Multiple organizations can initially run separate
deployments. True multi-tenancy requires explicit tenant isolation, administration,
billing, quotas, and incident controls and is deferred.

### Embeddings improve retrieval, not truth

Embeddings and pgvector can find semantically related knowledge that keyword search
misses. They do not determine which answer is correct. Potential contradictions may
be surfaced by similarity, structured rules, and AI-assisted comparison, but a
human must approve the final resolution.

Factual knowledge and writing-style examples must remain separate. A style example
may influence tone, but it must never be used as evidence for a factual answer.

## 3. Target Architecture

```text
Gmail mailbox
    ↓ Gmail API + Google Pub/Sub
MailOps ingestion and synchronization
    ↓
Classification → review policy → hybrid retrieval → reply draft
    ↓                              ↓
Reviewer web app             PostgreSQL + pgvector

External company systems
    ↓ authenticated HTTPS API
MailOps application services
```

A suitable first Google-based deployment is:

- a containerized Next.js/API application on Cloud Run;
- PostgreSQL with pgvector on Cloud SQL;
- Pub/Sub for Gmail change notifications;
- Secret Manager for deployment secrets;
- Cloud Scheduler for watch renewal and reconciliation triggers.

These are deployment adapters. Core email, knowledge, review, and AI rules must not
depend directly on Google Cloud or Gmail SDK types.

## 4. Product Requirements

### PR-GMAIL — Real mailbox synchronization

- **PR-GMAIL-01:** A reviewer can connect one Gmail mailbox through OAuth with the
  minimum scopes required for the enabled features.
- **PR-GMAIL-02:** The service performs an initial bounded sync and records Gmail
  message, thread, and history identifiers separately from RFC email headers.
- **PR-GMAIL-03:** New Gmail changes are ingested automatically through Pub/Sub and
  the Gmail history API without manual `.eml` upload.
- **PR-GMAIL-04:** Duplicate notifications and repeated fetches do not create
  duplicate messages, classifications, drafts, or sends.
- **PR-GMAIL-05:** The service renews Gmail watches and periodically reconciles the
  mailbox to recover missed notifications.
- **PR-GMAIL-06:** The first Gmail release runs in read-only Shadow Mode. Drafting
  is reviewable, and real sending is enabled only in a later phase with explicit
  human confirmation and a kill switch.
- **PR-GMAIL-07:** `.eml` import remains available for automated tests and optional
  administrator-only migration or recovery workflows.

### PR-GENERIC — Organization-neutral product

- **PR-GENERIC-01:** Names, email addresses, FAQ sources, categories, and reply
  styles belonging to L'Original or an individual are removed from core behavior.
- **PR-GENERIC-02:** Organization profile, mailbox settings, category policy,
  knowledge, and style profiles are configurable data.
- **PR-GENERIC-03:** The first deployment model is single-tenant, while domain and
  API boundaries avoid blocking a future multi-tenant design.
- **PR-GENERIC-04:** Public fixtures and demo data remain synthetic and contain no
  employer or private mailbox data.

### PR-WEB — Reviewer application

- **PR-WEB-01:** The application home page opens the Inbox directly.
- **PR-WEB-02:** Inbox shows synchronization state, classification, confidence,
  review requirements, linked knowledge, and draft status.
- **PR-WEB-03:** Outbox shows drafts and simulated or real dispatch states, including
  scheduled, sent, failed, cancelled, and retry information.
- **PR-WEB-04:** Knowledge Base supports creating, editing, approving, deactivating,
  versioning, and tracing factual knowledge to its source.
- **PR-WEB-05:** Style Library supports reviewable writing examples and explicit
  tone rules without mixing them into factual grounding.
- **PR-WEB-06:** Conflict Center shows suspected duplicate or contradictory
  knowledge, the evidence behind the alert, and a human resolution workflow.
- **PR-WEB-07:** Integration settings show Gmail connection, last successful sync,
  watch/reconciliation health, Shadow Mode, and sending safety state.
- **PR-WEB-08:** AI suggestions, human-approved values, and simulated versus real
  actions are visually distinct.

### PR-RETRIEVAL — Embeddings and grounded answers

- **PR-RETRIEVAL-01:** Embedding generation remains behind an internal provider
  interface and records model, version, dimensions, content hash, and status.
- **PR-RETRIEVAL-02:** Only active, approved factual knowledge is eligible for answer
  grounding and knowledge-vector search.
- **PR-RETRIEVAL-03:** Retrieval combines PostgreSQL full-text results with pgvector
  semantic results and applies a deterministic fusion or reranking method.
- **PR-RETRIEVAL-04:** Style examples use a separate index or retrieval path and
  cannot be cited as factual sources.
- **PR-RETRIEVAL-05:** Updating content or embedding models queues controlled
  re-embedding without silently mixing incompatible vectors.
- **PR-RETRIEVAL-06:** Exact vector search is the initial default. HNSW or another
  approximate index is added only when measured corpus size and latency justify it.
- **PR-RETRIEVAL-07:** Retrieval changes are evaluated against the current full-text
  baseline using a versioned English/French question set and measures such as
  relevant-source recall, unsupported-answer rate, and reviewer acceptance.
- **PR-RETRIEVAL-08:** Conflict detection may rank suspicious knowledge pairs, but
  only a human may merge, deactivate, or select the authoritative entry.

### PR-API — Deployable service and external integration

- **PR-API-01:** MailOps is packaged as an application container and can be deployed
  independently from a customer's website or database.
- **PR-API-02:** External systems use versioned HTTPS APIs rather than direct
  PostgreSQL access.
- **PR-API-03:** APIs use service authentication, authorization, input validation,
  rate limits, audit events, and idempotency keys for mutating operations.
- **PR-API-04:** The first API surface covers only stable workflows such as thread
  status, draft review actions, approved knowledge search, and integration health.
- **PR-API-05:** API contracts are documented with request, response, error, and
  webhook semantics before a company integration is built.
- **PR-API-06:** Production environments use HTTPS, managed secrets, database
  migrations, backups, structured logs, monitoring, and recoverable error handling.
- **PR-API-07:** Mailbox data and reviewer pages are never exposed through an
  unauthenticated public endpoint.

## 5. Delivery Plan

Each phase should finish with automated tests, documentation, and a small manual
acceptance checklist before the next phase begins.

### Phase A — Generic product boundary

- replace hard-coded organization/person concepts with configurable organization,
  mailbox, category, and style concepts;
- preserve existing behavior while introducing no real Gmail or sending side
  effects;
- update synthetic fixtures and define the first protected API contract.

**Exit:** the local app can demonstrate its main workflows without L'Original or
Dorian being required by the code or UI.

### Phase B — Deployable secure foundation

- containerize the application, not only PostgreSQL;
- deploy a non-production environment with managed PostgreSQL, HTTPS, secrets,
  migrations, logs, health checks, and basic reviewer authentication;
- keep external delivery disabled.

**Exit:** a protected staging URL runs the same tested application build as local
development and can be safely recreated from documented steps.

### Phase C — Gmail inbound Shadow Mode

- implement OAuth connection, initial sync, Pub/Sub/history ingestion, watch
  renewal, reconciliation, and sync-health reporting;
- run classification and draft generation without changing or sending Gmail mail;
- compare imported results with the Gmail mailbox and verify idempotency.

**Exit:** new Gmail messages reliably appear once in the MailOps Inbox and failures
are visible and recoverable.

### Phase D — Product workflow interface

- make Inbox the home page;
- complete Inbox, Outbox, Knowledge Base, Style Library, Conflict Center, and
  integration settings;
- support human correction, approval, editing, deactivation, and audit history.

**Exit:** a reviewer can complete the daily workflow from the web interface without
database tools or manual `.eml` upload.

### Phase E — Hybrid retrieval and conflict assistance

- add pgvector, embedding lifecycle, hybrid retrieval, and separate style retrieval;
- build a versioned evaluation set and compare it with the full-text baseline;
- add conflict suggestions and human resolution, without automatic truth decisions.

**Exit:** hybrid retrieval shows a measured improvement or is intentionally kept
behind a feature flag, and every factual draft remains traceable to approved
knowledge.

### Phase F — Protected external API and controlled Gmail sending

- publish the stable authenticated API and integration documentation;
- add human-confirmed Gmail sending, provider reconciliation, retry controls, and
  emergency disable controls;
- canary-test with a dedicated mailbox before enabling any real operational inbox.

**Exit:** an external company system can safely call MailOps without database
sharing, and an approved reply can be sent exactly once with a complete audit trail.

## 6. Deferred Scope

The following are not required for this plan's first production-capable release:

- native mobile applications;
- multi-tenant SaaS and billing;
- automatic unreviewed sending;
- Microsoft Graph, SMTP, or additional mailbox providers;
- Discord or company-specific workflows;
- attachment content extraction, OCR, or AI processing;
- autonomous approval of classifications, knowledge, conflicts, or replies.

## 7. Completion Criteria

The next-stage product is complete when:

- it is available at a protected HTTPS deployment and is reproducible;
- Gmail messages synchronize automatically and recover from duplicate or missed
  notifications;
- normal reviewers do not need `.eml` files or database tools;
- the product UI covers Inbox, Outbox, Knowledge Base, Style Library, conflicts,
  and integration health;
- factual grounding uses only approved knowledge and remains auditable;
- hybrid retrieval is evaluated against the full-text baseline;
- external systems have a documented, authenticated API;
- real replies require human confirmation and cannot be sent twice;
- privacy, retention, secrets, backups, monitoring, and recovery procedures are
  documented and tested.

## 8. Primary Technical References

- [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [Gmail `users.watch`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch)
- [Gmail OAuth scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Cloud Run Pub/Sub integration](https://cloud.google.com/run/docs/tutorials/pubsub)
- [pgvector](https://github.com/pgvector/pgvector)
