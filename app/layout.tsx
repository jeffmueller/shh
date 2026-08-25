import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import "./globals.css";

// Fonts vendored under app/fonts/ so the build does not depend on Google's CDN.
const geistSans = localFont({
  src: "./fonts/geist-regular.woff2",
  variable: "--font-geist-sans",
  weight: "400",
  display: "swap",
});
const geistMono = localFont({
  src: "./fonts/geist-mono-regular.woff2",
  variable: "--font-geist-mono",
  weight: "400",
  display: "swap",
});
const vt323 = localFont({
  src: "./fonts/vt323-regular.woff2",
  variable: "--font-vt323",
  weight: "400",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "shh. — share a secret",
  description: "Self-destructing secret sharing.",
  robots: { index: false, follow: false },
  applicationName: "shh.",
  // iOS ignores the web app manifest, so standalone mode + the home-screen
  // icon have to be declared separately.
  appleWebApp: {
    capable: true,
    title: "shh.",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${vt323.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-black text-gray-100 font-sans scanlines">
        <header className="px-6 py-5 border-b border-gray-800">
          <div className="max-w-2xl mx-auto flex items-baseline gap-3">
            <Link href="/" className="font-retro text-3xl tracking-wide text-gray-100 hover:text-blue-400 transition-colors">
              shh.
            </Link>
            <span className="text-xs text-gray-500 data-mono">self-destructing secrets</span>
          </div>
        </header>
        <main className="flex-1 px-6 py-8">
          <div className="max-w-2xl mx-auto">{children}</div>
        </main>
        <footer className="px-6 py-4 border-t border-gray-800 text-xs text-gray-600">
          <div className="max-w-2xl mx-auto data-mono">
            secrets are encrypted. the decryption key lives only in the URL.
          </div>
        </footer>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
