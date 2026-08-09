import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description = "An open-source data analysis agent that turns questions, official sources, and your files into evidence-backed interactive dashboards.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "Polaris — Open-Source Data Analysis Agent",
    description,
    applicationName: "Polaris",
    creator: "Weifan Wu",
    keywords: ["data analysis", "AI agent", "open source", "data visualization", "official data", "OpenAI"],
    openGraph: {
      title: "Polaris — Ask questions. Get evidence-backed dashboards.",
      description,
      type: "website",
      images: [{ url: imageUrl, width: 1200, height: 630, alt: "Polaris data intelligence workspace preview" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Polaris — Open-Source Data Analysis Agent",
      description,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
