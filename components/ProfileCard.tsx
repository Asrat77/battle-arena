"use client";

import { useState } from "react";
import type { Profile } from "@/lib/api";

export function ProfileCard({ profile }: { profile: Profile }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(profile.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">{profile.name}</h2>
      <p className="mt-1 text-xs text-gray-500">Profile ID</p>
      <p className="flex items-center gap-2">
        <span className="mono" data-testid="profile-id">
          {profile.id}
        </span>
        <button className="text-xs text-gray-500 underline" onClick={copy}>
          {copied ? "copied" : "copy"}
        </button>
      </p>
    </section>
  );
}
