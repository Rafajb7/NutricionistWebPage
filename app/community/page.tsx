import { redirect } from "next/navigation";
import { CommunityShell } from "@/components/community/community-shell";
import { getSessionFromCookies } from "@/lib/auth/session";

export default async function CommunityPage() {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");

  return (
    <main className="min-h-screen bg-brand-gradient">
      <CommunityShell
        user={{
          username: session.username,
          name: session.name,
          permission: session.permission
        }}
      />
    </main>
  );
}
