import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { getEnv } from "@/lib/env";

type ServiceAccount = {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  token_uri: string;
};

function loadCredentialsFromEnv(): ServiceAccount | null {
  const env = getEnv();

  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    return parsed;
  }

  if (
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
    env.GOOGLE_SERVICE_ACCOUNT_PROJECT_ID &&
    env.GOOGLE_SERVICE_ACCOUNT_CLIENT_ID &&
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID
  ) {
    return {
      type: "service_account",
      project_id: env.GOOGLE_SERVICE_ACCOUNT_PROJECT_ID,
      private_key_id: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_ID,
      private_key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
      client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      client_id: env.GOOGLE_SERVICE_ACCOUNT_CLIENT_ID,
      token_uri: "https://oauth2.googleapis.com/token"
    };
  }

  return null;
}

function loadCredentialsFromFile(): ServiceAccount | null {
  const credentialPath = path.join(process.cwd(), "credentials.json");
  if (!fs.existsSync(credentialPath)) return null;
  const raw = fs.readFileSync(credentialPath, "utf8");
  return JSON.parse(raw) as ServiceAccount;
}

export function getGoogleAuth(scopes: string[]) {
  const credentials = loadCredentialsFromEnv() ?? loadCredentialsFromFile();
  if (!credentials) {
    throw new Error("Google service account credentials are missing.");
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes
  });
}
