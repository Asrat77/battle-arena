"use client";

import { useState } from "react";
import { isCode } from "@/engine/games/crackTheCode";

/** 4 distinct digits 1-9, checked before sending; the server checks again. */
export function CodeInput({ label, onSubmit, disabled }: { label: string; onSubmit(code: string): void; disabled?: boolean }) {
  const [code, setCode] = useState("");
  const valid = isCode(code);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSubmit(code);
    setCode("");
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        className="input w-28 text-center font-mono text-lg tracking-widest"
        inputMode="numeric"
        maxLength={4}
        placeholder="1234"
        value={code}
        disabled={disabled}
        onChange={(e) => setCode(e.target.value.replace(/[^1-9]/g, "").slice(0, 4))}
        autoFocus
      />
      <button className="btn" disabled={disabled || !valid}>
        {label}
      </button>
      {code.length === 4 && !valid && <span className="text-xs text-red-600">Digits must all differ.</span>}
    </form>
  );
}
