# MailOps AI — Phase 1 State Consistency and Verification

Completed: **2026-10-27**. Scope: P1-T1 through P1-T5 in the
[implementation plan](09-code-inventory-and-career-implementation-plan.md).

## 1. Workflow Rules

Classification confidence/category policy, single-source grounding, and human
confirmation before simulated sending remain unchanged. Phase 1 retains the
existing draft states: GENERATED, SUPERSEDED, and SIMULATED_SENT. Independently
saved edits and separate approval/rejection UI remain Phase 4 work under FR-076.

| Action | Preconditions | Committed result |
| --- | --- | --- |
| New classification | Inbound context and previous classification revision still match the context captured before the provider call | Advance thread workflow revision, create the classification, and supersede older GENERATED drafts atomically |
| Classification correction | Displayed revision matches; current classification/context is valid; no prior human correction or finalized response | Keep original AI output, save the human result, advance classification revision, clear the previous route, and supersede its generated drafts |
| Route without drafting | Current classification/context/revision is still eligible | Advance revision, update route and thread status together, and supersede obsolete generated drafts |
| Generate or regenerate | Current nonterminal classification and qualifying ACTIVE knowledge | Call provider outside the transaction; validate output; recheck context, revision, and source fingerprint; create replacement and supersede previous drafts in one transaction |
| Confirm simulated send | GENERATED draft belongs to the current classification revision; inbound context matches; processing is DRAFT_READY; all bound sources remain ACTIVE and unchanged | Save exact final subject/body/language and simulation time; advance revision and update thread/classification together |
| Submit human answer | Displayed revision matches and the current classification is waiting for a human answer | Save one final simulated reply and optional pending candidate atomically, then advance revision |
| Simulate technical forwarding | Current context is TECHNICAL_QUEUED | Mark forwarded and advance revision with the thread update; duplicate forwarding is rejected |
| Review candidate/source/website policy | Displayed revision matches the stored record | Advance the applicable revision and save decision, related knowledge changes, and event in one transaction |

SIMULATED_SENT and SIMULATED_FORWARDED cannot be reopened for the same inbound
context. A genuinely changed inbound context can start a new classification while
retaining confirmed history. NO_ACTION blocks automatic reruns on the same input,
but an automatically classified spam result remains explicitly human-correctable.

## 2. Validity Tokens and Concurrency

The additive migration
`20261027183000_add_workflow_consistency` introduces:

| Model | New fields | Purpose |
| --- | --- | --- |
| EmailThread | workflowRevision | Identifies the current classification generation without relying on timestamp ordering |
| Classification | threadRevision, revision, sourceContextHash | Binds classification to the thread generation/input; rejects stale reviews and processing results |
| Draft | classificationRevision | Binds a generated reply to the classification revision that produced it |
| DraftKnowledgeSource | knowledgeFingerprint | Detects changed or retired sources before committing or confirming a reply |
| KnowledgeCandidate | revision | Protects review, split, and bulk approval from competing writes |
| EmailMessage | knowledgeReviewRevision | Protects historical-source review decisions |
| WebsiteKnowledgeReviewItem | revision | Protects policy review decisions |

The input fingerprint covers the thread identity/subject and the ordered inbound
message identities, dates, and effective cleaned text. Adding an inbound message,
including an out-of-order arrival, changes that context. The source fingerprint
covers source identity, factual fields, status, and update time. Model input uses
the same trimmed effective body used for context validation.

Mutation services use short serializable transactions and revision-conditional
writes. Model calls run outside database transactions. A competing update or
serialization conflict returns a recoverable refresh/review message; the service
does not automatically repeat a model request or silently replay a human decision.
Lists select current classifications by thread revision before timestamps.

Review forms submit the revision of their rendered record. Candidate/source/policy
forms remount with refreshed revisions after a successful save; rejected submissions
do not revalidate those pages and retain the entered text for the user to reconcile.
This is conflict feedback, not the richer comparison/merge interface planned for
Phase 4.

Existing candidate/body/direction/prescreen maintenance writes now advance the
corresponding review token and check the token captured during their scan. Website
sample refresh updates each item and its evidence transactionally while advancing
its revision, so older review forms are invalidated. These maintenance commands
were type/build checked, not executed against private imported mail during this task.

## 3. Failure and Replacement Semantics

- A failed or invalid classification attempt records a failed execution without
  replacing the previous classification or superseding its reply.
- A failed regeneration on the same classification preserves the previous draft
  content/status. If that draft still has valid grounding, processing remains
  DRAFT_READY and the route explanation identifies the failed replacement.
