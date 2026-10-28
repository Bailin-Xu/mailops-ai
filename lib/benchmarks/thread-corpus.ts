import type { ThreadPlanningMessage } from "@/lib/email/thread-reconstruction";
export const CORPUS_VERSION = "neutral-thread-corpus-v1";
export function corpusUuid(namespace: number, value: number) {
  return `${namespace.toString(16).padStart(8, "0")}-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}
export function generateThreadCorpus(size: number, deep = false): ThreadPlanningMessage[] {
  if (!Number.isInteger(size) || size < 10 || size > 100_000 || size % 10) throw new Error("Benchmark size must be a multiple of ten between 10 and 100000.");
  return Array.from({ length: size }, (_, i) => {
    const index = deep ? size - i : i + 1;
    const group = Math.floor(i / 10), position = i % 10;
    const internet = (n: number) => `<synthetic-${deep ? "deep" : "group"}-${n}@example.test>`;
    const inReplyTo = deep ? (i ? internet(i - 1) : null) : position ? internet(i - 1) : (group % 20 === 0 ? internet(i + 9) : null);
    const references = deep ? [] : position ? [internet(group * 10)] : [];
    if (!deep && position === 9 && group % 25 === 0) references.push(`<synthetic-missing-${group}@example.test>`);
    return { id: corpusUuid(1, index), threadId: corpusUuid(2, index), messageId: internet(i), inReplyTo, references,
      fingerprint: `synthetic-fingerprint-${deep ? "deep" : "normal"}-${i}`,
      sentAt: new Date(Date.UTC(2026, 0, 1) + i * 1000), createdAt: new Date("2026-01-01T00:00:00Z") };
  });
}
export function expectedCorpusGroups(size: number) {
  return Array.from({ length: size / 10 }, (_, group) => Array.from({ length: 10 }, (_, i) => corpusUuid(1, group * 10 + i + 1)).sort());
}
export function shuffled<T>(items: T[]) {
  let state = 123456789;
  const values = [...items];
  for (let i = values.length - 1; i > 0; i--) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const j = state % (i + 1); [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
