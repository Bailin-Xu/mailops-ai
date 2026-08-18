# MailOps AI — MVP Requirements

## 1. Purpose

This document defines the functional scope and acceptance criteria for the first usable version of **MailOps AI**.

It is intentionally limited to product behavior. Detailed architecture, data modeling, AI prompt design, security policy, and testing strategy are documented separately.

The MVP is a local, single-user system that:

- imports `.eml` files;
- parses and stores email content;
- classifies English and French inquiries;
- allows human review and correction;
- manages approved knowledge;
- generates grounded reply drafts;
- simulates sending without contacting a real mailbox.

## 2. MVP Boundaries

### Included

- Local Next.js application
- PostgreSQL database
- Docker-based local database setup
- `.eml` import
- Email parsing
- Duplicate detection
- Basic thread reconstruction
- Mock inbox
- Gemini-based classification
- Original English and French email content preservation
- Confidence-gated classification and human correction
- Knowledge candidate workflow
- Approved knowledge base
- Keyword and PostgreSQL text search
- Grounded draft generation
- Draft review and editing
- Simulated sending
- AI execution history
- Synthetic demo data

### Excluded

- Authentication
- Multi-user roles
- Microsoft Graph
- Gmail API
- Real mailbox synchronization
- Real email sending
- Discord integration
- Attachment-content processing
- OCR and PDF extraction
- Vector search
- Fine-tuning
- Autonomous agents
- Production use of private company emails

## 3. User Model

The MVP supports one local user with full access.

The user can:

- import emails;
- review parsed content;
- classify emails;
- correct AI results;
- create and approve knowledge;
- generate and edit drafts;
- simulate sending;
- inspect AI execution records.

Authentication and role-based access are deferred.

# 4. Functional Requirements

## 4.1 Local Setup

### FR-001 — Run locally

The application shall start locally using documented commands.

**Acceptance criteria**

- PostgreSQL starts through Docker Compose.
- The application connects to PostgreSQL.
- Database migrations can be applied.
- The application starts with `npm run dev`.
- Setup steps are documented.

### FR-002 — Environment configuration

The application shall use environment variables for:

- database connection;
- Gemini API key;
- Gemini model;
- optional mock-AI mode.

**Acceptance criteria**

- `.env.example` exists.
- `.env` is excluded from Git.
- Missing required configuration produces a clear error.
- No secret is hard-coded.

## 4.2 EML Import

### FR-010 — Import EML files

The user shall be able to upload one or more `.eml` files.

**Acceptance criteria**

- Single-file upload works.
- Multi-file upload works.
- Each file receives an independent result.
- Imported messages appear in the inbox.
- Invalid files do not block valid files in the same batch.

### FR-011 — Validate uploads

The system shall reject:

- empty files;
- unsupported file types;
- obviously malformed email files;
- files larger than the configured limit.

The initial file-size limit shall be 10 MB per file.

### FR-012 — Show import results

The import page shall show:

- imported count;
- duplicate count;
- failed count;
- per-file errors.

Errors shall not expose internal stack traces.

## 4.3 Email Parsing

### FR-020 — Parse email headers

The system shall extract:

- sender;
- recipients;
- CC recipients;
- BCC recipients when present;
- reply-to address;
- subject;
- sent date;
- message ID;
- in-reply-to value;
- references.

### FR-021 — Parse email body

The system shall extract:

- plain-text body;
- HTML body when present;
- normalized readable text.

Plain text should be preferred for display. HTML-only messages may be converted to readable text.

### FR-022 — Parse participants

Each email participant shall be represented with:

- display name when available;
- email address;
- normalized lowercase address.

### FR-023 — Record attachment metadata

The system shall record attachment metadata such as:

- filename;
- MIME type;
- size;
- inline status.

The system shall not process or store attachment content in the MVP.

### FR-024 — Handle malformed content

A malformed message shall not crash the application.

The system shall either:

- parse the recoverable fields and record warnings; or
- reject the message with a clear error.

