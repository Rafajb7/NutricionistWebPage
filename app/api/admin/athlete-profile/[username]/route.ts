import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { getComputedPaymentStatus, todayIsoDate } from "@/lib/finance/calculations";
import { listStrengthGoalsForUser, listStrengthMarksForUser } from "@/lib/google/achievements";
import { listCompetitionEventsForUser } from "@/lib/google/calendar";
import { listNutritionPlanPdfsForUser } from "@/lib/google/drive";
import { listFinanceRecords } from "@/lib/google/finance";
import { isGoogleRateLimitError } from "@/lib/google/retry";
import {
  getAthletePrivateNotes,
  listNutritionManagementData,
  listNutritionMealCompletionsForAthlete,
  listNutritionPlansForAthlete,
  updateAthletePrivateNotes
} from "@/lib/google/nutrition-management";
import {
  listPeakModeDailyLogsForUser,
  listRevisionRowsForUser,
  listRoutineLogsForUser,
  readUsersFromSheet,
  updateUserInSheet
} from "@/lib/google/sheets";
import { logError, logInfo } from "@/lib/logger";
import { toRevisionEntry } from "@/lib/revisions";

type RouteContext = {
  params: Promise<{
    username: string;
  }>;
};

const patchSchema = z.object({
  user: z
    .object({
      name: z.string().min(2).max(120).optional(),
      email: z.union([z.string().email().max(200), z.literal("")]).optional(),
      permission: z.enum(["user", "admin"]).optional()
    })
    .optional(),
  privateNotes: z.string().max(6000).optional()
});

function decodeRouteValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeUsername(value: string): string {
  return decodeRouteValue(value).trim().replace(/^@/, "").toLowerCase();
}

function sanitizeSourceUsername(value: string): string {
  return value.trim().replace(/^@/, "");
}

function isValidUsername(value: string): boolean {
  return value.length >= 2 && value.length <= 120 && !/[\u0000-\u001F\u007F/\\]/.test(value);
}

async function resolveTargetUser(username: string) {
  const targetUsername = normalizeUsername(username);
  if (!isValidUsername(targetUsername)) return null;

  const users = await readUsersFromSheet();
  const targetUser = users.find(
    (user) => normalizeUsername(user.username) === targetUsername
  );
  if (!targetUser) return null;

  return {
    targetUsername,
    sourceUsername: sanitizeSourceUsername(targetUser.username),
    targetUser
  };
}

