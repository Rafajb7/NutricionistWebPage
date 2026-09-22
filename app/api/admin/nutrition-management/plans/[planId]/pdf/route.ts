import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  buildNutritionPlanPdfFileName,
  getNutritionPlanById,
  getPublishedNutritionPlanSnapshot
} from "@/lib/google/nutrition-management";
import { renderNutritionPlanPdf } from "@/lib/nutrition/pdf";
import { getNutritionPdfSupportingData } from "@/lib/nutrition/pdf-supporting-data";
import { nutritionPlanSaveSchema } from "@/lib/nutrition/validation";
import { isGoogleRateLimitError, isGoogleTransientError } from "@/lib/google/retry";
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

const pdfOptionsSchema = z.object({
  includeMacros: z.boolean().optional().default(true),
  mode: z.enum(["review", "published"]).optional().default("review"),
  plan: nutritionPlanSaveSchema.optional()
});

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { planId } = await context.params;
  if (!isValidId(planId)) {
    return NextResponse.json({ error: "Invalid plan id." }, { status: 400 });
  }

  try {
    const parsed = pdfOptionsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Revisa los datos del plan antes de generar el PDF.", code: "INVALID_PLAN" },
        { status: 400 }
      );
    }
    const options = parsed.data;
    if (options.plan && (
      options.mode !== "review" || options.plan.id !== planId || options.plan.status !== "review"
    )) {
      return NextResponse.json(
        { error: "El borrador no corresponde al plan solicitado.", code: "INVALID_PLAN" },
        { status: 400 }
      );
    }

    // A review PDF can use the validated editor contents even if saving to Google failed.
    // Published PDFs always come from persisted published data.
    const plan =
      options.mode === "published"
        ? await getPublishedNutritionPlanSnapshot(planId)
        : options.plan ?? await getNutritionPlanById(planId);
    if (!plan || (options.mode === "published" && plan.status !== "published")) {
      return NextResponse.json({ error: "No se encontró el plan solicitado." }, { status: 404 });
    }

    const { comparisonPlans, roadmapSteps, partial } = await getNutritionPdfSupportingData(plan, {
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
        "X-Nutrition-Pdf-Partial": String(partial),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    logError("Failed to generate nutrition plan preview PDF", {
      username: auth.session.username,
      planId,
      error
    });
    if (isGoogleRateLimitError(error)) {
      return NextResponse.json(
        { error: "Google ha limitado temporalmente las solicitudes. Inténtalo de nuevo en unos segundos.", code: "GOOGLE_RATE_LIMIT" },
        { status: 429, headers: { "Retry-After": "30" } }
      );
    }
    if (isGoogleTransientError(error)) {
      return NextResponse.json(
        { error: "Google no está disponible temporalmente. Inténtalo de nuevo en unos segundos.", code: "GOOGLE_UNAVAILABLE" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "No se pudo generar el PDF nutricional. Puedes volver a intentarlo.", code: "PDF_GENERATION_FAILED" },
      { status: 500 }
    );
  }
}
