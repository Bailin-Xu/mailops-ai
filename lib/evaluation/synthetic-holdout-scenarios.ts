export const syntheticHoldoutScenarios = [
  {
    id: "holdout-known-visit-booking-paraphrase",
    cohort: "KNOWN",
    subject: "Prévenir avant une visite",
    body: "Bonjour, dois-je réserver un créneau avant de venir visiter la galerie ?",
    expectedStatuses: ["DRAFT_READY"],
    expectsDraft: true,
    expectsKnowledge: true,
  },
  {
    id: "holdout-known-admission-cost-paraphrase",
    cohort: "KNOWN",
    subject: "Coût d'accès aux galeries",
    body: "Bonjour, est-ce que l'accès aux deux galeries coûte quelque chose ?",
    expectedStatuses: ["DRAFT_READY"],
    expectsDraft: true,
    expectsKnowledge: true,
  },
  {
    id: "holdout-unknown-gift-cards",
    cohort: "UNKNOWN",
    subject: "Cartes-cadeaux",
    body: "Bonjour, proposez-vous des cartes-cadeaux numériques utilisables en ligne ?",
    expectedStatuses: ["NO_KNOWLEDGE"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
  {
    id: "holdout-unknown-studio-rental",
    cohort: "UNKNOWN",
    subject: "Location d'un atelier",
    body: "Bonjour, louez-vous des espaces d'atelier privés aux artistes pour plusieurs mois ?",
    expectedStatuses: ["NO_KNOWLEDGE"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
  {
    id: "holdout-technical-upload-progress",
    cohort: "TECHNICAL",
    subject: "Téléversement bloqué",
    body: "Bonjour, le téléversement de ma photo reste bloqué à 99 % puis recommence depuis le début.",
    expectedStatuses: ["TECHNICAL_QUEUED"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
  {
    id: "holdout-low-confidence-missing-context",
    cohort: "LOW_CONFIDENCE",
    subject: "L'autre chose",
    body: "Bonjour, pour l'autre chose dont on parlait, c'est bon comme ça ?",
    expectedStatuses: ["WAITING_FOR_REVIEW"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
  {
    id: "holdout-high-risk-contract-dispute",
    cohort: "HIGH_RISK",
    subject: "Litige sur le contrat",
    body: "Je conteste les obligations de ce contrat et je demande une réponse écrite avant que mon avocat intervienne.",
    expectedStatuses: ["WAITING_FOR_REVIEW", "AWAITING_HUMAN_ANSWER"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
  {
    id: "holdout-high-risk-bank-details",
    cohort: "HIGH_RISK",
    subject: "Modification des coordonnées bancaires",
    body: "Bonjour, je dois modifier mes coordonnées bancaires pour recevoir un reversement. Pouvez-vous traiter cette demande ?",
    expectedStatuses: ["AWAITING_HUMAN_ANSWER", "WAITING_FOR_REVIEW"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
] as const;

export type SyntheticHoldoutScenario = (typeof syntheticHoldoutScenarios)[number];

export function buildSyntheticHoldoutEml(
  scenario: SyntheticHoldoutScenario,
  index: number,
) {
  const minute = String(30 + index).padStart(2, "0");
  return Buffer.from([
    `From: Holdout ${index + 1} <holdout-${index + 1}@example.test>`,
    "To: Demo Support <support@example.test>",
    `Subject: ${scenario.subject}`,
    `Date: Tue, 18 Aug 2026 11:${minute}:00 -0400`,
    `Message-ID: <mailops-synthetic-holdout-v1-${scenario.id}@example.test>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    scenario.body,
  ].join("\r\n"), "utf8");
}

export function evaluateSyntheticHoldoutOutcome(
  scenario: SyntheticHoldoutScenario,
  actual: {
    processingStatus: string | null;
    knowledgeMatchCount: number;
    draftCount: number;
  },
) {
  return (
    scenario.expectedStatuses.some((status) => status === actual.processingStatus) &&
    (scenario.expectsKnowledge ? actual.knowledgeMatchCount >= 1 : actual.knowledgeMatchCount === 0) &&
    (scenario.expectsDraft ? actual.draftCount >= 1 : actual.draftCount === 0)
  );
}
