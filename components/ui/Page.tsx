// Content column for a page. The shell is 1280 px (1440 px on very wide
// screens); a page picks how much of it to use so desktop never shows a phone
// column in a sea of empty space, and long lines stay readable.
//
//   reading  one column of lists, forms or cards       ~720 px
//   wide     two columns at lg (side panel + main)     ~1120 px
//   full     the whole shell (home, grids, play)
//
// Below lg every width is simply the screen, so mobile is unchanged.

type Width = "reading" | "wide" | "full";

// Spelled out so Tailwind sees every class name.
const WIDTHS: Record<Width, string> = {
  reading: "max-w-xl lg:max-w-[720px]",
  wide: "max-w-xl lg:max-w-[1120px]",
  full: "max-w-none",
};

export function Page({
  width = "reading",
  className = "",
  children,
}: {
  width?: Width;
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`mx-auto w-full ${WIDTHS[width]} ${className}`}>{children}</div>;
}
