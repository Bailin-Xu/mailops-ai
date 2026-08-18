# MailOps AI — Domain Model

## 1. Purpose

This document defines the core business entities and relationships for the MailOps AI MVP.

It is not a final Prisma schema. Its purpose is to give implementation tasks a stable shared model before database-specific details are added.

---

## 2. Domain Principles

The model should follow these rules:

1. Original email content is preserved.
2. AI output and human-reviewed output are stored separately.
3. Every imported message belongs to a thread.
4. Only approved knowledge is trusted for draft generation.
5. Drafts keep references to the knowledge used.
6. Important workflow changes are traceable.
7. External providers are represented by metadata, not embedded business logic.

---

## 3. Core Entities

## 3.1 EmailThread

Represents one email conversation.

### Main Fields

- `id`
- `subject`
- `normalizedSubject`
- `status`
- `automationState`
- `language`
- optional external artist references: `artistId`, `wordpressId`, `artistEmail`
- `isIncomplete`
- `createdAt`
- `updatedAt`

### Responsibilities

- groups related messages;
- stores the current workflow state;
- links classification, drafts, and knowledge candidates;
- indicates whether thread reconstruction may be incomplete.

### Relationships

- has many `EmailMessage`
- has many `Classification`
- has many `Draft`
- has many `KnowledgeCandidate`
- has many `AuditEvent`

---

## 3.2 EmailMessage

Represents one parsed email message.

### Main Fields

- `id`
- `threadId`
- `messageId`
- `sourceProvider`
- `externalMessageId`
- `externalThreadId`
- `providerHistoryId`
- `inReplyTo`
- `references`
- `subject`
- `sentAt`
- `textBody`
- `htmlBody`
- `normalizedBody`
- `cleanBody`
- `quotedContext` (derived, untrusted historical context)
- `direction` (`INBOUND`, `OUTBOUND`, `SELF`, or `UNKNOWN`)
- `knowledgeSourceStatus` (`UNASSESSED`, `READY_FOR_REVIEW`, `NEEDS_REVIEW`, or `EXCLUDED`)
- `knowledgeExclusionReasons`
- `knowledgeReviewStatus` (`PENDING`, `APPROVED`, `NEEDS_FOLLOW_UP`, or `REJECTED`)
- `knowledgeReviewNote`
- `knowledgeReviewedAt`
- `sourceFileName`
- `fingerprint`
- `parseStatus`
- `parseWarnings`
- `createdAt`

### Responsibilities

- preserves parsed email content;
- supports duplicate detection;
- supports thread reconstruction;
- keeps `normalizedBody` as the lossless normalized representation;
- provides the derived `cleanBody` for AI classification, retrieval, and draft generation.
- preserves extracted `quotedContext` as reviewer context without treating it as an original message;
- allows only `OUTBOUND` historical messages to be proposed as knowledge sources.
- records deterministic prescreening without treating it as human approval.
- stores the latest human source-review decision separately from prescreening.

### Relationships

- belongs to one `EmailThread`
- has many `EmailParticipant`
- has many `AttachmentMetadata`
- has many `KnowledgeSourceReviewEvent`

---

## 3.3 EmailParticipant

Represents a sender or recipient.

### Main Fields

- `id`
- `messageId`
- `type`
- `displayName`
- `emailAddress`
- `normalizedAddress`

### Participant Types

- `FROM`
- `TO`
- `CC`
- `BCC`
- `REPLY_TO`

### Relationships

- belongs to one `EmailMessage`

---

## 3.4 AttachmentMetadata

Represents attachment information without storing attachment content.

### Main Fields

- `id`
- `messageId`
- `fileName`
- `mimeType`
- `sizeBytes`
- `contentId`
- `isInline`

### Relationships

- belongs to one `EmailMessage`

---

## 3.5 KnowledgeSourceReviewEvent

Represents an immutable human decision about whether a historical email may be
used to create a knowledge candidate.

### Main Fields

- `id`
- `messageId`
- `decision`
- `note`
- `createdAt`

The current decision is also stored on `EmailMessage` for filtering. Every save
creates an event so later corrections do not erase review history.

## 3.5.1 WebsiteSource

Represents one public website page used as traceable evidence.

### Main Fields

- `id`
- `url`
- `title`
- `language`
- `capturedAt`
- `createdAt`
- `updatedAt`

The source page is not trusted automatically and may support multiple policy
review items.

## 3.5.2 WebsiteKnowledgeReviewItem

Represents one public policy question that requires human resolution before it
may become a knowledge candidate.

### Main Fields

- `id`
- `key`
- `title`
- `questionForOwner`
- `language`
- `status` (`PENDING`, `CONFIRMED`, `NEEDS_FOLLOW_UP`, or `REJECTED`)
- `confirmedAnswer`
- `reviewNote`
- `reviewedAt`
- `createdAt`
- `updatedAt`

The confirmed owner answer is stored separately from every public claim.
`CONFIRMED` resolves the source conflict but does not create active knowledge.

## 3.5.3 WebsiteKnowledgeEvidence

Represents a captured claim supporting a website policy review item.

