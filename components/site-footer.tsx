import { Instagram, Mail } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-black/20 px-4 py-5">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 text-sm text-brand-muted sm:flex-row">
        <p>
          Created by <span className="font-semibold text-brand-text">Rafael Jiménez</span>
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <a
            href="https://www.instagram.com/rafajb7/"
            target="_blank"
            rel="noreferrer"
            aria-label="Instagram de Rafael Jimenez"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 transition hover:border-brand-accent/50 hover:bg-brand-accent/10 hover:text-brand-text"
          >
            <Instagram className="h-4 w-4" />
            @rafajb7
          </a>
          <a
            href="mailto:rafajibra@gmail.com"
            aria-label="Correo electronico de Rafael Jimenez"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 transition hover:border-brand-accent/50 hover:bg-brand-accent/10 hover:text-brand-text"
          >
            <Mail className="h-4 w-4" />
            rafajibra@gmail.com
          </a>
        </div>
      </div>
    </footer>
  );
}
