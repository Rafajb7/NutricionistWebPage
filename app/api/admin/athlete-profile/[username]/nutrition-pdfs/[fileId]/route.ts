import { NextResponse } from "next/server";
import { deleteMemoryCache } from "@/lib/cache/memory-cache";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  deleteDriveFileById,
  listNutritionPlanPdfsForUser
} from "@/lib/google/drive";
import { readUsersFromSheetCached } from "@/lib/google/sheets";
import { logError, logInfo } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 30;

type RouteContext = {
  params: Promise<{
    username: string;
    fileId: string;
  }>;
};

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

function isValidDriveId(value: string): boolean {
  return /^[A-Za-z0-9_-]{10,}$/.test(value);
}

function getAthleteProfileCacheKey(username: string): string {
  return `admin:athlete-profile:${normalizeUsername(username)}`;
}

export async function DELETE(_req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { username, fileId } = await context.params;
  const targetUsername = normalizeUsername(username);

  if (!isValidUsername(targetUsername)) {
    return NextResponse.json({ error: "Atleta no valido." }, { status: 400 });
  }
  if (!isValidDriveId(fileId)) {
    return NextResponse.json({ error: "PDF no valido." }, { status: 400 });
  }

  try {
    const users = await readUsersFromSheetCached();
    const targetUser = users.find(
      (user) => normalizeUsername(user.username) === targetUsername
    );
    if (!targetUser) {
      return NextResponse.json({ error: "Atleta no encontrado." }, { status: 404 });
    }

    const sourceUsername = sanitizeSourceUsername(targetUser.username);
    const pdfs = await listNutritionPlanPdfsForUser(sourceUsername);
    const targetPdf = pdfs.find((pdf) => pdf.id === fileId);

    if (!targetPdf) {
      deleteMemoryCache(getAthleteProfileCacheKey(targetUsername));
      return NextResponse.json({ error: "PDF no encontrado para este atleta." }, { status: 404 });
    }

    await deleteDriveFileById(fileId);
    deleteMemoryCache(getAthleteProfileCacheKey(targetUsername));

    const remainingPdfs = pdfs.filter((pdf) => pdf.id !== fileId);
    logInfo("Nutrition PDF deleted from athlete profile", {
      username: auth.session.username,
      targetUsername,
      fileId,
      fileName: targetPdf.name
    });

    return NextResponse.json({
      ok: true,
      deleted: targetPdf,
      pdfs: remainingPdfs
    });
  } catch (error) {
    logError("Failed to delete nutrition PDF from athlete profile", {
      username: auth.session.username,
      targetUsername,
      fileId,
      error
    });
    return NextResponse.json({ error: "No se pudo eliminar el PDF." }, { status: 500 });
  }
}
