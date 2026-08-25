import { redirect } from "next/navigation";
import { AdminNutritionManagementShell } from "@/components/admin/admin-nutrition-management-shell";
import { getSessionFromCookies } from "@/lib/auth/session";

export default async function NutritionManagementPage() {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");
  if (session.permission !== "admin") redirect("/dashboard");

  return (
    <main className="min-h-screen bg-brand-gradient">
      <AdminNutritionManagementShell
        user={{
          username: session.username,
          name: session.name
        }}
      />
    </main>
  );
}
