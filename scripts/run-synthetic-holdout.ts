import "dotenv/config";

import { getConfiguredAIProvider } from "../lib/ai/provider-factory";
import { getDb } from "../lib/db";
import { ingestEml } from "../lib/email/ingestion";
import { getServerEnv } from "../lib/env";
import {
  buildSyntheticHoldoutEml,
  evaluateSyntheticHoldoutOutcome,
  syntheticHoldoutScenarios,
} from "../lib/evaluation/synthetic-holdout-scenarios";
import { runThreadAutomation } from "../lib/processing/service";

const db = getDb();
const provider = getConfiguredAIProvider();
const env = getServerEnv();

const classificationInclude = {
  aiExecution: true,
  drafts: {
    where: { status: { not: "SUPERSEDED" as const } },
    include: { aiExecution: true, knowledgeSources: true },
  },
} as const;

async function main() {
  if (!env.SHADOW_MODE || env.EXTERNAL_DELIVERY_ENABLED) {
    throw new Error("Synthetic holdout requires Shadow Mode with external delivery disabled.");
  }

  const results = [];

  for (const [index, scenario] of syntheticHoldoutScenarios.entries()) {
    const ingestion = await ingestEml(
      buildSyntheticHoldoutEml(scenario, index),
      `synthetic-holdout-${scenario.id}.eml`,
      { db, ownedAddresses: ["support@example.test"] },
    );
    if (ingestion.status === "failed") {
      results.push({ id: scenario.id, cohort: scenario.cohort, passed: false, error: ingestion.error.code });
      continue;
    }

    let stored = await db.classification.findFirst({
      where: { threadId: ingestion.threadId },
      orderBy: { createdAt: "desc" },
      include: classificationInclude,
    });
    const executedNow = stored === null;
    if (!stored) {
      const classification = await runThreadAutomation(ingestion.threadId, provider, db);
      stored = await db.classification.findUniqueOrThrow({
        where: { id: classification.id },
        include: classificationInclude,
      });
    }

    const actual = {
      processingStatus: stored.processingStatus,
      knowledgeMatchCount: stored.knowledgeMatchCount,
      draftCount: stored.drafts.length,
    };
    results.push({
      id: scenario.id,
      cohort: scenario.cohort,
      executedNow,
      promptVersion: stored.aiExecution.promptVersion,
      category: stored.aiCategory,
      confidence: stored.aiConfidence,
      reviewStatus: stored.reviewStatus,
      route: stored.route,
      ...actual,
      passed: evaluateSyntheticHoldoutOutcome(scenario, actual),
    });
  }

  console.log(JSON.stringify({
    provider: provider.id,
    model: provider.model,
    passed: results.filter((result) => result.passed).length,
    total: results.length,
    executedNow: results.filter((result) => "executedNow" in result && result.executedNow).length,
    results,
  }, null, 2));
}

void main()
  .catch(() => {
    console.error("Synthetic holdout could not be completed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
