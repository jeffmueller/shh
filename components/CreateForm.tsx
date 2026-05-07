"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock, Send } from "lucide-react";
import { EXPIRY_OPTIONS, type ExpiryValue } from "@/lib/expiry";

const MAX_BYTES = 100 * 1024;

export default function CreateForm() {
  const router = useRouter();
  const [plaintext, setPlaintext] = useState("");
  const [expiry, setExpiry] = useState<ExpiryValue>("first_view");
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byteLen = new Blob([plaintext]).size;
  const overLimit = byteLen > MAX_BYTES;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!plaintext) return;
    if (overLimit) {
      setError("Secret exceeds 100 KB limit.");
      return;
    }
    if (usePassword && password.length === 0) {
      setError("Password cannot be empty.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plaintext,
          expiry,
          password: usePassword ? password : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create secret.");
      }
      const { id, key } = await res.json();
      // Pass key via hash so it never hits the network.
      router.push(`/created/${encodeURIComponent(id)}#${key}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create secret.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel space-y-5 animate-fade-in" autoComplete="off">
      <div>
        <label htmlFor="plaintext" className="block text-sm text-gray-400 mb-2 data-mono">
          Secret <span className="text-gray-600">(plain text only)</span>
        </label>
        <textarea
          id="plaintext"
          name="plaintext"
          value={plaintext}
          onChange={(e) => setPlaintext(e.target.value)}
          placeholder="paste a password, API key, ssh key, etc."
          rows={8}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="input-base data-mono resize-y"
          required
        />
        <div className="mt-1 flex justify-between text-xs">
          <span className={overLimit ? "text-red-400" : "text-gray-600"}>
            {byteLen.toLocaleString()} / {MAX_BYTES.toLocaleString()} bytes
          </span>
        </div>
      </div>

      <div>
        <label htmlFor="expiry" className="block text-sm text-gray-400 mb-2 data-mono">
          Expires
        </label>
        <select
          id="expiry"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value as ExpiryValue)}
          className="input-base data-mono"
        >
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={usePassword}
            onChange={(e) => setUsePassword(e.target.checked)}
            className="accent-blue-500"
          />
          <Lock size={14} className="text-gray-400" />
          Require a password to view
        </label>
        {usePassword && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            maxLength={256}
            autoComplete="new-password"
            className="input-base data-mono mt-2"
          />
        )}
      </div>

      {error && (
        <div className="panel-accent-red text-red-300 text-sm data-mono">{error}</div>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={submitting || overLimit || !plaintext} className="btn-primary">
          <Send size={16} />
          {submitting ? "Creating…" : "Create Secret"}
        </button>
      </div>
    </form>
  );
}
