import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { readUsersFromSheet } from "@/lib/google/sheets";
import { getEnv } from "@/lib/env";
import { logError, logInfo } from "@/lib/logger";

const loginSchema = z.object({
  username: z.string().min(2).max(80),
  password: z.string().min(1).max(200)
});

export async function POST(req: NextRequest) {
  try {
    const forwardedFor = req.headers.get("x-forwarded-for") ?? "unknown";
    const ip = forwardedFor.split(",")[0].trim();
    const rate = checkRateLimit({
      key: `login:${ip}`,
      limit: 8,
      windowMs: 15 * 60 * 1000
    });

    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000))
          }
        }
      );
    }

    const json = await req.json();
    const parsed = loginSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const { username, password } = parsed.data;
    const normalizedUsername = username.trim().replace(/^@/, "").toLowerCase();
    const users = await readUsersFromSheet();
    const user = users.find(
      (item) => item.username.trim().replace(/^@/, "").toLowerCase() === normalizedUsername
    );

    if (!user) {
      return NextResponse.json({ error: "Credenciales inválidas." }, { status: 401 });
    }

    const env = getEnv();
    const validPassword = await verifyPassword({
      candidate: password,
      stored: user.password,
      allowPlaintextFallback: env.ALLOW_PLAINTEXT_PASSWORDS === "true"
    });

    if (!validPassword) {
      return NextResponse.json({ error: "Credenciales inválidas." }, { status: 401 });
    }

    const token = await createSessionToken({
      username: user.username.trim().replace(/^@/, ""),
      name: user.name
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        username: user.username,
        name: user.name
      }
    });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: getEnv().SESSION_TTL_HOURS * 60 * 60
    });

    logInfo("User logged in", { username: user.username });
    return response;
  } catch (error) {
    logError("Login failed", error);
    return NextResponse.json({ error: "Server error." }, { status: 500 });
  }
}
