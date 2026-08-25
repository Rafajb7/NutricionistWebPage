import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { listNutritionManagementData } from "@/lib/google/nutrition-management";
import { readUsersFromSheet } from "@/lib/google/sheets";
import { logError } from "@/lib/logger";

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const [users, nutrition] = await Promise.all([
      readUsersFromSheet(),
      listNutritionManagementData()
    ]);
    const athletes = users
      .filter((user) => user.permission === "user")
      .map((user) => ({
        username: normalizeUsername(user.username),
        name: user.name.trim(),
        email: user.email.trim()
      }))
      .filter((user) => user.username)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    return NextResponse.json({
      athletes,
      foods: nutrition.foods,
      plans: nutrition.plans,
      restrictions: nutrition.restrictions
    });
  } catch (error) {
    logError("Failed to load nutrition management data", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not load nutrition management data." }, { status: 500 });
  }
}
