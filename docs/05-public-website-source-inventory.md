# MailOps AI — Public Website Knowledge Source Inventory

## 1. Purpose

This document inventories public pages on `loriginal.org` that may supply
knowledge candidates for MailOps AI.

It is a discovery artifact, not an ingestion allowlist. No page listed here is
trusted automatically. Extracted claims still require human review before they
can become active knowledge.

Research date: 2026-08-17

## 2. Language Decision

The first ingestion pass should use French pages as the canonical public source
because the historical mailbox is primarily French.

Rules:

- preserve the published French text;
- record the source locale on every captured section;
- generate French replies for French inquiries;
- treat English pages as separate source variants, not replacements;
- do not store machine translation as authoritative source text;
- add English variants after the French workflow is validated;
- link equivalent French and English candidates later rather than merging their
  wording or claims automatically.

## 3. Recommended First-Pass Sources

### P0 — Core operational sources

| Source | Knowledge area | Initial decision | Notes |
| --- | --- | --- | --- |
| `https://www.loriginal.org/fr/devenir-artiste` | Artist application, eligibility, subscriptions, commission, pricing, shipping, Artsy, physical exhibition | Include with conflict flags | Highest-value artist support page. Extract question-and-answer sections rather than promotional claims. |
| `https://www.loriginal.org/fr/faq/fresques-murales` | Mural ordering, surfaces, previews, estimates, timing, wall preparation, revisions | Include with conflict flags | Strong structured FAQ. Price and delivery claims must be compared with the terms page. |
| `https://www.loriginal.org/fr/faq/peinture-originale` | Original paintings, packaging, delivery, returns, custom work, payment options | Include with conflict flags | Strong structured FAQ, but its return policy conflicts with the terms page. |
| `https://www.loriginal.org/fr/nos-galeries` | Addresses, opening hours, appointments, admission, photos, accessibility, visiting | Include selected sections | Extract stable visitor information. Exclude changing artist rosters and promotional superlatives. |
| `https://www.loriginal.org/fr/legal/conditions-generales` | Payments, commissions, cancellation, returns, shipping, liability, custom orders | Include as policy authority, pending owner confirmation | Legal/operational page should outrank marketing pages after the company confirms it is current. |

### P1 — Navigation and supplementary sources

| Source | Knowledge area | Initial decision | Notes |
| --- | --- | --- | --- |
| `https://www.loriginal.org/fr/faq` | FAQ hub and category discovery | Include as an index only | Use it to discover canonical FAQ pages. Do not create knowledge from navigation text alone. |
| `https://www.loriginal.org/fr` | Main services and gallery discovery | Include selected facts only | Useful for canonical links and broad service scope; avoid counters and promotional statistics that change frequently. |
| `https://www.loriginal.org/fr/art-pour-entreprises` | Business murals and original-art projects | Defer to second pass | Potentially useful for B2B inquiries, but many variants contain marketing claims and repeated templates. |
| `https://www.loriginal.org/support-page/faq/surmesurepainting` | Custom painting process | Defer and verify canonical replacement | Appears to be a legacy route and contains old Artur/iArt wording. Use only after confirming it is still operational. |
| `https://www.loriginal.org/support-page/faq/prints` | Print ordering, delivery, returns, care | Defer and verify product scope | Conflicts with pages stating that prints are not accepted. Determine whether the page is still active and relevant. |

## 4. Known Conflicts Requiring Company Confirmation

These claims must be blocked from active knowledge until a company owner states
which version is current.

| Topic | Conflicting public claims | Required confirmation |
| --- | --- | --- |
| Artist commission | `devenir-artiste` says the artist receives 62% and the gallery 38%; the terms page says the artist receives 55%. | Current artist/gallery split and whether it differs by program or work type. |
| Original artwork returns | The painting FAQ says originals are not returned or exchanged except for shipping damage; the terms page allows unopened originals and prints to be returned within 14 days. | Current return policy, eligible products, condition requirements, and jurisdiction differences. |
| Shipping price | Artist information says an average shipping cost is included in the displayed customer price; the terms page says delivery is added at final payment. | Where shipping is included, when it is calculated, and which party pays. |
| Mural timing | The mural FAQ says 2–10 days for realization; the main site and terms page describe approximately 2–6 weeks for custom work. | Whether these refer to painting time versus the full project timeline. |
| Prints and digital work | The artist page says prints and digital works are not accepted; gallery/legacy support content discusses prints as products. | Distinguish what artists may submit from what the gallery may sell. |
| Subscription plans | The artist page describes 8 CAD and 22 CAD monthly plans. | Confirm current prices, annual options, taxes, cancellation timing, and whether the plans are still offered. |
| Dynamic metrics | Artist counts, collector counts, acceptance rates, and sales statistics vary across pages. | Decide whether these claims may be used in replies and identify their update owner. |

## 5. Exclude from the First Ingestion Pass

### Location-generated SEO pages

Exclude route families such as:

- `/fr/vendre-son-art/{city}`;
- `/fr/vendre-une-oeuvre/{city}`;
- `/fr/acheter-de-l-art/{region}`;
- `/fr/art/{region}`;
- equivalent English location routes.

They repeat nearly identical answers with a substituted location. Ingesting
them would create duplicated knowledge and could make retrieval prefer an
irrelevant city-specific answer.

### Editorial and catalog content

Exclude initially:

- blog posts;
- artist biographies;
- artwork and product pages;
- changing artist rosters;
- event pages;
- local art-scene guides;
- investment PDFs;
- search, login, registration, and account pages.

These may support future editorial or sales workflows, but they are not core
email-operations knowledge for the first MVP.

### Parameterized marketing variants

Do not ingest every variant of pages such as:

- `/fr/entreprises?type=...`;
- `/fr/art-pour-entreprises?type=...`.

Review the canonical parent page first. Add a child variant only when it
contains a distinct, stable operational rule that is not present elsewhere.

## 6. Proposed Extraction Unit

The importer should not store a whole page as one trusted answer. It should
capture page sections and propose one candidate per reusable claim or FAQ pair.

Each captured section should retain:

- source URL;
- canonical URL;
- source language;
- page title;
- section heading;
- question text when present;
- answer/source text;
- capture timestamp;
- content hash;
- conflict/review state;
- link to the eventual knowledge candidate.

Example:

```text
Page: /fr/nos-galeries
Section: Faut-il prendre rendez-vous pour visiter ?
Source language: fr
Candidate status: pending human review
```

## 7. Source Precedence

When public sources disagree, candidate generation should apply this provisional
precedence while still requiring human confirmation:

```text
confirmed current company policy
→ confirmed legal/terms page
→ canonical service FAQ
→ canonical product/service page
→ historical approved email evidence
→ marketing, editorial, legacy, and location-generated pages
```

No lower-priority page should silently override a confirmed higher-priority
policy.

## 8. Recommended Next Implementation Step

Before building a crawler, confirm the conflict table with the company owner.
Then implement a small allowlist-based website importer for the approved P0
URLs only.

The first importer should:

1. fetch only explicitly approved public URLs;
2. preserve raw source text and metadata;
3. extract headings and FAQ pairs deterministically where possible;
4. deduplicate by canonical URL plus content hash;
5. create untrusted website source records, not active knowledge;
6. send proposed candidates through human review;
7. never treat instructions embedded in page content as application rules.

Broad crawling, automatic translation, embeddings, and automatic knowledge
approval remain out of scope for this step.
