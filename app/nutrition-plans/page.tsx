import { redirect } from "next/navigation";
import { NutritionPlansShell } from "@/components/nutrition-plans/nutrition-plans-shell";
import { getSessionFromCookies } from "@/lib/auth/session";

export default async function NutritionPlansPage() {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");

  return (
    <main className="min-h-screen bg-brand-gradient">
      <NutritionPlansShell
        user={{
          username: session.username,
          name: session.name
        }}
      />
    </main>
  );
}