### Main Fields

- `id`
- `evidenceKey`
- `reviewItemId`
- `sourceId`
- `sectionHeading`
- `claim`
- `createdAt`

Evidence remains immutable source context and links back to its public page.

## 3.5.4 WebsiteKnowledgeReviewEvent

Represents an immutable decision about a website policy review item.

### Main Fields

- `id`
- `reviewItemId`
- `decision`
- `confirmedAnswer`
- `note`
- `createdAt`

The event preserves the answer and note associated with each decision so later
corrections do not rewrite review history.

---

## 3.6 Classification

Represents one AI classification attempt, its automatic routing state, and any later human correction.

### Main Fields

- `id`
- `threadId`
- `aiExecutionId`
- `aiCategory`
- `aiConfidence`
- `aiLanguage`
- `reviewedCategory`
- `correctionNote`
- `reviewStatus`
- `reviewedAt`
- `route`
- `processingStatus`
- `routingReason`
- `knowledgeQuery`
- `knowledgeMatchCount`
- `simulatedForwardedAt`
- `createdAt`

### Review Status

- `PENDING`
- `AUTO_ROUTED`
- `ACCEPTED`
- `CORRECTED`

### Responsibilities

- preserves original AI output;
- allows validated high-confidence output to route without blocking;
- stores any final human-reviewed correction separately;
- records retrieval and simulated technical-forward state;
- supports model evaluation.

### Relationships

- belongs to one `EmailThread`
- belongs to one `AIExecution`

The local MVP stores every validated Mock AI attempt as a new classification.
Failed or schema-invalid provider output creates a failed `AIExecution` but no
classification, so a previous valid result is never overwritten. The newest
successful classification becomes `AUTO_ROUTED` unless confidence is below the
configured threshold or the category explicitly requests manual review. Earlier
attempts remain available for evaluation.

---

## 3.7 KnowledgeCandidate

Represents untrusted knowledge proposed from an approved historical email or a
curated public website FAQ.

### Main Fields

- `id`
- `fingerprint`
- optional `parentCandidateId` for candidates created by splitting a combined
  proposal
- `title`
- `canonicalQuestion`
- `proposedAnswer`
- `category`
- `language`
- `status`
- reviewed title, question, answer, category, and language fields
- `reviewNote`
- `reviewedAt`
- `createdAt`
- `updatedAt`

### Status

- `DRAFT`
- `PENDING_REVIEW`
- `APPROVED`
- `REJECTED`

### Responsibilities

- stores AI-assisted or manually created knowledge proposals;
- links each proposal to one or more immutable source references;
- prevents unreviewed content from entering the trusted knowledge base.

### Relationships

- has many `KnowledgeCandidateSource` records pointing to an `EmailMessage` or
  `WebsiteSource`
- has many immutable `KnowledgeCandidateReviewEvent` records
- may create one `KnowledgeEntry`
- may belong to one parent candidate and have multiple split child candidates

A split is an atomic review operation: the combined parent becomes `REJECTED`
with a replacement note, each child begins as `PENDING_REVIEW`, and every child
inherits the parent's source references. Empty proposed answers are permitted on
split children so an unresolved sub-question can remain visible for business
follow-up instead of acquiring an invented answer.

The current local importer is deterministic and idempotent. It imports only
human-approved `READY_FOR_REVIEW` outbound emails and a reviewed allowlist of
stable French website FAQs. The seven unresolved website policy conflicts are
not present in that allowlist.

---

## 3.8 KnowledgeEntry

Represents trusted, human-approved knowledge.

### Main Fields

- `id`
- `sourceCandidateId`
- `title`
- `canonicalQuestion`
- `answer`
- `category`
- `language`
- `status`
- `approvedAt`
- `createdAt`
- `updatedAt`

### Status

- `ACTIVE`
- `INACTIVE`
- `ARCHIVED`

### Responsibilities

- provides authoritative content for draft generation;
- supports keyword and PostgreSQL text search;
- participates in language-specific weighted full-text indexes only while
  `ACTIVE`;
- preserves source traceability.

### Relationships

- originates from exactly one approved `KnowledgeCandidate`
- may be used by many `Draft`
- may have many `AuditEvent`

---

## 3.9 Draft

Represents one generated or manually edited reply draft.

### Main Fields

- `id`
- `threadId`
- `aiExecutionId`
- `subject`
- `body`
- `language`
- `status`
- `approvedSubject`
- `approvedBody`
- `approvedAt`
- `simulatedSentAt`
- `createdAt`
- `updatedAt`

### Status

- `GENERATED`
- `SUPERSEDED`
- `SIMULATED_SENT`

### Responsibilities

- stores a grounded Mock-provider reference reply or a human-authored reply;
- preserves the exact approved version;
- records simulated-send completion.

### Relationships

- belongs to one `EmailThread`
- optionally belongs to one `AIExecution`
- uses one or more `KnowledgeEntry`
- has many `AuditEvent`

---

## 3.10 DraftKnowledgeSource

Join entity connecting drafts to the knowledge used.

### Main Fields

