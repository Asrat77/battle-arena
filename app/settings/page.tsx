"use client";

// Settings: account, picture, appearance and sign out.

import { ComingSoon } from "@/components/shell/ComingSoon";
import { AccountSettings } from "@/components/settings/AccountSettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { PictureSettings } from "@/components/settings/PictureSettings";
import { SignOut } from "@/components/settings/SignOut";
import { useSession } from "@/lib/session";
import { Page } from "@/components/ui/Page";

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
    // lg: account forms on the left, picture and appearance on the right, so
    // fields stop stretching across the screen.
    <Page width="wide" className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start lg:gap-x-10">
      <h1 className="text-[30px] font-semibold leading-[1.02] tracking-[-.045em] lg:col-span-2 lg:text-h1">Settings</h1>
      <Section id="set-account" title="Account">
        <AccountSettings />
      </Section>
      <div className="flex flex-col gap-6">
        <Section id="set-picture" title="Profile picture">
          <PictureSettings />
        </Section>
        <Section id="set-look" title="Appearance">
          <AppearanceSettings />
        </Section>
        <SignOut />
      </div>
    </Page>
  );
}
