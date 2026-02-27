import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { createPasswordResetToken, getPasswordVersion } from "@/lib/auth/password-reset-token";
import { getEnv } from "@/lib/env";
import { readUsersFromSheet } from "@/lib/google/sheets";
import { isSmtpConfigured, sendEmail } from "@/lib/email/smtp";
import { logError, logInfo } from "@/lib/logger";

const forgotSchema = z.object({
  identifier: z.string().min(2).max(120)
});

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function resolveBaseUrl(req: NextRequest): string {
  const env = getEnv();
  return env.APP_BASE_URL ?? req.nextUrl.origin;
}

function getSmtpErrorMessage(error: unknown): string {
  const maybe = error as {
    code?: string;
    responseCode?: number;
    response?: string;
    message?: string;
  };

  const response = maybe.response ?? "";
  const isAppPasswordError =
    maybe.code === "EAUTH" &&
    (maybe.responseCode === 534 ||
      response.includes("InvalidSecondFactor") ||
      response.toLowerCase().includes("application-specific password required"));

  if (isAppPasswordError) {
    return "Gmail rechazó el acceso SMTP. Debes usar una contraseña de aplicación (no la contraseña normal de la cuenta).";
  }

  if (maybe.code === "EAUTH") {
    return "No se pudo autenticar con SMTP. Revisa SMTP_USER y SMTP_PASS.";
  }

  return "No se pudo enviar el correo de restablecimiento.";
}

export async function POST(req: NextRequest) {
  try {
    const smtpConfigured = isSmtpConfigured();
    const isProduction = process.env.NODE_ENV === "production";

    if (!smtpConfigured && isProduction) {
      return NextResponse.json(
        {
          error:
            "El servicio de correo no está configurado. Define SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASS."
        },
        { status: 503 }
      );
    }

    const json = await req.json();
    const parsed = forgotSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const identifier = parsed.data.identifier.trim();
    const identifierUsername = normalizeUsername(identifier);
    const identifierEmail = normalizeEmail(identifier);

    const users = await readUsersFromSheet();
    const user = users.find((item) => {
      const sameUsername = normalizeUsername(item.username) === identifierUsername;
      const sameEmail = item.email && normalizeEmail(item.email) === identifierEmail;
      return sameUsername || sameEmail;
    });

    // Do not leak user existence.
    if (!user) {
      return NextResponse.json({ ok: true });
    }

    const token = await createPasswordResetToken({
      username: user.username.trim().replace(/^@/, ""),
      passwordVersion: getPasswordVersion(user.password)
    });

    const baseUrl = resolveBaseUrl(req).replace(/\/$/, "");
    const resetLink = `${baseUrl}/password/reset?token=${encodeURIComponent(token)}`;

    if (smtpConfigured && user.email) {
      try {
        await sendEmail({
          to: user.email,
          subject: "Restablecer contraseña",
          text: `Hola ${user.name},\n\nHas solicitado restablecer tu contraseña.\n\nPulsa este enlace para continuar:\n${resetLink}\n\nSi no lo solicitaste, ignora este correo.`,
          html: `
            <p>Hola ${user.name},</p>
            <p>Has solicitado restablecer tu contraseña.</p>
            <p><a href="${resetLink}">Pulsa aquí para restablecerla</a></p>
            <p>Si no lo solicitaste, ignora este correo.</p>
          `
        });

        logInfo("Password reset email sent", { username: user.username, email: user.email });
        return NextResponse.json({ ok: true });
      } catch (smtpError) {
        logError("Failed to send password reset email", smtpError);
        const message = getSmtpErrorMessage(smtpError);
        if (!isProduction) {
          return NextResponse.json({ ok: true, developmentResetLink: resetLink, warning: message });
        }
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }

    // Development fallback: allow testing reset flow without SMTP service.
    if (!isProduction) {
      logInfo("SMTP not configured, returning development reset link", { username: user.username });
      return NextResponse.json({ ok: true, developmentResetLink: resetLink });
    }

    // In production keep generic response if user has no email configured.
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Failed to send password reset email", error);
    return NextResponse.json({ error: "Could not process request." }, { status: 500 });
  }
}