### FR-025 — Preserve bilingual characters

English and French characters, including accented characters, shall display correctly.

## 4.4 Duplicate Detection

### FR-030 — Detect duplicates

The system shall prevent duplicate email records.

Primary duplicate detection shall use normalized `Message-ID`.

When `Message-ID` is unavailable, the system shall use a deterministic fingerprint based on message metadata and body content.

### FR-031 — Report duplicate imports

A duplicate upload shall:

- return a duplicate result;
- reference the existing record where practical;
- not create a second email record.

## 4.5 Thread Reconstruction

### FR-040 — Group related messages

Each message shall belong to a thread.

The system shall use:

- `In-Reply-To`;
- `References`;
- matching `Message-ID`;

to connect related messages.

### FR-041 — Support standalone messages

A message without related messages shall remain a one-message thread.

### FR-042 — Order thread messages

Messages in a thread shall be displayed chronologically.

### FR-043 — Show incomplete-thread warnings

The system shall indicate when:

- a referenced parent is missing;
- only part of a conversation is available;
- thread reconstruction used a weaker fallback.

Subject-based fallback matching may be added, but it must be conservative.

## 4.6 Mock Inbox

### FR-050 — Display inbox

The application shall provide an inbox-style view of imported threads.

Each row shall show:

- sender;
- subject;
- date;
- message count;
- language when available;
- classification when available;
- review status;
- draft status.

### FR-051 — Search inbox

The user shall be able to search by:

- sender;
- subject;
- body keywords.

### FR-052 — Filter inbox

The user shall be able to filter by:

- classification category;
- language;
- review state;
- draft state.

### FR-053 — Sort and paginate

The inbox shall:

- sort newest first by default;
- support pagination or incremental loading.

### FR-054 — Open thread detail

The user shall be able to open a thread and inspect all known messages.

## 4.7 Thread Detail

### FR-060 — Display message timeline

The thread detail page shall display:

- sender;
- recipients;
- date;
- subject;
- body;
- attachment metadata;
- message order.

### FR-061 — Display technical metadata

The user shall be able to inspect:

- message ID;
- in-reply-to;
- references;
- import filename;
- parse warnings.

Technical metadata may be placed in a collapsible section.

### FR-062 — Render email safely

HTML email content shall be sanitized.

Remote images and tracking pixels shall not load automatically.

### FR-063 — Display workflow state

The thread page shall display:

- current classification;
- AI confidence;
- detected language;
- human review result;
- linked knowledge;
- current draft;
- knowledge candidate status.

# 5. AI Classification Requirements

## 5.1 Provider Behavior

### AIR-001 — Provider abstraction

The application shall access AI through an internal provider interface.

Business logic shall not depend directly on the Gemini SDK.

### AIR-002 — Gemini provider

The MVP shall include a Gemini provider.

The model name shall be configurable.

### AIR-003 — Mock provider

The project shall include a deterministic mock AI provider for tests and offline development.

## 5.2 Classification

### AIR-010 — Classify English and French emails

The system shall classify English and French email content.

The initial category set shall include:

- `KNOWN_QUESTION`;
- `TECHNICAL_ISSUE`;
- `ACCOUNT_ACCESS`;
- `PAYMENT_ADMINISTRATIVE`;
- `BUSINESS_PARTNERSHIP`;
- `UNKNOWN_QUESTION`;
- `IRRELEVANT_SPAM`;
- `MANUAL_REVIEW`.

### AIR-011 — Return structured output

Classification output shall include:

```json
{
  "category": "TECHNICAL_ISSUE",
  "confidence": 0.92,
  "language": "fr",
  "requiresHumanReview": true
}
```

### AIR-012 — Validate AI output

The system shall validate all model output before storing it.

Invalid output shall not replace an existing valid classification.

### AIR-013 — Gate classification review by confidence

