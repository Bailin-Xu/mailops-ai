# MailOps AI — User Workflows

## 1. Purpose

This document defines the main user workflows for the MailOps AI MVP. It focuses on user actions, system responses, state transitions, and important failure paths.

## 2. Main Workflow

```text
EML Import
→ Parse
→ Store
→ Classify
→ Human Review
→ Search Approved Knowledge
→ Generate Draft
→ Human Approval
→ Simulated Send
```

A second workflow converts reviewed conversations into trusted knowledge:

```text
Reviewed Email or Thread
→ Create Knowledge Candidate
→ Human Edit
→ Approve or Reject
→ Approved Knowledge Base
```

A public-website workflow resolves contradictory claims before candidate
creation:

```text
Allowlisted Website Evidence
→ Detect or Record Policy Question
→ Ask Company Owner
→ Preserve Confirmed Answer
→ Create Knowledge Candidate
→ Human Knowledge Approval
```

## 3. Import Email

### Goal

Import one or more `.eml` files into the local inbox.

### Main Flow

1. The user selects one or more `.eml` files.
2. The system validates file type and size.
3. The system parses each file.
4. The system extracts headers, body text, and attachment metadata.
5. The system checks for duplicates.
6. The system stores valid messages.
7. The system creates or updates email threads.
8. The system displays per-file results.
9. Imported threads appear in the Inbox.

### Possible Results

- `IMPORTED`
- `DUPLICATE`
- `FAILED`

### Failure Handling

- Invalid or oversized files are rejected.
- One failed file does not block the rest of the batch.
- Duplicate messages do not create new records.
- Parser failures do not crash the application.

## 4. Review Imported Thread

### Goal

Inspect the message before AI classification.

### Main Flow

1. The user opens the Inbox.
2. The user selects a thread.
3. The system displays all known messages in chronological order.
4. The system shows the sender, recipients, subject, date, body, attachment metadata, and thread warnings.
5. The user may inspect technical metadata.
6. The user starts AI classification.

The user may leave the thread unclassified and return later.

## 5. AI Classification

### Goal

Classify and route an inquiry without blocking normal high-confidence work.

### Main Flow

1. Email ingestion triggers automatic processing, or the user selects **Run automatic processing** for an imported thread.
2. The system prepares the minimum required email context.
3. The system calls the configured AI provider.
4. The AI returns structured output.
5. The system validates the output.
6. The system stores the category, confidence, language, and execution metadata.
7. For French input, the system preserves and displays the original French content.
8. Confidence below `0.70` or an explicit `MANUAL_REVIEW` category enters `PENDING_REVIEW`.
9. Other validated classifications enter `AUTO_ROUTED` and continue immediately.
10. Technical issues enter the technical queue. High-confidence ordinary questions search Active Knowledge even when the classifier labels them unknown; unsupported questions fall back to the human-answer queue.

### Failure Handling

- Provider failure or timeout → show a retry action.
- Invalid structured output → reject the result.
- Missing Gemini configuration → suggest mock mode or configuration.
- Previous valid results are not overwritten by failed retries.

## 6. Human Classification Review and Correction

### Goal

Resolve a blocked low-confidence result or correct an automatically routed result.

### Main Flow

1. The user reviews the original email and AI result.
2. The user may:
   - accept the category;
   - change the category;
   - edit the summary;
   - add a correction note.
3. The system stores the final reviewed result.
4. The original AI result remains available.
5. Routing resumes from the corrected category.

**Rule:** high-confidence classification may drive routing, but it is never a sending decision. A human can correct it, and all real or simulated reply sending remains human-confirmed.

Before simulated sending, the reviewer may edit the generated subject, reply
body, and target language. The generated AI text remains unchanged; the edited
final text is stored separately with its approval and simulated-send timestamps.

## 7. Search Approved Knowledge

### Goal

Find approved knowledge relevant to the reviewed inquiry.

### Main Flow

1. For a high-confidence `KNOWN_QUESTION` or `UNKNOWN_QUESTION`, the system builds a compact query from question-like text in the latest inbound message and searches active knowledge. Classification describes intent and risk; it does not claim that the model knows whether an approved answer exists.
2. Results are ranked by keyword relevance, category, and language.
3. A deterministic relevance gate requires at least two meaningful query terms in the canonical question itself. Answer text may improve ranking but cannot make a weak question match eligible; title-only or otherwise broad hits are not sufficient grounding.
4. The first MVP draft uses only the strongest qualifying entry and displays that retrieval evidence; additional matches are not concatenated into the reply.

### No-Result Flow

When no relevant knowledge exists:

1. The system warns the user.
2. The system does not claim that the question is known.
3. The user may handle the message manually or create a knowledge candidate.
4. Grounded draft generation is blocked or marked unsupported.

## 8. Create Knowledge Candidate

### Goal

Convert useful information from a reviewed conversation into reusable knowledge.

For imported historical sources, the reviewer first records one of these source
decisions without changing the deterministic prescreen result:

- `APPROVED`: the source may proceed to candidate creation;
- `NEEDS_FOLLOW_UP`: a person must resolve an uncertainty first;
- `REJECTED`: the source must not proceed.

Each saved decision records its timestamp and an optional note. Changing a
decision creates another review event so the review history remains traceable.
Source approval does not create approved knowledge.

### Main Flow

