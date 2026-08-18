import { describe, expect, it } from "vitest";

import { cleanEmailBody } from "@/lib/email/clean-body";

describe("cleanEmailBody", () => {
  it("keeps a current message without known noise unchanged", () => {
    const result = cleanEmailBody("Bonjour,\n\nÊtes-vous ouverts samedi ?");

    expect(result.cleanBody).toBe("Bonjour,\n\nÊtes-vous ouverts samedi ?");
    expect(result.removalReasons).toEqual([]);
  });

  it("removes a concatenated French Outlook history", () => {
    const result = cleanEmailBody(
      "Bonjour, nous sommes au Canada aussi.________________________________De : Ann <ann@example.com>Envoyé : dimancheÀ : DorianObjet : Re: inscriptionAncien message",
    );

    expect(result.cleanBody).toBe("Bonjour, nous sommes au Canada aussi.");
    expect(result.quotedContext).toContain("Ancien message");
    expect(result.removalReasons).toContain("QUOTED_HISTORY");
  });

  it("removes French and English Gmail quote blocks", () => {
    const french = cleanEmailBody(
        "Merci pour votre réponse.\n\nLe dim. 28 juin 2026 à 06:00, Dorian a écrit :\nAncien message",
      );
    expect(french.cleanBody).toBe("Merci pour votre réponse.");
    expect(french.quotedContext).toBe("Ancien message");

    const english = cleanEmailBody(
        "Thanks for the update.\n\nOn Sun, June 28, 2026, Dorian wrote:\nOld message",
      );
    expect(english.cleanBody).toBe("Thanks for the update.");
    expect(english.quotedContext).toBe("Old message");
  });

  it("extracts the latest quoted message after a confidentiality notice", () => {
    const result = cleanEmailBody(
      [
        "Voici la réponse de Dorian.",
        "",
        "NOTE DE CONFIDENTIALITÉ: contenu légal",
        "",
        "________________________________",
        "De : Client <client@example.test>",
        "Envoyé : dimanche",
        "À : Dorian <support@example.test>",
        "Objet : Question",
        "Bonjour, quels sont vos horaires ?",
        "",
        "Cordialement,",
        "Client",
      ].join("\n"),
    );

    expect(result.cleanBody).toBe("Voici la réponse de Dorian.");
    expect(result.quotedContext).toBe("Bonjour, quels sont vos horaires ?");
  });

  it("removes confidentiality notices and everything after them", () => {
    const result = cleanEmailBody(
      "Voici ma réponse.\n\nNOTE DE CONFIDENTIALITÉ: Ce courriel contient de l’information confidentielle.",
    );

    expect(result.cleanBody).toBe("Voici ma réponse.");
    expect(result.removalReasons).toContain("CONFIDENTIALITY_NOTICE");
  });

  it("removes standard signatures and mobile footers", () => {
    expect(
      cleanEmailBody("I can attend tomorrow.\n\n-- \nAlex\nCompany").cleanBody,
    ).toBe("I can attend tomorrow.");

    expect(
      cleanEmailBody("Oui, cela me convient.\n\nEnvoyé de mon iPhone").cleanBody,
    ).toBe("Oui, cela me convient.");
  });

  it("removes a generic professional signature without a named rule", () => {
    const result = cleanEmailBody(
      [
        "Parfait, je confirme votre inscription.",
        "D",
        "",
        "[cid:logo.png] <https://gallery.example>",
        "Alex Example - Executive Director",
        "Cultural programs and exhibitions",
        "514.555.0100",
        "163 Main Street, Montréal",
      ].join("\n"),
    );

    expect(result.cleanBody).toBe("Parfait, je confirme votre inscription.");
    expect(result.removalReasons).toContain("SIGNATURE");
  });

  it("keeps a useful response link before a professional signature", () => {
    const result = cleanEmailBody(
      [
        "Use this checkout link:",
        "https://example.test/checkout/123",
        "",
        "<https://gallery.example>",
        "Alex Example - Director",
        "514.555.0100",
      ].join("\n"),
    );

    expect(result.cleanBody).toBe(
      "Use this checkout link:\nhttps://example.test/checkout/123",
    );
  });

  it("removes a trailing sign-off only when it has signature content", () => {
    expect(
      cleanEmailBody(
        "Thank you for confirming the appointment.\n\nKind regards,\nAlex\nCustomer support",
      ).cleanBody,
    ).toBe("Thank you for confirming the appointment.");

    expect(
      cleanEmailBody("Votre inscription est confirmée.\n\nAu plaisir,\nD\nÉquipe support")
        .cleanBody,
    ).toBe("Votre inscription est confirmée.");

    expect(cleanEmailBody("Regards\nThis is the full message.").cleanBody).toBe(
      "Regards\nThis is the full message.",
    );
  });

  it("removes quoted lines and CID artifacts without deleting useful links", () => {
    const result = cleanEmailBody(
      "See https://example.com/help [cid:image001.png]\n> previous answer\nMy answer",
    );

    expect(result.cleanBody).toBe("See https://example.com/help\nMy answer");
    expect(result.quotedContext).toBeNull();
    expect(result.removalReasons).toEqual([
      "QUOTED_HISTORY",
      "INLINE_ARTIFACT",
    ]);
  });
});
