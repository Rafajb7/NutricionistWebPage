import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { canUserAccessPhotoFile, downloadDriveFile } from "@/lib/google/drive";
import { listRevisionRowsForUser } from "@/lib/google/sheets";
import { logError } from "@/lib/logger";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

function isValidDriveId(value: string): boolean {
  return /^[A-Za-z0-9_-]{10,}$/.test(value);
}

function sanitizeFileName(value: string): string {
  return value.replace(/["\r\n]+/g, "_");
}

function buildFileIdPatterns(fileId: string): RegExp[] {
  const escaped = fileId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`/api/photos/view/${escaped}`, "i"),
    new RegExp(`[?&]id=${escaped}(?:$|[&#])`, "i"),
    new RegExp(`/file/d/${escaped}(?:/|$)`, "i"),
    new RegExp(`/d/${escaped}(?:/|$)`, "i")
  ];
}

async function isFileReferencedInUserRevisions(username: string, fileId: string): Promise<boolean> {
  const rows = await listRevisionRowsForUser(username);
  const patterns = buildFileIdPatterns(fileId);
  return rows.some((row) => {
    const value = String(row.respuesta ?? "");
    return patterns.some((pattern) => pattern.test(value));
  });
}

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  const { fileId } = await context.params;
  if (!isValidDriveId(fileId)) {
    return NextResponse.json({ error: "Invalid file id." }, { status: 400 });
  }

  try {
    const canAccess = await canUserAccessPhotoFile({
      username: auth.session.username,
      name: auth.session.name,
      permission: auth.session.permission,
      fileId
    });
    if (!canAccess) {
      const hasRevisionReference =
        auth.session.permission === "admin"
          ? true
          : await isFileReferencedInUserRevisions(auth.session.username, fileId);
      if (!hasRevisionReference) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const file = await downloadDriveFile(fileId);
    const fileName = sanitizeFileName(file.name);

    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, max-age=600"
      }
    });
  } catch (error) {
    logError("Failed to stream Drive image", { fileId, error });
    return NextResponse.json({ error: "Could not load image." }, { status: 500 });
  }
}
