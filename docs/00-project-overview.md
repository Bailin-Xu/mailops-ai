# MailOps AI — Project Overview

## 1. Project Summary

**MailOps AI** is a human-in-the-loop email operations platform designed to help small organizations manage incoming inquiries more efficiently.

The system imports email messages, analyzes their content, classifies each inquiry, retrieves relevant approved knowledge, generates a grounded response draft, and presents the result for human review. It also supports the identification of technical issues and unknown questions that require manual handling.

The initial version is a provider-agnostic mock system. It does not depend on enterprise Microsoft 365 permissions, Microsoft Graph, Gmail APIs, or any production mailbox. Instead, it accepts `.eml` files and synthetic test messages so that the complete workflow can be developed and evaluated independently.

The project serves two purposes:

1. Provide a realistic prototype for a future production email-assistance system.
2. Demonstrate full-stack, AI integration, data processing, system design, testing, and privacy-aware engineering skills as a public portfolio project.

---

## 2. Background

Small organizations often receive recurring questions through email but do not have a dedicated customer support platform or structured knowledge-management process.

Emails are usually handled manually by one or a few people. Common operational problems include:

- repeated questions receiving repeated manual answers;
- inconsistent response quality;
- technical issues being mixed with general inquiries;
- important questions being overlooked;
- knowledge remaining inside individual email threads;
- difficulty training new staff;
- no reliable record of why an email was classified or answered in a certain way;
- no structured process for reviewing, correcting, and approving AI-generated content.

MailOps AI addresses these problems by combining deterministic software workflows with limited, supervised AI capabilities.

The system is not intended to replace human decision-making. It is designed to reduce repetitive work while keeping a human reviewer responsible for all important actions.

---

## 3. Problem Statement

The current email-handling process in many small organizations is fragmented and highly manual.

A typical workflow may look like this:

1. A customer, artist, partner, or user sends an email.
2. A staff member reads the message.
3. The staff member decides whether it is:
   - a known question;
   - a technical issue;
   - an administrative inquiry;
   - an unknown or ambiguous request.
4. The staff member searches previous emails or relies on memory.
5. A response is written manually.
6. If the issue is technical, it is forwarded informally to a developer.
7. The answer remains inside the email thread and is not converted into reusable organizational knowledge.

This process creates several risks:

- slow response times;
- duplicated work;
- inconsistent answers;
- incorrect routing;
- knowledge loss;
- privacy issues caused by over-sharing mailbox data;
- difficulty measuring system quality;
- inability to safely automate future workflows.

The core problem is therefore not simply “writing email replies.” The broader problem is managing the complete lifecycle of an inquiry:

> intake, parsing, classification, knowledge retrieval, draft generation, human review, correction, approval, and knowledge reuse.

---

## 4. Proposed Solution

MailOps AI introduces a structured workflow around incoming email.

At a high level, the system will:

1. Import one or more `.eml` files.
2. Parse email headers and text content.
3. Store normalized email data in PostgreSQL.
4. Detect duplicate imports.
5. Group related messages into threads when possible.
6. Classify each inquiry using a low-cost AI model.
7. Produce a structured classification result.
8. Search approved knowledge records.
9. Generate a grounded draft response when relevant knowledge exists.
10. Require human review before any message is considered approved.
11. Allow a reviewer to correct the classification.
12. Allow a reviewer to edit, approve, or reject the draft.
13. Extract reusable knowledge candidates from reviewed conversations.
14. Allow a human reviewer to approve or reject knowledge candidates.
15. Record AI executions, user corrections, and workflow decisions for evaluation.

The MVP will simulate email sending instead of sending real messages.

The initial implementation will use Gemini through a provider abstraction. The application architecture must allow other providers to be added later without rewriting the main business logic.

---

## 5. Project Goals

### 5.1 Product Goals

The project should:

- reduce repetitive email-handling work;
- help users identify the type and urgency of an inquiry;
- produce consistent response drafts;
- ensure drafts are grounded in approved knowledge;
- preserve human control over classification and response approval;
- convert useful historical answers into reusable knowledge;
- support English and French email content;
- provide traceability for AI-assisted decisions;
- allow future integration with enterprise email providers.

### 5.2 Engineering Goals

The project should demonstrate:

