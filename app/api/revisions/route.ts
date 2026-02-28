import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import {
  deleteRevisionRowsByDateForUser,
  listRevisionRowsForUser
} from "@/lib/google/sheets";
import { toRevisionEntry } from "@/lib/revisions";
import { deleteMemoryCache, getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { logError, logInfo } from "@/lib/logger";

const querySchema = z.object({
  date: z.string().optional(),
  q: z.string().optional()
});

const deleteSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const REVISION_CACHE_TTL_MS = 45_000;

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

    const cacheKey = `revisions:${auth.session.username.trim().toLowerCase()}`;
    const allEntries = await getOrSetMemoryCache(cacheKey, REVISION_CACHE_TTL_MS, async () => {
      const rows = await listRevisionRowsForUser(auth.session.username);
      return rows.map(toRevisionEntry).sort((a, b) => b.fecha.localeCompare(a.fecha));
    });

    const entries = allEntries
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
      });

    return NextResponse.json({ revisions: entries });
  } catch (error) {
    logError("Failed to read revisions", error);
    return NextResponse.json({ error: "Could not load revisions." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = deleteSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const deletedCount = await deleteRevisionRowsByDateForUser({
      username: auth.session.username,
      date: parsed.data.date
    });

    if (!deletedCount) {
      return NextResponse.json({ error: "Revision rows not found." }, { status: 404 });
    }

    const cacheKey = `revisions:${auth.session.username.trim().toLowerCase()}`;
    deleteMemoryCache(cacheKey);
    logInfo("Revision rows deleted by date", {
      username: auth.session.username,
      date: parsed.data.date,
      count: deletedCount
    });

    return NextResponse.json({ ok: true, count: deletedCount });
  } catch (error) {
    logError("Failed to delete revisions", error);
    return NextResponse.json({ error: "Could not delete revisions." }, { status: 500 });
  }
}