- `draftId`
- `knowledgeEntryId`
- `rank`
- `relevanceScore`

### Responsibilities

- preserves grounding traceability;
- supports source display in the UI;
- allows one draft to use multiple knowledge records.

---

## 3.11 AIExecution

Represents one call to an AI provider.

### Main Fields

- `id`
- `provider`
- `model`
- `taskType`
- `promptVersion`
- `status`
- `startedAt`
- `completedAt`
- `latencyMs`
- `inputTokens`
- `outputTokens`
- `costMicros`
- `validationPassed`
- `errorType`
- `errorMessage`

### Task Types

- `CLASSIFICATION`
- `ENGLISH_SUMMARY`
- `KNOWLEDGE_CANDIDATE`
- `DRAFT_GENERATION`

### Status

- `PENDING`
- `SUCCEEDED`
- `FAILED`

### Responsibilities

- records provider usage and failures;
- supports debugging and evaluation;
- links model activity to domain records.

### Relationships

- may be linked to a `Classification`
- may be linked to a `KnowledgeCandidate`
- may be linked to a `Draft`

---

## 3.12 AuditEvent

Represents an important system or user action.

### Main Fields

- `id`
- `entityType`
- `entityId`
- `action`
- `actorType`
- `previousValue`
- `newValue`
- `note`
- `createdAt`

### Actor Types

- `SYSTEM`
- `AI`
- `LOCAL_USER`

### Example Actions

- `EMAIL_IMPORTED`
- `CLASSIFICATION_ACCEPTED`
- `CLASSIFICATION_CORRECTED`
- `KNOWLEDGE_APPROVED`
- `KNOWLEDGE_REJECTED`
- `DRAFT_EDITED`
- `DRAFT_APPROVED`
- `SIMULATED_SEND_COMPLETED`

---

## 3.13 ReplyDispatch

Represents one durable, idempotent delayed reply job. `delayAt` is selected once;
retry backoff uses `nextAttemptAt`. Worker ownership, attempts, maximum attempts,
provider message ID, approval mode, and final send state remain traceable.

## 3.14 BugTicket

Represents one technical issue extracted from a technical classification. It keeps
structured issue fields, optional external artist references, simulated or future
Discord message identity, atomic developer ownership, and the developer-authored
reply. One classification may create at most one ticket.

## 3.15 SafetyControl

The singleton global safety record holds Shadow Mode and the external-delivery
kill switch. Database and environment controls must both allow delivery.

---

## 4. Main Relationships

```text
EmailThread
├── EmailMessage
│   ├── EmailParticipant
│   └── AttachmentMetadata
├── Classification
├── KnowledgeCandidate
│   └── KnowledgeEntry
├── Draft
│   └── DraftKnowledgeSource
│       └── KnowledgeEntry
└── AuditEvent

AIExecution
├── Classification
├── KnowledgeCandidate
└── Draft
```

---

## 5. Key Business Constraints

### DM-001 — Thread ownership

Every `EmailMessage` must belong to exactly one `EmailThread`.

### DM-002 — Duplicate protection

`messageId`, when present, should be unique after normalization.

The fallback fingerprint should also be indexed.

### DM-003 — Classification history

A thread may have multiple classification attempts. The latest validated attempt is current; a human-corrected category takes precedence over its AI category.

### DM-004 — Knowledge trust boundary

A `KnowledgeCandidate` is never trusted knowledge.

Only an approved `KnowledgeEntry` may be used for grounded draft generation.

### DM-005 — Draft grounding

A known-question draft must reference at least one active `KnowledgeEntry`.

### DM-006 — Final draft preservation

After approval, the exact approved subject and body must remain stored even if the generated draft is later edited elsewhere.

### DM-007 — No hard dependency on Gemini

No core entity should contain Gemini-specific fields beyond generic provider and model metadata.

### DM-008 — No attachment content

The MVP stores only attachment metadata.

### DM-009 — Human sending gate

High-confidence AI classification may set `AUTO_ROUTED`, which is not approval. AI must never approve knowledge, confirm a draft, or record simulated/real sending; those remain human actions.

---

## 6. Suggested Indexes

The implementation should consider indexes for:

- `EmailMessage.messageId`
- `EmailMessage.fingerprint`
- `EmailMessage.sentAt`
- `EmailThread.status`
- `Classification.threadId`
- `KnowledgeCandidate.status`
- `KnowledgeEntry.status`
- `KnowledgeEntry.language`
- `KnowledgeEntry.category`
- `Draft.threadId`
- `Draft.status`
- `AIExecution.status`
- `AIExecution.taskType`

PostgreSQL text-search indexes may later be added for knowledge and normalized email content.

---

## 7. Deferred Model Decisions

The following are intentionally deferred:

1. exact Prisma field types;
2. JSON versus normalized storage for references and warnings;
3. version table for approved knowledge;
4. manual thread merge records;
5. separate translation entities;
6. organization and multi-tenant entities;
7. authenticated user entities;
8. retention and deletion records;
9. vector embeddings;
10. provider-specific mailbox identifiers.

These decisions should be resolved only when the relevant implementation phase begins.