- clean full-stack application architecture;
- provider abstraction;
- `.eml` parsing and normalization;
- PostgreSQL data modeling;
- AI structured-output integration;
- knowledge-grounded generation;
- human-in-the-loop workflow design;
- privacy-aware data handling;
- Docker-based local infrastructure;
- automated testing;
- maintainable public repository structure;
- future readiness for Microsoft Graph integration.

### 5.3 Portfolio Goals

The public repository should clearly demonstrate that the project is more than a basic chatbot.

It should show experience with:

- Next.js;
- React;
- TypeScript;
- PostgreSQL;
- Docker;
- Prisma;
- API design;
- AI model integration;
- prompt design;
- structured outputs;
- email parsing;
- workflow state management;
- evaluation methodology;
- security and privacy constraints;
- software testing;
- architecture documentation.

---

## 6. Target Users

### 6.1 Primary MVP User

The MVP is designed for a single local reviewer who can:

- import emails;
- review classifications;
- inspect parsed message content;
- generate draft responses;
- edit drafts;
- approve or reject knowledge candidates;
- inspect AI execution details;
- simulate workflow completion.

Authentication is intentionally excluded from the MVP.

### 6.2 Future Users

A future production version may support:

#### Email Reviewer
Reviews incoming messages, classifications, and drafts.

#### Knowledge Reviewer
Approves, edits, versions, and retires knowledge records.

#### Technical Staff Member
Handles technical cases and records resolutions.

#### Administrator
Configures email providers, AI providers, roles, retention policies, and integrations.

#### Read-Only Stakeholder
Views workflow status, analytics, and audit history without making changes.

---

## 7. MVP Scope

The MVP will include the following capabilities.

### 7.1 Email Import

- Upload one or more `.eml` files.
- Parse each file locally on the application server.
- Extract:
  - sender;
  - recipients;
  - CC recipients;
  - subject;
  - sent date;
  - plain-text body;
  - HTML body when available;
  - message ID;
  - in-reply-to value;
  - references;
  - attachment metadata.
- Ignore attachment file contents.
- Reject unsupported or malformed files with clear errors.
- Detect duplicate imports.

### 7.2 Mock Inbox

- Display imported emails in an inbox-style interface.
- Filter by:
  - status;
  - category;
  - language;
  - review state.
- Search by:
  - sender;
  - subject;
  - body keywords.
- Open an email detail page.
- Display parsed metadata and normalized body text.

### 7.3 Thread Reconstruction

- Use `Message-ID`, `In-Reply-To`, and `References` when available.
- Group related messages into an email thread.
- Allow unthreaded messages to remain standalone.
- Display messages chronologically within a thread.
- Clearly indicate when thread reconstruction is incomplete.

### 7.4 AI Classification

- Send normalized email text to the configured AI provider.
- Support English and French input.
- Return structured JSON.
- Classify messages into an initial configurable taxonomy.
- Include:
  - category;
  - confidence;
  - detected language;
  - summary;
  - requires-human-review flag;
  - reasoning summary suitable for audit display.
- Validate AI output before storing it.
- Allow human correction.

### 7.5 Knowledge Candidates

- Generate a candidate knowledge record from selected emails or threads.
- Include:
  - proposed title;
  - canonical question;
  - proposed answer;
  - category;
  - language;
  - source email or thread references;
  - review status.
- Allow human editing.
- Allow approval or rejection.
- Preserve the original candidate and reviewer-modified version.

### 7.6 Approved Knowledge Base

- Store only human-approved knowledge records.
- Search approved knowledge using PostgreSQL keyword and text search.
- Filter by category and language.
- Display source traceability.
- Support active and inactive status.
- Record creation and update timestamps.

### 7.7 Draft Generation

- Generate a response draft using:
  - the incoming email;
  - the detected language;
  - approved knowledge;
  - configurable response instructions.
- Require at least one relevant knowledge source when the system claims the answer is known.
- Display the knowledge sources used.
- Allow human editing.
- Allow approval, rejection, and regeneration.
- Never send automatically in the MVP.

### 7.8 Simulated Sending

- Mark an approved draft as “simulated sent.”
- Record the simulated send time.
- Preserve the final approved text.
- Do not connect to a real email provider.

### 7.9 AI Execution History

- Record:
  - provider;
  - model;
  - task type;
  - prompt version;
  - request timestamp;
  - response timestamp;
  - latency;
  - success or failure;
  - estimated token usage when available;
  - validation errors.
