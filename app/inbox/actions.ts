"use server";

import { revalidatePath } from "next/cache";

import { MockAIProvider } from "@/lib/ai/mock-provider";
import {
  confirmAndSimulateSend,
  correctAndResumeProcessing,
  runAutomaticProcessing,
  runThreadAutomation,
  simulateForwardToDiscord,
  submitManualAnswer,
} from "@/lib/processing/service";

export type InboxActionState = { status: "idle" | "success" | "error"; message: string };

const provider = new MockAIProvider();

export async function runClassificationAction(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  try {
    await runThreadAutomation(formData.get("threadId"), provider);
    revalidatePath("/inbox");
    return { status: "success", message: "Automatic processing completed with the Mock provider." };
  } catch (error) {
    return { status: "error", message: safeMessage(error, "Classification could not be completed.") };
  }
}

export async function reviewClassificationAction(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  try {
    await correctAndResumeProcessing({
      classificationId: formData.get("classificationId"),
      category: formData.get("category"),
      note: formData.get("note"),
    }, provider);
    revalidatePath("/inbox");
    return { status: "success", message: "Classification feedback saved and routing resumed." };
  } catch (error) {
    return { status: "error", message: safeMessage(error, "The review could not be saved.") };
  }
}

export async function retryProcessingAction(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  try {
    await runAutomaticProcessing(formData.get("classificationId"), provider);
    revalidatePath("/inbox");
    return { status: "success", message: "Automatic processing retried." };
  } catch (error) {
    return { status: "error", message: safeMessage(error, "Automatic processing could not be completed.") };
  }
}

export async function confirmSimulatedSendAction(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  try {
    await confirmAndSimulateSend(formData.get("draftId"));
    revalidatePath("/inbox");
    return { status: "success", message: "Confirmed and marked simulated sent. No email was delivered." };
  } catch (error) {
    return { status: "error", message: safeMessage(error, "Simulated send could not be completed.") };
  }
}

export async function simulateDiscordForwardAction(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  try {
    await simulateForwardToDiscord(formData.get("classificationId"));
    revalidatePath("/inbox");
    return { status: "success", message: "Marked simulated forwarded. Discord was not contacted." };
  } catch (error) {
    return { status: "error", message: safeMessage(error, "Simulated forward could not be completed.") };
  }
}

export async function submitManualAnswerAction(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  try {
    await submitManualAnswer({
      classificationId: formData.get("classificationId"),
      body: formData.get("body"),
      createCandidate: formData.get("createCandidate") === "on",
    });
    revalidatePath("/inbox");
    return { status: "success", message: "Human answer saved and marked simulated sent. No email was delivered." };
  } catch (error) {
    return { status: "error", message: safeMessage(error, "The human answer could not be saved.") };
  }
}

function safeMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const allowed = [
    "no longer exists",
    "inbound message",
    "failed validation",
    "already been reviewed",
    "no longer ready",
    "waiting for a human answer",
    "Draft output",
    "Draft generation",
  ];
  return allowed.some((fragment) => error.message.includes(fragment)) ? error.message : fallback;
}
