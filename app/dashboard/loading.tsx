import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <main className="app-page-container mx-auto min-h-screen w-full space-y-6 px-4 py-8 md:px-8">
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-3xl" />
      <Skeleton className="h-80 w-full rounded-3xl" />
    </main>
  );
}
