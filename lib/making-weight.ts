import { todayIsoDate } from "@/lib/finance/calculations";
import type { CompetitionCalendarEvent } from "@/lib/google/calendar";
import type { PeakModeDailyLogRow } from "@/lib/google/sheets";
import type { RevisionEntry, RevisionRow } from "@/lib/google/types";

export type MakingWeightRiskLevel = "critical" | "moderate" | "none";

export type MakingWeightStatus = {
  competition: CompetitionCalendarEvent;
  currentWeightKg: number | null;
  currentWeightSource: "peak-mode" | "revision" | null;
  currentWeightDate: string | null;
  targetWeightKg: number | null;
  weightToCutKg: number | null;
  cutRatioPercent: number | null;
  daysUntilWeighIn: number | null;
  daysUntilCompetitionWeek: number | null;
  criticalThresholdPercent: number;
  moderateThresholdPercent: number;
  risk: MakingWeightRiskLevel;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function daysUntilDate(targetDate: string, fromDate = todayIsoDate()): number | null {
  const target = parseDateOnly(targetDate);
  const from = parseDateOnly(fromDate);
  if (!target || !from) return null;
  return Math.ceil((target.getTime() - from.getTime()) / MS_PER_DAY);
}

function interpolateThreshold(
  daysUntilWeighIn: number,
  points: Array<{ days: number; percent: number }>
): number {
  const sorted = [...points].sort((a, b) => a.days - b.days);
  if (daysUntilWeighIn <= sorted[0].days) return sorted[0].percent;
  if (daysUntilWeighIn >= sorted[sorted.length - 1].days) {
    return sorted[sorted.length - 1].percent;
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const next = sorted[index];
    if (daysUntilWeighIn > next.days) continue;
    const span = next.days - previous.days;
    const progress = span > 0 ? (daysUntilWeighIn - previous.days) / span : 0;
    return previous.percent + (next.percent - previous.percent) * progress;
  }

  return sorted[sorted.length - 1].percent;
}

export function getMakingWeightThresholds(daysUntilWeighIn: number | null): {
  criticalThresholdPercent: number;
  moderateThresholdPercent: number;
} {
  const days = daysUntilWeighIn === null ? 30 : Math.max(0, daysUntilWeighIn);
  return {
    criticalThresholdPercent: interpolateThreshold(days, [
      { days: 7, percent: 5 },
      { days: 15, percent: 7 },
      { days: 30, percent: 10 }
    ]),
    moderateThresholdPercent: interpolateThreshold(days, [
      { days: 7, percent: 2 },
      { days: 15, percent: 3 },
      { days: 30, percent: 3 }
    ])
  };
}

function parseNumber(value: unknown): number | null {
  const match = String(value ?? "")
    .replace(",", ".")
    .match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeQuestion(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

export function getLatestRevisionWeight(
  revisions: Array<RevisionEntry | RevisionRow>
): { weightKg: number; date: string } | null {
  const candidates = revisions
    .filter((entry) => normalizeQuestion(entry.pregunta).includes("peso"))
    .map((entry) => {
      const weightKg = parseNumber(entry.respuesta);
      if (weightKg === null || weightKg <= 0 || weightKg > 800) return null;
      return {
        weightKg,
        date: entry.fecha
      };
    })
    .filter((item): item is { weightKg: number; date: string } => Boolean(item))
    .sort((a, b) => b.date.localeCompare(a.date));

  return candidates[0] ?? null;
}

export function getLatestPeakModeWeight(
  logs: PeakModeDailyLogRow[]
): { weightKg: number; date: string } | null {
  const candidates = logs
    .filter((log) => Number.isFinite(log.pesoAyunasKg) && log.pesoAyunasKg > 0)
    .map((log) => ({
      weightKg: log.pesoAyunasKg,
      date: log.fecha
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return candidates[0] ?? null;
}

export function getCurrentMakingWeightValue(input: {
  revisions: Array<RevisionEntry | RevisionRow>;
  peakModeLogs?: PeakModeDailyLogRow[];
}): { weightKg: number; date: string; source: "peak-mode" | "revision" } | null {
  const revision = getLatestRevisionWeight(input.revisions);
  if (revision) return { ...revision, source: "revision" };
  const peak = getLatestPeakModeWeight(input.peakModeLogs ?? []);
  if (peak) return { ...peak, source: "peak-mode" };
  return null;
}

export function calculateMakingWeightStatus(input: {
  competition: CompetitionCalendarEvent;
  currentWeightKg: number | null;
  currentWeightDate?: string | null;
  currentWeightSource?: "peak-mode" | "revision" | null;
  fromDate?: string;
}): MakingWeightStatus {
  const currentWeightKg = input.currentWeightKg;
  const targetWeightKg = input.competition.targetWeightKg ?? null;
  const daysUntilWeighIn = daysUntilDate(
    input.competition.weighInDate || input.competition.date,
    input.fromDate ?? todayIsoDate()
  );
  const thresholds = getMakingWeightThresholds(daysUntilWeighIn);
  const hasWeights =
    currentWeightKg !== null &&
    targetWeightKg !== null &&
    currentWeightKg > 0 &&
    targetWeightKg > 0;
  let weightToCutKg: number | null = null;
  let cutRatioPercent: number | null = null;
  if (hasWeights) {
    weightToCutKg = Math.abs(currentWeightKg - targetWeightKg);
    cutRatioPercent = (100 * Math.abs(currentWeightKg - targetWeightKg)) / targetWeightKg;
  }
  let risk: MakingWeightRiskLevel = "none";
  if (hasWeights && cutRatioPercent !== null) {
    if (cutRatioPercent >= thresholds.criticalThresholdPercent) {
      risk = "critical";
    } else if (cutRatioPercent >= thresholds.moderateThresholdPercent) {
      risk = "moderate";
    }
  }

  return {
    competition: input.competition,
    currentWeightKg,
    currentWeightSource: input.currentWeightSource ?? null,
    currentWeightDate: input.currentWeightDate ?? null,
    targetWeightKg,
    weightToCutKg,
    cutRatioPercent,
    daysUntilWeighIn,
    daysUntilCompetitionWeek:
      daysUntilWeighIn === null ? null : daysUntilWeighIn - 7,
    criticalThresholdPercent: thresholds.criticalThresholdPercent,
    moderateThresholdPercent: thresholds.moderateThresholdPercent,
    risk
  };
}

export function getNearestMakingWeightStatus(input: {
  competitions: CompetitionCalendarEvent[];
  revisions: Array<RevisionEntry | RevisionRow>;
  peakModeLogs?: PeakModeDailyLogRow[];
  fromDate?: string;
}): MakingWeightStatus | null {
  const currentWeight = getCurrentMakingWeightValue({
    revisions: input.revisions,
    peakModeLogs: input.peakModeLogs
  });
  const today = input.fromDate ?? todayIsoDate();
  const upcoming = input.competitions
    .filter((competition) => (competition.weighInDate || competition.date) >= today)
    .sort((a, b) =>
      (a.weighInDate || a.date).localeCompare(b.weighInDate || b.date)
    )[0];
  if (!upcoming) return null;

  return calculateMakingWeightStatus({
    competition: upcoming,
    currentWeightKg: currentWeight?.weightKg ?? null,
    currentWeightDate: currentWeight?.date ?? null,
    currentWeightSource: currentWeight?.source ?? null,
    fromDate: today
  });
}
