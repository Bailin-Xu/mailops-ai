import { describe, expect, it } from "vitest";

import { classificationResultSchema } from "@/lib/ai/provider";
import { MockAIProvider } from "@/lib/ai/mock-provider";

const provider = new MockAIProvider();

describe("MockAIProvider", () => {
  it("classifies a French payment inquiry without translating the message", async () => {
    const result = await provider.classifyEmail({
      subject: "Question concernant mon abonnement",
      cleanBody: "Bonjour, combien coûte le paiement mensuel? Merci.",
    });
    expect(classificationResultSchema.parse(result)).toMatchObject({
      category: "PAYMENT_ADMINISTRATIVE",
      language: "fr",
      requiresHumanReview: false,
    });
    expect(result).not.toHaveProperty("summary");
  });

  it("deterministically recognizes a technical failure", async () => {
    await expect(
      provider.classifyEmail({
        subject: "Upload error",
        cleanBody: "Hello, the upload does not work for my artist profile.",
      }),
    ).resolves.toMatchObject({ category: "TECHNICAL_ISSUE", language: "en" });
  });

  it("does not treat generic art vocabulary or a non-question as known", async () => {
    await expect(
      provider.classifyEmail({
        subject: "Galerie Original",
        cleanBody: "Salut Dorian, merci pour votre temps. Je postulerai à nouveau quand mon profil sera plus développé.",
      }),
    ).resolves.toMatchObject({
      category: "MANUAL_REVIEW",
      confidence: 0.45,
      requiresHumanReview: true,
    });
  });

  it("recognizes a specific known-topic question", async () => {
    await expect(
      provider.classifyEmail({
        subject: "Shipping question",
        cleanBody: "Hello, could you explain the shipping policy?",
      }),
    ).resolves.toMatchObject({
      category: "KNOWN_QUESTION",
      confidence: 0.76,
      requiresHumanReview: false,
    });
  });

  it("does not borrow a known-topic word from unrelated narrative context", async () => {
    await expect(
      provider.classifyEmail({
        subject: "Platform fit",
        cleanBody: "I completed a delivery yesterday. Is this platform appropriate for ceramic work?",
      }),
    ).resolves.toMatchObject({
      category: "UNKNOWN_QUESTION",
      confidence: 0.62,
      requiresHumanReview: true,
    });
  });

  it("recognizes Artsy when it appears inside the actual question", async () => {
    await expect(
      provider.classifyEmail({
        subject: "Re: L'Original — Dernier rappel",
        cleanBody: [
          "Bonjour Dorian,",
          "Question: Une fois sur votre site, est-ce notre responsabilité d'insérer",
          "nos listings et description sur Artsy et si c'est L'original qui s'en",
          "occupe?",
          "Merci pour cette précision.",
          "Meilleures salutations.",
          "Angela Bisson",
        ].join("\n"),
      }),
    ).resolves.toMatchObject({
      category: "KNOWN_QUESTION",
      confidence: 0.76,
    });
  });
});
