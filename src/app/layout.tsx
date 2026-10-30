import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DockTwin",
  description: "Plain-English digital twins of port terminals, stress-tested by an agent built on Meta models.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
