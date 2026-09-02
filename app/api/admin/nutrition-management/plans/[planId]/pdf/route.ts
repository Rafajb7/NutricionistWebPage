import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  buildNutritionPlanPdfFileName,
  getNutritionPlanById,
  getPublishedNutritionPlanSnapshot
} from "@/lib/google/nutrition-management";
import { renderNutritionPlanPdf } from "@/lib/nutrition/pdf";
import { getNutritionPdfSupportingData } from "@/lib/nutrition/pdf-supporting-data";
import { logError } from "@/lib/logger";

type RouteContext = {
  params: Promise<{
    planId: string;
  }>;
};

export const runtime = "nodejs";
export const maxDuration = 60;

function isValidId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,}$/.test(value);
}

async function parsePdfOptions(req: Request): Promise<{
  includeMacros: boolean;
  mode: "review" | "published";
}> {
  try {
    const body = (await req.json()) as { includeMacros?: unknown; mode?: unknown };
    return {
      includeMacros: body.includeMacros !== false,
      mode: body.mode === "published" ? "published" : "review"
    };
  } catch {
    return { includeMacros: true, mode: "review" };
  }
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { planId } = await context.params;
  if (!isValidId(planId)) {
    return NextResponse.json({ error: "Invalid plan id." }, { status: 400 });
  }

  try {
    const options = await parsePdfOptions(req);
    const plan =
      options.mode === "published"
        ? (await getPublishedNutritionPlanSnapshot(planId)) ?? (await getNutritionPlanById(planId))
        : await getNutritionPlanById(planId);
    if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

    const { comparisonPlans, roadmapSteps } = await getNutritionPdfSupportingData(plan, {
      username: auth.session.username,
      planId,
      action: "preview"
    });
    const pdf = await renderNutritionPlanPdf(plan, {
      comparisonPlans,
      includeMacros: options.includeMacros,
      roadmapSteps
    });
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
