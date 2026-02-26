import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getDriveFileThumbnail } from "@/lib/google/drive";
import { logError } from "@/lib/logger";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

function isValidDriveId(value: string): boolean {
  return /^[A-Za-z0-9_-]{10,}$/.test(value);
}

function buildPdfPlaceholderSvg() {
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 620" role="img" aria-label="PDF">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#1c1c22"/>
      <stop offset="100%" stop-color="#111113"/>
    </linearGradient>
  </defs>
  <rect width="480" height="620" rx="24" fill="url(#bg)"/>
  <rect x="48" y="72" width="384" height="476" rx="18" fill="#0b0b0c" stroke="#30303a" />
  <rect x="84" y="130" width="180" height="52" rx="12" fill="#F7CC2F"/>
  <text x="174" y="164" text-anchor="middle" font-size="30" font-family="Arial, sans-serif" fill="#151515">PDF</text>
  <rect x="84" y="230" width="312" height="16" rx="8" fill="#3e3e49"/>
  <rect x="84" y="264" width="280" height="16" rx="8" fill="#343440"/>
  <rect x="84" y="298" width="312" height="16" rx="8" fill="#3e3e49"/>
  <rect x="84" y="332" width="250" height="16" rx="8" fill="#343440"/>
</svg>`.trim();
}

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  const { fileId } = await context.params;
  if (!isValidDriveId(fileId)) {
    return NextResponse.json({ error: "Invalid file id." }, { status: 400 });
  }

  try {
    const thumbnail = await getDriveFileThumbnail(fileId);
    if (thumbnail) {
      return new NextResponse(new Uint8Array(thumbnail.data), {
        headers: {
          "Content-Type": thumbnail.mimeType,
          "Cache-Control": "private, max-age=600"
        }
      });
    }
  } catch (error) {
    logError("Failed to read nutrition plan thumbnail", { fileId, error });
  }

  return new NextResponse(buildPdfPlaceholderSvg(), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, max-age=600"
    }
  });
}
