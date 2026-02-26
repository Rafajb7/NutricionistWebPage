import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";

export async function requireSession() {
  const session = await getSessionFromCookies();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    };
  }
  return { session, response: null };
}
