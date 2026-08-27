import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  listNutritionChangeRequests,
  listNutritionManagementData
} from "@/lib/google/nutrition-management";
import { readUsersFromSheetCached } from "@/lib/google/sheets";
import { logError } from "@/lib/logger";

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const [usersResult, nutritionResult, changeRequestsResult] = await Promise.allSettled([
      readUsersFromSheetCached(),
      listNutritionManagementData(),
      listNutritionChangeRequests()
    ]);

    if (nutritionResult.status === "rejected") {
      throw nutritionResult.reason;
    }

    if (usersResult.status === "rejected") {
      logError("Failed to load users for nutrition management", {
        username: auth.session.username,
        error: usersResult.reason
      });
    }

    if (changeRequestsResult.status === "rejected") {
      logError("Failed to load nutrition change requests inside management payload", {
        username: auth.session.username,
        error: changeRequestsResult.reason
      });
    }

    const users = usersResult.status === "fulfilled" ? usersResult.value : [];
    const nutrition = nutritionResult.value;
    const changeRequests =
      changeRequestsResult.status === "fulfilled" ? changeRequestsResult.value : [];

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
      restrictions: nutrition.restrictions,
      changeRequests
    });
  } catch (error) {
    logError("Failed to load nutrition management data", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not load nutrition management data." }, { status: 500 });
  }
}
