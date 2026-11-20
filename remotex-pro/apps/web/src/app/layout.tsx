import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "RemoteX Pro", description: "Secure remote support workspace" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
