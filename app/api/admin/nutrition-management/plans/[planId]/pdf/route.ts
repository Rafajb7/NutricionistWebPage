import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  buildNutritionPlanPdfFileName,
  getNutritionPlanById,
  listNutritionPlansForAthlete
} from "@/lib/google/nutrition-management";
import { renderNutritionPlanPdf } from "@/lib/nutrition/pdf";
import { logError } from "@/lib/logger";

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

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    logError("Failed to generate nutrition plan preview PDF", {
      username: auth.session.username,
      planId,
      error
    });
    return NextResponse.json({ error: "Could not generate PDF." }, { status: 500 });
  }
}