- If there is no valid prior reply, failure sets processing to FAILED and the
  thread to AUTOMATIC_PROCESSING_FAILED. Preserved content is not shown as an
  approved reply or offered for confirmation until processing becomes ready.
- A successful new classification or human correction invalidates older drafts
  immediately because their decision context changed. Preservation of content
  does not imply that an obsolete draft remains eligible to send.
- Two concurrent replacements may invoke the provider, but only one result can
  activate against a particular classification revision. The losing output is
  recorded as a failed execution with STALE_CONTEXT; it cannot replace the winner.
- Late provider failures cannot overwrite newer corrections, successful replies,
  or confirmations. Output-schema and source-membership failures retain validation
  metadata; raw provider errors are not exposed.
- Human answer/candidate creation is atomic. An error creating the candidate rolls
  back the reply and status updates as well.
- The import wrapper marks a failure only while its new thread is still NEW at
  workflow revision zero, so its late catch handler cannot overwrite newer work.

## 4. Historical Data and Migration Boundaries

The migration adds nullable provenance markers and zero-initialized counters; it
does not invent evidence for historical classifications or drafts. Existing email
bodies, knowledge content, approved text, and simulation timestamps are retained.

Old pending classifications without a verified context must be reclassified using
an explicit **Run a new AI attempt**. Older generated drafts without a classification
revision/source fingerprint cannot be confirmed. Confirmed history remains readable.
No existing private email was reclassified and no live model request was made as
part of migration or verification.

The migration was applied both to the isolated test database and to the local
development database (`mailops` on loopback port 5433), after validating that local
target. For another checkout/database:

```bash
npm run db:generate
npm run db:deploy
```

Do not edit earlier migrations or backfill hashes from today's mutable knowledge
as if they were historical snapshots. An application-code rollback can leave these
additive columns in place; removing metadata requires a separate migration and
data-impact review.

Knowledge fingerprints are validity markers, **not immutable source snapshots**.
Reconstructing the exact historical approved evidence and surfacing all affected
drafts remains Phase 2. The standalone dispatch/ticket foundations were not expanded
or connected to real delivery.

## 5. Verification Evidence

| Criterion | Tests/evidence |
| --- | --- |
| P1-A1 | Processing consistency tests reject old classifications/drafts, changed message content, new inbound messages, retired/changed knowledge, and missing legacy context; rejected confirmation preserves prior data |
| P1-A2 | Provider, output-schema, and citation-membership failure cases preserve the previous valid reply; failed first drafting can retry without repeating classification; late failure cannot overwrite newer success |
| P1-A3 | Paused-provider tests release competing results against the same revision and assert a single winner; concurrent manual submissions create only one reply/candidate |
| P1-A4 | Review consistency tests cover old tabs, simultaneous candidate decisions, split-versus-approval, bulk-versus-individual approval, and source/policy revision conflicts; only winning review events persist |
| P1-A5 | Concurrent final text confirmation has one winner; exact approved subject/body/language is retained; technical forwarding and terminal reruns are protected; candidate-creation failure rolls back the manual reply; a genuinely new input preserves confirmed history |

Commands actually run:

- `npm run db:generate`: passed.
- `npm run db:validate`: passed.
- `npm run check`: passed lint, type checking, **27 offline files / 112 tests**,
  and production build. Run with Mock AI, empty Gemini key/model, delivery disabled,
  and an unreachable placeholder application database URL.
- `npm run test:integration`: **14 files / 61 tests passed**, using an explicit
  TEST_DATABASE_URL and all 19 migrations; the separate database sentinel remained
  unchanged. Tests include deterministic paused-provider concurrency rather than
  timing-based sleeps.
- Existing local database migration: only the new migration was pending and was
  successfully applied. No historical content was backfilled or reprocessed.
- Final diff/whitespace and documentation links were reviewed.

The main regression suites are
[processing consistency](../lib/processing/consistency.integration.test.ts) and
[review consistency](../lib/knowledge/review-consistency.integration.test.ts).
Existing review tests now supply the revision they actually read. Offline
classification schema tests reject missing, empty, negative, or fractional tokens.

No Playwright setup exists yet, so browser end-to-end tests were not run; the form
changes were type/build checked and their server behavior is covered by integration
tests. Browser automation remains Phase 4. No GitHub-hosted CI or live Gemini
evaluation was run. No Git commit or push was made for this phase.

**Next planned phase: Phase 2 — Knowledge Versions and Draft Evidence.**