- Avoid logging secrets.
- Avoid logging raw real-email content in production-oriented logs.

### 7.10 Local Development Environment

- Run PostgreSQL in Docker.
- Run the Next.js application locally.
- Use environment variables for configuration.
- Provide seed data using synthetic emails.
- Provide repeatable setup instructions.

---

## 8. Out of Scope for the MVP

The following items are explicitly excluded from the first version:

- Microsoft Graph integration;
- GoDaddy or Microsoft 365 administration;
- Gmail API integration;
- real mailbox synchronization;
- real email sending;
- automatic reply sending;
- Discord integration;
- user authentication;
- role-based access control;
- multi-tenant billing;
- production attachment processing;
- OCR;
- PDF content extraction;
- malware scanning;
- advanced analytics dashboards;
- vector databases;
- fine-tuning a custom model;
- self-hosting a large language model;
- fully autonomous agents;
- mobile application;
- CRM integration;
- SLA automation;
- production deployment of private company email data.

These items may be reconsidered after the MVP workflow is stable and evaluated.

---

## 9. Key Design Principles

### 9.1 Human-in-the-Loop by Default

AI may classify, summarize, retrieve, and draft, but a human must remain responsible for approval.

The MVP must not automatically send email.

### 9.2 Provider-Agnostic Architecture

Email and AI integrations must be hidden behind interfaces.

The business workflow must not depend directly on Gemini, Microsoft Graph, Gmail, or a specific transport mechanism.

### 9.3 Approved Knowledge Only

Historical emails are raw source material, not trusted knowledge.

Only human-approved knowledge records may be used as authoritative response sources.

### 9.4 Structured AI Output

AI responses used by the application must be returned in a validated structured format.

Free-form model output must not directly control workflow state.

### 9.5 Data Minimization

The system should process only the information required for the task.

Attachment content is excluded from the MVP.

Real private emails must not be committed to the public repository.

### 9.6 Clear Separation of Responsibilities

The system should separate:

- email parsing;
- email persistence;
- thread reconstruction;
- AI classification;
- knowledge retrieval;
- draft generation;
- workflow state changes;
- user interface;
- external providers.

### 9.7 Testability

Core business logic must be testable without:

- a real mailbox;
- a real AI provider;
- a deployed environment.

Mock implementations must be available for tests.

### 9.8 Cost Awareness

The first AI provider should be inexpensive or free for development.

The architecture must support future model comparison and replacement.

### 9.9 Bilingual Support

The system must correctly process English and French email content.

The interface may initially be English-only, but detected email language and generated draft language must be handled explicitly.

### 9.10 Public Repository Safety

The repository must remain safe for public viewing.

It must not contain:

- real email messages;
- private company information;
- credentials;
- access tokens;
- production configuration;
- real customer or artist data;
- confidential screenshots;
- employer-specific internal rules without authorization.

---

## 10. Initial Classification Concept

The final taxonomy will be defined in a later document, but the MVP should support an initial set of broad categories.

Possible categories include:

- known question;
- technical issue;
- account or access issue;
- payment or administrative issue;
- partnership or business inquiry;
- unknown question;
- irrelevant or spam;
- requires manual review.

The taxonomy must remain configurable and must not be hard-coded deeply into the application.

---

## 11. High-Level Workflow

```text
EML Upload
    ↓
Parse and Normalize
    ↓
Store Email
    ↓
Detect Duplicate
    ↓
Reconstruct Thread
    ↓
AI Classification
    ↓
Human Review
    ↓
┌───────────────────────────────┐
│ Known question                │
│ → Retrieve approved knowledge │
│ → Generate grounded draft     │
│ → Human approval              │
│ → Simulated send              │
├───────────────────────────────┤
│ Technical or unknown issue    │
│ → Manual handling             │
│ → Optional knowledge candidate│
├───────────────────────────────┤
│ Irrelevant or spam            │
│ → Mark and close              │
└───────────────────────────────┘
```

---

## 12. Success Criteria

The MVP will be considered successful when all of the following are true:

