import { NextResponse } from "next/server";
import { getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { requireSession } from "@/lib/auth/require-session";
import { todayIsoDate } from "@/lib/finance/calculations";
import { calculateMakingWeightStatus, getCurrentMakingWeightValue } from "@/lib/making-weight";
import { listCompetitionEventsForUser } from "@/lib/google/calendar";
import {
  listPeakModeDailyLogsForUser,
  listRevisionRowsForUser
} from "@/lib/google/sheets";
import { isGoogleRateLimitError } from "@/lib/google/retry";
import { logError, logInfo } from "@/lib/logger";

const MAKING_WEIGHT_CACHE_TTL_MS = 2 * 60_000;

function getMakingWeightCacheKey(username: string): string {
  return `making-weight:${username.trim().toLowerCase()}`;
}

export async function GET() {
  const auth = await requireSession();
  if (!auth.session) return auth.response;
  if (auth.session.permission === "admin") {
    return NextResponse.json({ status: null, statuses: [] });
  }

  try {
    const data = await getOrSetMemoryCache(
      getMakingWeightCacheKey(auth.session.username),
      MAKING_WEIGHT_CACHE_TTL_MS,
      async () => {
        const [competitions, revisionRows, peakModeLogs] = await Promise.all([
          listCompetitionEventsForUser(auth.session.username),
          listRevisionRowsForUser(auth.session.username),
          listPeakModeDailyLogsForUser(auth.session.username).catch((error) => {
            if (isGoogleRateLimitError(error)) {
              logInfo("Making Weight peak logs skipped by Google Sheets quota", {
                username: auth.session.username
              });
              return [];
            }
            throw error;
          })
        ]);
        const today = todayIsoDate();
        const currentWeight = getCurrentMakingWeightValue({
          revisions: revisionRows,
          peakModeLogs
        });
        const statuses = competitions
          .filter((competition) => (competition.weighInDate || competition.date) >= today)
          .sort((a, b) => (a.weighInDate || a.date).localeCompare(b.weighInDate || b.date))
          .map((competition) =>
            calculateMakingWeightStatus({
              competition,
              currentWeightKg: currentWeight?.weightKg ?? null,
              currentWeightDate: currentWeight?.date ?? null,
              currentWeightSource: currentWeight?.source ?? null,
              fromDate: today
            })
          );

        return {
          status: statuses[0] ?? null,
          statuses,
          today
        };
      }
    );

    return NextResponse.json(data);
  } catch (error) {
    logError("Failed to load Making Weight status", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ status: null, statuses: [] }, { status: 200 });
  }
}
