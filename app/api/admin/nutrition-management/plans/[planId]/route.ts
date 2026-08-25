import { NextResponse } from "next/server";
import { deleteMemoryCache } from "@/lib/cache/memory-cache";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  deleteNutritionPlanById,
  getNutritionPlanById,
  saveNutritionPlan
} from "@/lib/google/nutrition-management";
import { deleteDriveFileById } from "@/lib/google/drive";
import { nutritionPlanSaveSchema } from "@/lib/nutrition/validation";
import { logError, logInfo } from "@/lib/logger";

type RouteContext = {
  params: Promise<{
    planId: string;
  }>;
};

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
    const plan = await getNutritionPlanById(planId);
    if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    return NextResponse.json({ plan });
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
    const parsed = nutritionPlanSaveSchema.safeParse(await req.json());
    if (!parsed.success || parsed.data.id !== planId) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const plan = await saveNutritionPlan(parsed.data);
    if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

    logInfo("Nutrition plan saved", {
      username: auth.session.username,
      planId,
      status: plan.status
    });
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    logError("Failed to save nutrition plan", { username: auth.session.username, planId, error });
    return NextResponse.json({ error: "Could not save nutrition plan." }, { status: 500 });
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
