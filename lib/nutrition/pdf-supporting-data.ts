import {
  getAthleteRoadmapSteps,
  listNutritionPlansForAthlete
} from "@/lib/google/nutrition-management";
import { logError } from "@/lib/logger";
import type { AthleteRoadmapStep, NutritionPlanFull } from "@/lib/nutrition/types";

type PdfSupportingDataContext = Record<string, unknown>;

export async function getNutritionPdfSupportingData(
  plan: NutritionPlanFull,
  context: PdfSupportingDataContext = {}
): Promise<{
  comparisonPlans: NutritionPlanFull[];
  roadmapSteps: AthleteRoadmapStep[];
}> {
  const [comparisonPlansResult, roadmapStepsResult] = await Promise.allSettled([
    listNutritionPlansForAthlete(plan.athleteUsername),
    getAthleteRoadmapSteps(plan.athleteUsername)
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

  return { comparisonPlans, roadmapSteps };
}
