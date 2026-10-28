# Phase 5 — Measured Performance Report

Recorded on **2026-10-28**, using the final message-origin/alias implementation.
These are local synthetic samples, not production SLAs. Raw samples, code identity
and query evidence are in [phase-5-summary.json](benchmarks/phase-5-summary.json).
Reproduce with `npm run bench:threads`; see the
[method/safety contract](15-phase-5-thread-reconstruction-and-scale.md).

## Environment and conditions

- Apple M3, 8 logical CPUs, 16 GiB host RAM, Darwin 24.6.0 arm64; Node 24.3.0.
- Docker Engine 28.1.1: 8 logical CPUs, approximately 7.65 GiB VM RAM. Settings
  were read after the run. CPU frequency/affinity and exclusive host use were not controlled.
- PostgreSQL 17.10 (aarch64 Alpine), `shared_buffers=128MB`, `work_mem=4MB`.
- Three reseeded database repetitions per scale with unmeasured warm scans;
  each query has one warm-up plus three samples per repetition (9 pooled samples).
  OS/DB caches were not flushed. No cold-cache claim.
- Expected 10-message groups with chains, cycles, missing references, identical
  subjects, shuffled insertion and 512-character bilingual clean/normalized bodies.
  One participant per message; knowledge counts 100 / 1,000 / 5,000. No real AI calls.

## End-to-end reconstruction

Medians of 3 samples, in milliseconds. Preparation includes database snapshot,
manifest/hash and grouping. Apply includes revalidation, transactional updates,
invalidation, post-state scan and receipt. RSS peaks include setup/seeding/warm-ups
and are worker high-water values, not isolated apply allocations.

| Messages | Prepare median ms | Apply median ms | Worker peak MiB |
| --- | ---: | ---: | ---: |
| 1,000 | 38.72 | 129.41 | 438.0 |
| 10,000 | 303.95 | 1327.27 | 608.1 |
| 50,000 | 1155.98 | 6655.06 | 738.7 |

Every scale passed exact expected grouping, moved 90% of messages to their expected
canonical threads, and replayed unchanged plans as `ALREADY_APPLIED`. No scale up to
50k hit resource limits here. Larger scales, larger bodies, dense workflow history
and continuous writes were not measured. The 100k guard is not tested 100k capacity.

## Pure planner baseline comparison

Baseline is the actual planner at Git `de0d86c`. Baseline/current kernels use
matching regular header groups, separate child processes, one warm-up and 3 samples.
The current kernel additionally validates identities and preserves existing membership.

| Messages | Old regular median ms | Current regular median ms | Old descending chain | Current descending median ms |
| --- | ---: | ---: | --- | ---: |
| 1,000 | 2.75 | 2.37 | 1.38 ms | 1.82 |
| 10,000 | 20.81 | 25.26 | Stack limit; no valid sample | 19.47 |
| 50,000 | 123.37 | 177.98 | Stack limit; no valid sample | 125.48 |

Iterative/path-compressed union by size fixes the demonstrated stack failure at
10k/50k. Ordinary current planning is slower at 10k/50k, while the 1k sample is
slightly faster; small-sample variation is not a general speedup. Validation/membership
work adds overhead. No general throughput/memory improvement is claimed, and no
ratio is computed against a failed baseline.

## Actual query behavior

Medians of 9 warm samples, milliseconds. This is before/after **data reconstruction**,
not before/after an index optimization. The same messages change from separate
imports to 10-message conversations; selected detail size and current classification
visibility change. Tuple visibility/statistics and cache residency can also change.

| Messages | Inbox first before → after | Filtered before → after | Last page before → after | Specific FTS before → after | Broad FTS before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 8.60 → 5.24 | 16.94 → 17.92 | 13.37 → 8.58 | 0.56 → 0.66 | 1.88 → 2.00 |
| 10,000 | 17.68 → 20.65 | 140.99 → 132.54 | 68.12 → 44.84 | 1.09 → 0.99 | 13.63 → 13.78 |
| 50,000 | 92.07 → 171.81 | 779.70 → 772.15 | 495.11 → 240.85 | 1.62 → 1.37 | 64.41 → 61.50 |

Inbox returned at most 10 summaries; retrieval at most 8 results. Only the selected
thread's detail was fetched. Specific FTS explain samples used the existing
`KnowledgeEntry_active_search_en_idx` bitmap path; node/buffer data is in the JSON.
No new search index was added.

Query regressions are retained. Broad FTS ranking and body-substring filtering are
more expensive than selective retrieval. Fewer threads do not guarantee a faster
first page or smaller detail payload. No query improvement is attributed to merging.

## Decision and practical limits

Keep a full rebuild for this measured **offline local maintenance** slice. Apply
holds graph-table write locks, including unrelated threads; schedule a quiet window
and expect competing work to retry. It is not an ordinary page request.

The demonstrated optimization is stack safety, with ordinary-case overhead.
An incremental worker, additional indexes or retrieval infrastructure is not
justified solely by these results. Revisit them against write-availability/SLO
requirements, larger bodies/history and repeated load tests. Three repetitions on
one laptop establish neither statistical significance nor production capacity.
The benchmark is opt-in; normal CI keeps deterministic stack/relationship regressions.
