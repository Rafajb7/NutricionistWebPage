import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { appendRevisionRows } from "@/lib/google/sheets";
import { buildRevisionRows } from "@/lib/revisions";
import { logError, logInfo } from "@/lib/logger";

const submitSchema = z.object({
  answers: z
    .array(
      z.object({
        question: z.string().min(1).max(400),
        answer: z.string().min(1).max(3000)
      })
    )
    .min(1)
});

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = submitSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const fecha = new Date().toISOString().slice(0, 10);
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
