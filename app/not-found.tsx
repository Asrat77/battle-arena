import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NotFound() {
  return (
    <EmptyState
      icon="err404"
      title="Nothing here"
      action={
        <ButtonLink href="/" variant="act" icon="controller">
          Back home
        </ButtonLink>
      }
    >
      This page doesn’t exist. Check the link, or start from home.
    </EmptyState>
  );
}
