import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Em Dia — by Everlenz",
  description: "Gestão técnica de obras, cronogramas e status reports.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1013" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var saved=localStorage.getItem('emdia-theme');var manual=localStorage.getItem('emdia-theme-manual')==='true';var dark=manual&&saved?saved==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=dark?'dark':'light'}catch(e){}})()` }} /></head>
      <body>{children}</body>
    </html>
  );
}
