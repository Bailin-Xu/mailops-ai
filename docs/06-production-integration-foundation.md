# MailOps AI — Production Integration Foundation

## 1. Decision Summary

MailOps AI remains a PostgreSQL application. A future Artur integration may read
artist identity from MariaDB-backed services, but MailOps does not join across
databases and does not create cross-database foreign keys. It stores only stable
external references (`artistId`, `wordpressId`, and normalized artist email) and
reconciles them through an application service.

Phase 1 does not connect to Gmail, Google Pub/Sub, Discord, OpenAI, Gemini, or the
Artur application. It creates the provider boundaries and durable workflow records
needed to add those integrations without moving business rules into API clients.

## 2. Existing Code That Remains Reusable

| Existing capability | Production use |
| --- | --- |
| `.eml` parser, cleaner, participants, attachments metadata | Shared normalization path for Gmail payloads after a Gmail adapter converts them to the internal ingestion shape |
| `EmailThread` and RFC `Message-ID`/`In-Reply-To`/`References` | Canonical conversation record and reply-header construction |
| Message fingerprint and unique RFC `messageId` | Secondary duplicate protection in addition to Gmail's provider message ID |
| `AIProvider` and Zod result schemas | Gemini or another model remains replaceable and all output remains validated |
| `Classification` history and human correction | Routing, evaluation, and correction feedback |
| approved `KnowledgeEntry` workflow | Trust boundary for keyword search and future pgvector retrieval |
| `DraftKnowledgeSource` | Exact retrieved knowledge IDs used for every draft |
| `AIExecution` | Provider/model/prompt/latency audit, extended with token and cost fields |
| simulated send and simulated technical forward | Local and Shadow Mode workflow testing |

The existing `EmailThread.status` and classification processing fields remain for
the current Inbox. The new `automationState` is the durable integration state;
later UI work can consolidate the older presentation-oriented status without a
broad migration in Phase 1.

## 3. Phase 1 Database Additions

### Email provider identity

`EmailMessage` now keeps these identifiers separately:

- `messageId`: RFC `Message-ID`, used for email threading;
- `sourceProvider`: `EML_IMPORT` or future `GMAIL`;
- `externalMessageId`: Gmail's provider message ID, unique with provider;
- `externalThreadId`: Gmail's thread ID;
- `providerHistoryId`: optional Gmail history checkpoint context.

This prevents the common mistake of treating Gmail's opaque message ID as an RFC
header ID. Duplicate Pub/Sub deliveries can safely converge on the provider ID,
while RFC and fingerprint checks remain secondary defenses.

### Artur reference boundary

`EmailThread` stores nullable, indexed `artistId`, `wordpressId`, and
`artistEmail`. They are references, not foreign keys. MailOps remains available if
Artur or MariaDB is unavailable, and reconciliation can be retried independently.

### Durable workflow

`automationState` uses:

```text
RECEIVED → CLASSIFIED → AWAITING_HUMAN
                    ↘ REPLY_SCHEDULED → SENDING → SENT
                                           ↘ FAILED
Any non-terminal state → CANCELLED
FAILED → REPLY_SCHEDULED
```

`ReplyDispatch` is the outbox/job record. It stores:

- one unique dispatch per draft;
- a deterministic idempotency key;
- immutable randomized `delayAt` between 2 and 15 hours;
- independently mutable `nextAttemptAt` for retry backoff;
- attempts and maximum attempts;
- compare-and-set worker locks;
- provider message ID and final timestamp;
- approval mode (`HUMAN_CONFIRMED` or future `AUTO_LOW_RISK`).

The send delay is chosen once. A retry may update `nextAttemptAt` but never
re-randomizes `delayAt`.

### Safety and audit

`SafetyControl(global)` defaults to Shadow Mode with external delivery disabled.
Environment variables default to the same safe state. Both the runtime policy and
database kill switch must permit delivery before a worker may claim a due job.

`AuditEvent` stores event names and minimal identifiers/metadata. It must not store
complete incoming email bodies, generated replies, credentials, or attachment
content.

### Bug workflow

`BugTicket` stores the validated issue summary, page, reproduction steps, severity,
optional Artur references, queue/claim state, developer assignment, and submitted
reply. `classificationId` is unique so retries cannot create duplicate tickets.
Developer claim uses a compare-and-set update so two Discord button clicks cannot
both take ownership.

## 4. Module Layout

Implemented now:

```text
lib/
├── automation/
│   ├── state-machine.ts
│   ├── reply-policy.ts
│   └── reply-dispatch.ts
├── bugs/
│   └── service.ts
└── integrations/
    ├── email-provider.ts
    └── technical-queue-provider.ts
```

Planned adapters and workers:

```text
lib/
├── integrations/
│   ├── gmail/gmail-email-provider.ts
│   ├── gmail/gmail-ingestion-adapter.ts
│   ├── discord/discord-technical-provider.ts
│   └── artur/artist-reference-resolver.ts
├── workers/
│   ├── inbox-event-worker.ts
│   ├── reply-dispatch-worker.ts
│   └── stale-lock-recovery.ts
└── knowledge/
    ├── embedding-provider.ts
    └── hybrid-search.ts
```

