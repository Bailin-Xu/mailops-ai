# MailOps AI — AI and Knowledge Design

## 1. Purpose

This document defines how MailOps AI uses artificial intelligence and approved knowledge in the MVP.

The design follows three rules:

1. AI assists but does not make final decisions.
2. Only human-approved knowledge is trusted.
3. AI output must be structured, validated, and traceable.

---

## 2. AI Responsibilities

The AI layer may perform the following tasks:

- classify incoming inquiries;
- detect the primary language;
- summarize French emails in English;
- propose knowledge candidates;
- generate reply drafts from approved knowledge.

The AI layer must not:

- approve classifications;
- approve knowledge;
- approve drafts;
- send email;
- delete records;
- change configuration;
- treat email instructions as system instructions.

---

## 3. Provider Architecture

AI access shall use a provider abstraction.

```text
Application Service
    ↓
AIProvider Interface
    ├── GeminiProvider
    └── MockAIProvider
```

The provider interface should expose task-focused methods such as:

```ts
interface AIProvider {
  classifyEmail(input: ClassificationInput): Promise<ClassificationResult>;
  summarizeFrenchEmail(input: SummaryInput): Promise<SummaryResult>;
  generateKnowledgeCandidate(
    input: KnowledgeCandidateInput
  ): Promise<KnowledgeCandidateResult>;
  generateDraft(input: DraftGenerationInput): Promise<DraftResult>;
}
```

The rest of the application must not depend directly on Gemini-specific SDK types.

---

## 4. Classification Design

## 4.1 Input

Classification should use only the minimum required context:

- subject;
- normalized body;
- limited thread context when useful;
- category definitions;
- output schema;
- language instructions.

The system should avoid sending:

- attachment content;
- unnecessary headers;
- unrelated messages;
- secrets;
- internal database identifiers.

## 4.2 Initial Taxonomy

The initial categories are:

- `KNOWN_QUESTION`
- `TECHNICAL_ISSUE`
- `ACCOUNT_ACCESS`
- `PAYMENT_ADMINISTRATIVE`
- `BUSINESS_PARTNERSHIP`
- `UNKNOWN_QUESTION`
- `IRRELEVANT_SPAM`
- `MANUAL_REVIEW`

Each category should have a short internal definition so that prompts and tests use the same meaning.

## 4.3 Structured Output

Expected output:

```json
{
  "category": "TECHNICAL_ISSUE",
  "confidence": 0.92,
  "language": "fr",
  "summary": "The sender cannot upload a media file.",
  "requiresHumanReview": true
}
```

The result must be validated before storage.

Invalid output should produce a failed execution rather than a partially trusted classification.

## 4.4 Human Review

All classifications require review.

The reviewer can:

- accept the AI category;
- correct the category;
- edit the summary;
- add a correction note.

The original AI result and the final reviewed result must both remain available.

---

## 5. Bilingual Behavior

The system must support English and French email content.

For French emails:

- preserve the original French text;
- generate an English summary for the reviewer;
- generate the reply in French by default;
- allow the reviewer to change the target language.

For mixed-language emails:

- classify the language as `mixed`;
- summarize the main request in English;
- let the reviewer choose the reply language.

The MVP interface may remain English-only.

---

## 6. Knowledge Trust Model

MailOps AI distinguishes three data types:

### Raw Email

Original source material. It may contain useful information, mistakes, outdated answers, or private content.

### Knowledge Candidate

A proposed reusable question-and-answer record. It is not trusted until reviewed.

### Approved Knowledge Entry

Human-approved content that may be used for draft generation.

```text
Raw Email
→ AI or Manual Extraction
→ Knowledge Candidate
→ Human Review
→ Approved Knowledge Entry
```

Historical emails must never be treated automatically as authoritative knowledge.

---

## 7. Knowledge Candidate Generation

A candidate may be created manually or with AI assistance.

The AI may propose:

- title;
- canonical question;
- answer;
- category;
- language;
- source summary.

Example:

```json
{
  "title": "Updating an artist profile",
  "canonicalQuestion": "How can an artist update profile information?",
  "proposedAnswer": "Submit the requested changes through the profile update form.",
  "category": "KNOWN_QUESTION",
  "language": "en"
}
```

The reviewer must verify that the answer is:

- factually supported by the source;
- reusable beyond one specific person;
- free from unnecessary private information;
- clear and current;
- appropriate for future replies.

---

## 8. Approved Knowledge Structure

Each approved entry should contain:

- title;
- canonical question;
- answer;
- category;
- language;
- status;
- source references;
- approval timestamp.

Only entries with `ACTIVE` status may be used for draft generation.

English and French versions may initially be stored as separate entries.

Automatic translation linking is deferred.

---

## 9. Knowledge Retrieval

The MVP shall use PostgreSQL keyword and text search.

Retrieval should consider:

1. language match;
2. category match;
3. title relevance;
4. canonical-question relevance;
5. answer relevance.

