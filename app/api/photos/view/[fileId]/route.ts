import { google } from "googleapis";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getGoogleAuth } from "@/lib/google/auth";
import { logError } from "@/lib/logger";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

function isValidDriveId(value: string): boolean {
  return /^[A-Za-z0-9_-]{10,}$/.test(value);
}

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  const { fileId } = await context.params;
  if (!isValidDriveId(fileId)) {
    return NextResponse.json({ error: "Invalid file id." }, { status: 400 });
  }

  try {
    const drive = google.drive({
      version: "v3",
      auth: getGoogleAuth(["https://www.googleapis.com/auth/drive.readonly"])
    });

    const [metadata, media] = await Promise.all([
      drive.files.get({
        fileId,
        fields: "mimeType,name"
      }),
      drive.files.get(
        {
          fileId,
          alt: "media"
        },
        {
          responseType: "arraybuffer"
        }
      )
    ]);

    const mimeType = metadata.data.mimeType ?? "application/octet-stream";
    const fileName = metadata.data.name ?? `${fileId}.bin`;
    const data = Buffer.from(media.data as ArrayBuffer);

    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, max-age=600"
      }
    });
  } catch (error) {
    logError("Failed to stream Drive image", { fileId, error });
    return NextResponse.json({ error: "Could not load image." }, { status: 500 });
  }
}
