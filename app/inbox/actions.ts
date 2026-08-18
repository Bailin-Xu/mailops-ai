"use server";

import { revalidatePath } from "next/cache";

import { getConfiguredAIProvider } from "@/lib/ai/provider-factory";
import {
  confirmAndSimulateSend,
  correctAndResumeProcessing,
  runAutomaticProcessing,
  runThreadAutomation,
  simulateForwardToDiscord,
  submitManualAnswer,
} from "@/lib/processing/service";

export type InboxActionState = {
  status: "idle" | "success" | "error";
  message: string;
  completedAt: number;
};

const provider = getConfiguredAIProvider();

export async function runClassificationAction(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  try {
    await runThreadAutomation(formData.get("threadId"), provider);
    revalidatePath("/inbox");
    return actionResult("success", `Automatic processing completed with the ${provider.id} provider.`);
  } catch (error) {
    return actionResult("error", safeMessage(error, "Classification could not be completed."));
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
    return actionResult("success", "Classification feedback saved and routing resumed.");
  } catch (error) {
    return actionResult("error", safeMessage(error, "The review could not be saved."));
  }
}

export async function retryProcessingAction(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  try {
    await runAutomaticProcessing(formData.get("classificationId"), provider);
    revalidatePath("/inbox");
    return actionResult("success", "Automatic processing retried.");
  } catch (error) {
    return actionResult("error", safeMessage(error, "Automatic processing could not be completed."));
  }
}

export async function confirmSimulatedSendAction(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  try {
    await confirmAndSimulateSend({
      draftId: formData.get("draftId"),
      subject: formData.get("subject"),
      body: formData.get("body"),
      language: formData.get("language"),
    });
    revalidatePath("/inbox");
    return actionResult("success", "Confirmed and marked simulated sent. No email was delivered.");
  } catch (error) {
    return actionResult("error", safeMessage(error, "Simulated send could not be completed."));
  }
}

export async function simulateDiscordForwardAction(
  _previous: InboxActionState,
  formData: FormData,
): Promise<InboxActionState> {
  try {
    await simulateForwardToDiscord(formData.get("classificationId"));
    revalidatePath("/inbox");
    return actionResult("success", "Marked simulated forwarded. Discord was not contacted.");
  } catch (error) {
    return actionResult("error", safeMessage(error, "Simulated forward could not be completed."));
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
    return actionResult("success", "Human answer saved and marked simulated sent. No email was delivered.");
  } catch (error) {
    return actionResult("error", safeMessage(error, "The human answer could not be saved."));
  }
}

function actionResult(
  status: Exclude<InboxActionState["status"], "idle">,
  message: string,
): InboxActionState {
  return { status, message, completedAt: Date.now() };
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
