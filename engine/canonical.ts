// Stable JSON: object keys sorted, no whitespace. Same value → same string, everywhere.

export function canonical(value: unknown): string {
  const out = encode(value);
  if (out === undefined) throw new TypeError("canonical: value is not serialisable");
  return out;
}

function encode(value: unknown): string | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`canonical: non-finite number ${value}`);
      return JSON.stringify(value);
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    case "bigint":
      throw new TypeError("canonical: bigint is not supported");
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => encode(v) ?? "null").join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  if (typeof (obj as { toJSON?: unknown }).toJSON === "function") {
    return encode((obj as { toJSON(): unknown }).toJSON());
  }
  const parts: string[] = [];
  for (const key of Object.keys(obj).sort()) {
    const v = encode(obj[key]);
    if (v !== undefined) parts.push(`${JSON.stringify(key)}:${v}`);
  }
  return `{${parts.join(",")}}`;
}
