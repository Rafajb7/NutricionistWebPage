import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { hashPassword } from "@/lib/auth/password";
import {
  createUserInSheet,
  deleteUserFromSheetByUsername,
  readUsersFromSheet
} from "@/lib/google/sheets";
import { logError, logInfo } from "@/lib/logger";

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

const createUserSchema = z.object({
  name: z.string().min(2).max(120),
  username: z.string().min(2).max(80),
  email: z.string().email().max(200).optional(),
  password: z.string().min(8).max(200),
  permission: z.enum(["user", "admin"]).default("user")
});

const deleteUserSchema = z.object({
  username: z.string().min(2).max(80)
});

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const users = await readUsersFromSheet();
    const items = users
      .map((user) => ({
        username: normalizeUsername(user.username),
        name: user.name.trim(),
        email: user.email.trim(),
        permission: user.permission
      }))
      .filter((user) => user.username.length > 0)
      .sort((a, b) => a.username.localeCompare(b.username, "es"));

    return NextResponse.json({ users: items });
  } catch (error) {
    logError("Failed to list admin users", { username: auth.session.username, error });
    return NextResponse.json({ error: "Could not load users." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = createUserSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const normalizedUsername = normalizeUsername(parsed.data.username);
    const users = await readUsersFromSheet();
    const exists = users.some(
      (user) => normalizeUsername(user.username) === normalizedUsername
    );
    if (exists) {
      return NextResponse.json({ error: "Username already exists." }, { status: 409 });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    await createUserInSheet({
      name: parsed.data.name.trim(),
      username: normalizedUsername,
      email: parsed.data.email?.trim(),
      permission: parsed.data.permission,
      passwordHash
    });

    logInfo("Admin created user", {
      adminUsername: auth.session.username,
      username: normalizedUsername,
      permission: parsed.data.permission
    });

    return NextResponse.json({
      ok: true,
      user: {
        username: normalizedUsername,
        name: parsed.data.name.trim(),
        email: parsed.data.email?.trim() ?? "",
        permission: parsed.data.permission
      }
    });
  } catch (error) {
    logError("Failed to create admin user", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not create user." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = deleteUserSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const targetUsername = normalizeUsername(parsed.data.username);
    if (targetUsername === normalizeUsername(auth.session.username)) {
      return NextResponse.json(
        { error: "You cannot delete your own admin user." },
        { status: 400 }
      );
    }

    const deleted = await deleteUserFromSheetByUsername(targetUsername);
    if (!deleted) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    logInfo("Admin deleted user", {
      adminUsername: auth.session.username,
      username: targetUsername
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Failed to delete admin user", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not delete user." }, { status: 500 });
  }
}
