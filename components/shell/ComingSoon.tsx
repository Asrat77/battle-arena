// Stand-in for a tab whose screen hasn't shipped yet, so the nav never 404s.

import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Icon3DName } from "@/components/ui/Icon3D";

export function ComingSoon({ icon, title, children }: { icon: Icon3DName; title: string; children: React.ReactNode }) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      action={
        <ButtonLink href="/" variant="act" icon="lightning">
          Play a match
        </ButtonLink>
      }
    >
      {children}
    </EmptyState>
  );
}
