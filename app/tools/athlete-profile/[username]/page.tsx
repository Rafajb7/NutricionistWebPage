import { redirect } from "next/navigation";
import { AthleteProfileShell } from "@/components/admin/athlete-profile-shell";
import { getSessionFromCookies } from "@/lib/auth/session";

type AthleteProfilePageProps = {
  params: Promise<{
    username: string;
  }>;
};

export default async function AthleteProfilePage({ params }: AthleteProfilePageProps) {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");
  if (session.permission !== "admin") redirect("/dashboard");

  const { username } = await params;

  return (
    <main className="min-h-screen bg-brand-gradient">
      <AthleteProfileShell
        user={{
          username: session.username,
          name: session.name
        }}
        athleteUsername={username}
      />
    </main>
  );
}
