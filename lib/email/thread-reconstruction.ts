import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

export type ThreadPlanningMessage = {
  id: string;
  threadId: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  sentAt: Date | null;
  createdAt: Date;
  fingerprint?: string;
};

export type PlannedThread = {
  retainedThreadId: string;
  retainedMessageId: string;
  messageIds: string[];
  currentThreadIds: string[];
  isIncomplete: boolean;
  missingReferenceCount: number;
};

export type ThreadReconstructionPlan = {
  summary: {
    messages: number;
    currentThreads: number;
    plannedThreads: number;
    multiMessageThreads: number;
    standaloneThreads: number;
    messagesToMove: number;
    threadsToArchive: number;
    incompleteThreads: number;
    matchedRelations: number;
    missingReferenceOccurrences: number;
    uniqueMissingReferences: number;
    selfReferencesIgnored: number;
    largestThreadSize: number;
  };
  threads: PlannedThread[];
  threadIdsToArchive: string[];
};

export async function planThreadReconstruction(
  db: PrismaClient = getDb(),
): Promise<ThreadReconstructionPlan> {
  const messages = await db.emailMessage.findMany({
    select: {
      id: true,
      threadId: true,
      messageId: true,
      inReplyTo: true,
      references: true,
      sentAt: true,
      createdAt: true,
      fingerprint: true,
    },
    orderBy: { id: "asc" },
  });

  return buildThreadReconstructionPlan(messages);
}

export function buildThreadReconstructionPlan(
  messages: ThreadPlanningMessage[],
): ThreadReconstructionPlan {
  if (new Set(messages.map((m) => m.id)).size !== messages.length) throw new Error("Duplicate message identity in reconstruction.");
  const internetIds = messages.flatMap((m) => m.messageId ? [m.messageId] : []);
  if (new Set(internetIds).size !== internetIds.length) throw new Error("Duplicate Internet message identity in reconstruction.");
  const orderedMessages = [...messages].sort(compareMessages);
  const messagesById = new Map(orderedMessages.map((message) => [message.id, message]));
  const messagesByInternetId = new Map(
    orderedMessages.flatMap((message) =>
      message.messageId ? [[message.messageId, message] as const] : [],
    ),
  );
  const unionFind = new UnionFind(orderedMessages.map((message) => message.id));
  // Existing conversations are indivisible: never guess how historical records should be split.
  const firstByThread = new Map<string, string>();
  for (const message of orderedMessages) {
    const first = firstByThread.get(message.threadId);
    if (first) unionFind.union(first, message.id); else firstByThread.set(message.threadId, message.id);
  }
  const missingByMessage = new Map<string, number>();
  const uniqueMissingReferences = new Set<string>();
  const matchedEdges = new Set<string>();
  let missingReferenceOccurrences = 0;
  let selfReferencesIgnored = 0;

  for (const message of orderedMessages) {
    const declaredReferences = new Set([
      ...(message.inReplyTo ? [message.inReplyTo] : []),
      ...message.references,
    ]);

    for (const reference of declaredReferences) {
      const relatedMessage = messagesByInternetId.get(reference);

      if (!relatedMessage) {
        missingReferenceOccurrences += 1;
        uniqueMissingReferences.add(reference);
        missingByMessage.set(message.id, (missingByMessage.get(message.id) ?? 0) + 1);
        continue;
      }

      if (relatedMessage.id === message.id) {
        selfReferencesIgnored += 1;
        continue;
      }

      const edge = [message.id, relatedMessage.id].sort().join(":");
      matchedEdges.add(edge);
      unionFind.union(message.id, relatedMessage.id);
    }
  }

  const componentMessageIds = new Map<string, string[]>();
  for (const message of orderedMessages) {
    const root = unionFind.find(message.id);
    const component = componentMessageIds.get(root) ?? [];
    component.push(message.id);
    componentMessageIds.set(root, component);
  }

  const threads = [...componentMessageIds.values()]
    .map((ids): PlannedThread => {
      const componentMessages = ids
        .map((id) => messagesById.get(id))
        .filter((message): message is ThreadPlanningMessage => message !== undefined)
        .sort(compareMessages);
      const retainedMessage = componentMessages[0];

      if (!retainedMessage) {
        throw new Error("Thread reconstruction produced an empty component.");
      }

      const missingReferenceCount = componentMessages.reduce(
        (total, message) => total + (missingByMessage.get(message.id) ?? 0),
        0,
      );

      return {
        retainedThreadId: retainedMessage.threadId,
        retainedMessageId: retainedMessage.id,
        messageIds: componentMessages.map((message) => message.id),
        currentThreadIds: [...new Set(componentMessages.map((message) => message.threadId))].sort(),
        isIncomplete: missingReferenceCount > 0,
        missingReferenceCount,
      };
    })
    .sort((a, b) => {
      const aMessage = messagesById.get(a.retainedMessageId);
      const bMessage = messagesById.get(b.retainedMessageId);
      if (!aMessage || !bMessage) return a.retainedMessageId.localeCompare(b.retainedMessageId);
      return compareMessages(aMessage, bMessage);
    });

  const currentThreadIds = new Set(orderedMessages.map((message) => message.threadId));
  const retainedThreadIds = new Set(threads.map((thread) => thread.retainedThreadId));
  const threadIdsToArchive = [...currentThreadIds]
    .filter((threadId) => !retainedThreadIds.has(threadId))
    .sort();
  const messagesToMove = threads.reduce(
    (total, thread) =>
      total +
      thread.messageIds.filter(
        (messageId) => messagesById.get(messageId)?.threadId !== thread.retainedThreadId,
      ).length,
    0,
  );

  return {
    summary: {
      messages: orderedMessages.length,
      currentThreads: currentThreadIds.size,
      plannedThreads: threads.length,
      multiMessageThreads: threads.filter((thread) => thread.messageIds.length > 1).length,
      standaloneThreads: threads.filter((thread) => thread.messageIds.length === 1).length,
      messagesToMove,
      threadsToArchive: threadIdsToArchive.length,
      incompleteThreads: threads.filter((thread) => thread.isIncomplete).length,
      matchedRelations: matchedEdges.size,
      missingReferenceOccurrences,
      uniqueMissingReferences: uniqueMissingReferences.size,
      selfReferencesIgnored,
      largestThreadSize: Math.max(0, ...threads.map((thread) => thread.messageIds.length)),
    },
    threads,
    threadIdsToArchive,
  };
}

