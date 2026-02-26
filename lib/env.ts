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
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().default("1G-QgvfDD-dqMPzjuaA71ii7t6aWn_prX"),
  GOOGLE_NUTRITION_PLANS_ROOT_FOLDER_ID: z
    .string()
    .default("1B9yxdQztuuyzTeQrRB-JOP58vHCJ5Mmf"),
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
