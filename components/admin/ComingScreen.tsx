// Placeholder body for a console screen that a later task builds: the real
// title and a quiet empty state, so navigation and screenshots already work.

import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import type { IconName } from "./icons";
import { PageHeader } from "./PageHeader";

export function ComingScreen({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: IconName; children: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <EmptyState icon={icon} title="This screen is being built">
          {children}
        </EmptyState>
      </Card>
    </>
  );
}
