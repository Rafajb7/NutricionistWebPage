"use client";

import { motion } from "framer-motion";
import type { HTMLMotionProps } from "framer-motion";
import type { PropsWithChildren } from "react";
import { cn } from "@/lib/utils";

type BrandButtonProps = HTMLMotionProps<"button"> &
  PropsWithChildren<{
    variant?: "accent" | "ghost";
  }>;

export function BrandButton({
  children,
  className,
  variant = "accent",
  ...props
}: BrandButtonProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-xl px-5 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/70 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "accent" &&
          "bg-brand-accent text-black hover:bg-[#ffe169] shadow-[0_8px_25px_-12px_rgba(247,204,47,0.75)]",
        variant === "ghost" &&
          "border border-white/15 bg-white/5 text-brand-text hover:border-brand-accent/50 hover:bg-brand-accent/10",
        className
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}