Validated classifications with confidence at or above `0.70` shall continue to automatic routing unless the category is `MANUAL_REVIEW`. Lower-confidence classifications shall block for human review. Automatically routed classifications remain correctable.

For blocked or incorrect classifications, the user shall be able to:

- accept the classification;
- change the category;
- add an optional correction note.

### AIR-014 — Preserve AI and human results

The system shall preserve:

- original AI category;
- confidence;
- final reviewed category;
- review timestamp;
- whether the result changed.
- the automatic route and routing reason;
- correction feedback without overwriting the original AI category.

### AIR-015 — Support retries

The user shall be able to retry classification after a provider or validation failure.

A deliberate retry shall create a new execution record.

## 5.3 Bilingual Assistance

### AIR-020 — Detect language

The system shall identify the primary language as:

- `en`;
- `fr`;
- `mixed`;
- `unknown`.

### AIR-021 — Preserve original-language content

The MVP shall keep the original English or French content visible during review.

Translated reviewer summaries are deferred until the bilingual interface is designed.

### AIR-022 — Preserve response language

Drafts shall use the incoming email’s primary language unless the reviewer explicitly chooses another language.

# 6. Knowledge Base Requirements

## 6.1 Knowledge Candidates

### KBR-001 — Create candidate

The user shall be able to create a knowledge candidate from a reviewed email or thread.

### KBR-002 — Candidate content

A candidate shall contain:

- title;
- canonical question;
- proposed answer;
- category;
- language;
- source thread;
- source messages;
- status.

### KBR-003 — Edit candidate

The user shall be able to edit the candidate before approval.

### KBR-004 — Review candidate

Candidate status shall include:

- `DRAFT`;
- `PENDING_REVIEW`;
- `APPROVED`;
- `REJECTED`.

The user shall be able to approve or reject a candidate.

### KBR-005 — Preserve source traceability

Approved and rejected candidates shall retain links to their source thread and messages.

### KBR-006 — Restrict historical source direction

Only historical email marked `OUTBOUND` and `READY_FOR_REVIEW` may be used to
create a knowledge candidate. `INBOUND`, `SELF`, `UNKNOWN`, and prescreened
`EXCLUDED` messages shall be blocked with traceable exclusion reasons.
`NEEDS_REVIEW` messages remain blocked until a human resolves their source
eligibility.

## 6.2 Approved Knowledge

### KBR-010 — Approve knowledge manually

Only a human-approved candidate may become an approved knowledge entry.

### KBR-011 — Store approved knowledge

Each knowledge entry shall contain:

- title;
- canonical question;
- answer;
- category;
- language;
- status;
- source references;
- created and updated timestamps.

### KBR-012 — Support lifecycle status

Knowledge status shall include:

- `ACTIVE`;
- `INACTIVE`;
- `ARCHIVED`.

Only active knowledge may be used for draft generation.

### KBR-013 — Edit and deactivate knowledge

The user shall be able to:

- edit an approved entry;
- deactivate it;
- archive it.

Hard deletion is not required for the MVP.

## 6.3 Knowledge Search

### KBR-020 — Search approved knowledge

The system shall search active knowledge using PostgreSQL keyword and text search.

Search shall consider:

- title;
- canonical question;
- answer;
- category;
- language.

### KBR-021 — Prefer matching language and category

Search ranking shall prefer:

- the reviewed email category;
- the target response language;
- stronger keyword relevance.

### KBR-022 — Handle no-result cases

When no relevant approved knowledge is found:

- the system shall not claim the question is known;
- the user shall be warned;
- draft generation for a known-question workflow shall be blocked or explicitly marked unsupported.

Vector search is excluded from the MVP.

# 7. Draft Requirements

## 7.1 Draft Generation

### FR-070 — Generate grounded reference draft automatically

For a high-confidence or human-corrected known question, the system shall automatically retrieve Active Knowledge and generate a grounded Dorian-style reference reply.

