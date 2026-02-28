import { z } from "zod";

const DEV_SESSION_SECRET = "dev-only-session-secret-change-me";

const envSchema = z.object({
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PROJECT_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_CLIENT_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID: z.string().optional(),
  GOOGLE_USERS_SHEET_NAME: z.string().default("Users"),
  GOOGLE_QUESTIONS_SHEET_NAME: z.string().default("Preguntas"),
  GOOGLE_REVISION_SHEET_NAME: z.string().default("Revisiones"),
  GOOGLE_REVISION_WORKSHEET_NAME: z.string().default("Revision"),
  GOOGLE_ROUTINE_SHEET_NAME: z.string().default("Rutinas"),
  GOOGLE_ROUTINE_EXERCISES_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_ROUTINE_LOGS_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_ROUTINE_EXERCISES_WORKSHEET_NAME: z.string().default("Ejercicios"),
  GOOGLE_ROUTINE_LOGS_WORKSHEET_NAME: z.string().default("Registro"),
  GOOGLE_ACHIEVEMENTS_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_ACHIEVEMENTS_SHEET_NAME: z.string().default("Logros"),
  GOOGLE_ACHIEVEMENTS_MARKS_WORKSHEET_NAME: z.string().default("Marcas"),
  GOOGLE_ACHIEVEMENTS_GOALS_WORKSHEET_NAME: z.string().default("Objetivos"),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().default("1G-QgvfDD-dqMPzjuaA71ii7t6aWn_prX"),
  GOOGLE_NUTRITION_PLANS_ROOT_FOLDER_ID: z
    .string()
    .default("1B9yxdQztuuyzTeQrRB-JOP58vHCJ5Mmf"),
  GOOGLE_COMPETITIONS_CALENDAR_ID: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().default(30),
  SESSION_SECRET: z.string().min(16).optional(),
  SESSION_TTL_HOURS: z.coerce.number().default(24),
  ALLOW_PLAINTEXT_PASSWORDS: z.enum(["true", "false"]).default("false"),
  ADMIN_MIGRATION_TOKEN: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().default(8)
});

type ParsedEnv = z.infer<typeof envSchema>;
export type AppEnv = ParsedEnv & {
  SESSION_SECRET: string;
};

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${parsed.error.message}`);
  }

  const isProduction = process.env.NODE_ENV === "production";
  const sessionSecret = parsed.data.SESSION_SECRET ?? (isProduction ? undefined : DEV_SESSION_SECRET);

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required in production.");
  }

  cachedEnv = {
    ...parsed.data,
    SESSION_SECRET: sessionSecret
  };
  return cachedEnv;
}
