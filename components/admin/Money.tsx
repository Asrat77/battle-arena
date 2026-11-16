// A money amount in mono: santim in, birr out, with the book's unit label
// (ETB or play). `signed` shows + / − and colours credits green, debits red.

import { birr, signedBirr, unitFor, type Book } from "@/lib/admin/format";

export function Money({
  santim,
  book = "real",
  signed = false,
  unit = true,
  className = "",
}: {
  santim: number | null | undefined;
  book?: Book;
  signed?: boolean;
  /** Show the unit label after the number. */
  unit?: boolean;
  className?: string;
}) {
  const colour = !signed || !santim ? "text-ink" : santim > 0 ? "text-recorded" : "text-mismatch";
  return (
    <span className={`num whitespace-nowrap ${colour} ${className}`}>
      {signed ? signedBirr(santim) : birr(santim)}
      {unit && santim != null && <span className="ml-1 text-[0.8em] font-medium text-ink-3">{unitFor(book)}</span>}
    </span>
  );
}