The MVP shall build retrieval queries from question-like body text, reject broad
or title-only matches with a deterministic relevance gate, and ground the initial
automatic draft in only the strongest qualifying Active Knowledge entry. If no
entry passes the gate, the system shall require a human-authored answer instead of
generating a draft.

### FR-071 — Use approved knowledge

A known-question draft shall use one or more active approved knowledge entries.

### FR-072 — Return structured draft output

The result shall include:

```json
{
  "subject": "Re: ...",
  "body": "...",
  "language": "fr",
  "knowledgeSourceIds": ["..."],
  "requiresHumanReview": true
}
```

### FR-073 — Display sources

The interface shall display the knowledge entries used to generate the draft.

### FR-074 — Prevent unsupported claims

The model shall be instructed not to invent:

- policies;
- prices;
- commitments;
- dates;
- technical facts;
- account-specific information.

### FR-075 — Allow editing

The user shall be able to edit:

- subject;
- body;
- target language.

### FR-076 — Review draft

Draft status shall include:

- `GENERATED`;
- `GENERATION_FAILED`;
- `EDITED`;
- `APPROVED`;
- `REJECTED`;
- `SIMULATED_SENT`.

The user shall be able to approve, reject, or regenerate a draft.

### FR-077 — Preserve final text

The exact approved subject and body shall be stored.

## 7.2 Simulated Sending

### FR-080 — Simulate send

A human shall be able to confirm a generated reference draft and mark it simulated sent in one action.

### FR-081 — Never send real email

The simulated-send action shall not connect to:

- SMTP;
- Gmail;
- Microsoft Graph;
- any real mailbox.

### FR-082 — Record simulated send

The system shall record:

- final approved draft;
- related thread;
- related knowledge sources;
- simulated-send timestamp.

The UI shall clearly state that no real email was delivered.

# 8. AI Execution History

### AIR-030 — Record AI executions

Each AI operation shall create an execution record.

Initial task types:

- classification;
- knowledge candidate generation;
- draft generation.

### AIR-031 — Store execution metadata

The system shall record:

- provider;
- model;
- task type;
- prompt version;
- status;
- start time;
- completion time;
- latency;
- validation result;
- error type;
- token usage when available.

### AIR-032 — Protect secrets

Execution records shall never store API keys or credentials.

Storage of complete prompts and model responses shall remain configurable.

# 9. User Interface Requirements

## 9.1 Required Pages

The MVP shall include:

- Dashboard
- Import
- Inbox
- Thread Detail
- Knowledge Candidates
- Knowledge Base
- AI Executions
- Settings

## 9.2 Dashboard

The dashboard shall display basic counts, including:

- imported threads;
- pending classification reviews;
- active knowledge entries;
- pending knowledge candidates;
- generated drafts;
- simulated-sent drafts;
- recent AI failures.

## 9.3 Common UI States

Core pages shall provide:

- loading states;
- empty states;
- success feedback;
- recoverable error states.

## 9.4 French Email Review

The thread detail page shall show:

- original French content;
- reviewed category;
- draft in the selected language.

The application interface may remain English-only for the MVP.

# 10. Data and Safety Requirements

### SR-001 — Public repository data policy

The repository shall contain only synthetic or safely redacted email fixtures.

Real private `.eml` files shall not be committed.

### SR-002 — Secret management

The repository shall not contain:

- API keys;
- database passwords;
- access tokens;
- private certificates;
- production configuration.

### SR-003 — Treat email as untrusted input

The system shall not execute scripts, embedded code, or attachments from imported emails.

### SR-004 — Sanitize HTML

HTML bodies shall be sanitized before display.

### SR-005 — Minimize AI input

AI requests shall exclude:

- attachment content;
- unrelated headers;
- secrets;
- unnecessary message history.

### SR-006 — Prevent prompt authority escalation

Instructions contained inside an email shall not override application or system instructions.

### SR-007 — AI cannot approve actions

AI output shall never independently:

- approve a classification;
- approve knowledge;
- approve a draft;
- simulate send;
- delete records;
- change application settings.

