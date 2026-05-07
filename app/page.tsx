import CreateForm from "@/components/CreateForm";

export default function Page() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-retro text-4xl text-gray-100">share a secret</h1>
        <p className="text-sm text-gray-400 data-mono">
          Paste a secret. Get a one-time link. The secret is encrypted at rest; the
          decryption key never touches the server&apos;s database — it lives only in the
          URL fragment you share.
        </p>
      </div>
      <CreateForm />
    </div>
  );
}
