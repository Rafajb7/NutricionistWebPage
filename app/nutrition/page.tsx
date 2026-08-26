import { redirect } from "next/navigation";
import { InteractiveNutritionShell } from "@/components/nutrition/interactive-nutrition-shell";
import { getSessionFromCookies } from "@/lib/auth/session";

export default async function NutritionPage() {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");

  return (
    <main className="min-h-screen bg-brand-gradient">
      <InteractiveNutritionShell
        user={{
          username: session.username,
          name: session.name
        }}
      />
    </main>
  );
}
