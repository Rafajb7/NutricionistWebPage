import type { Metadata } from "next";
import { Sora, Manrope } from "next/font/google";
import "@/app/globals.css";
import { GlobalDiabloMode } from "@/components/global-diablo-mode";
import { Providers } from "@/components/providers";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-heading"
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body"
});

export const metadata: Metadata = {
  title: "Manuel Angel Trenas | Seguimiento Nutricional",
  description: "Plataforma de seguimiento nutricional para powerlifting.",
  icons: {
    icon: "/logoV1.png",
    shortcut: "/logoV1.png",
    apple: "/logoV1.png"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${sora.variable} ${manrope.variable} bg-brand-bg font-[var(--font-body)] text-brand-text`}>
        <GlobalDiabloMode />
        {children}
        <Providers />
      </body>
    </html>
  );
}
