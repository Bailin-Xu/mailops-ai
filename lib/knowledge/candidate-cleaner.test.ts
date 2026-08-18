import { describe, expect, it } from "vitest";

import { cleanKnowledgeCandidate } from "@/lib/knowledge/candidate-cleaner";

describe("cleanKnowledgeCandidate", () => {
  it("removes greeting names and customer signature details", () => {
    const result = cleanKnowledgeCandidate({
      title: "Inscription",
      canonicalQuestion:
        "Bonjour Dorian,\n\nComment terminer mon inscription ?\n\nMerci,\nSandra Boorne\n514-555-0100\nsandra@example.test",
      proposedAnswer: "Bonjour Sandra,\n\nUtilise le portail de paiement.\n\nCordialement,\nDorian",
      knownNames: ["Dorian"],
    });

    expect(result.canonicalQuestion).toBe("Comment terminer mon inscription ?");
    expect(result.proposedAnswer).toBe("Utilise le portail de paiement.");
    expect(result.reasons).toEqual(
      expect.arrayContaining(["GREETING", "SIGNATURE"]),
    );
  });

  it("removes contact data, links, attachment markers, and names after contact phrases", () => {
    const result = cleanKnowledgeCandidate({
      title: "Partner plan",
      canonicalQuestion:
        "J’ai discuté avec Sophia. Je reçois une erreur. Vidéo: [Video File] IMG_4653.mov https://example.test/video 514.555.0100",
      proposedAnswer:
        "Tu peux envoyer une capture à support@example.test ou à @gallery_support.\n\nMerci beaucoup,",
    });

    expect(result.canonicalQuestion).not.toContain("Sophia");
    expect(result.canonicalQuestion).not.toContain("https://");
    expect(result.canonicalQuestion).not.toContain("514");
    expect(result.canonicalQuestion).not.toContain("IMG_4653.mov");
    expect(result.proposedAnswer).not.toContain("support@example.test");
    expect(result.proposedAnswer).not.toContain("@gallery_support");
    expect(result.proposedAnswer).not.toContain("Merci beaucoup");
  });

  it("keeps stable business names and factual content", () => {
    const result = cleanKnowledgeCandidate({
      title: "Artsy",
      canonicalQuestion: "Comment publier mes œuvres sur Artsy ?",
      proposedAnswer:
        "Ajoute d’abord les œuvres à ton profil pour collaborer avec L’Original.",
    });

    expect(result.canonicalQuestion).toContain("Artsy");
    expect(result.proposedAnswer).toContain("L’Original");
  });
});
