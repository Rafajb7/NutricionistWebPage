import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getCommunityPostById } from "@/lib/google/community";
import {
  downloadDriveFile,
  getCommunityAttachmentMetadata
} from "@/lib/google/drive";
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

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  const { fileId } = await context.params;
  if (!isValidDriveId(fileId)) {
    return NextResponse.json({ error: "Invalid file id." }, { status: 400 });
  }

  try {
    const metadata = await getCommunityAttachmentMetadata(fileId);
    if (!metadata || metadata.trashed || metadata.fileType !== "community-attachment") {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }
    if (!metadata.postId) {
      return NextResponse.json({ error: "Invalid attachment metadata." }, { status: 404 });
    }

    const post = await getCommunityPostById(metadata.postId);
    if (!post) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }
    if (post.attachmentFileId !== fileId) {
      return NextResponse.json({ error: "Attachment mismatch." }, { status: 403 });
    }
    if (post.status !== "active" && auth.session.permission !== "admin") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const file = await downloadDriveFile(fileId);
    const fileName = sanitizeFileName(file.name);

    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, max-age=300"
      }
    });
  } catch (error) {
    logError("Failed to stream community attachment", {
      fileId,
      error
    });
    return NextResponse.json({ error: "Could not load attachment." }, { status: 500 });
  }
}
