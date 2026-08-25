import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { duplicateNutritionPlan } from "@/lib/google/nutrition-management";
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
    const plan = await duplicateNutritionPlan(planId);
    if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

    logInfo("Nutrition plan duplicated", {
      username: auth.session.username,
      sourcePlanId: planId,
      planId: plan.id
    });
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    logError("Failed to duplicate nutrition plan", {
      username: auth.session.username,
      planId,
      error
    });
    return NextResponse.json({ error: "Could not duplicate nutrition plan." }, { status: 500 });
  }
}
