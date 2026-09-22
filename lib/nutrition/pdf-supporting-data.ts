import {
  getAthleteRoadmapSteps,
  listNutritionPlansForAthlete
} from "@/lib/google/nutrition-management";
import { logError } from "@/lib/logger";
import type { AthleteRoadmapStep, NutritionPlanFull } from "@/lib/nutrition/types";

type PdfSupportingDataContext = Record<string, unknown>;

// Optional PDF sections must not hold up a download when Google is unavailable.
const SUPPORTING_DATA_TIMEOUT_MS = 2000;

async function withSupportingDataDeadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Nutrition PDF supporting data timed out."));
        }, SUPPORTING_DATA_TIMEOUT_MS);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getNutritionPdfSupportingData(
  plan: NutritionPlanFull,
  context: PdfSupportingDataContext = {}
): Promise<{
  comparisonPlans: NutritionPlanFull[];
  roadmapSteps: AthleteRoadmapStep[];
  partial: boolean;
}> {
  const [comparisonPlansResult, roadmapStepsResult] = await Promise.allSettled([
    withSupportingDataDeadline(listNutritionPlansForAthlete(plan.athleteUsername)),
    withSupportingDataDeadline(getAthleteRoadmapSteps(plan.athleteUsername))
  ]);

  const comparisonPlans =
    comparisonPlansResult.status === "fulfilled" && comparisonPlansResult.value.length
      ? comparisonPlansResult.value
      : [plan];
  const roadmapSteps = roadmapStepsResult.status === "fulfilled" ? roadmapStepsResult.value : [];

  if (comparisonPlansResult.status === "rejected") {
    logError("Failed to load nutrition PDF comparison plans", {
      ...context,
      athleteUsername: plan.athleteUsername,
      error: comparisonPlansResult.reason
    });
  }

  if (roadmapStepsResult.status === "rejected") {
    logError("Failed to load nutrition PDF roadmap steps", {
      ...context,
      athleteUsername: plan.athleteUsername,
      error: roadmapStepsResult.reason
    });
  }

  return {
    comparisonPlans,
    roadmapSteps,
    partial: comparisonPlansResult.status === "rejected" || roadmapStepsResult.status === "rejected"
  };
}
