import type {
  AIProvider,
  ClassificationInput,
  ClassificationResult,
  DraftInput,
  DraftResult,
} from "@/lib/ai/provider";

type Rule = {
  category: ClassificationResult["category"];
  pattern: RegExp;
};

const rules: Rule[] = [
  {
    category: "IRRELEVANT_SPAM",
    pattern: /(?:crypto|casino|seo service|buy followers|prize winner)/iu,
  },
  {
    category: "TECHNICAL_ISSUE",
    pattern: /(?:bug|error|erreur|ne fonctionne pas|doesn['’]t work|upload|télévers|charger|lien ne fonctionne)/iu,
  },
  {
    category: "ACCOUNT_ACCESS",
    pattern: /(?:login|log in|password|mot de passe|connexion|accès au compte|reactiv|réactiv)/iu,
  },
  {
    category: "PAYMENT_ADMINISTRATIVE",
    pattern: /(?:paiement|payer|payment|prix|price|coût|cost|abonnement|subscription|facture|invoice|\$)/iu,
  },
  {
    category: "BUSINESS_PARTNERSHIP",
    pattern: /(?:partenariat|partnership|collaboration|commission|murale|mural|corporate project)/iu,
  },
];

const questionPattern = /\?|\b(?:how|what|why|where|which|can you|could you|please explain|tell me|comment|pourquoi|où|quel(?:le|s|les)?|combien|est-ce|pouvez-vous|peux-tu|pourriez-vous|expliquez-moi)\b/iu;
const knownQuestionPattern = /\b(?:artsy|livraison|shipping|delivery|encadr\w*|framing|taxe?s?|taxes?)\b/iu;

export class MockAIProvider implements AIProvider {
  readonly id = "mock";
  readonly model = "deterministic-rules-v5";
  readonly classificationPromptVersion = "classification-mock-v5";
  readonly draftPromptVersion = "dorian-reference-mock-v3";

  async classifyEmail(input: ClassificationInput): Promise<ClassificationResult> {
    const text = `${input.subject}\n${input.cleanBody}`.trim();
    const language = detectLanguage(text);
    const rule = rules.find((candidate) => candidate.pattern.test(text));
    if (rule) {
      return {
        category: rule.category,
        confidence: 0.88,
        language,
        requiresHumanReview: false,
      };
    }

    const questionText = extractQuestionText(text);
    const hasQuestion = questionText.length > 0;
    if (knownQuestionPattern.test(questionText)) {
      return {
        category: "KNOWN_QUESTION",
        confidence: 0.76,
        language,
        requiresHumanReview: false,
      };
    }

    return {
      category: hasQuestion ? "UNKNOWN_QUESTION" : "MANUAL_REVIEW",
      confidence: hasQuestion ? 0.62 : 0.45,
      language,
      requiresHumanReview: true,
    };
  }

  async generateDraft(input: DraftInput): Promise<DraftResult> {
    const source = input.knowledge[0];
    if (!source) throw new Error("Mock grounded drafts require one knowledge source.");
    const answer = source.answer.trim();
    const french = input.language === "fr";
    return {
      subject: /^re:/iu.test(input.subject) ? input.subject : `Re: ${input.subject}`,
      body: french
        ? `Bonjour,\n\n${answer}\n\nBien à vous,\nDorian`
        : `Hello,\n\n${answer}\n\nBest,\nDorian`,
      language: input.language,
      knowledgeSourceIds: [source.id],
      requiresHumanReview: true,
    };
  }
}

function detectLanguage(text: string): ClassificationResult["language"] {
  const french = countMatches(text, /\b(?:bonjour|merci|vous|votre|avec|pour|pas|une|des|est|artiste|galerie|paiement)\b|[àâçéèêëîïôùûüÿœ]/giu);
  const english = countMatches(text, /\b(?:hello|thanks|you|your|with|for|not|the|artist|gallery|payment)\b/giu);
  if (french >= 2 && english >= 2) return "mixed";
  if (french >= 2) return "fr";
  if (english >= 2) return "en";
  return "unknown";
}

function extractQuestionText(text: string) {
  return text
    .replaceAll(/\s+/gu, " ")
    .split(/(?<=[?!.])\s+/u)
    .filter((segment) => questionPattern.test(segment))
    .join(" ");
}

function countMatches(value: string, expression: RegExp) {
  return [...value.matchAll(expression)].length;
}
