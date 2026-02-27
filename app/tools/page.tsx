import { redirect } from "next/navigation";
import { ToolsShell } from "@/components/tools/tools-shell";
import { getSessionFromCookies } from "@/lib/auth/session";

export default async function ToolsPage() {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");

  return (
    <main className="min-h-screen bg-brand-gradient">
      <ToolsShell
        user={{
          username: session.username,
          name: session.name
        }}
      />
    </main>
  );
}

