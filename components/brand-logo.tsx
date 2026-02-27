import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  href?: string;
  className?: string;
  showText?: boolean;
};

export function BrandLogo({ href = "/dashboard", className, showText = true }: BrandLogoProps) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-3", className)}>
      <div className="relative h-10 w-10 overflow-hidden rounded-xl border border-brand-accent/40 bg-brand-surface">
        <Image src="/logoV1.png" alt="Logo" fill className="object-cover" sizes="40px" priority />
      </div>
      {showText ? (
        <div className="leading-tight">
          <p className="text-sm uppercase tracking-[0.2em] text-brand-muted">Power Nutrition</p>
          <p className="text-base font-semibold text-brand-text">Manuel Angel Trenas</p>
        </div>
      ) : null}
    </Link>
  );
}
