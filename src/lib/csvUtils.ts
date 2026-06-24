import Papa from "papaparse";

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export type Dtype = "numeric" | "categorical" | "boolean" | "datetime" | "text";

export interface ColumnStat {
  name: string;
  dtype: Dtype;
  missing: number;
  unique: number;
  min?: number | null;
  max?: number | null;
  mean?: number | null;
  median?: number | null;
  std?: number | null;
  q1?: number | null;
  q3?: number | null;
  topValues?: { value: string; count: number }[];
}

export interface DatasetProfile {
  rowCount: number;
  columnCount: number;
  duplicateRows: number;
  memoryBytes: number;
  columns: ColumnStat[];
}

const MISSING_TOKENS = new Set(["", "na", "n/a", "nan", "null", "none", "-"]);

export function isMissing(v: Cell): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return MISSING_TOKENS.has(v.trim().toLowerCase());
  if (typeof v === "number") return !Number.isFinite(v);
  return false;
}

export function parseCsv(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ rows: Row[]; columns: string[] }> {
  return new Promise((resolve, reject) => {
    const rows: Row[] = [];
    let columns: string[] = [];
    Papa.parse<Row>(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: "greedy",
      worker: false,
      chunk: (results) => {
        if (!columns.length && results.meta.fields) columns = results.meta.fields;
        rows.push(...results.data);
        if (onProgress && file.size) {
          // results.meta.cursor is byte offset
          const cursor = (results.meta as unknown as { cursor?: number }).cursor ?? 0;
          onProgress(Math.min(99, Math.round((cursor / file.size) * 100)));
        }
      },
      complete: () => {
        onProgress?.(100);
        resolve({ rows, columns: columns.length ? columns : Object.keys(rows[0] ?? {}) });
      },
      error: (err) => reject(err),
    });
  });
}

function inferDtype(values: Cell[]): Dtype {
  let num = 0,
    bool = 0,
    date = 0,
    nonNull = 0;
  for (const v of values) {
    if (isMissing(v)) continue;
    nonNull++;
    if (typeof v === "number") {
      num++;
      continue;
    }
    if (typeof v === "boolean") {
      bool++;
      continue;
    }
    const s = String(v).trim();
    if (s === "true" || s === "false") {
      bool++;
      continue;
    }
    if (!isNaN(Number(s)) && s !== "") {
      num++;
      continue;
    }
    if (!isNaN(Date.parse(s)) && /\d{4}|\d{1,2}[/-]\d{1,2}/.test(s)) {
      date++;
      continue;
    }
  }
  if (!nonNull) return "text";
  if (bool / nonNull > 0.95) return "boolean";
  if (num / nonNull > 0.9) return "numeric";
  if (date / nonNull > 0.8) return "datetime";
  // categorical vs text
  const uniq = new Set(values.filter((v) => !isMissing(v)).map(String)).size;
  return uniq <= Math.max(20, nonNull * 0.1) ? "categorical" : "text";
}

function toNum(v: Cell): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined)
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

export function profileDataset(rows: Row[], columns: string[]): DatasetProfile {
  const memoryBytes = new Blob([JSON.stringify(rows)]).size;
  const seen = new Set<string>();
  let dupes = 0;
  for (const r of rows) {
    const k = JSON.stringify(columns.map((c) => r[c]));
    if (seen.has(k)) dupes++;
    else seen.add(k);
  }

  const colStats: ColumnStat[] = columns.map((name) => {
    const values = rows.map((r) => r[name]);
    const dtype = inferDtype(values);
    const missing = values.filter(isMissing).length;
    const present = values.filter((v) => !isMissing(v));
    const unique = new Set(present.map(String)).size;
    const stat: ColumnStat = { name, dtype, missing, unique };
    if (dtype === "numeric") {
      const nums = present
        .map(toNum)
        .filter((n): n is number => n !== null)
        .sort((a, b) => a - b);
      if (nums.length) {
        const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
        const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
        stat.min = nums[0];
        stat.max = nums[nums.length - 1];
        stat.mean = +mean.toFixed(4);
        stat.median = +quantile(nums, 0.5).toFixed(4);
        stat.std = +Math.sqrt(variance).toFixed(4);
        stat.q1 = +quantile(nums, 0.25).toFixed(4);
        stat.q3 = +quantile(nums, 0.75).toFixed(4);
      }
    } else {
      const counts = new Map<string, number>();
      for (const v of present) {
        const k = String(v);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      stat.topValues = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }));
    }
    return stat;
  });

  return {
    rowCount: rows.length,
    columnCount: columns.length,
    duplicateRows: dupes,
    memoryBytes,
    columns: colStats,
  };
}

export function toCsv(rows: Row[], columns: string[]): string {
  return Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => r[c] ?? "")) });
}

// ============ Cleaning ============

