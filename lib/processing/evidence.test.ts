import { describe, expect, it } from "vitest";

import { draftInputSnapshotSchema } from "./evidence";

const snapshot = {
  schemaVersion: 1, threadId: "14d70f08-4f3f-4eec-8954-c4b65993741f",
  classificationId: "89974b51-f229-46d5-bd88-7a75a369b5a8", classificationRevisionAtStart: 1,
  inboundMessageId: "87594904-d07e-47eb-817b-9f33a22fc709", sourceContextHash: "a".repeat(64),
  subject: "Livraison", cleanBody: "Comment fonctionne la livraison ?", language: "fr",
  kind: "GROUNDED", factualGrounding: { revisionIds: ["ec43b224-e9aa-4318-a495-c87da1227d5c"] },
  style: { profile: "DORIAN_REFERENCE" },
};

describe("draft evidence contracts", () => {
  it("preserves French inputs and keeps factual revision references separate from style", () => {
    expect(draftInputSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(draftInputSnapshotSchema.safeParse({ ...snapshot, factualGrounding: { revisionIds: [] } }).success).toBe(false);
    expect(draftInputSnapshotSchema.safeParse({ ...snapshot, factualGrounding: undefined,
      style: { profile: "DORIAN_REFERENCE", revisionIds: snapshot.factualGrounding.revisionIds } }).success).toBe(false);
  });

  it("does not represent a human-authored response as knowledge-grounded", () => {
    const manual = { ...snapshot, kind: "HUMAN_AUTHORED", style: { profile: "HUMAN_AUTHORED" }, factualGrounding: { revisionIds: [] } };
    expect(draftInputSnapshotSchema.safeParse(manual).success).toBe(true);
    expect(draftInputSnapshotSchema.safeParse({ ...manual, factualGrounding: snapshot.factualGrounding }).success).toBe(false);
    expect(draftInputSnapshotSchema.safeParse({ ...snapshot, sourceContextHash: "missing" }).success).toBe(false);
  });
});
