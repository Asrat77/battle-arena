"use client";

import { useEffect, useState } from "react";

export function Countdown({ deadline }: { deadline: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  if (deadline === null) return null;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <span className={`font-mono ${left <= 10 ? "text-red-600" : ""}`}>{left}s</span>;
}
