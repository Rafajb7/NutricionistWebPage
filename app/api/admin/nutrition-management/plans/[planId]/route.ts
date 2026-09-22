import { NextResponse } from "next/server";
import { deleteMemoryCache } from "@/lib/cache/memory-cache";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  deleteNutritionPlanById,
  getNutritionPlanById,
  getPublishedNutritionPlanSnapshot,
  saveNutritionPlan
} from "@/lib/google/nutrition-management";
import { deleteDriveFileById } from "@/lib/google/drive";
import { isGoogleRateLimitError, isGoogleTransientError } from "@/lib/google/retry";
import { nutritionPlanSaveSchema } from "@/lib/nutrition/validation";
import { logError, logInfo } from "@/lib/logger";

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

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { planId } = await context.params;
  if (!isValidId(planId)) {
    return NextResponse.json({ error: "Invalid plan id." }, { status: 400 });
  }

  try {
    const [plan, publishedPlan] = await Promise.all([
      getNutritionPlanById(planId),
      getPublishedNutritionPlanSnapshot(planId)
    ]);
    if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    return NextResponse.json({ plan, publishedPlan });
  } catch (error) {
    logError("Failed to load nutrition plan", { username: auth.session.username, planId, error });
    return NextResponse.json({ error: "Could not load nutrition plan." }, { status: 500 });
  }
}

export async function PUT(req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { planId } = await context.params;
  if (!isValidId(planId)) {
    return NextResponse.json({ error: "Invalid plan id." }, { status: 400 });
  }

  try {
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json(
        { error: "No se pudieron leer los datos del plan. Vuelve a intentar guardarlo.", code: "INVALID_PLAN" },
        { status: 400 }
      );
    }
    const parsed = nutritionPlanSaveSchema.safeParse(payload);
    if (!parsed.success || parsed.data.id !== planId) {
      const fields = parsed.success ? ["id"] : parsed.error.issues.map((issue) => issue.path.join("."));
      logError("Invalid nutrition plan save payload", { username: auth.session.username, planId, fields });
      return NextResponse.json({
        error: "Revisa los datos del plan: hay campos vacíos o valores fuera de los límites permitidos.",
        code: "INVALID_PLAN",
        fields
      }, { status: 400 });
    }

    const plan = await saveNutritionPlan(parsed.data);
    if (!plan) return NextResponse.json({ error: "No se encontró el plan nutricional.", code: "PLAN_NOT_FOUND" }, { status: 404 });

    logInfo("Nutrition plan saved", {
      username: auth.session.username,
      planId,
      status: plan.status
    });
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    const rateLimited = isGoogleRateLimitError(error);
    const temporarilyUnavailable = isGoogleTransientError(error);
    const code = rateLimited ? "GOOGLE_RATE_LIMIT" : temporarilyUnavailable ? "GOOGLE_UNAVAILABLE" : "SAVE_FAILED";
    logError("Failed to save nutrition plan", { username: auth.session.username, planId, code, error });
    return NextResponse.json({
      error: rateLimited
        ? "Google ha limitado temporalmente las solicitudes. Espera un momento y vuelve a guardar."
        : temporarilyUnavailable
          ? "No se pudo conectar con Google para guardar el plan. Vuelve a intentarlo en unos instantes."
          : "No se pudo guardar el plan nutricional. Vuelve a intentarlo.",
      code
    }, {
      status: rateLimited ? 429 : temporarilyUnavailable ? 503 : 500,
      headers: temporarilyUnavailable ? { "Retry-After": rateLimited ? "30" : "5" } : undefined
    });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { planId } = await context.params;
  if (!isValidId(planId)) {
    return NextResponse.json({ error: "Invalid plan id." }, { status: 400 });
  }

  try {
    const result = await deleteNutritionPlanById(planId);
    if (!result.deleted) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

    for (const fileId of result.fileIds) {
      try {
        await deleteDriveFileById(fileId);
      } catch (error) {
        logError("Failed to delete published nutrition PDF", { fileId, error });
      }
    }

    if (result.athleteUsername) {
      deleteMemoryCache(`nutrition-plans:${result.athleteUsername.toLowerCase()}`);
    }
    logInfo("Nutrition plan deleted", {
      username: auth.session.username,
      planId,
      fileCount: result.fileIds.length
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Failed to delete nutrition plan", { username: auth.session.username, planId, error });
    return NextResponse.json({ error: "Could not delete nutrition plan." }, { status: 500 });
  }
}