Gmail, Discord, Artur, and embedding clients must translate external payloads at
the boundary. Core classification, risk, scheduling, knowledge, and approval rules
must not import their SDK types.

## 5. Automatic Reply Policy

The Phase 1 policy is deliberately stricter than classification routing. A future
automatic reply requires all of the following:

- effective category is `KNOWN_QUESTION`;
- confidence is at least `0.90` by default;
- classification was automatically routed, not merely corrected;
- draft is ready;
- exactly one approved grounding source was selected;
- no high-risk payment, refund, contract, privacy, account deletion, legal dispute,
  harassment, or serious complaint signal is present.

Failing any rule sends the case to a human. A model cannot change the policy,
schedule, job state, retry count, or kill switch.

## 6. Main Risks and Controls

### Privacy and prompt injection

- Free AI tiers must not receive real private email because their data-use terms
  may differ from paid services.
- Send only cleaned minimum context, never attachment content, remote images,
  credentials, or full unrelated history.
- Treat email instructions as untrusted text.
- Separate factual knowledge from Dorian-style examples. Style examples cannot
  authorize claims.
- Apply retention, access control, encryption, and deletion policies before a
  production mailbox is connected.

### Duplicate ingestion and duplicate sending

- Pub/Sub is at-least-once; Gmail provider message ID must be unique and processing
  must be idempotent.
- RFC `Message-ID` and fingerprint remain fallback checks.
- One `ReplyDispatch` per draft plus a unique idempotency key prevents local double
  scheduling.
- A Gmail send may succeed while its response is lost. Before retrying an ambiguous
  send, the production adapter must reconcile by dispatch identifier/thread rather
  than blindly sending again.

### Concurrency

- Worker claims use a compare-and-set state/lock update.
- Discord developer claims use the same pattern.
- Production workers need stale-lock recovery with bounded lock age and audit.
- Every transition must verify the current state; terminal states cannot reopen
  without an explicit recovery action.

### External endpoint security

- Verify Google Pub/Sub push authentication and reject replayed event IDs.
- Verify Discord interaction signatures and timestamps.
- Restrict Gmail OAuth scopes to the minimum required mailbox operations.
- Store tokens in a secret manager, never PostgreSQL plaintext or repository files.

### Attachments

Phase 1 stores metadata only. Before attachment content is enabled, add size/type
allowlists, malware scanning, quarantine, archive-bomb protection, safe filenames,
retention limits, and an explicit rule preventing automatic AI upload.

## 7. Phased Implementation Plan

### Phase 1 — Local integration foundation (implemented)

- additive PostgreSQL schema;
- provider-neutral Gmail/Discord contracts;
- durable scheduling, fixed delay, retry, idempotency, and worker claim;
- Bug Ticket creation, simulated forwarding, single developer claim, resolution;
- environment and database kill switches;
- automatic-reply risk policy;
- synthetic automated tests only.

### Phase 2 — AI Shadow Mode

- Gemini 3.5 Flash-Lite is implemented behind the existing `AIProvider` for
  explicit local Shadow Mode actions;
- build a safely redacted classification/draft evaluation set;
- token usage and provider response metadata are captured; structured bug
  extraction and paid-cost calculation remain deferred;
- keep real historical messages out of free-tier AI services;
- compare Mock and Gemini without sending.

### Phase 3 — Gmail inbound Shadow Mode

- create a dedicated Google Cloud project and least-privilege OAuth setup;
- ingest `artistes@...` messages through Gmail API and Pub/Sub;
- persist provider IDs/history checkpoints and reconstruct complete threads;
- no outgoing Gmail calls; verify idempotency and replay handling first.

### Phase 4 — Discord technical workflow

- implement signed Discord Interactions in a non-production server;
- create tickets, claim atomically, submit developer replies;
- save the reply as a human-authored draft; Gmail sending remains disabled.

### Phase 5 — Human-confirmed Gmail canary

- enable Gmail reply delivery for a test mailbox only;
- reconcile ambiguous sends and validate reply headers/threading;
- exercise retry limits, stale-lock recovery, cancellation, and kill switches;
- require human confirmation for every send.

### Phase 6 — Controlled low-risk automation

- run Shadow Mode long enough to measure false-answer and correction rates;
- require approved atomic knowledge and a reviewed risk taxonomy;
- enable delayed automatic replies for a small allowlisted category set;
- begin with a small percentage, monitoring, alerting, and immediate rollback;
- keep high-risk categories permanently human-controlled.

## 8. Deferred Deliberately

- No PostgreSQL-to-MariaDB migration.
- No Artur code or schema changes.
- No Gmail, Pub/Sub, Discord, OpenAI, or Gemini production call.
- No pgvector column or embedding dependency until the approved knowledge set and
  retrieval evaluation are stable. PostgreSQL can add the extension later without
  changing the provider or workflow boundaries.
- No production worker, cron, webhook endpoint, OAuth storage, or attachment body
  processing in Phase 1.
