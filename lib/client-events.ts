type ClientEventLevel = "info" | "warn" | "error";

export async function reportClientEvent(input: {
  category: string;
  message: string;
  level?: ClientEventLevel;
  path?: string;
  usernameHint?: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    await fetch("/api/client-events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      keepalive: true,
      body: JSON.stringify({
        category: input.category,
        message: input.message,
        level: input.level ?? "error",
        path: input.path ?? window.location.pathname,
        usernameHint: input.usernameHint,
        context: input.context
      })
    });
  } catch {
    // Best effort only.
  }
}

export async function readResponseErrorMessage(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.toLowerCase().includes("application/json")) {
      const json = (await response.json()) as { error?: string };
      return json.error?.trim() || fallbackMessage;
    }

    const text = (await response.text()).trim();
    if (!text) return fallbackMessage;
    return text.length > 220 ? `${text.slice(0, 217)}...` : text;
  } catch {
    return fallbackMessage;
  }
}
