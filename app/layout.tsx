import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

// Tipografia da identidade Everlenz: Montserrat 400/500/600.
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Em Dia — by Everlenz",
  description: "Gestão técnica de obras, cronogramas e status reports.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={montserrat.variable} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var saved=localStorage.getItem('emdia-theme');var manual=localStorage.getItem('emdia-theme-manual')==='true';var dark=manual&&saved?saved==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=dark?'dark':'light'}catch(e){}})()` }} /></head>
      <body>{children}</body>
    </html>
  );
}
