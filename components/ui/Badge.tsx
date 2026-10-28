// A 3D object on a radial plate. Earned: saffron rim. Locked: grayscale at
// 30 % inside a dashed ring.

import { Icon3D, type Icon3DName } from "./Icon3D";

export function Badge({
  icon,
  size = 88,
  locked,
  label,
}: {
  icon: Icon3DName;
  size?: number;
  locked?: boolean;
  /** Accessible name when the badge stands alone. */
  label?: string;
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      className="plate flex flex-none items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        boxShadow: locked ? "none" : "inset 0 0 0 2px rgb(243 181 66 / .4), 0 12px 26px rgb(0 0 0 / .35)",
        border: locked ? "2px dashed rgb(var(--sf3))" : undefined,
      }}
    >
      <Icon3D
        name={icon}
        size={Math.round(size * 0.64)}
        style={locked ? { filter: "grayscale(1)", opacity: 0.3 } : undefined}
      />
    </span>
  );
}
