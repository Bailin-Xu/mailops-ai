import { describe, expect, it } from "vitest";

import {
  buildThreadReconstructionPlan,
  type ThreadPlanningMessage,
} from "@/lib/email/thread-reconstruction";

const baseDate = new Date("2026-01-01T00:00:00.000Z");

describe("buildThreadReconstructionPlan", () => {
  it("groups chained replies and leaves unrelated messages standalone", () => {
    const messages = [
      message("a", "thread-a", "mail-a", null, [], 1),
      message("b", "thread-b", "mail-b", "mail-a", [], 2),
      message("c", "thread-c", "mail-c", "mail-b", ["mail-a", "mail-b"], 3),
      message("d", "thread-d", "mail-d", null, [], 4),
    ];

    const plan = buildThreadReconstructionPlan(messages);

    expect(plan.summary).toMatchObject({
      messages: 4,
      currentThreads: 4,
      plannedThreads: 2,
      multiMessageThreads: 1,
      standaloneThreads: 1,
      messagesToMove: 2,
      threadsToRemove: 2,
      incompleteThreads: 0,
      largestThreadSize: 3,
    });
    expect(plan.threads[0]).toMatchObject({
      retainedThreadId: "thread-a",
      messageIds: ["a", "b", "c"],
      isIncomplete: false,
    });
  });

  it("marks a component incomplete when declared references are missing", () => {
    const plan = buildThreadReconstructionPlan([
      message("a", "thread-a", "mail-a", "missing-parent", ["missing-root"], 1),
    ]);

    expect(plan.summary).toMatchObject({
      plannedThreads: 1,
      incompleteThreads: 1,
      missingReferenceOccurrences: 2,
      uniqueMissingReferences: 2,
    });
    expect(plan.threads[0]).toMatchObject({
      isIncomplete: true,
      missingReferenceCount: 2,
    });
  });

  it("handles cycles and self references without looping", () => {
    const plan = buildThreadReconstructionPlan([
      message("a", "thread-a", "mail-a", "mail-b", ["mail-a"], 1),
      message("b", "thread-b", "mail-b", "mail-a", [], 2),
    ]);

    expect(plan.summary).toMatchObject({
      plannedThreads: 1,
      multiMessageThreads: 1,
      matchedRelations: 1,
      selfReferencesIgnored: 1,
    });
  });

  it("produces the same plan regardless of input order", () => {
    const messages = [
      message("a", "thread-a", "mail-a", null, [], 1),
      message("b", "thread-b", "mail-b", "mail-a", [], 2),
      message("c", "thread-c", "mail-c", "mail-b", [], 3),
    ];

    expect(buildThreadReconstructionPlan(messages)).toEqual(
      buildThreadReconstructionPlan([...messages].reverse()),
    );
  });
});

function message(
  id: string,
  threadId: string,
  messageId: string | null,
  inReplyTo: string | null,
  references: string[],
  day: number,
): ThreadPlanningMessage {
  return {
    id,
    threadId,
    messageId,
    inReplyTo,
    references,
    sentAt: new Date(baseDate.getTime() + day * 24 * 60 * 60 * 1000),
    createdAt: baseDate,
  };
}
