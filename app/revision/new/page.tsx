import { redirect } from "next/navigation";
import { getSessionFromCookies } from "@/lib/auth/session";
import { RevisionWizard } from "@/components/revision/revision-wizard";

export default async function NewRevisionPage() {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");

  return (
    <main className="min-h-screen bg-brand-gradient">
      <RevisionWizard />
    </main>
  );
}
