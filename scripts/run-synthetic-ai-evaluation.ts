import "dotenv/config";

import { getConfiguredAIProvider } from "../lib/ai/provider-factory";
import { getDb } from "../lib/db";
import { ingestEml } from "../lib/email/ingestion";
import { getServerEnv } from "../lib/env";
import {
  buildSyntheticScenarioEml,
  evaluateSyntheticOutcome,
  syntheticInboxScenarios,
} from "../lib/evaluation/synthetic-inbox-scenarios";
import { runThreadAutomation } from "../lib/processing/service";

const db = getDb();
const provider = getConfiguredAIProvider();
const env = getServerEnv();

async function main() {
  if (!env.SHADOW_MODE || env.EXTERNAL_DELIVERY_ENABLED) {
    throw new Error("Synthetic evaluation requires Shadow Mode with external delivery disabled.");
  }

  const requestedIds = new Set(process.argv.slice(2));
  const scenarios = requestedIds.size
    ? syntheticInboxScenarios.filter((scenario) => requestedIds.has(scenario.id))
    : syntheticInboxScenarios;
  if (requestedIds.size && scenarios.length !== requestedIds.size) {
    throw new Error("Every requested synthetic scenario ID must exist.");
  }

  const results = [];

  for (const [index, scenario] of scenarios.entries()) {
    const ingestion = await ingestEml(
      buildSyntheticScenarioEml(scenario, index),
      `synthetic-evaluation-${scenario.id}.eml`,
      { db, ownedAddresses: ["support@example.test"] },
    );
    if (ingestion.status === "failed") {
      results.push({ id: scenario.id, cohort: scenario.cohort, passed: false, error: ingestion.error.code });
      continue;
    }

    const classification = await runThreadAutomation(ingestion.threadId, provider, db);
    const stored = await db.classification.findUniqueOrThrow({
      where: { id: classification.id },
      include: {
        aiExecution: true,
        drafts: {
          where: { status: { not: "SUPERSEDED" } },
          include: { aiExecution: true, knowledgeSources: true },
        },
      },
    });
    const actual = {
      processingStatus: stored.processingStatus,
      knowledgeMatchCount: stored.knowledgeMatchCount,
      draftCount: stored.drafts.length,
    };
    results.push({
      id: scenario.id,
      cohort: scenario.cohort,
      expectedStatuses: scenario.expectedStatuses,
      category: stored.aiCategory,
      confidence: stored.aiConfidence,
      reviewStatus: stored.reviewStatus,
      route: stored.route,
      ...actual,
      classificationTokens:
        (stored.aiExecution.inputTokens ?? 0) + (stored.aiExecution.outputTokens ?? 0),
      draftTokens: stored.drafts.reduce(
        (sum, draft) => sum + (draft.aiExecution?.inputTokens ?? 0) + (draft.aiExecution?.outputTokens ?? 0),
        0,
      ),
      passed: evaluateSyntheticOutcome(scenario, actual),
    });
  }

  console.log(JSON.stringify({
    provider: provider.id,
    model: provider.model,
    passed: results.filter((result) => result.passed).length,
    total: results.length,
    results,
  }, null, 2));
}

void main()
  .catch(() => {
    console.error("Synthetic AI evaluation could not be completed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
