"use client";

import { useActionState, useState } from "react";

import { splitCandidateAction } from "@/app/knowledge-candidates/actions";

type Segment = {
  title: string;
  canonicalQuestion: string;
  proposedAnswer: string;
};

const initialState: Awaited<ReturnType<typeof splitCandidateAction>> = {
  status: "idle",
  message: "",
};

export function CandidateSplitForm({
  candidateId,
  initialSegments,
}: {
  candidateId: string;
  initialSegments: Segment[];
}) {
  const [open, setOpen] = useState(false);
  const [segments, setSegments] = useState(initialSegments);
  const [state, action, pending] = useActionState(splitCandidateAction, initialState);

  function updateSegment(index: number, key: keyof Segment, value: string) {
    setSegments((current) =>
      current.map((segment, segmentIndex) =>
        segmentIndex === index ? { ...segment, [key]: value } : segment,
      ),
    );
  }

  function addSegment() {
    if (segments.length >= 10) return;
    setSegments((current) => [
      ...current,
      { title: `Question ${current.length + 1}`, canonicalQuestion: "", proposedAnswer: "" },
    ]);
  }

  function removeSegment(index: number) {
    if (segments.length <= 2) return;
    setSegments((current) => current.filter((_, segmentIndex) => segmentIndex !== index));
  }

  return (
    <section className={`candidate-split-card ${open ? "is-open" : ""}`}>
      <div className="candidate-split-intro">
        <div>
          <p>Multi-question source</p>
          <h3>One email can become several atomic candidates.</h3>
          <span>
            The original stays traceable. Each child returns to Pending Review and
            must be approved separately.
          </span>
        </div>
        <button onClick={() => setOpen((current) => !current)} type="button">
          {open ? "Close splitter" : `Review ${initialSegments.length} suggested splits`}
        </button>
      </div>

      {open ? (
        <form action={action} className="candidate-split-workspace">
          <input name="candidateId" type="hidden" value={candidateId} />
          <input name="segmentCount" type="hidden" value={segments.length} />
          <div className="candidate-split-rail" aria-hidden="true">
            <span>Combined source</span><b>→</b><strong>{segments.length} atomic candidates</strong>
          </div>
          <div className="candidate-split-segments">
            {segments.map((segment, index) => (
              <fieldset key={index}>
                <legend><span>{String(index + 1).padStart(2, "0")}</span> Child candidate</legend>
                <button disabled={segments.length <= 2 || pending} onClick={() => removeSegment(index)} type="button">Remove</button>
                <label><span>Title</span><input disabled={pending} maxLength={200} name={`title_${index}`} onChange={(event) => updateSegment(index, "title", event.target.value)} required value={segment.title} /></label>
                <label><span>Canonical question</span><textarea disabled={pending} maxLength={2000} name={`question_${index}`} onChange={(event) => updateSegment(index, "canonicalQuestion", event.target.value)} required rows={3} value={segment.canonicalQuestion} /></label>
                <label><span>Proposed answer <em>may stay empty for follow-up</em></span><textarea disabled={pending} maxLength={10000} name={`answer_${index}`} onChange={(event) => updateSegment(index, "proposedAnswer", event.target.value)} rows={3} value={segment.proposedAnswer} /></label>
              </fieldset>
            ))}
          </div>
          <div className="candidate-split-actions">
            <button disabled={pending || segments.length >= 10} onClick={addSegment} type="button">+ Add another question</button>
            <button disabled={pending} type="submit">{pending ? "Splitting…" : `Create ${segments.length} pending candidates`}</button>
          </div>
          <p className={`candidate-split-feedback is-${state.status}`} aria-live="polite">{state.message || "Submitting marks the combined candidate as rejected because its children replace it."}</p>
        </form>
      ) : null}
    </section>
  );
}
