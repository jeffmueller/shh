"use client";

import { useEffect, useState } from "react";
import { Eye, Lock, AlertTriangle } from "lucide-react";
import CopyButton from "./CopyButton";

type Stage = "loading" | "missing-key" | "not-found" | "ready" | "needs-password" | "revealed" | "error";

export default function RevealView({ id }: { id: string }) {
  const [stage, setStage] = useState<Stage>("loading");
  const [hashKey, setHashKey] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const k = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    if (!k) {
      setStage("missing-key");
      return;
    }
    setHashKey(k);
    fetch(`/api/secrets/${encodeURIComponent(id)}/meta`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.exists) {
          setStage("not-found");
          return;
        }
        setStage(data.hasPassword ? "needs-password" : "ready");
      })
      .catch(() => setStage("error"));
  }, [id]);

  async function reveal(e?: React.FormEvent) {
    e?.preventDefault();
    if (!hashKey) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/secrets/${encodeURIComponent(id)}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ key: hashKey, password: password || undefined }),
      });
      if (res.status === 429) {
        setErrorMsg("Too many attempts. Please wait a few minutes.");
        setSubmitting(false);
        return;
      }
      if (res.status === 401) {
        setErrorMsg(stage === "needs-password" ? "Password is required." : "Unauthorized.");
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        setStage("not-found");
        return;
      }
      const data = await res.json();
      setPlaintext(data.plaintext);
      setStage("revealed");
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (stage === "loading") {
    return <div className="panel data-mono text-gray-400">Loading…</div>;
  }

  if (stage === "missing-key") {
    return (
      <div className="panel-accent-red space-y-2">
        <div className="flex items-center gap-2 text-red-300 font-retro text-2xl">
          <AlertTriangle size={20} /> missing decryption key
        </div>
        <p className="text-sm text-red-200">
          The URL is missing the part after <code className="data-mono">#</code>. Without
          it, the secret cannot be decrypted. Ask the sender to share the full link.
        </p>
      </div>
    );
  }

  if (stage === "not-found" || stage === "error") {
    return (
      <div className="panel-accent-red space-y-2">
        <div className="flex items-center gap-2 text-red-300 font-retro text-2xl">
          <AlertTriangle size={20} /> not found or expired
        </div>
        <p className="text-sm text-red-200">
          This secret may have already been viewed, expired, or never existed.
        </p>
      </div>
    );
  }

  if (stage === "revealed" && plaintext !== null) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="space-y-1">
          <h1 className="font-retro text-4xl text-green-400">secret revealed</h1>
          <p className="text-xs text-gray-500 data-mono">
            Save it now — refreshing this page will not show it again.
          </p>
        </div>
        <div className="panel-accent-green">
          {/* React text interpolation auto-escapes; safe against XSS. */}
          <pre className="data-mono text-sm whitespace-pre-wrap break-all text-green-100">
            {plaintext}
          </pre>
        </div>
        <CopyButton text={plaintext} label="Copy secret" className="btn-primary" />
      </div>
    );
  }

  // ready or needs-password
  const requiresPassword = stage === "needs-password";

  return (
    <form onSubmit={reveal} className="panel space-y-4 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-retro text-3xl text-gray-100">a secret is waiting</h1>
        <p className="text-sm text-gray-400 data-mono">
          Click to reveal. {requiresPassword ? "A password is required." : ""} You may only get one chance — link previewers and double clicks count.
        </p>
      </div>

      {requiresPassword && (
        <div>
          <label htmlFor="pw" className="block text-sm text-gray-400 mb-2 data-mono flex items-center gap-2">
            <Lock size={14} /> Password
          </label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            maxLength={256}
            className="input-base data-mono"
            required
          />
        </div>
      )}

      {errorMsg && <div className="text-red-300 text-sm data-mono">{errorMsg}</div>}

      <div>
        <button type="submit" disabled={submitting} className="btn-primary">
          <Eye size={16} />
          {submitting ? "Revealing…" : "Reveal Secret"}
        </button>
      </div>
    </form>
  );
}
