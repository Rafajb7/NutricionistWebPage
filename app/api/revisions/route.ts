import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { listRevisionRowsForUser } from "@/lib/google/sheets";
import { toRevisionEntry } from "@/lib/revisions";
import { logError } from "@/lib/logger";

const querySchema = z.object({
  date: z.string().optional(),
  q: z.string().optional()
});

export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const parsedQuery = querySchema.safeParse({
      date: req.nextUrl.searchParams.get("date") ?? undefined,
      q: req.nextUrl.searchParams.get("q") ?? undefined
    });

    if (!parsedQuery.success) {
      return NextResponse.json({ error: "Invalid query." }, { status: 400 });
    }

    const rows = await listRevisionRowsForUser(auth.session.username);
    const entries = rows
      .map(toRevisionEntry)
      .filter((entry) => {
        if (parsedQuery.data.date && entry.fecha !== parsedQuery.data.date) {
          return false;
        }
        if (parsedQuery.data.q) {
          const q = parsedQuery.data.q.toLowerCase();
          return (
            entry.pregunta.toLowerCase().includes(q) ||
            entry.respuesta.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    return NextResponse.json({ revisions: entries });
  } catch (error) {
    logError("Failed to read revisions", error);
    return NextResponse.json({ error: "Could not load revisions." }, { status: 500 });
  }
}