# 11. Non-Functional Requirements

### NFR-001 — Type safety

The application shall use TypeScript strict mode.

### NFR-002 — Validation

External inputs and AI outputs shall be schema-validated.

### NFR-003 — Separation of concerns

Business logic shall be separated from UI components and external provider implementations.

### NFR-004 — Graceful failure

Parser, database, and AI failures shall not crash the entire application.

### NFR-005 — Idempotency

Repeated imports and repeated requests shall not create uncontrolled duplicate data.

### NFR-006 — Testability

Core workflows shall be testable without a real mailbox or real AI provider.

### NFR-007 — Small-dataset performance

The MVP should operate normally with at least:

- 1,000 messages;
- 500 threads;
- 500 knowledge entries.

This is a development target, not a production benchmark.

### NFR-008 — Cost control

The system shall support:

- mock-AI mode;
- configurable model;
- request-size limits;
- no AI calls triggered by ordinary page refreshes.

# 12. MVP Acceptance Checklist

The MVP is complete when all mandatory conditions below are met.

## Setup

- [ ] PostgreSQL starts through Docker Compose.
- [ ] The application starts locally.
- [ ] Prisma migrations run successfully.
- [ ] Synthetic seed data can be loaded.
- [ ] Environment setup is documented.

## Import and parsing

- [ ] One or multiple `.eml` files can be imported.
- [ ] English and French characters are preserved.
- [ ] Core headers and body content are stored.
- [ ] Attachment metadata is recorded.
- [ ] Attachment content is ignored.
- [ ] Invalid files return safe errors.
- [ ] Duplicate imports are detected.

## Inbox and threads

- [x] Imported threads appear in the inbox.
- [x] Search and filtering work.
- [x] Thread detail displays all messages.
- [ ] Reply metadata links related messages.
- [ ] Incomplete-thread warnings are visible.

## Classification

- [ ] Gemini can classify synthetic English and French emails.
- [x] Mock classification works without an API key.
- [x] AI output is schema-validated.
- [x] French source content remains unchanged and visible.
- [x] The user can review and correct classifications.
- [x] Original AI and final human results are preserved.

## Knowledge

- [ ] A candidate can be created from a reviewed thread.
- [ ] A candidate can be edited, approved, or rejected.
- [x] Approved knowledge can be searched.
- [x] Inactive knowledge is excluded from retrieval.
- [ ] Source traceability is visible.

## Drafts

- [ ] A grounded draft can be generated from approved knowledge.
- [ ] Knowledge sources are visible.
- [ ] The user can edit and approve the draft.
- [ ] The final approved text is preserved.
- [ ] Simulated send works.
- [ ] No real email is sent.

## Safety and quality

- [ ] No secrets are committed.
- [ ] No real private emails are committed.
- [ ] HTML email content is sanitized.
- [ ] AI cannot approve or send independently.
- [ ] Lint passes.
- [ ] Typecheck passes.
- [ ] Tests pass.
- [ ] Production build passes.

# 13. Recommended Implementation Order

1. Repository and local setup
2. Docker PostgreSQL
3. Prisma foundation
4. EML parser
5. Import and duplicate detection
6. Inbox and thread detail
7. Thread reconstruction
8. AI provider abstraction
9. Mock AI provider
10. Gemini classification
11. Confidence-gated automatic routing and human correction
12. Knowledge candidate workflow
13. Automatic Active Knowledge search
14. Grounded Dorian-style reference generation
15. Human confirmation and simulated sending
16. AI execution history
17. End-to-end tests
18. Public demo polish

# 14. Deferred Decisions

These decisions do not block initial development:

1. exact Gemini model;
2. exact UI component library;
3. exact EML parsing package;
4. exact PostgreSQL full-text ranking;
5. confidence-warning threshold;
6. manual thread merging;
7. storage of full prompts and responses;
8. long-term retention of imported normalized email content;
9. later addition of `pgvector`;
10. later Vercel deployment.
