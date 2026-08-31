import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { listNutritionChangeRequests } from "@/lib/google/nutrition-management";
import { logError } from "@/lib/logger";

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const requests = await listNutritionChangeRequests({ status: "pending" });
    return NextResponse.json({ requests });
  } catch (error) {
    logError("Failed to list admin nutrition change requests", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not load change requests." }, { status: 500 });
  }
}
