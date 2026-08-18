export const syntheticInboxScenarios = [
  {
    id: "known-gallery-appointment",
    cohort: "KNOWN",
    subject: "Visite sur rendez-vous",
    body: "Bonjour, faut-il prendre rendez-vous pour visiter la galerie ? Merci.",
    expectedStatuses: ["DRAFT_READY"],
    expectsDraft: true,
    expectsKnowledge: true,
  },
  {
    id: "known-gallery-admission",
    cohort: "KNOWN",
    subject: "Entrée à la galerie",
    body: "Bonjour, l'entrée à la galerie est-elle gratuite ? Merci.",
    expectedStatuses: ["DRAFT_READY"],
    expectsDraft: true,
    expectsKnowledge: true,
  },
  {
    id: "known-minimum-price",
    cohort: "KNOWN",
    subject: "Prix minimal d'une œuvre",
    body: "Bonjour, existe-t-il un prix minimal pour publier une œuvre ? Merci.",
    expectedStatuses: ["DRAFT_READY"],
    expectsDraft: true,
    expectsKnowledge: true,
  },
  {
    id: "known-gallery-children",
    cohort: "KNOWN",
    subject: "Visite avec des enfants",
    body: "Bonjour, les enfants sont-ils les bienvenus dans la galerie ? Merci.",
    expectedStatuses: ["DRAFT_READY"],
    expectsDraft: true,
    expectsKnowledge: true,
  },
  {
    id: "unknown-weekend-art-classes",
    cohort: "UNKNOWN",
    subject: "Cours de peinture le dimanche",
    body: "Bonjour, proposez-vous des cours de peinture pour adultes le dimanche matin ?",
    expectedStatuses: ["NO_KNOWLEDGE"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
  {
    id: "unknown-gallery-parking",
    cohort: "UNKNOWN",
    subject: "Stationnement pour les visiteurs",
    body: "Bonjour, avez-vous un stationnement réservé aux visiteurs de la galerie ?",
    expectedStatuses: ["NO_KNOWLEDGE"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
  {
    id: "technical-image-upload",
    cohort: "TECHNICAL",
    subject: "Erreur de téléversement",
    body: "Bonjour, le téléversement de mes images échoue avec une erreur chaque fois que je clique sur Enregistrer.",
    expectedStatuses: ["TECHNICAL_QUEUED"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
  {
    id: "technical-profile-blank-page",
    cohort: "TECHNICAL",
    subject: "Page blanche après sauvegarde",
    body: "Bonjour, après avoir sauvegardé mon profil, la page devient blanche et mes changements disparaissent.",
    expectedStatuses: ["TECHNICAL_QUEUED"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
  {
    id: "low-confidence-missing-referent",
    cohort: "LOW_CONFIDENCE",
    subject: "Pour ça",
    body: "Bonjour, pour ça, vous pensez oui ou non ? Merci.",
    expectedStatuses: ["WAITING_FOR_REVIEW"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
  {
    id: "low-confidence-fragmented-mixed",
    cohort: "LOW_CONFIDENCE",
    subject: "Question maybe",
    body: "Hello bonjour, galerie compte peut-être... je ne sais pas. Can you?",
    expectedStatuses: ["WAITING_FOR_REVIEW"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
  {
    id: "high-risk-refund-dispute",
    cohort: "HIGH_RISK",
    subject: "Contestation de paiement",
    body: "Bonjour, je conteste ce prélèvement et je demande un remboursement immédiat de mon abonnement.",
    expectedStatuses: ["AWAITING_HUMAN_ANSWER", "WAITING_FOR_REVIEW"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
  {
    id: "high-risk-delete-personal-data",
    cohort: "HIGH_RISK",
    subject: "Suppression du compte et des données",
    body: "Supprimez mon compte et toutes mes données personnelles. Je souhaite une confirmation écrite pour mon avocat.",
    expectedStatuses: ["WAITING_FOR_REVIEW", "AWAITING_HUMAN_ANSWER"],
    expectsDraft: false,
    expectsKnowledge: false,
  },
] as const;

export type SyntheticInboxScenario = (typeof syntheticInboxScenarios)[number];

export function syntheticScenarioMessageId(scenario: SyntheticInboxScenario) {
  return `mailops-synthetic-eval-v1-${scenario.id}@example.test`;
}

export function buildSyntheticScenarioEml(
  scenario: SyntheticInboxScenario,
  index: number,
) {
  const minute = String(index).padStart(2, "0");
  return Buffer.from([
    `From: Evaluation ${index + 1} <evaluation-${index + 1}@example.test>`,
    "To: Demo Support <support@example.test>",
    `Subject: ${scenario.subject}`,
    `Date: Tue, 18 Aug 2026 11:${minute}:00 -0400`,
    `Message-ID: <${syntheticScenarioMessageId(scenario)}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    scenario.body,
  ].join("\r\n"), "utf8");
}

export function evaluateSyntheticOutcome(
  scenario: SyntheticInboxScenario,
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
