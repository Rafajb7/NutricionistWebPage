import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { hashPassword } from "@/lib/auth/password";
import { buildCreateFinanceContractInput } from "@/lib/finance/contract-input";
import { financeContractOnUserCreateSchema } from "@/lib/finance/validation";
import { createFinanceContractWithPayments, listFinanceRecords } from "@/lib/google/finance";
import { parseHeightCmInput } from "@/lib/athlete-profile";
import {
  createUserInSheet,
  deleteUserFromSheetByUsername,
  readUsersFromSheet,
  readUsersFromSheetCached
} from "@/lib/google/sheets";
import { logError, logInfo } from "@/lib/logger";

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

const optionalIsoDateSchema = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")])
  .optional()
  .default("");

const optionalHeightCmSchema = z.preprocess((value) => {
  const parsed = parseHeightCmInput(value);
  return parsed ?? (value === undefined || value === null || value === "" ? null : value);
}, z.number().min(50).max(260).nullable().optional().default(null));

const createUserSchema = z
  .object({
    name: z.string().min(2).max(120),
    username: z.string().min(2).max(80),
    email: z.string().email().max(200).optional(),
    password: z.string().min(8).max(200),
    permission: z.enum(["user", "admin"]).default("user"),
    birthDate: optionalIsoDateSchema,
    sex: z.enum(["", "male", "female"]).optional().default(""),
    heightCm: optionalHeightCmSchema,
    finance: financeContractOnUserCreateSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.permission !== "user") return;
    if (!value.birthDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["birthDate"],
        message: "Birth date is required for athletes."
      });
    }
    if (!value.sex) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sex"],
        message: "Sex is required for athletes."
      });
    }
    if (value.heightCm === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["heightCm"],
        message: "Height is required for athletes."
      });
    }
  });

const deleteUserSchema = z.object({
  username: z.string().min(2).max(80)
});

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const users = await readUsersFromSheetCached();
    const items = users
      .map((user) => ({
        username: normalizeUsername(user.username),
        name: user.name.trim(),
        email: user.email.trim(),
        permission: user.permission,
        birthDate: user.birthDate,
        sex: user.sex,
        heightCm: user.heightCm
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
    if (parsed.data.finance && parsed.data.permission !== "user") {
      return NextResponse.json(
        { error: "Finance data can only be assigned to athlete users." },
        { status: 400 }
      );
    }

    const financeInput = parsed.data.finance
      ? buildCreateFinanceContractInput({
          payload: {
            ...parsed.data.finance,
            athleteUsername: normalizedUsername
          },
          athlete: {
            username: normalizedUsername,
            name: parsed.data.name.trim()
          },
          planOptions: (await listFinanceRecords()).planOptions
        })
      : null;

    const passwordHash = await hashPassword(parsed.data.password);
    await createUserInSheet({
      name: parsed.data.name.trim(),
      username: normalizedUsername,
      email: parsed.data.email?.trim(),
      permission: parsed.data.permission,
      passwordHash,
      birthDate: parsed.data.birthDate,
      sex: parsed.data.sex,
      heightCm: parsed.data.heightCm
    });

    let financeWarning = "";
    if (financeInput) {
      try {
        await createFinanceContractWithPayments(financeInput);
      } catch (error) {
        financeWarning = "User was created, but finance data could not be saved.";
        logError("Failed to create finance data for new user", {
          adminUsername: auth.session.username,
          username: normalizedUsername,
          error
        });
      }
    }

    logInfo("Admin created user", {
      adminUsername: auth.session.username,
      username: normalizedUsername,
      permission: parsed.data.permission,
      withFinance: Boolean(financeInput && !financeWarning)
    });

    return NextResponse.json({
      ok: true,
      financeWarning,
      user: {
        username: normalizedUsername,
        name: parsed.data.name.trim(),
        email: parsed.data.email?.trim() ?? "",
        permission: parsed.data.permission,
        birthDate: parsed.data.birthDate,
        sex: parsed.data.sex,
        heightCm: parsed.data.heightCm
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
