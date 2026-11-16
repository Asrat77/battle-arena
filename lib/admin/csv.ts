// CSV export for admin tables. Cells are quoted when needed, and text that a
// spreadsheet would run as a formula (= + - @, tab, carriage return at the
// start) gets a leading single quote so an exported player name can't execute.

export interface CsvColumn<T> {
  header: string;
  value(row: T): string | number | boolean | null | undefined;
}

const FORMULA_START = /^[=+\-@\t\r]/;
/** Money text with two decimals such as "-3.00" is a number to a spreadsheet, not a formula, so it keeps its minus and decimals. */
const PLAIN_NUMBER = /^-?\d+\.\d{2}$/;

export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return "";
  let s: string;
  if (typeof v === "number") s = Number.isFinite(v) ? String(v) : "";
  else if (typeof v === "boolean") s = v ? "true" : "false";
  else s = FORMULA_START.test(v) && !PLAIN_NUMBER.test(v) ? `'${v}` : v;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows → CSV text with a header line and CRLF line ends. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Save rows as a .csv file in the browser (UTF-8 with a BOM so Excel reads Amharic names). */
export function downloadCsv<T>(filename: string, rows: readonly T[], columns: readonly CsvColumn<T>[]) {
  const blob = new Blob(["﻿", toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
