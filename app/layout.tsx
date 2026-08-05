import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MailOps AI",
  description: "Human-reviewed email operations powered by grounded AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
