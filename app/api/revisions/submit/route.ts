import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { appendRevisionRows } from "@/lib/google/sheets";
import { deleteMemoryCache } from "@/lib/cache/memory-cache";
import { buildRevisionRows } from "@/lib/revisions";
import { logError, logInfo } from "@/lib/logger";

const submitSchema = z.object({
  revisionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  answers: z
    .array(
      z.object({
        question: z.string().min(1).max(400),
        answer: z.string().min(1).max(3000)
      })
    )
    .min(1)
});

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = submitSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const fecha = parsed.data.revisionDate ?? getTodayDateString();
    const rows = buildRevisionRows({
      nombre: auth.session.name,
      usuario: auth.session.username,
      fecha,
      answers: parsed.data.answers.map((item) => ({
        pregunta: item.question,
        respuesta: item.answer
      }))
    });

    await appendRevisionRows(rows);
    deleteMemoryCache(`revisions:${auth.session.username.trim().toLowerCase()}`);
    logInfo("Revision answers stored", {
      username: auth.session.username,
      count: rows.length
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Failed to store revision answers", error);
    return NextResponse.json({ error: "Could not save revision." }, { status: 500 });
  }
}
