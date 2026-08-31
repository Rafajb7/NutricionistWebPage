import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { createNutritionPlanForAthlete } from "@/lib/google/nutrition-management";
import { readUsersFromSheetCached } from "@/lib/google/sheets";
import { logError, logInfo } from "@/lib/logger";

const createPlanSchema = z.object({
  athleteUsername: z.string().min(1).max(120),
  name: z.string().min(1).max(120)
});

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export async function POST(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const parsed = createPlanSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const targetUsername = normalizeUsername(parsed.data.athleteUsername);
    const users = await readUsersFromSheetCached();
    const athlete = users.find((user) => normalizeUsername(user.username) === targetUsername);
    if (!athlete || athlete.permission !== "user") {
      return NextResponse.json({ error: "Athlete not found." }, { status: 404 });
    }

    const plan = await createNutritionPlanForAthlete({
      athleteUsername: athlete.username,
      athleteName: athlete.name,
      name: parsed.data.name
    });

    logInfo("Nutrition plan created", {
      username: auth.session.username,
      athleteUsername: targetUsername,
      planId: plan.id
    });

    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    logError("Failed to create nutrition plan", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not create nutrition plan." }, { status: 500 });
  }
}
