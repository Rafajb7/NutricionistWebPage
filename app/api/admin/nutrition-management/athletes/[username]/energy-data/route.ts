import { NextResponse } from "next/server";
import { getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  listRevisionRowsForUser,
  readUsersFromSheetCached
} from "@/lib/google/sheets";
import { logError } from "@/lib/logger";

type RouteContext = {
  params: Promise<{
    username: string;
  }>;
};

type LatestMetric = {
  value: number;
  date: string;
  question: string;
} | null;

const CACHE_TTL_MS = 60_000;

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

function normalizeQuestion(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

function parseNumericAnswer(value: string): number | null {
  const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWeightQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  return (
    normalized.includes("peso medio") ||
    normalized === "peso" ||
    normalized.includes("peso corporal") ||
    normalized.includes("peso actual") ||
    normalized.includes("weight")
  );
}

function isBodyFatQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  return (
    normalized.includes("% grasa") ||
    normalized.includes("porcentaje grasa") ||
    normalized.includes("grasa corporal") ||
    normalized.includes("body fat") ||
    normalized.includes("fat percentage")
  );
}

async function loadEnergyData(username: string) {
  const targetUsername = normalizeUsername(username);
  if (!targetUsername) return null;

  const users = await readUsersFromSheetCached();
  const athlete = users.find(
    (user) => normalizeUsername(user.username) === targetUsername && user.permission === "user"
  );
  if (!athlete) return null;

  const revisionRows = await listRevisionRowsForUser(athlete.username);
  const sortedRows = [...revisionRows].sort((a, b) => b.fecha.localeCompare(a.fecha));

  const findLatestMetric = (predicate: (question: string) => boolean): LatestMetric => {
    for (const row of sortedRows) {
      if (!predicate(row.pregunta)) continue;
      const value = parseNumericAnswer(row.respuesta);
      if (value === null) continue;
      return {
        value,
        date: row.fecha,
        question: row.pregunta
      };
    }
    return null;
  };

  return {
    athlete: {
      username: targetUsername,
      name: athlete.name.trim(),
      email: athlete.email.trim(),
      birthDate: athlete.birthDate,
      sex: athlete.sex,
      heightCm: athlete.heightCm
    },
    latestRevision: {
      weightKg: findLatestMetric(isWeightQuestion),
      bodyFatPercent: findLatestMetric(isBodyFatQuestion)
    }
  };
}

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { username } = await context.params;
  const targetUsername = normalizeUsername(username);
  try {
    const data = await getOrSetMemoryCache(
      `nutrition-energy-data:${targetUsername}`,
      CACHE_TTL_MS,
      () => loadEnergyData(targetUsername)
    );
    if (!data) return NextResponse.json({ error: "Athlete not found." }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    logError("Failed to load athlete energy data", {
      username: auth.session.username,
      targetUsername,
      error
    });
    return NextResponse.json({ error: "Could not load athlete energy data." }, { status: 500 });
  }
}
