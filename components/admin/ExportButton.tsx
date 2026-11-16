"use client";

// "Export CSV" for a list header: runs `load` (every matching row, paged by the
// caller with collectAll), shows "N of M" while it works, then saves the file.
// A failure shows beside the button with the reason; leaving the page cancels.

import { useEffect, useRef, useState } from "react";
import { downloadCsv, type CsvColumn } from "@/lib/admin/csv";
import { num } from "@/lib/admin/format";
import { Button } from "./Button";

export interface ExportButtonProps<T> {
  /** File name, e.g. from `exportFilename`. Read when the export finishes, so filters changed meanwhile do not matter. */
  filename: string;
  columns: readonly CsvColumn<T>[];
  /** Fetch every row. Call `progress(done, total)` as pages arrive and stop early when `cancelled()` is true. */
  load(progress: (done: number, total: number) => void, cancelled: () => boolean): Promise<T[]>;
  disabled?: boolean;
}

export function ExportButton<T>({ filename, columns, load, disabled }: ExportButtonProps<T>) {
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = async () => {
    setError(null);
    setBusy({ done: 0, total: 0 });
    try {
      const rows = await load(
        (done, total) => alive.current && setBusy({ done, total }),
        () => !alive.current,
      );
      if (alive.current) downloadCsv(filename, rows, columns);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "The export failed");
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  return (
    <>
      {busy && busy.total > 0 && (
        <span role="status" className="num text-[12.5px] font-normal text-ink-2">
          {num(busy.done)} of {num(busy.total)}
        </span>
      )}
      {error && (
        <span role="alert" className="text-[12.5px] font-normal text-mismatch">
          Export failed: {error}
        </span>
      )}
      <Button size="sm" icon="download" onClick={run} loading={Boolean(busy)} disabled={disabled}>
        {busy ? "Exporting" : "Export CSV"}
      </Button>
    </>
  );
}
