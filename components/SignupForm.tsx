"use client";

import { useState } from "react";
import { useSession } from "@/lib/session";

export function SignupForm() {
  const { signup } = useSession();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup(name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card mx-auto mt-12 max-w-sm space-y-3">
      <h1 className="text-xl font-bold">Battle Arena</h1>
      <p className="text-sm text-gray-600">Pick a name to play. You get a profile ID right away, no wallet needed.</p>
      <input
        className="input w-full"
        placeholder="Your name"
        maxLength={24}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn w-full" disabled={busy || !name.trim()}>
        {busy ? "Creating profile…" : "Start playing"}
      </button>
    </form>
  );
}
