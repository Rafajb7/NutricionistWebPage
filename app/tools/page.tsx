import { redirect } from "next/navigation";
import { AdminToolsShell } from "@/components/admin/admin-tools-shell";
import { ToolsShell } from "@/components/tools/tools-shell";
import { getSessionFromCookies } from "@/lib/auth/session";

export default async function ToolsPage() {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");

  return (
    <main className="min-h-screen bg-brand-gradient">
      {session.permission === "admin" ? (
        <AdminToolsShell
          user={{
            username: session.username,
            name: session.name
          }}
        />
      ) : (
        <ToolsShell
          user={{
            username: session.username,
            name: session.name
          }}
        />
      )}
    </main>
  );
}
