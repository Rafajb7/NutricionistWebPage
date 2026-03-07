import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { listStrengthGoalsForUser, listStrengthMarksForUser } from "@/lib/google/achievements";
import { listCompetitionEventsForUser } from "@/lib/google/calendar";
import { listNutritionPlanPdfsForUser } from "@/lib/google/drive";
import {
  listPeakModeDailyLogsForUser,
  listRoutineLogsForUser,
  listRevisionRowsForUser,
  readUsersFromSheet
} from "@/lib/google/sheets";
import { toRevisionEntry } from "@/lib/revisions";
import { logError } from "@/lib/logger";

const querySchema = z.object({
  username: z.string().min(2).max(80)
});

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const parsed = querySchema.safeParse({
      username: req.nextUrl.searchParams.get("username") ?? ""
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query." }, { status: 400 });
    }

    const targetUsername = normalizeUsername(parsed.data.username);
    const users = await readUsersFromSheet();
    const targetUser = users.find(
      (user) => normalizeUsername(user.username) === targetUsername
    );
    if (!targetUser) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    const sourceUsername = targetUser.username.trim().replace(/^@/, "");

    const [revisionRows, routineLogs, competitions, marks, goals, nutritionPlans] =
      await Promise.all([
        listRevisionRowsForUser(sourceUsername),
        listRoutineLogsForUser(sourceUsername),
        listCompetitionEventsForUser(sourceUsername, { includePast: true }),
        listStrengthMarksForUser(sourceUsername),
        listStrengthGoalsForUser(sourceUsername),
        listNutritionPlanPdfsForUser(sourceUsername)
      ]);

    let peakModeLogs: Awaited<ReturnType<typeof listPeakModeDailyLogsForUser>> = [];
    try {
      peakModeLogs = await listPeakModeDailyLogsForUser(sourceUsername);
    } catch (error) {
      logError("Failed to load peak mode logs for admin user-data", {
        username: auth.session.username,
        targetUsername,
        error
      });
    }

    const revisions = revisionRows
      .map(toRevisionEntry)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    return NextResponse.json({
      user: {
        username: targetUsername,
        name: targetUser.name,
        permission: targetUser.permission
      },
      dashboard: {
        revisions
      },
      tools: {
        routines: routineLogs,
        competitions,
        peakModeLogs,
        nutritionPlans,
        achievements: {
          marks,
          goals
        }
      }
    });
  } catch (error) {
    logError("Failed to load admin user data", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not load user data." }, { status: 500 });
  }
}
