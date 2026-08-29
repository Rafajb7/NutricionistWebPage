import { z } from "zod";
import { NextResponse } from "next/server";
import { deleteMemoryCache, getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { requireAdminSession } from "@/lib/auth/require-session";
import { getComputedPaymentStatus, todayIsoDate } from "@/lib/finance/calculations";
import { DEFAULT_FINANCE_INVOICE_SETTINGS } from "@/lib/finance/types";
import { listStrengthGoalsForUser, listStrengthMarksForUser } from "@/lib/google/achievements";
import { listCompetitionEventsForUser } from "@/lib/google/calendar";
import { listNutritionPlanPdfsForUser } from "@/lib/google/drive";
import { listFinanceRecords } from "@/lib/google/finance";
import { isGoogleRateLimitError } from "@/lib/google/retry";
import {
  getAthleteRoadmapSteps,
  getAthletePrivateNotes,
  listNutritionManagementData,
  listNutritionMealCompletionsForAthlete,
  listNutritionPlansForAthlete,
  replaceAthleteRoadmapSteps,
  updateAthletePrivateNotes
} from "@/lib/google/nutrition-management";
import {
  listPeakModeDailyLogsForUser,
  listRevisionRowsForUser,
  listRoutineLogsForUser,
  readUsersFromSheetCached,
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
  privateNotes: z.string().max(6000).optional(),
  roadmapSteps: z
    .array(
      z.object({
        id: z.string().max(120).optional().default(""),
        title: z.string().min(1).max(120),
        description: z.string().max(600).optional().default(""),
        status: z.enum(["completed", "current", "pending"]).optional().default("pending"),
        startDate: z.string().max(20).optional().default(""),
        endDate: z.string().max(20).optional().default(""),
        position: z.coerce.number().int().min(0).max(1000).optional().default(0),
        createdAt: z.string().max(80).optional().default(""),
        updatedAt: z.string().max(80).optional().default("")
      })
    )
    .max(30)
    .optional()
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

function getAthleteProfileCacheKey(username: string): string {
  return `admin:athlete-profile:${normalizeUsername(username)}`;
}

async function resolveTargetUser(username: string) {
  const targetUsername = normalizeUsername(username);
  if (!isValidUsername(targetUsername)) return null;

  const users = await readUsersFromSheetCached();
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
    roadmapStepsResult,
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
    getAthleteRoadmapSteps(sourceUsername),
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
  const roadmapSteps = readSettled(roadmapStepsResult, [], "hoja de ruta");
  const privateNotes = readSettled(
    privateNotesResult,
    { athleteUsername: targetUsername, notes: "", updatedAt: "" },
    "notas privadas"
  );
  const mealCompletions = readSettled(mealCompletionsResult, [], "adherencia interactiva");
  const finance = readSettled(
    financeResult,
    {
      contracts: [],
      payments: [],
      expenses: [],
      invoices: [],
      invoiceSettings: DEFAULT_FINANCE_INVOICE_SETTINGS,
      planOptions: []
    },
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
      roadmapSteps,
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
    const profile = await getOrSetMemoryCache(getAthleteProfileCacheKey(username), 60_000, () =>
      loadAthleteProfile(username, auth.session.username)
    );
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

    if (parsed.data.roadmapSteps !== undefined) {
      await replaceAthleteRoadmapSteps({
        athleteUsername: targetUsername,
        steps: parsed.data.roadmapSteps
      });
    }

    deleteMemoryCache(getAthleteProfileCacheKey(targetUsername));
    const profile = await loadAthleteProfile(targetUsername, auth.session.username);
    logInfo("Athlete profile updated", {
      username: auth.session.username,
      targetUsername,
      userUpdated: Boolean(parsed.data.user),
      notesUpdated: parsed.data.privateNotes !== undefined,
      roadmapUpdated: parsed.data.roadmapSteps !== undefined
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
