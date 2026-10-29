"use client";

import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      icon="warning"
      title="Something broke"
      action={
        <div className="flex gap-2">
          <Button variant="act" icon="refresh" onClick={reset}>
            Try again
          </Button>
          <ButtonLink href="/" variant="ghost">
            Back home
          </ButtonLink>
        </div>
      }
    >
      This screen hit an error. Your matches and records are safe on the server.
    </EmptyState>
  );
}
