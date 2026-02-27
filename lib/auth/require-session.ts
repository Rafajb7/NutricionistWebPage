import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";

export async function requireSession(options?: {
  allowPasswordChangePending?: boolean;
}) {
  const session = await getSessionFromCookies();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    };
  }

  if (session.mustChangePassword && !options?.allowPasswordChangePending) {
    return {
      session: null,
      response: NextResponse.json(
        { error: "Password change required.", code: "PASSWORD_CHANGE_REQUIRED" },
        { status: 403 }
      )
    };
  }

  return { session, response: null };
}
