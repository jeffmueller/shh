"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, ShieldCheck } from "lucide-react";
import CopyButton from "./CopyButton";

export default function CreatedView({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    setUrl(`${window.location.origin}/s/${id}#${hash}`);
  }, [id]);

  if (!url) {
    return (
      <div className="panel-accent-red text-red-300 data-mono">
        <p>This page was opened without a decryption key in the URL.</p>
        <p className="mt-2">
          The link is only valid right after you create a secret. Please{" "}
          <Link href="/" className="underline hover:text-red-200">
            create a new one
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-retro text-4xl text-green-400 flex items-center gap-3">
          <ShieldCheck size={28} /> secret stored
        </h1>
        <p className="text-sm text-gray-400 data-mono">
          Share this URL with the recipient. We won&apos;t show it to you again.
        </p>
      </div>

      <div className="panel-accent-green space-y-3 animate-fade-in">
        <label className="block text-xs text-gray-400 data-mono">Private URL</label>
        <div className="bg-black/60 border border-gray-800 rounded-lg p-3 break-all data-mono text-sm text-green-200">
          {url}
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={url} label="Copy URL" className="btn-primary" />
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn-secondary">
            <ExternalLink size={16} /> Open
          </a>
        </div>
      </div>

      <div className="panel text-sm text-gray-400 space-y-2">
        <p className="data-mono text-gray-300">A few things to know:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>The decryption key is the part after the <code className="data-mono text-gray-300">#</code> — it never touches the server logs.</li>
          <li>If you chose <em>First view</em>, the secret is destroyed the first time anyone reveals it.</li>
          <li>Otherwise it self-destructs after the chosen time.</li>
        </ul>
      </div>

      <div>
        <Link href="/" className="btn-secondary inline-flex">
          <ArrowLeft size={16} /> Create another
        </Link>
      </div>
    </div>
  );
}
