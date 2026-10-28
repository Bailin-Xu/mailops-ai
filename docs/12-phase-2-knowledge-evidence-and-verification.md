# MailOps AI — Phase 2 Knowledge Versions and Draft Evidence

Completed: **2026-10-27**. Scope: P2-T1 through P2-T5 in the
[implementation plan](09-code-inventory-and-career-implementation-plan.md).

## 1. Knowledge Publication and Lifecycle

KnowledgeEntry remains the mutable current projection for existing PostgreSQL
full-text search. Its `currentRevisionId` points to the current immutable
KnowledgeRevision; `revisionSequence` supplies the next version number. Revision
records contain the exact title, canonical question, answer, category, language,
reported approval time, recording time, origin, and optional approval-event link.

| Operation | Result |
| --- | --- |
| Individual or bulk approval | Validate factual fields, record the human decision, append a HUMAN_APPROVAL revision, update the current projection/pointer, and flag affected pending drafts in one serializable transaction |
| Reapproval with identical content | Append another approval version; previous pending drafts still require regeneration |
| Candidate rejection | Preserve all approved revisions, set the current entry INACTIVE, and flag its pending drafts |
| Explicit retirement/archive | Require the displayed current revision ID and ACTIVE status; change lifecycle state, invalidate older candidate editors, flag pending drafts, and record an audit event |
| Synthetic demo seed | Preserve later edits; initialize a missing revision with SYNTHETIC_FIXTURE origin without invoking AI |
| Legacy baseline capture | Snapshot currently stored knowledge with LEGACY_BASELINE origin; never claim that it was the content used by an earlier draft |

INACTIVE and ARCHIVED entries remain excluded from retrieval. Factual revisions do
not acquire a mutable lifecycle status; the current entry owns eligibility. A
retired entry retains its last approved revision and can only be reactivated by a
fresh explicit approval. Retirement also advances the candidate review token, so
a candidate editor opened before retirement cannot silently reactivate it.

Database triggers reject revision updates and standalone deletion, and enforce
that a current pointer belongs to its own entry. Parent-entry cascade deletion is
permitted for isolated fixture cleanup, while draft-source foreign keys protect
referenced entries/revisions. The application provides no hard-delete workflow.

## 2. Captured Draft Evidence

New grounded drafts have `evidenceStatus=CAPTURED`, immutable `inputSnapshot` JSON,
and source links bound to immutable revision IDs. The snapshot is validated by
`draftInputSnapshotSchema` before storage and includes:

- schema version, thread/classification IDs, starting classification revision,
  selected inbound message ID, and source-context fingerprint;
- the exact subject, trimmed effective body, and requested language supplied to
  generation;
- factual revision references under `factualGrounding.revisionIds`;
- a separate `style.profile`, which is not factual grounding.

The model receives the factual title/answer from the captured revision. Its returned
source IDs still identify the supplied knowledge entries; the application, rather
than the model, binds the actual revision. Provider/model/prompt and usage metadata
remain linked through AIExecution. Input evidence stores email text in the database
but is never written to console logs or sent to another service by this feature.

The current provider still receives only the selected inbound body and one
approved source. Other inbound messages contribute to the context-validity hash;
they are not falsely represented as full conversation input to the model.

After the provider returns, the service rechecks the classification/context,
current revision pointer, source fingerprint, and factual content before committing.
A concurrent revision or retirement discards the result as STALE_CONTEXT, preserving
the previously stored reply and its original evidence. Snapshot and source-binding
updates are rejected by database triggers; regeneration creates a new draft instead.

New human-authored replies use HUMAN_AUTHORED evidence with captured input context
and an empty factual-grounding list. They are not represented as AI-grounded answers.

## 3. Impact Detection and Confirmation

Publication/retirement marks referencing GENERATED drafts with
`knowledgeReviewRequiredAt` and `knowledgeReviewReason`:

- KNOWLEDGE_REVISED: the referenced version is no longer current;
- KNOWLEDGE_RETIRED: its current entry is inactive or archived;
- LEGACY_EVIDENCE_UNVERIFIED: assigned by migration to older pending drafts.

This does not replace draft status or rewrite its content. SIMULATED_SENT history
is not flagged or updated. SUPERSEDED drafts remain available as historical records
but are excluded from the pending-impact query.

**Resolution policy:** regenerate from eligible current knowledge, then have a
human review the new reply. There is no action to clear the flag and confirm the
old factual version. If no eligible source remains, the existing human-answer
fallback applies. Independently of the flag/UI, confirmation verifies captured
input, classification revision, source revision ownership/currentness, factual
content, and source fingerprint.

The Inbox displays immutable historical source text/version instead of reading
today's projection as old evidence. A flagged draft is read-only with a regeneration
message. A legacy source link explicitly says that historical text was not captured.
The richer revision comparison/impact dashboard remains Phase 4 work.

## 4. Service Interfaces for Later Phases

| Interface | Contract |
| --- | --- |
| `captureApprovedKnowledge(entryId, db)` | Capture a consistent active entry/revision pair; initialize a missing legacy baseline if needed; reject pointer/projection mismatches |
| `retireKnowledge(input, db)` | Input: knowledgeEntryId, expectedRevisionId, INACTIVE/ARCHIVED status, optional note. Returns updated entry and affected draft count |
| `getKnowledgeHistory(entryId, db)` | Current projection/pointer plus versions ordered newest first and their approval events |
| `getDraftEvidence(draftId, db)` | Evidence status, parsed snapshot, immutable sources, execution/classification/thread references, impact markers, and provenance completeness |
| `getAffectedDrafts(input, db)` | Optional knowledgeEntryId filter, limit 1–100 (default 25), optional UUID cursor; returns pending items and nextCursor |

