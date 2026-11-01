"use client";

import { Segmented } from "@/components/ui/Segmented";
import { useTheme } from "@/lib/theme";

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="card flex flex-col gap-3">
      <span className="text-small text-ink-2">Theme</span>
      <Segmented
        label="Theme"
        value={theme}
        onChange={setTheme}
        options={[
          { value: "dark", label: "Arena Night" },
          { value: "light", label: "Day" },
        ]}
      />
    </div>
  );
}