async function loadAthleteProfile(username: string, adminUsername: string) {
  const resolved = await resolveTargetUser(username);
  if (!resolved) return null;

  const { targetUsername, sourceUsername, targetUser } = resolved;

  const [
    revisionRowsResult,
    routineLogsResult,
    competitionsResult,
    marksResult,
    goalsResult,
    nutritionPdfsResult,
    nutritionManagementResult,
    nutritionPlansResult,
    privateNotesResult,
    mealCompletionsResult,
    financeResult
  ] = await Promise.allSettled([
    listRevisionRowsForUser(sourceUsername),
    listRoutineLogsForUser(sourceUsername),
    listCompetitionEventsForUser(sourceUsername, { includePast: true }),
    listStrengthMarksForUser(sourceUsername),
    listStrengthGoalsForUser(sourceUsername),
    listNutritionPlanPdfsForUser(sourceUsername),
    listNutritionManagementData(),
    listNutritionPlansForAthlete(sourceUsername),
    getAthletePrivateNotes(sourceUsername),
    listNutritionMealCompletionsForAthlete(sourceUsername),
    listFinanceRecords()
  ]);

  const warnings: string[] = [];
  function readSettled<T>(result: PromiseSettledResult<T>, fallback: T, label: string): T {
    if (result.status === "fulfilled") return result.value;
    warnings.push(label);
    if (isGoogleRateLimitError(result.reason)) {
      logInfo("Athlete profile partial data source skipped by Google Sheets quota", {
        username: adminUsername,
        targetUsername,
        label
      });
    } else {
      logError("Athlete profile partial data source failed", {
        username: adminUsername,
        targetUsername,
        label,
        error: result.reason
      });
    }
    return fallback;
  }

  const revisionRows = readSettled(revisionRowsResult, [], "revisiones");
  const routineLogs = readSettled(routineLogsResult, [], "rutinas");
  const competitions = readSettled(competitionsResult, [], "competiciones");
  const marks = readSettled(marksResult, [], "marcas");
  const goals = readSettled(goalsResult, [], "objetivos");
  const nutritionPdfs = readSettled(nutritionPdfsResult, [], "pdfs nutricionales");
  const nutritionManagement = readSettled(
    nutritionManagementResult,
    { foods: [], plans: [], restrictions: [] },
    "gestion nutricional"
  );
  const nutritionPlans = readSettled(nutritionPlansResult, [], "planes nutricionales");
  const privateNotes = readSettled(
    privateNotesResult,
    { athleteUsername: targetUsername, notes: "", updatedAt: "" },
    "notas privadas"
  );
  const mealCompletions = readSettled(mealCompletionsResult, [], "adherencia interactiva");
  const finance = readSettled(
    financeResult,
    { contracts: [], payments: [], planOptions: [] },
    "finanzas"
  );

  let peakModeLogs: Awaited<ReturnType<typeof listPeakModeDailyLogsForUser>> = [];
  try {
    peakModeLogs = await listPeakModeDailyLogsForUser(sourceUsername);
  } catch (error) {
    warnings.push("modo pico");
    if (isGoogleRateLimitError(error)) {
      logInfo("Peak mode logs skipped by Google Sheets quota for athlete profile", {
        username: adminUsername,
        targetUsername
      });
    } else {
      logError("Failed to load peak mode logs for athlete profile", {
        username: adminUsername,
        targetUsername,
        error
      });
    }
  }

  const athleteContracts = finance.contracts.filter(
    (contract) => normalizeUsername(contract.athleteUsername) === targetUsername
  );
  const athletePayments = finance.payments.filter(
    (payment) => normalizeUsername(payment.athleteUsername) === targetUsername
  );
  const today = todayIsoDate();
  const pendingPayments = athletePayments.filter((payment) => payment.status === "pending");
  const nextPayment =
    [...pendingPayments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;

  return {
    user: {
      username: targetUsername,
      name: targetUser.name.trim(),
      email: targetUser.email.trim(),
      permission: targetUser.permission
    },
    dashboard: {
      revisions: revisionRows.map(toRevisionEntry).sort((a, b) => b.fecha.localeCompare(a.fecha))
    },
    nutrition: {
      plans: nutritionPlans,
      currentPlan:
        nutritionPlans.find((plan) => plan.status === "published") ?? nutritionPlans[0] ?? null,
      restrictions: nutritionManagement.restrictions.filter(
        (restriction) => restriction.athleteUsername === targetUsername
      ),
      pdfs: nutritionPdfs
    },
    adherence: {
      mealCompletions: mealCompletions.slice(0, 180)
    },
    tools: {
      routines: routineLogs,
      competitions,
      peakModeLogs,
      achievements: {
        marks,
        goals
      }
    },
    finance: {
      contracts: athleteContracts,
      payments: athletePayments,
      summary: {
        activeContractsCount: athleteContracts.filter((contract) => contract.status === "active")
          .length,
        pendingCents: pendingPayments.reduce(
          (sum, payment) => sum + payment.expectedAmountCents,
          0
        ),
        overdueCount: athletePayments.filter(
          (payment) => getComputedPaymentStatus(payment, today) === "overdue"
        ).length,
        paidCents: athletePayments
          .filter((payment) => payment.status === "paid")
          .reduce((sum, payment) => sum + (payment.paidAmountCents || payment.expectedAmountCents), 0),
        nextPayment
      }
    },
    privateNotes,
    warnings
  };
}

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { username } = await context.params;
  try {
    const profile = await loadAthleteProfile(username, auth.session.username);
    if (!profile) return NextResponse.json({ error: "User not found." }, { status: 404 });
    return NextResponse.json({ profile });
  } catch (error) {
    logError("Failed to load athlete profile", {
      username: auth.session.username,
      targetUsername: username,
      error
    });
    return NextResponse.json({ error: "Could not load athlete profile." }, { status: 500 });
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { username } = await context.params;
  const targetUsername = normalizeUsername(username);

  try {
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const resolved = await resolveTargetUser(targetUsername);
    if (!resolved) return NextResponse.json({ error: "User not found." }, { status: 404 });

    if (
      parsed.data.user?.permission &&
      targetUsername === normalizeUsername(auth.session.username) &&
      parsed.data.user.permission !== "admin"
    ) {
      return NextResponse.json(
        { error: "You cannot remove your own admin permission." },
        { status: 400 }
      );
    }

    if (parsed.data.user) {
      await updateUserInSheet({
        username: targetUsername,
        name: parsed.data.user.name,
        email: parsed.data.user.email,
        permission: parsed.data.user.permission
      });
    }

    if (parsed.data.privateNotes !== undefined) {
      await updateAthletePrivateNotes({
        athleteUsername: targetUsername,
        notes: parsed.data.privateNotes
      });
    }

    const profile = await loadAthleteProfile(targetUsername, auth.session.username);
    logInfo("Athlete profile updated", {
      username: auth.session.username,
      targetUsername,
      userUpdated: Boolean(parsed.data.user),
      notesUpdated: parsed.data.privateNotes !== undefined
    });

    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    logError("Failed to update athlete profile", {
      username: auth.session.username,
      targetUsername,
      error
    });
    return NextResponse.json({ error: "Could not update athlete profile." }, { status: 500 });
  }
}
