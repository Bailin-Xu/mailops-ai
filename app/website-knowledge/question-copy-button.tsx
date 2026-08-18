"use client";

import { useState } from "react";

export function QuestionCopyButton({ question }: { question: string }) {
  const [copied, setCopied] = useState(false);

  async function copyQuestion() {
    try {
      await navigator.clipboard.writeText(question);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button className="web-question-copy" onClick={copyQuestion} type="button">
      {copied ? "Copied" : "Copy question"}
    </button>
  );
}
