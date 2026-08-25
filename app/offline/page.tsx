import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = {
  title: "shh. — offline",
};

export default function Page() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="space-y-2">
        <h1 className="font-retro text-4xl text-gray-100">offline</h1>
        <p className="text-sm text-gray-400 data-mono">
          No connection. shh. needs the network — secrets are encrypted and stored
          server-side, and nothing is ever cached to this device.
        </p>
      </div>

      <div className="panel flex items-start gap-3">
        <WifiOff size={20} className="text-gray-500 shrink-0 mt-0.5" />
        <p className="text-sm text-gray-400">
          Reconnect and try again. If you were opening a secret link, it is still
          waiting — this page is not a failed reveal, and no view was spent.
        </p>
      </div>

      {/* Plain anchor, not next/link: a full navigation lets the service worker
          retry against the network instead of a client-side RSC fetch. A
          client-side navigation would need an RSC payload we deliberately
          never cache. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="btn-secondary">
        Try again
      </a>
    </div>
  );
}
