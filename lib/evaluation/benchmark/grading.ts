import { draftResultSchema, classificationResultSchema } from "@/lib/ai/provider";
import type { EvaluationCase, Result } from "./schemas";

const humanRoutes = new Set(["MANUAL_REVIEW", "HUMAN_ANSWER_QUEUE", "TECHNICAL_QUEUE"]);
export function isHumanRoute(route: string) { return humanRoutes.has(route); }
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replaceAll(/\s+/gu, " ").trim();

/** Conservative exact-claim proxy, not a semantic entailment or LLM judge. */
export function grade(item: EvaluationCase, result: Omit<Result, "grade">): NonNullable<Result["grade"]> {
  const draft = draftResultSchema.safeParse(result.draft);
  const classification = classificationResultSchema.parse(result.classification);
  const claims = item.supportedClaims.map(normalize);
  let factualSupport: boolean | null = null;
  let supportedClaimCoverage: number | null = null;
  let language = classification.language === item.expectedLanguage;
  if (draft.success) {
    const body = normalize(draft.data.body);
    let remainder = body;
    for (const claim of claims) remainder = remainder.replaceAll(claim, "");
    // Only these fixed courtesy phrases may accompany an annotated claim.
    remainder = remainder.replaceAll(/\b(?:hello|bonjour|best|regards|dorian|bien à vous|merci|thank you)\b/gu, "").replaceAll(/[\s,.!;:—-]/gu, "");
    factualSupport = claims.length > 0 && remainder.length === 0
      && draft.data.knowledgeSourceIds.every((id) => item.relevantSourceIds.includes(id));
    supportedClaimCoverage = claims.length ? claims.filter((claim) => body.includes(claim)).length / claims.length : null;
    // A matching output label alone cannot pass a reply written in the wrong language.
    const markers = item.expectedLanguage === "fr" ? /\b(?:bonjour|livraison|ouvrables|taxes locales|matériaux)\b/iu : /\b(?:hello|shipping|business days|local taxes|materials)\b/iu;
    const opposite = item.expectedLanguage === "fr" ? /\b(?:hello|shipping|business days|best)\b/iu : /\b(?:bonjour|livraison|ouvrables|bien à vous)\b/iu;
    language = language && draft.data.language === item.expectedLanguage && markers.test(draft.data.body) && !opposite.test(draft.data.body);
  }
  return {
    routing: result.route === item.expectedRoute,
    missedEscalation: isHumanRoute(item.expectedRoute) && !isHumanRoute(result.route ?? ""),
    falseEscalation: !isHumanRoute(item.expectedRoute) && isHumanRoute(result.route ?? ""),
    recallAtK: item.relevantSourceIds.length
      ? item.relevantSourceIds.filter((id) => result.retrievedIds.includes(id)).length / item.relevantSourceIds.length : null,
    factualSupport, supportedClaimCoverage, language,
  };
}
