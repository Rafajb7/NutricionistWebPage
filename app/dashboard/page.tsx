import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getSessionFromCookies } from "@/lib/auth/session";

export default async function DashboardPage() {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");

  return (
    <main className="min-h-screen bg-brand-gradient">
      <DashboardShell
        user={{
          username: session.username,
          name: session.name
        }}
      />
    </main>
  );
}
