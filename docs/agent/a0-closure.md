# A0 closure — 2026-10-29

A0-T1–T5 and A0-A1–A4 are complete within the foundation scope below.
A1–A5 remain not started. No live-model calls, external tracing, service runtime,
private email imports, business-table migrations or Git commits were performed.

## Evidence mapping

| Requirement | Deliverable / evidence |
| --- | --- |
| T1 / A1 architecture | adr-001-runtime-and-contracts.md: service/data ownership, MCP transport, contract ownership, admission/receipt/fencing, cancellation, graph/business mapping, pinned and resolved dependency set |
| T2 / A2 contracts | contracts/agent/schema.ts + services/agent/contracts.py; 31 identical valid/invalid cases pass in TypeScript and Pydantic, including bad versions/enums, missing revision, oversized content, write-tool rejection and proposal invariants |
| T3 / A3 isolation | Dedicated tmpfs profile on 5435; guarded setup twice, verify, cleanup all passed, with read-only development message/candidate/count-content sentinel unchanged; service then stopped |
| T4 / A4 dataset | 100 synthetic cases, 60 tuning / 40 holdout, balanced EN/FR, disjoint family IDs, frozen SHA-256; author-reviewed label rules and separate six-case fault matrix |
| T5 / A4 scoring | evaluation-protocol-v1.md: metrics/denominators, rubric, two paired repetitions, prospective gates, missing usage, run identity, budget requirements and holdout reuse policy |

## Limits and next step

The fixture DB stages a frozen JSON snapshot; it is not an Inbox demonstration.
A1 must map approved snapshot revisions into its isolated service fixture and add
concrete MCP response contracts/interoperability tests. The Python environment
resolves/install-checks the selected SDKs, but does not yet exercise their runtimes.

The templated authored dataset is mechanically checked and reviewed against explicit
label rules; independent human label/French calibration is still required before A4.
Freeze a new dataset version if that review changes labels. No real-model quality,
generalization, PII system coverage or semantic independence is claimed.

## Verification

- Python 3.12.14: shared contracts 31/31; pip check reports no broken requirements.
- Final `npm run check` passed end-to-end: lint, typecheck, 161 offline tests in
  32 files, and production build.
- Production build passed on retry with required local process permissions. Initial
  sandbox build failed binding a port; one overlapping retry saw the build lock.
- Dedicated fixture setup/replay/verify/cleanup passed; development sentinel unchanged.
- Full existing isolated integration regression passed: 93 tests / 20 files; sentinel
  unchanged. Initial attempt before service readiness failed; healthy-service retry passed.
- No UI changes; browser tests not rerun for A0.
- Git diff whitespace check passed. No commit/push.
