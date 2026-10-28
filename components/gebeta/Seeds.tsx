// A heap of pebble2 seeds. Five preset rotations, picked by position so a pit
// keeps its look between renders; only the first `max` are drawn.

import type { CSSProperties } from "react";
import { Icon3D } from "@/components/ui/Icon3D";

const ROT: CSSProperties[] = [
  {},
  { transform: "rotate(35deg)" },
  { transform: "rotate(-28deg) scale(.92)" },
  { transform: "rotate(80deg) scale(1.05)" },
  { transform: "rotate(150deg) scale(.95)" },
];

export function Seeds({ n, max, size, salt }: { n: number; max: number; size: number; salt: number }) {
  return (
    <>
      {Array.from({ length: Math.min(n, max) }, (_, k) => (
        <Icon3D
          key={k}
          name="pebble2"
          size={size}
          className="-mx-0.5 -my-[3px] drop-shadow-[0_2px_2px_rgb(0_0_0/.6)]"
          style={ROT[(k * 3 + salt) % 5]}
        />
      ))}
    </>
  );
}