function compareMessages(a: ThreadPlanningMessage, b: ThreadPlanningMessage): number {
  if (a.sentAt && b.sentAt) {
    const sentDifference = a.sentAt.getTime() - b.sentAt.getTime();
    if (sentDifference !== 0) return sentDifference;
  } else if (a.sentAt) {
    return -1;
  } else if (b.sentAt) {
    return 1;
  }

  const stableIdentityDifference = (a.messageId ?? a.fingerprint ?? a.id).localeCompare(b.messageId ?? b.fingerprint ?? b.id);
  if (stableIdentityDifference) return stableIdentityDifference;
  const createdDifference = a.createdAt.getTime() - b.createdAt.getTime();
  return createdDifference !== 0 ? createdDifference : a.id.localeCompare(b.id);
}

class UnionFind {
  private readonly parent = new Map<string, string>();
  private readonly size = new Map<string, number>();
  constructor(ids: string[]) { ids.forEach((id) => { this.parent.set(id, id); this.size.set(id, 1); }); }
  find(id: string): string {
    if (!this.parent.has(id)) throw new Error("Unknown message in thread reconstruction.");
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    while (id !== root) { const parent = this.parent.get(id)!; this.parent.set(id, root); id = parent; }
    return root;
  }
  union(a: string, b: string): void {
    let aRoot = this.find(a), bRoot = this.find(b);
    if (aRoot === bRoot) return;
    if (this.size.get(aRoot)! < this.size.get(bRoot)! || (this.size.get(aRoot) === this.size.get(bRoot) && aRoot > bRoot)) [aRoot, bRoot] = [bRoot, aRoot];
    this.parent.set(bRoot, aRoot);
    this.size.set(aRoot, this.size.get(aRoot)! + this.size.get(bRoot)!);
  }
}
