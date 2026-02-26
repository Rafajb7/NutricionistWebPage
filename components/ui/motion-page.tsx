"use client";

import { motion } from "framer-motion";
import type { PropsWithChildren } from "react";

export function MotionPage({ children }: PropsWithChildren) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
