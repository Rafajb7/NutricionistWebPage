import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  createNutritionAthleteRestriction,
  deleteNutritionAthleteRestriction
} from "@/lib/google/nutrition-management";
import { readUsersFromSheet } from "@/lib/google/sheets";
import { logError, logInfo } from "@/lib/logger";
import {
  nutritionAthleteRestrictionCreateSchema,
  nutritionAthleteRestrictionDeleteSchema
} from "@/lib/nutrition/validation";

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export async function POST(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const parsed = nutritionAthleteRestrictionCreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const targetUsername = normalizeUsername(parsed.data.athleteUsername);
    const users = await readUsersFromSheet();
    const athlete = users.find((user) => normalizeUsername(user.username) === targetUsername);
    if (!athlete || athlete.permission !== "user") {
      return NextResponse.json({ error: "Athlete not found." }, { status: 404 });
    }

    const restriction = await createNutritionAthleteRestriction({
      ...parsed.data,
      athleteUsername: targetUsername
    });

    logInfo("Nutrition athlete restriction created", {
      username: auth.session.username,
      athleteUsername: targetUsername,
      restrictionId: restriction.id
    });

    return NextResponse.json({ ok: true, restriction });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create restriction.";
    const status = message.includes("already exists") ? 409 : 500;
    logError("Failed to create nutrition athlete restriction", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const parsed = nutritionAthleteRestrictionDeleteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const restriction = await deleteNutritionAthleteRestriction(parsed.data.id);
    if (!restriction) return NextResponse.json({ error: "Restriction not found." }, { status: 404 });

    logInfo("Nutrition athlete restriction deleted", {
      username: auth.session.username,
      athleteUsername: restriction.athleteUsername,
      restrictionId: restriction.id
    });

    return NextResponse.json({ ok: true, restriction });
  } catch (error) {
    logError("Failed to delete nutrition athlete restriction", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not delete restriction." }, { status: 500 });
  }
}
