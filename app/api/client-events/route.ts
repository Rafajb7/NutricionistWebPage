import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { recordAppEventLog } from "@/lib/google/sheets";

const clientEventSchema = z.object({
  category: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(1200),
  level: z.enum(["info", "warn", "error"]).optional(),
  path: z.string().trim().max(240).optional(),
  usernameHint: z.string().trim().max(80).optional(),
  context: z.record(z.string(), z.unknown()).optional()
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = clientEventSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const session = await getSessionFromCookies();
    const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
    const ip = forwardedFor.split(",")[0]?.trim() ?? "";
    const userAgent = req.headers.get("user-agent") ?? "";

    await recordAppEventLog({
      category: parsed.data.category,
      level: parsed.data.level,
      message: parsed.data.message,
      path: parsed.data.path,
      username: session?.username ?? parsed.data.usernameHint,
      context: {
        ...(parsed.data.context ?? {}),
        ip,
        userAgent: userAgent.slice(0, 500)
      }
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not store client event." }, { status: 500 });
  }
}
