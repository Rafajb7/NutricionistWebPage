import { NextResponse } from "next/server";
import { deleteMemoryCache } from "@/lib/cache/memory-cache";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  buildNutritionPlanPdfFileName,
  getNutritionPlanById,
  listNutritionPlansForAthlete,
  markNutritionPlanPublished
} from "@/lib/google/nutrition-management";
import { uploadNutritionPlanPdfForUser } from "@/lib/google/drive";
import { renderNutritionPlanPdf } from "@/lib/nutrition/pdf";
import { logError, logInfo } from "@/lib/logger";

type RouteContext = {
  params: Promise<{
    planId: string;
  }>;
};

function isValidId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,}$/.test(value);
}

export async function POST(_req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { planId } = await context.params;
  if (!isValidId(planId)) {
    return NextResponse.json({ error: "Invalid plan id." }, { status: 400 });
  }

  try {
    const plan = await getNutritionPlanById(planId);
    if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

    const comparisonPlans = await listNutritionPlansForAthlete(plan.athleteUsername);
    const pdf = await renderNutritionPlanPdf(plan, { comparisonPlans });
    const fileName = buildNutritionPlanPdfFileName(plan);
    const uploaded = await uploadNutritionPlanPdfForUser({
      username: plan.athleteUsername,
      originalFileName: fileName,
      mimeType: "application/pdf",
      buffer: pdf
    });
    const published = await markNutritionPlanPublished({
      planId,
      driveFileId: uploaded.id,
      fileName: uploaded.name,
      snapshot: plan
    });

    deleteMemoryCache(`nutrition-plans:${plan.athleteUsername.toLowerCase()}`);
    logInfo("Nutrition plan published", {
      username: auth.session.username,
      athleteUsername: plan.athleteUsername,
      planId,
      fileId: uploaded.id
    });

    return NextResponse.json({
      ok: true,
      plan: published,
      file: uploaded
    });
  } catch (error) {
    logError("Failed to publish nutrition plan", {
      username: auth.session.username,
      planId,
      error
    });
    return NextResponse.json({ error: "Could not publish nutrition plan." }, { status: 500 });
  }
}
