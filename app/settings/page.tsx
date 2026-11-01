"use client";

// Settings: account, picture, appearance and sign out.

import { ComingSoon } from "@/components/shell/ComingSoon";
import { AccountSettings } from "@/components/settings/AccountSettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { PictureSettings } from "@/components/settings/PictureSettings";
import { SignOut } from "@/components/settings/SignOut";
import { useSession } from "@/lib/session";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <h2 id={id} className="eyebrow px-0.5">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { profile } = useSession();
  if (!profile)
    return (
      <ComingSoon icon="idcard" title="Settings">
        Sign up to change settings.
      </ComingSoon>
    );
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-[30px] font-semibold leading-[1.02] tracking-[-.045em]">Settings</h1>
      <Section id="set-account" title="Account">
        <AccountSettings />
      </Section>
      <Section id="set-picture" title="Profile picture">
        <PictureSettings />
      </Section>
      <Section id="set-look" title="Appearance">
        <AppearanceSettings />
      </Section>
      <SignOut />
    </div>
  );
}
