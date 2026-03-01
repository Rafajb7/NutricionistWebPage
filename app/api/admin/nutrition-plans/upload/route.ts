import { NextResponse } from "next/server";
import { deleteMemoryCache } from "@/lib/cache/memory-cache";
import { requireAdminSession } from "@/lib/auth/require-session";
import { readUsersFromSheet } from "@/lib/google/sheets";
import { uploadNutritionPlanPdfForUser } from "@/lib/google/drive";
import { logError, logInfo } from "@/lib/logger";

const MAX_PDF_UPLOAD_BYTES = 25 * 1024 * 1024;

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export async function POST(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const formData = await req.formData();
    const usernameRaw = formData.get("username");
    const filesRaw = formData.getAll("plans");
    const files = filesRaw.filter((item): item is File => item instanceof File);

    if (typeof usernameRaw !== "string" || !usernameRaw.trim()) {
      return NextResponse.json({ error: "Username is required." }, { status: 400 });
    }
    if (!files.length) {
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
    }

    const targetUsername = normalizeUsername(usernameRaw);
    const users = await readUsersFromSheet();
    const targetUser = users.find(
      (user) => normalizeUsername(user.username) === targetUsername
    );
    if (!targetUser) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const sourceUsername = targetUser.username.trim().replace(/^@/, "");
    const uploaded = [];

    for (const file of files) {
      const looksLikePdf =
        file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (!looksLikePdf) {
        return NextResponse.json(
          { error: `Only PDF files are allowed: ${file.name}` },
          { status: 400 }
        );
      }

      if (file.size > MAX_PDF_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: `File too large: ${file.name}` },
          { status: 400 }
        );
      }

      const uploadedFile = await uploadNutritionPlanPdfForUser({
        username: sourceUsername,
        originalFileName: file.name,
        mimeType: "application/pdf",
        buffer: Buffer.from(await file.arrayBuffer())
      });
      uploaded.push(uploadedFile);
    }

    deleteMemoryCache(`nutrition-plans:${sourceUsername.toLowerCase()}`);
    logInfo("Admin uploaded nutrition plans", {
      adminUsername: auth.session.username,
      targetUsername: sourceUsername,
      count: uploaded.length
    });

    return NextResponse.json({ ok: true, uploaded });
  } catch (error) {
    logError("Failed admin nutrition plan upload", {
      username: auth.session?.username,
      error
    });
    return NextResponse.json({ error: "Could not upload nutrition plans." }, { status: 500 });
  }
}

