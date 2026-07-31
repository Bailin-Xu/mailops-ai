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
- `language`
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
- `inReplyTo`
- `references`
- `subject`
- `sentAt`
- `textBody`
- `htmlBody`
- `normalizedBody`
- `sourceFileName`
- `fingerprint`
- `parseStatus`
- `parseWarnings`
- `createdAt`

### Responsibilities

- preserves parsed email content;
- supports duplicate detection;
- supports thread reconstruction;
- provides input for AI classification and draft generation.

### Relationships

- belongs to one `EmailThread`
- has many `EmailParticipant`
- has many `AttachmentMetadata`

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

## 3.5 Classification

Represents one AI classification attempt and its human-reviewed result.

### Main Fields

- `id`
- `threadId`
- `aiExecutionId`
- `aiCategory`
- `aiConfidence`
- `aiLanguage`
- `aiSummary`
- `reviewedCategory`
- `reviewedSummary`
- `correctionNote`
- `reviewStatus`
- `reviewedAt`
- `createdAt`

### Review Status

- `PENDING`
- `ACCEPTED`
- `CORRECTED`

### Responsibilities

- preserves original AI output;
- stores the final human-reviewed decision;
- supports model evaluation.

### Relationships

- belongs to one `EmailThread`
- optionally belongs to one `AIExecution`

---

## 3.6 KnowledgeCandidate

Represents untrusted knowledge proposed from an email or thread.

### Main Fields

- `id`
- `threadId`
- `aiExecutionId`
- `title`
- `canonicalQuestion`
- `proposedAnswer`
- `category`
- `language`
- `status`
- `rejectionReason`
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
- links each proposal to its source;
- prevents unreviewed content from entering the trusted knowledge base.

### Relationships

- belongs to one source `EmailThread`
- optionally belongs to one `AIExecution`
- may create one `KnowledgeEntry`

---

## 3.7 KnowledgeEntry

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
- preserves source traceability.

### Relationships

- optionally originates from one `KnowledgeCandidate`
- may be used by many `Draft`
- may have many `AuditEvent`

---

## 3.8 Draft

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
- `GENERATION_FAILED`
- `EDITED`
- `APPROVED`
- `REJECTED`
- `SIMULATED_SENT`

### Responsibilities

- stores generated and final reviewed reply text;
- preserves the exact approved version;
- records simulated-send completion.

### Relationships

- belongs to one `EmailThread`
- optionally belongs to one `AIExecution`
- uses one or more `KnowledgeEntry`
- has many `AuditEvent`

---

## 3.9 DraftKnowledgeSource

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

## 3.10 AIExecution

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
- `inputTokenCount`
- `outputTokenCount`
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

## 3.11 AuditEvent

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

A thread may have multiple classification attempts, but only one reviewed classification should be treated as current.

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

### DM-009 — Human approval

AI must never set final approved states for classifications, knowledge, or drafts.

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