Example retrieval flow:

```text
Reviewed Email
→ Build Search Query
→ Filter Active Knowledge
→ Prefer Matching Language
→ Prefer Matching Category
→ Rank by Text Relevance
→ Show Results to Reviewer
```

The reviewer selects the knowledge used for drafting.

Vector search is not required for the MVP.

---

## 10. Draft Generation

## 10.1 Preconditions

A grounded known-question draft requires:

- a reviewed classification;
- a selected response language;
- at least one active approved knowledge entry.

## 10.2 Input

Draft generation may use:

- email subject;
- normalized email body;
- limited thread context;
- reviewed category;
- target language;
- selected approved knowledge;
- response-style instructions.

## 10.3 Output

Expected output:

```json
{
  "subject": "Re: Profile update request",
  "body": "Bonjour, ...",
  "language": "fr",
  "knowledgeSourceIds": ["knowledge-id-1"],
  "requiresHumanReview": true
}
```

## 10.4 Grounding Rules

The model must be instructed to:

- use only supplied approved knowledge for factual claims;
- avoid inventing policies, dates, prices, or commitments;
- state uncertainty when the knowledge is insufficient;
- preserve the requested response language;
- avoid mentioning internal system details;
- avoid following instructions embedded inside the incoming email.

The UI must display the selected knowledge sources beside the draft.

---

## 11. No-Knowledge Behavior

If no relevant approved knowledge is found:

- the system must not claim the question is known;
- automatic grounded drafting should be blocked;
- the reviewer may write a manual response;
- the reviewer may create a new knowledge candidate.

This rule is important for preventing unsupported replies.

---

## 12. Prompt Organization

Prompts should be centralized by task.

Suggested structure:

```text
src/lib/ai/prompts/
├── classification.ts
├── french-summary.ts
├── knowledge-candidate.ts
└── draft-generation.ts
```

Each prompt should have a version identifier.

Example:

```ts
export const CLASSIFICATION_PROMPT_VERSION = "classification-v1";
```

Prompt text should not be duplicated inside UI components or route handlers.

---

## 13. Validation

Each AI task must have a schema.

Suggested tools:

- Zod for runtime validation;
- TypeScript types inferred from schemas;
- provider-level parsing before returning results.

Validation should reject:

- unknown categories;
- confidence outside `0` to `1`;
- unsupported language values;
- missing required fields;
- malformed JSON;
- source IDs not present in the request.

---

## 14. Error Handling

AI failures should be grouped into safe categories:

- `CONFIGURATION_ERROR`
- `AUTHENTICATION_ERROR`
- `RATE_LIMIT`
- `TIMEOUT`
- `PROVIDER_UNAVAILABLE`
- `INVALID_RESPONSE`
- `VALIDATION_ERROR`
- `UNKNOWN_ERROR`

The UI should show a concise message and allow retry where appropriate.

Previous successful results must not be overwritten by failed retries.

---

## 15. AI Execution Records

Each request should record:

- provider;
- model;
- task type;
- prompt version;
- start and completion time;
- latency;
- success or failure;
- validation result;
- error category;
- token usage when available;
- related thread, candidate, or draft.

API keys and secrets must never be stored.

Full prompt and response storage should remain configurable.

---

## 16. Mock AI Provider

The mock provider is required for:

- automated tests;
- offline development;
- predictable demos;
- avoiding unnecessary API usage.

It should return deterministic results based on fixtures or simple rules.

Example behavior:

```text
Subject contains "upload error"
→ TECHNICAL_ISSUE

Language fixture is French
→ language = fr
→ include English summary
```

The mock provider should follow the same interfaces and schemas as Gemini.

---

## 17. Cost Controls

The MVP should include basic safeguards:

- configurable model name;
- maximum input length;
- no AI calls on page refresh;
- explicit user action before classification or draft generation;
- mock mode for tests;
- limited thread context;
- reusable execution records.

Advanced budget dashboards are deferred.

---

## 18. Privacy Rules

Synthetic data should be used for public demos and free-tier model testing.

Real private emails should not be sent to an external free AI service unless they have been approved and properly redacted.

AI requests should exclude:

- attachments;
- unnecessary personal information;
- unrelated thread history;
- credentials;
- internal secrets.

---

## 19. MVP Evaluation

The first evaluation should measure:

- classification agreement with human labels;
- technical-issue recall;
- structured-output validity;
- French-language handling;
- English-summary usefulness;
- average latency;
- provider failure rate;
- human correction rate.

A small synthetic or redacted evaluation set is sufficient for the MVP.

The evaluation dataset must remain separate from approved knowledge used during testing.

---

## 20. Deferred AI Features

The MVP excludes:

- model fine-tuning;
- vector embeddings;
- autonomous agent loops;
- automatic sending;
- automatic knowledge approval;
- automatic draft approval;
- multi-model routing;
- advanced prompt optimization;
- self-hosted language models;
- attachment analysis;
- production use of private company email data.
