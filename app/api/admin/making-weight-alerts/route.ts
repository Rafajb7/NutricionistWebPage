import { NextResponse } from "next/server";
import { getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { requireAdminSession } from "@/lib/auth/require-session";
import { todayIsoDate } from "@/lib/finance/calculations";
import {
  calculateMakingWeightStatus,
  getCurrentMakingWeightValue
} from "@/lib/making-weight";
import { listUpcomingCompetitionEventsForAdmin } from "@/lib/google/calendar";
import {
  listAllPeakModeDailyLogs,
  listAllRevisionRows,
  readUsersFromSheetCached
} from "@/lib/google/sheets";
import { isGoogleRateLimitError } from "@/lib/google/retry";
import { logError, logInfo } from "@/lib/logger";

const ADMIN_MAKING_WEIGHT_ALERTS_CACHE_KEY = "admin:making-weight-critical-alerts";
const ADMIN_MAKING_WEIGHT_ALERTS_CACHE_TTL_MS = 2 * 60_000;

type CriticalMakingWeightAlert = {
  username: string;
  athleteName: string;
  competitionId: string;
  competitionTitle: string;
  competitionDate: string;
  weighInDate: string;
  daysUntilWeighIn: number | null;
  cutRatioPercent: number | null;
  currentWeightKg: number | null;
  targetWeightKg: number | null;
};

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function addGroupedItem<T extends { usuario: string }>(
  map: Map<string, T[]>,
  item: T
): void {
  const username = normalizeUsername(item.usuario);
  if (!username) return;
  const list = map.get(username) ?? [];
  list.push(item);
  map.set(username, list);
}

async function loadCriticalAlerts(adminUsername: string): Promise<{
  alerts: CriticalMakingWeightAlert[];
  today: string;
  warnings: string[];
}> {
  const today = todayIsoDate();
  const [
    usersResult,
    competitionsResult,
    revisionRowsResult,
    peakModeLogsResult
  ] = await Promise.allSettled([
    readUsersFromSheetCached(),
    listUpcomingCompetitionEventsForAdmin(today),
    listAllRevisionRows(),
    listAllPeakModeDailyLogs()
  ]);

  const warnings: string[] = [];
  function readSettled<T>(result: PromiseSettledResult<T>, fallback: T, label: string): T {
    if (result.status === "fulfilled") return result.value;
    warnings.push(label);
    if (isGoogleRateLimitError(result.reason)) {
      logInfo("Making Weight admin alert source skipped by Google quota", {
        username: adminUsername,
        label
      });
    } else {
      logError("Making Weight admin alert source failed", {
        username: adminUsername,
        label,
        error: result.reason
      });
    }
    return fallback;
  }

  const users = readSettled(usersResult, [], "usuarios");
  const competitions = readSettled(competitionsResult, [], "competiciones");
  const revisionRows = readSettled(revisionRowsResult, [], "revisiones");
  const peakModeLogs = readSettled(peakModeLogsResult, [], "modo pico");

  const athletesByUsername = new Map(
    users
      .filter((user) => user.permission === "user")
      .map((user) => [normalizeUsername(user.username), user])
  );
  const revisionsByUsername = new Map<string, typeof revisionRows>();
  const peakModeLogsByUsername = new Map<string, typeof peakModeLogs>();

  revisionRows.forEach((row) => addGroupedItem(revisionsByUsername, row));
  peakModeLogs.forEach((row) => addGroupedItem(peakModeLogsByUsername, row));

  const criticalByUsername = new Map<string, CriticalMakingWeightAlert>();
  for (const competition of competitions) {
    const username = normalizeUsername(competition.username);
    const athlete = athletesByUsername.get(username);
    if (!athlete) continue;
    if ((competition.weighInDate || competition.date) < today) continue;

    const currentWeight = getCurrentMakingWeightValue({
      revisions: revisionsByUsername.get(username) ?? [],
      peakModeLogs: peakModeLogsByUsername.get(username) ?? []
    });
    const status = calculateMakingWeightStatus({
      competition,
      currentWeightKg: currentWeight?.weightKg ?? null,
      currentWeightDate: currentWeight?.date ?? null,
      currentWeightSource: currentWeight?.source ?? null,
      fromDate: today
    });

    if (status.risk !== "critical") continue;

    const alert: CriticalMakingWeightAlert = {
      username,
      athleteName: athlete.name || competition.displayName || username,
      competitionId: competition.id,
      competitionTitle: competition.title,
      competitionDate: competition.date,
      weighInDate: competition.weighInDate || competition.date,
      daysUntilWeighIn: status.daysUntilWeighIn,
      cutRatioPercent: status.cutRatioPercent,
      currentWeightKg: status.currentWeightKg,
      targetWeightKg: status.targetWeightKg
    };
    const existing = criticalByUsername.get(username);
    if (
      !existing ||
      (alert.daysUntilWeighIn ?? Number.POSITIVE_INFINITY) <
        (existing.daysUntilWeighIn ?? Number.POSITIVE_INFINITY)
    ) {
      criticalByUsername.set(username, alert);
    }
  }

  return {
    alerts: Array.from(criticalByUsername.values()).sort((a, b) => {
      const byDays =
        (a.daysUntilWeighIn ?? Number.POSITIVE_INFINITY) -
        (b.daysUntilWeighIn ?? Number.POSITIVE_INFINITY);
      if (byDays !== 0) return byDays;
      return a.athleteName.localeCompare(b.athleteName, "es");
    }),
    today,
    warnings
  };
}

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const data = await getOrSetMemoryCache(
      ADMIN_MAKING_WEIGHT_ALERTS_CACHE_KEY,
      ADMIN_MAKING_WEIGHT_ALERTS_CACHE_TTL_MS,
      () => loadCriticalAlerts(auth.session.username)
    );
    return NextResponse.json(data);
  } catch (error) {
    logError("Failed to load admin Making Weight alerts", {
      username: auth.session.username,
      error
    });
    return NextResponse.json(
      { alerts: [], today: todayIsoDate(), warnings: ["making weight"] },
      { status: 200 }
    );
  }
}
