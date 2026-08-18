import { z } from "zod";

export const classificationCategoryValues = [
  "KNOWN_QUESTION",
  "TECHNICAL_ISSUE",
  "ACCOUNT_ACCESS",
  "PAYMENT_ADMINISTRATIVE",
  "BUSINESS_PARTNERSHIP",
  "UNKNOWN_QUESTION",
  "IRRELEVANT_SPAM",
  "MANUAL_REVIEW",
] as const;

export const classificationLanguageValues = ["en", "fr", "mixed", "unknown"] as const;

export const classificationResultSchema = z.object({
  category: z.enum(classificationCategoryValues),
  confidence: z.number().min(0).max(1),
  language: z.enum(classificationLanguageValues),
  requiresHumanReview: z.boolean(),
});

export const draftResultSchema = z.object({
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20_000),
  language: z.enum(classificationLanguageValues),
  knowledgeSourceIds: z.array(z.string().uuid()).min(1),
  requiresHumanReview: z.literal(true),
});

export type ClassificationInput = {
  subject: string;
  cleanBody: string;
};

export type ClassificationResult = z.infer<typeof classificationResultSchema>;

export type DraftInput = {
  subject: string;
  cleanBody: string;
  language: ClassificationResult["language"];
  knowledge: Array<{ id: string; title: string; answer: string }>;
  style: "DORIAN_REFERENCE";
};

export type DraftResult = z.infer<typeof draftResultSchema>;

export type AIExecutionMetadata = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  thoughtsTokens?: number;
  modelVersion?: string;
  responseId?: string;
  finishReason?: string;
};

export interface AIProvider {
  readonly id: string;
  readonly model: string;
  readonly classificationPromptVersion: string;
  readonly draftPromptVersion: string;
  classifyEmail(input: ClassificationInput): Promise<unknown>;
  generateDraft(input: DraftInput): Promise<unknown>;
  getExecutionMetadata?(output: unknown): AIExecutionMetadata | undefined;
}
