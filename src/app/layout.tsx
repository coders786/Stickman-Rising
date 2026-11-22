import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BOOT_WATCH } from "./boot-watch";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: "Stickman Rising",
  description: "A fast-paced stickman combat run across a rain-soaked procedural bridge.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: BOOT_WATCH }} /></head>
      <body
        className="antialiased bg-background text-foreground"
      >
        {children}
        <aside id="sr-boot-report" className="sr-boot-report" hidden suppressHydrationWarning>
          <details open>
            <summary>Startup report</summary>
            <output suppressHydrationWarning>Starting the game…</output>
            <div><a href="/">Reload game</a><button type="button">Copy timings</button></div>
          </details>
        </aside>
        <noscript><p className="sr-boot-report">Enable JavaScript in the preview to play Stickman Rising.</p></noscript>
      </body>
    </html>
  );
}
