import type { Metadata } from "next";
import { Sora, Manrope } from "next/font/google";
import "@/app/globals.css";
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
    icon: "/logo.jpeg",
    shortcut: "/logo.jpeg",
    apple: "/logo.jpeg"
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
        {children}
        <Providers />
      </body>
    </html>
  );
}
