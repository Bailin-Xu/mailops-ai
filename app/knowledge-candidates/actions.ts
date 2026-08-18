"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import {
  approvePendingCandidatesInView,
  saveCandidateReview,
} from "@/lib/knowledge/candidate-review";
import { splitKnowledgeCandidate } from "@/lib/knowledge/candidate-split";

type CandidateActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function reviewCandidateAction(
  _previousState: CandidateActionState,
  formData: FormData,
): Promise<CandidateActionState> {
  try {
    const result = await saveCandidateReview({
      candidateId: formData.get("candidateId"),
      decision: formData.get("decision"),
      title: formData.get("title"),
      canonicalQuestion: formData.get("canonicalQuestion"),
      answer: formData.get("answer"),
      category: formData.get("category"),
      language: formData.get("language"),
      note: formData.get("note"),
    });
    revalidatePath("/knowledge-candidates");
    return {
      status: "success",
      message:
        result.status === "APPROVED"
          ? "Candidate approved. Its knowledge entry is now active."
          : "Candidate rejected and excluded from active knowledge.",
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof ZodError
          ? (error.issues[0]?.message ?? "Check the reviewed content.")
          : "The candidate decision could not be saved. Refresh and try again.",
    };
  }
}

export async function bulkApproveCandidatesAction(
  _previousState: CandidateActionState,
  formData: FormData,
): Promise<CandidateActionState> {
  try {
    const result = await approvePendingCandidatesInView({
      source: formData.get("source"),
      q: formData.get("q"),
      confirmed: formData.get("confirmed"),
    });
    revalidatePath("/knowledge-candidates");
    return {
      status: "success",
      message:
        result.approved === 0
          ? "No pending candidates matched this view."
          : `${result.approved} candidates approved and activated.`,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof ZodError
          ? (error.issues[0]?.message ?? "Confirm the bulk approval first.")
          : "Bulk approval could not be completed. No partial changes were saved.",
    };
  }
}

export async function splitCandidateAction(
  _previousState: CandidateActionState,
  formData: FormData,
): Promise<CandidateActionState> {
  try {
    const segmentCount = Number(formData.get("segmentCount"));
    const segments = Number.isInteger(segmentCount)
      ? Array.from({ length: segmentCount }, (_, index) => ({
          title: formData.get(`title_${index}`),
          canonicalQuestion: formData.get(`question_${index}`),
          proposedAnswer: formData.get(`answer_${index}`),
        }))
      : [];
    const result = await splitKnowledgeCandidate({
      candidateId: formData.get("candidateId"),
      segments,
    });
    revalidatePath("/knowledge-candidates");
    return {
      status: "success",
      message: `${result.created} child candidates created for separate review.`,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof ZodError
          ? (error.issues[0]?.message ?? "Check every split question and answer.")
          : error instanceof Error && error.message.startsWith("Only a pending")
            ? error.message
            : "The candidate could not be split. No partial changes were saved.",
    };
  }
}
