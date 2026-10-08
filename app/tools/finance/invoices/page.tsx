import { redirect } from "next/navigation";
import { AdminFinanceShell } from "@/components/admin/admin-finance-shell";
import { getSessionFromCookies } from "@/lib/auth/session";

export default async function FinanceInvoicesPage() {
  const session = await getSessionFromCookies();
  if (!session) redirect("/login");
  if (session.permission !== "admin") redirect("/dashboard");

  return (
    <main className="min-h-screen bg-brand-gradient">
      <AdminFinanceShell section="invoices"
        user={{
          username: session.username,
          name: session.name
        }}
      />
    </main>
  );
}