export type CleaningStep =
  | { kind: "drop_missing_rows"; columns?: string[] }
  | {
      kind: "fill_numeric";
      column: string;
      method: "mean" | "median" | "mode" | "constant";
      constant?: number;
    }
  | { kind: "fill_categorical"; column: string; method: "mode" | "constant"; constant?: string }
  | { kind: "drop_duplicates" }
  | { kind: "outliers_iqr"; column: string; action: "remove" | "cap" }
  | { kind: "drop_columns"; columns: string[] };

export interface CleaningResult {
  rows: Row[];
  log: string[];
}

function mode<T extends Cell>(values: T[]): T | undefined {
  const counts = new Map<string, { v: T; n: number }>();
  for (const v of values) {
    const k = String(v);
    const e = counts.get(k);
    if (e) e.n++;
    else counts.set(k, { v, n: 1 });
  }
  let best: { v: T; n: number } | undefined;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  return best?.v;
}

export function applyCleaning(
  initial: Row[],
  columns: string[],
  steps: CleaningStep[],
): CleaningResult {
  let rows = initial.map((r) => ({ ...r }));
  const log: string[] = [];

  for (const step of steps) {
    const before = rows.length;
    switch (step.kind) {
      case "drop_missing_rows": {
        const cols = step.columns?.length ? step.columns : columns;
        rows = rows.filter((r) => !cols.some((c) => isMissing(r[c])));
        log.push(
          `Removed ${before - rows.length} rows with missing values${step.columns?.length ? ` in ${step.columns.join(", ")}` : ""}.`,
        );
        break;
      }
      case "fill_numeric": {
        const nums = rows
          .map((r) => toNum(r[step.column]))
          .filter((n): n is number => n !== null)
          .sort((a, b) => a - b);
        let fill: number | null = null;
        if (step.method === "mean")
          fill = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        else if (step.method === "median") fill = nums.length ? quantile(nums, 0.5) : 0;
        else if (step.method === "mode") fill = mode(nums) ?? 0;
        else if (step.method === "constant") fill = step.constant ?? 0;
        let n = 0;
        for (const r of rows)
          if (isMissing(r[step.column])) {
            r[step.column] = fill;
            n++;
          }
        log.push(
          `Filled ${n} missing values in "${step.column}" with ${step.method}${fill !== null ? ` (${(+fill).toFixed(3)})` : ""}.`,
        );
        break;
      }
      case "fill_categorical": {
        const present = rows.map((r) => r[step.column]).filter((v) => !isMissing(v));
        const fill = step.method === "mode" ? (mode(present) ?? "") : (step.constant ?? "");
        let n = 0;
        for (const r of rows)
          if (isMissing(r[step.column])) {
            r[step.column] = fill as Cell;
            n++;
          }
        log.push(
          `Filled ${n} missing values in "${step.column}" with ${step.method}${typeof fill === "string" ? ` ("${fill}")` : ""}.`,
        );
        break;
      }
      case "drop_duplicates": {
        const seen = new Set<string>();
        rows = rows.filter((r) => {
          const k = JSON.stringify(columns.map((c) => r[c]));
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        log.push(`Removed ${before - rows.length} duplicate rows.`);
        break;
      }
      case "outliers_iqr": {
        const nums = rows
          .map((r) => toNum(r[step.column]))
          .filter((n): n is number => n !== null)
          .sort((a, b) => a - b);
        if (!nums.length) {
          log.push(`Skipped outliers on "${step.column}" (no numeric values).`);
          break;
        }
        const q1 = quantile(nums, 0.25);
        const q3 = quantile(nums, 0.75);
        const iqr = q3 - q1;
        const lo = q1 - 1.5 * iqr;
        const hi = q3 + 1.5 * iqr;
        if (step.action === "remove") {
          rows = rows.filter((r) => {
            const v = toNum(r[step.column]);
            return v === null || (v >= lo && v <= hi);
          });
          log.push(
            `Removed ${before - rows.length} outliers in "${step.column}" (IQR bounds [${lo.toFixed(2)}, ${hi.toFixed(2)}]).`,
          );
        } else {
          let n = 0;
          for (const r of rows) {
            const v = toNum(r[step.column]);
            if (v === null) continue;
            if (v < lo) {
              r[step.column] = lo;
              n++;
            } else if (v > hi) {
              r[step.column] = hi;
              n++;
            }
          }
          log.push(
            `Capped ${n} outliers in "${step.column}" to [${lo.toFixed(2)}, ${hi.toFixed(2)}].`,
          );
        }
        break;
      }
      case "drop_columns": {
        for (const c of step.columns) {
          for (const r of rows) delete r[c];
        }
        log.push(`Dropped columns: ${step.columns.join(", ")}.`);
        break;
      }
    }
  }

  return { rows, log };
}

export function remainingColumns(columns: string[], steps: CleaningStep[]): string[] {
  const dropped = new Set<string>();
  for (const s of steps) if (s.kind === "drop_columns") s.columns.forEach((c) => dropped.add(c));
  return columns.filter((c) => !dropped.has(c));
}
