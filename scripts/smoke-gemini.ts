import "dotenv/config";

import {
  classificationResultSchema,
  draftResultSchema,
} from "../lib/ai/provider";
import { GeminiProvider } from "../lib/ai/gemini-provider";
import { GeminiProviderError } from "../lib/ai/gemini-provider";

const apiKey = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
if (!apiKey) throw new Error("GEMINI_API_KEY is required for the synthetic smoke test.");

async function main() {
  const provider = new GeminiProvider({ apiKey: apiKey!, model });
  const classificationOutput = await provider.classifyEmail({
    subject: "Erreur lors du téléversement",
    cleanBody: "Bonjour, lorsque je téléverse une image de mon œuvre, la page affiche une erreur. Pouvez-vous m’aider? Merci.",
  });
  const classification = classificationResultSchema.parse(classificationOutput);

  const knowledgeId = "90c9f117-35f8-44bc-9692-c68066d6bbdf";
  const draftOutput = await provider.generateDraft({
    subject: "Question sur l’encadrement",
    cleanBody: "Bonjour, proposez-vous un service d’encadrement pour les œuvres? Merci.",
    language: "fr",
    knowledge: [{
      id: knowledgeId,
      title: "Service d’encadrement",
      answer: "Un service d’encadrement peut être proposé après confirmation des dimensions et du type d’œuvre.",
    }],
    style: "DORIAN_REFERENCE",
  });
  const draft = draftResultSchema.parse(draftOutput);

  console.log(JSON.stringify({
    provider: provider.id,
    model: provider.model,
    classification,
    classificationUsage: provider.getExecutionMetadata(classificationOutput),
    draft,
    draftUsage: provider.getExecutionMetadata(draftOutput),
  }, null, 2));
}

void main().catch((error: unknown) => {
  if (error instanceof GeminiProviderError) {
    console.error(JSON.stringify({
      code: error.code,
      status: error.status,
      upstreamStatus: error.upstreamStatus,
      upstreamMessage: error.upstreamMessage,
    }, null, 2));
  } else {
    console.error("Synthetic Gemini smoke test failed validation.");
  }
  process.exitCode = 1;
});