1. The user selects **Create Knowledge Candidate**.
2. The system initializes or generates:
   - title;
   - canonical question;
   - proposed answer;
   - category;
   - language;
   - source references.
3. The user edits the candidate.
4. The user submits it for review.
5. The candidate enters `PENDING_REVIEW`.

The user may create the candidate manually without AI.

## 9. Review Knowledge Candidate

### Approval Flow

1. The user reviews the question, answer, category, language, and source.
2. The user edits the content if necessary.
3. The user approves the candidate.
4. The system creates an active knowledge entry.
5. The candidate enters `APPROVED`.

### Rejection Flow

1. The user rejects the candidate.
2. The user may record a reason.
3. The candidate enters `REJECTED`.
4. No trusted knowledge entry is created.

**Rule:** Only human-approved content may become authoritative knowledge.

## 9.1 Resolve Website Policy Evidence

### Goal

Resolve contradictory or time-sensitive public website claims without treating
the website as automatically authoritative.

### Main Flow

1. The reviewer selects a policy question.
2. The system displays every captured public evidence excerpt and source URL.
3. The reviewer copies the prepared French question and asks the company owner.
4. The reviewer pastes the confirmed answer without overwriting source evidence.
5. The reviewer selects `CONFIRMED`, `NEEDS_FOLLOW_UP`, or `REJECTED`.
6. The system stores the current state and an immutable review event.
7. A confirmed item may later be used to create a knowledge candidate.

**Rule:** A confirmed website policy is resolved source material, not active
knowledge. It still requires the knowledge-candidate approval workflow.

## 10. Generate Reply Draft

### Preconditions

- Classification is high confidence or human-corrected.
- At least one relevant active knowledge entry was retrieved.
- Target response language is known.

### Main Flow

1. The orchestration service selects the single strongest retrieved active knowledge source that passes the relevance gate.
2. The system sends only the required context to the configured AI provider.
4. The AI returns a structured subject, body, language, and source IDs.
5. The system validates and stores the result.
6. The Dorian-style reference draft enters `GENERATED` and waits for a human.

### Failure Handling

- No knowledge selected → block known-question draft generation.
- Invalid AI output → mark generation failed.
- Provider error → allow retry.
- Unsupported claims → user edits or rejects the draft.

## 11. Review and Edit Draft

### Main Flow

1. The user reviews the email, selected knowledge, draft subject, draft body, and language.
2. The user may edit the subject or body.
3. The user chooses to approve, reject, or regenerate.
4. The system preserves the exact final approved text.
5. An approved draft enters `APPROVED`.

**Rule:** AI cannot approve its own draft.

## 12. Simulated Send

### Preconditions

The draft is approved.

### Main Flow

1. The user selects **Simulate Send**.
2. The system records the final draft, related thread, knowledge sources, and timestamp.
3. The draft enters `SIMULATED_SENT`.
4. The UI states clearly that no real email was delivered.

The MVP must not connect to SMTP, Gmail, or Microsoft Graph.

## 13. Retry Failed AI Operation

1. The user opens a failed AI operation.
2. The system displays a safe error category.
3. The user selects **Retry**.
4. The system creates a new AI execution.
5. The previous execution remains in history.
6. The new result is validated independently.

## 14. Inspect AI Execution History

The AI Executions page shall display:

- task type;
- provider;
- model;
- status;
- latency;
- validation result;
- related thread or draft;
- timestamp.

Secrets must never be displayed.

## 15. Key State Transitions

### Thread

```text
IMPORTED
→ READY_FOR_CLASSIFICATION
→ AUTO_ROUTED
→ DRAFT_READY
→ SIMULATED_SENT
```

Human-gated branches:

```text
PENDING_REVIEW → CORRECTED → AUTO_ROUTED
AUTO_ROUTED → TECHNICAL_QUEUED → SIMULATED_FORWARDED
AUTO_ROUTED → AWAITING_HUMAN_ANSWER → SIMULATED_SENT
```

Possible failures:

```text
PARSE_FAILED
CLASSIFICATION_FAILED
DRAFT_GENERATION_FAILED
```

### Knowledge Candidate

```text
DRAFT
→ PENDING_REVIEW
→ APPROVED
```

or:

```text
DRAFT
→ PENDING_REVIEW
→ REJECTED
```

### Knowledge Entry

```text
ACTIVE
→ INACTIVE
→ ARCHIVED
```

### Draft

```text
GENERATED
→ EDITED
→ APPROVED
→ SIMULATED_SENT
```

Alternative paths:

```text
GENERATED → REJECTED
GENERATION_FAILED → GENERATED
```

## 16. Workflow Rules

1. Low-confidence and explicitly manual classifications require human review; ordinary high-confidence classifications continue automatically and remain correctable.
2. Only approved knowledge may support a grounded draft.
3. AI output must be schema-validated.
4. Original email content must remain unchanged.
5. Original AI output must remain available after correction.
6. French source content must remain unchanged and visible during review.
7. AI cannot approve knowledge, approve a draft, or confirm sending; automatic classification is a routing input, not a human approval.
8. The MVP never sends real email.
9. Failed operations must remain recoverable.
10. Important state changes must be recorded.

## 17. Deferred Workflows

The MVP excludes:

- real mailbox synchronization;
- scheduled polling;
- webhook ingestion;
- Microsoft Graph draft creation;
- real email sending;
- Discord routing;
- authentication;
- multi-user assignment;
- attachment-content analysis;
- production retention workflows.
