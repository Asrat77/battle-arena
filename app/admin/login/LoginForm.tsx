"use client";

// The admin sign-in form. The token is sent once to our own server (never put
// in the URL or stored); the name is remembered in this browser because it
// is what the audit log records. Errors: wrong token, lockout, API unreachable.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/admin/Button";
import { Field } from "@/components/admin/Field";
import { Icon } from "@/components/admin/icons";
import { BrandMark } from "@/components/admin/Sidebar";
import { AdminApiError, adminSession } from "@/lib/admin/api";
import { safeNext } from "@/lib/admin/proxyRules";

const NAME_KEY = "admin.name";

function message(err: unknown): { field: "token" | "name" | null; text: string } {
  if (err instanceof AdminApiError) {
    if (err.status === 401) return { field: "token", text: "That token is not right. Check it and try again." };
    if (err.status === 429) return { field: null, text: "Too many failed attempts. Try again in about 15 minutes." };
    if (err.status === 400) return { field: /name/i.test(err.message) ? "name" : "token", text: err.message };
    if (err.status === 0 || err.status >= 500) return { field: null, text: "The admin server can't be reached right now. Try again in a minute." };
    return { field: null, text: err.message };
  }
  return { field: null, text: "Sign-in failed. Try again." };
}

export function LoginForm() {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: "token" | "name" | null; text: string } | null>(null);
  const tokenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {
      // storage off: type it each time
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const n = name.trim();
    if (!token.trim()) return setError({ field: "token", text: "Enter the admin token." });
    if (!n) return setError({ field: "name", text: "Enter your name. It goes in the audit log." });
    setBusy(true);
    setError(null);
    try {
      await adminSession.signIn(token.trim(), n);
      try {
        localStorage.setItem(NAME_KEY, n);
      } catch {
        // not remembered
      }
      setToken("");
      window.location.assign(safeNext(new URLSearchParams(window.location.search).get("next")));
    } catch (err) {
      const m = message(err);
      setError(m);
      setBusy(false);
      if (m.field === "token") tokenRef.current?.select();
    }
  };

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center gap-3 px-1">
          <BrandMark size={36} />
          <div>
            <p className="text-[15px] font-semibold leading-tight text-ink">Battle Arena</p>
            <p className="text-[12.5px] text-ink-3">Admin console</p>
          </div>
        </div>

        <section className="rounded-xl border border-line bg-sf">
          <div className="border-b border-line px-5 py-4">
            <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">Sign in</h1>
            <p className="mt-1 text-[13px] text-ink-2">Use the admin token from the server settings.</p>
          </div>
          <form onSubmit={submit} noValidate className="space-y-4 px-5 py-5">
            <Field
              ref={tokenRef}
              label="Admin token"
              type={show ? "text" : "password"}
              name="admin-token"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              error={error?.field === "token" ? error.text : null}
              autoFocus
              trailing={
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-pressed={show}
                  className="h-8 rounded-md px-2 text-[12px] font-medium text-ink-2 hover:bg-sf-3 hover:text-ink"
                >
                  {show ? "Hide" : "Show"}
                </button>
              }
            />
            <Field
              label="Your name"
              name="admin-name"
              autoComplete="nickname"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              hint="Shown in the audit log next to everything you do."
              error={error?.field === "name" ? error.text : null}
            />
            {error && !error.field && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-mismatch/40 bg-mismatch-soft px-3 py-2.5 text-[13px] text-mismatch">
                <Icon name="alert" size={16} className="mt-px" />
                {error.text}
              </p>
            )}
            <Button type="submit" variant="primary" loading={busy} className="w-full">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </section>

        <p className="mt-4 flex items-center justify-center gap-2 text-[12.5px] text-ink-3">
          <Icon name="shield" size={15} />
          Every action here is recorded in the audit log.
        </p>
      </div>
    </main>
  );
}