Publication/retirement services live in `lib/knowledge/revisions.ts`; history and
impact queries live in `lib/knowledge/history.ts`; snapshot validation lives in
`lib/processing/evidence.ts`. These are local application services, not newly exposed
unauthenticated HTTP integration endpoints.

`provenanceComplete` means the recorded input and source references are complete.
It does not mean the historical facts remain current or the reply is eligible to
send: a draft can have complete A evidence and still require regeneration after B.

## 5. Migration, Legacy Records, and Recovery

Migration: `20261027190000_add_knowledge_revisions_and_evidence`.

1. Add the revision model/current pointer and snapshot/impact fields.
2. Copy each current KnowledgeEntry to version 1 with LEGACY_BASELINE origin and
   a recording time at migration, retaining the entry's reported approval time.
3. Leave **all existing** draft snapshots/revision links unassigned and mark them
   LEGACY_UNVERIFIED. Existing source-entry links and Phase 1 fingerprints remain.
4. Mark old GENERATED drafts for review. Preserve confirmed reply text, metadata,
   timestamps, and existing thread/classification/source relationships.
5. Install immutability/ownership guards for subsequent writes.

The migration does not reconstruct old generation inputs, attach today's facts to
old drafts, or reprocess private email. A Phase 1 classification with valid context
can regenerate a fresh evidenced draft. An older classification lacking valid
context must first run an explicit new classification attempt.

Clean setup and upgrades use the existing commands:

```bash
npm run db:generate
npm run db:deploy
```

Restart an already-running Next.js development process after regenerating Prisma
Client so it loads the new model delegates and fields.

Verification used a scratch database inside the isolated test service: apply all
19 earlier migrations, insert synthetic legacy messages/classification/knowledge
and pending/confirmed drafts, apply Phase 2 inside a transaction, ROLLBACK, verify
original data, then apply/COMMIT and check preserved relationships and honest
baseline/legacy markers. This tests migration transaction rollback before publication,
not a destructive down migration after new evidence has been created.

Before applying to another populated database, retain an off-repository backup and
pause writers. If an uncommitted migration fails, roll back its transaction and
resolve the failure before retrying. Once new revisions/evidence exist, prefer a
forward repair. For recovery to an earlier application/schema, pause writers and
restore a pre-change backup to a separate database, validate original fields and
relationships before switching configuration, and retain the newer database for
recovery. No automatic evidence-deleting down migration or production backup
restore is claimed as tested. Do not let older unversioned approval code write the
current projection: it cannot maintain the new immutable revision pointer.

The new migration was applied to both the isolated test database and the guarded
local development database (`mailops`, loopback port 5433). No existing migration
was rewritten. No live model call or Git commit/push occurred.

## 6. Acceptance Evidence

| Criterion | Evidence |
| --- | --- |
| P2-A1 | A→B test retains A's immutable factual text and input snapshot for the old draft, creates B for the replacement, and confirms only the new eligible draft |
| P2-A2 | Revision, rejection, INACTIVE and ARCHIVED tests mark pending drafts; direct confirmation rejects them; paginated and entry-filtered impact queries are tested |
| P2-A3 | Paused-provider tests publish B or retire A during generation; verify the provider saw A and the late output is rejected without a falsely attributed new draft |
| P2-A4 | Confirmed reply equality test, DB immutability tests, and synthetic legacy migration test preserve history and explicitly leave old evidence unverified |
| P2-A5 | Real pre-Phase-2 schema upgraded with synthetic existing data; transaction rollback/reapplication preserves original fields and relationships; recovery boundaries are documented above |

Checks run:

- Prisma client generation and schema validation: passed.
- `npm run check`: lint, type checking, **28 offline files / 114 tests**, production
  build passed with Mock AI, empty Gemini key/model, external delivery disabled,
  and an unreachable placeholder application database URL.
- `npm run test:integration`: **16 files / 73 tests passed** using only the explicit
  test database and disposable migration scratch database. The separate development
  sentinel was unchanged, and scratch databases were removed by their tests.
- Prisma `migrate diff --from-config-datasource --to-schema prisma/schema.prisma
  --exit-code` against the test database: no difference detected. PostgreSQL guards
  are additionally exercised by integration tests, since Prisma diff does not model
  trigger behavior.
- Final diff, whitespace, and documentation link checks: passed.

The primary suites are `lib/knowledge/revisions.integration.test.ts`,
`tests/knowledge-migration.integration.test.ts`, and
`lib/processing/evidence.test.ts`; all previous workflow tests remain included.
An initial scratch fixture reused one SQL parameter for UUID and text fields; that
fixture was corrected and the final migration test passed.

No Playwright setup exists yet, so the small source-display/impact-message changes
were type/build checked and covered at the service/data level, without browser
end-to-end verification. No remote GitHub CI, real Gemini evaluation, or full
production backup restore was run. No dependencies were added.

The shared Phase 0–2 foundation is complete. Choose Phase 3 (AI evaluation), Phase 4
(full-stack revision workflow), or Phase 5 (backend reconstruction/scale) next.
