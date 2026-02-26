import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { downloadDriveFile } from "@/lib/google/drive";
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

export async function GET(req: Request, context: RouteContext) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  const { fileId } = await context.params;
  if (!isValidDriveId(fileId)) {
    return NextResponse.json({ error: "Invalid file id." }, { status: 400 });
  }

  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";

  try {
    const file = await downloadDriveFile(fileId);
    const fileName = sanitizeFileName(file.name);
    const disposition = download ? "attachment" : "inline";

    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `${disposition}; filename="${fileName}"`,
        "Cache-Control": "private, max-age=300"
      }
    });
  } catch (error) {
    logError("Failed to read nutrition plan PDF", { fileId, error });
    return NextResponse.json({ error: "Could not read nutrition plan PDF." }, { status: 500 });
  }
}