1. A user can upload valid `.eml` files.
2. The system correctly extracts key headers and text bodies.
3. Duplicate imports are detected.
4. Imported emails appear in a usable inbox interface.
5. Related emails can be grouped into threads when metadata is available.
6. The AI provider returns valid structured classifications.
7. English and French messages are handled.
8. A user can correct the classification.
9. A user can generate a knowledge candidate.
10. A user can approve a knowledge entry.
11. Approved knowledge can be searched.
12. A draft can be generated from approved knowledge.
13. The draft identifies which knowledge records were used.
14. A human can edit and approve the draft.
15. The system can mark the draft as simulated sent.
16. Core workflows have automated tests.
17. The project can be started locally using documented steps.
18. The public repository contains no real private email data.
19. The architecture allows Gemini to be replaced by another provider.
20. The architecture allows a future Microsoft Graph email provider to be added without rewriting the core workflow.

---

## 13. Non-Functional Priorities

For the MVP, priorities are ordered as follows:

1. Correctness
2. Privacy
3. Maintainability
4. Testability
5. Usability
6. Cost efficiency
7. Performance
8. Scalability

The MVP is not expected to process large enterprise email volumes.

A simple and reliable design is preferred over premature optimization.

---

## 14. Technology Direction

The initial implementation is expected to use:

- **Frontend and backend:** Next.js with TypeScript
- **UI:** React with a lightweight component system
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Local infrastructure:** Docker Compose
- **Email parsing:** a maintained Node.js `.eml` parsing library
- **AI provider:** Gemini through an abstraction layer
- **Validation:** Zod
- **Testing:** Vitest and Playwright
- **Deployment:** local development first; Vercel-compatible architecture
- **Future background processing:** optional VPS worker if required later

The exact package choices may change after technical evaluation.

---

## 15. Future Enterprise Integration

The mock system is intentionally designed as a stepping stone toward a production deployment.

A future enterprise version may add:

- Microsoft 365 shared mailbox support;
- Microsoft Entra application registration;
- Microsoft Graph email synchronization;
- draft creation inside Exchange;
- sending through a shared mailbox;
- per-mailbox access restrictions;
- webhook or polling-based synchronization;
- role-based access control;
- Discord or ticketing integration;
- audit and retention policies;
- production-grade monitoring;
- secure secret storage;
- background job processing;
- organization-specific knowledge bases.

The future email provider should implement the same core interface used by the mock provider.

---

## 16. Portfolio Positioning

The public project should be presented as a general-purpose engineering system, not as a replica of a specific employer’s private infrastructure.

Recommended public description:

> MailOps AI is a human-in-the-loop email operations platform that imports EML messages, classifies multilingual inquiries, retrieves approved knowledge, generates grounded response drafts, and records review decisions through a structured workflow.

The project should emphasize:

- real-world workflow design;
- safe AI integration;
- bilingual processing;
- provider abstraction;
- data modeling;
- testing;
- privacy boundaries;
- evaluation of low-cost models.

The repository must use synthetic demo data.

---

## 17. Assumptions

The initial project assumes:

- the MVP is operated by a single local user;
- no authentication is required;
- imported `.eml` files are valid enough to parse;
- attachment content is not required;
- the AI provider may occasionally fail;
- classification errors will be corrected manually;
- the approved knowledge base will initially be small;
- PostgreSQL text search is sufficient for the first version;
- real email sending is unnecessary for validating the core workflow;
- enterprise mailbox permissions may not be available during development.

---

## 18. Open Questions

The following questions remain intentionally unresolved and will be addressed in later documents or implementation phases:

1. What is the final classification taxonomy?
2. How should quoted reply text be cleaned?
3. How should signatures and disclaimers be removed?
4. How should incomplete threads be displayed?
5. What confidence threshold should trigger mandatory manual review?
6. How should bilingual knowledge records be linked?
7. Should knowledge answers be stored separately by language?
8. What minimum quality score is required before draft generation?
9. How should knowledge relevance be ranked?
10. When should PostgreSQL full-text search be extended with `pgvector`?
11. How should real private `.eml` files be processed safely outside the public demo?
12. Which Gemini model is most suitable for the free development tier?
13. What token and cost limits should be enforced?
14. Which workflow states are required for the first release?
15. When should background jobs move from request-based execution to a worker?
16. What data-retention policy should apply to imported emails?
17. What level of company-specific customization should remain outside the public repository?

---

## 19. Project Status

Current phase:

> Requirements and architecture definition

No production integration has been implemented.

The next documents will define:

1. detailed MVP functional requirements;
2. user workflows and state transitions;
3. domain entities and relationships;
4. AI classification and knowledge-base behavior;
5. technical architecture and implementation roadmap.
