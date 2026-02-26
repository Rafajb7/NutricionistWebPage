import { Skeleton } from "@/components/ui/skeleton";

export default function NewRevisionLoading() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl space-y-6 px-4 py-8 md:px-8">
      <Skeleton className="h-5 w-44" />
      <Skeleton className="h-72 w-full rounded-3xl" />
    </main>
  );
}
