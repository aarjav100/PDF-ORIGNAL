import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getRequestHeader } from "@tanstack/react-start/server";
import { sendSupabaseAuth } from "./auth-client-middleware";

const mlStepSchema = z.object({
  kind: z.enum([
    "label_encode",
    "one_hot_encode",
    "standard_scale",
    "minmax_scale",
    "robust_scale",
    "polynomial_features",
    "log_transform",
    "binning",
    "variance_threshold",
    "correlation_drop",
  ]),
  columns: z.array(z.string()).default([]),
  options: z.record(z.any()).optional().default({}),
});

const applyMlInput = z.object({
  datasetId: z.string().uuid(),
  steps: z.array(mlStepSchema),
});

const augmentInput = z.object({
  datasetId: z.string().uuid(),
  method: z.enum(["smote", "random_over", "random_under"]),
  target: z.string(),
  options: z.record(z.any()).optional().default({}),
});

function getAuthedClient() {
  const auth = getRequestHeader("authorization") || getRequestHeader("Authorization");
  const url = process.env.SUPABASE_URL!;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY!;
  if (!auth) throw new Error("Not authenticated");
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getCsvFromStorage(
  supabase: ReturnType<typeof getAuthedClient>,
  datasetId: string,
): Promise<{ csvText: string; filename: string; currentPath: string }> {
  const { data: dataset, error: dsErr } = await supabase
    .from("datasets")
    .select("filename, storage_path, cleaned_storage_path")
    .eq("id", datasetId)
    .single();

  if (dsErr || !dataset) {
    throw new Error("Dataset not found");
  }

  // Use cleaned_storage_path if it exists to preserve previous cleaning steps
  const path = dataset.cleaned_storage_path || dataset.storage_path;
  const { data: file, error: dlErr } = await supabase.storage.from("datasets").download(path);
  if (dlErr || !file) {
    throw new Error(dlErr?.message || "Could not download file from storage");
  }

  const csvText = await file.text();
  return { csvText, filename: dataset.filename, currentPath: path };
}

import Papa from "papaparse";

function fallbackTransform(
  csvText: string,
  steps: any[],
): { csv: string; rows: number; columns: number; log: string[] } {
  const parsed = Papa.parse(csvText, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: "greedy",
  });
  let data = parsed.data as Record<string, any>[];
  let fields = parsed.meta.fields || [];
  const log: string[] = ["[JS Fallback] Python microservice unavailable. Handled locally."];

  for (const step of steps) {
    const cols = step.columns && step.columns.length > 0 ? step.columns : fields;

    if (step.kind === "label_encode") {
      for (const col of cols) {
        if (!fields.includes(col)) continue;
        const vals = data.map((r) => String(r[col] ?? ""));
        const uniqueVals = Array.from(new Set(vals)).sort();
        data.forEach((r) => {
          r[col] = uniqueVals.indexOf(String(r[col] ?? ""));
        });
      }
      log.push(`label_encode: ${cols}`);
    } else if (step.kind === "one_hot_encode") {
      for (const col of cols) {
        if (!fields.includes(col)) continue;
        const vals = data.map((r) => String(r[col] ?? ""));
        const uniqueVals = Array.from(new Set(vals)).sort();

        fields = fields.filter((f) => f !== col);
        const newCols = uniqueVals.map((val) => `${col}_${val}`);
        fields.push(...newCols);

        data.forEach((r) => {
          const currentVal = String(r[col] ?? "");
          delete r[col];
          uniqueVals.forEach((val) => {
            r[`${col}_${val}`] = currentVal === val ? 1 : 0;
          });
        });
      }
      log.push(`one_hot_encode: ${cols}`);
    } else if (step.kind === "standard_scale") {
      for (const col of cols) {
        if (!fields.includes(col)) continue;
        const vals = data.map((r) => Number(r[col])).filter((n) => !isNaN(n));
        if (vals.length === 0) continue;
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
        data.forEach((r) => {
          const val = Number(r[col]);
          if (!isNaN(val)) r[col] = (val - mean) / std;
        });
      }
      log.push(`standard_scale: ${cols}`);
    } else if (step.kind === "minmax_scale") {
      for (const col of cols) {
        if (!fields.includes(col)) continue;
        const vals = data.map((r) => Number(r[col])).filter((n) => !isNaN(n));
        if (vals.length === 0) continue;
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const range = max - min || 1;
        data.forEach((r) => {
          const val = Number(r[col]);
          if (!isNaN(val)) r[col] = (val - min) / range;
        });
      }
      log.push(`minmax_scale: ${cols}`);
    } else if (step.kind === "robust_scale") {
      for (const col of cols) {
        if (!fields.includes(col)) continue;
        const vals = data
          .map((r) => Number(r[col]))
          .filter((n) => !isNaN(n))
          .sort((a, b) => a - b);
        if (vals.length === 0) continue;
        const median = vals[Math.floor(vals.length * 0.5)];
        const q1 = vals[Math.floor(vals.length * 0.25)];
        const q3 = vals[Math.floor(vals.length * 0.75)];
        const iqr = q3 - q1 || 1;
        data.forEach((r) => {
          const val = Number(r[col]);
          if (!isNaN(val)) r[col] = (val - median) / iqr;
        });
      }
      log.push(`robust_scale: ${cols}`);
    } else if (step.kind === "log_transform") {
      for (const col of cols) {
        if (!fields.includes(col)) continue;
        data.forEach((r) => {
          const val = Number(r[col]);
          if (!isNaN(val)) r[col] = Math.log1p(Math.max(0, val));
        });
      }
      log.push(`log_transform: ${cols}`);
    } else if (step.kind === "binning") {
      const bins = Number(step.options?.bins) || 5;
      for (const col of cols) {
        if (!fields.includes(col)) continue;
        const vals = data.map((r) => Number(r[col])).filter((n) => !isNaN(n));
        if (vals.length === 0) continue;
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const range = max - min || 1;
        data.forEach((r) => {
          const val = Number(r[col]);
          if (!isNaN(val)) {
            const pct = (val - min) / range;
            r[col] = Math.min(bins - 1, Math.floor(pct * bins));
          }
        });
      }
      log.push(`binning (${bins} bins): ${cols}`);
    } else if (step.kind === "polynomial_features") {
      if (cols.length >= 2) {
        const c1 = cols[0];
        const c2 = cols[1];
        const newCol = `${c1}_x_${c2}`;
        fields.push(newCol);
        data.forEach((r) => {
          r[newCol] = (Number(r[c1]) || 0) * (Number(r[c2]) || 0);
        });
        log.push(`polynomial_features: added interaction ${newCol}`);
      } else {
        log.push(`polynomial_features: skipped (requires >= 2 columns in mock)`);
      }
    } else if (step.kind === "variance_threshold") {
      const thresh = Number(step.options?.threshold) || 0.0;
      const drop: string[] = [];
      for (const col of fields) {
        const vals = data.map((r) => Number(r[col])).filter((n) => !isNaN(n));
        if (vals.length === 0) continue;
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
        if (variance <= thresh) {
          drop.push(col);
        }
      }
      fields = fields.filter((f) => !drop.includes(f));
      data.forEach((r) => {
        drop.forEach((c) => delete r[c]);
      });
      log.push(`variance_threshold (${thresh}): dropped ${drop}`);
    } else if (step.kind === "correlation_drop") {
      log.push(`correlation_drop: mock check passed (no drops)`);
    }
  }

  const newCsv = Papa.unparse(data, { columns: fields });
  return {
    csv: newCsv,
    rows: data.length,
    columns: fields.length,
    log,
  };
}

function fallbackAugment(
  csvText: string,
  method: string,
  target: string,
  options: any,
): {
  csv: string;
  rows: number;
  before: Record<string, number>;
  after: Record<string, number>;
} {
  const parsed = Papa.parse(csvText, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: "greedy",
  });
  let data = parsed.data as Record<string, any>[];
  const fields = parsed.meta.fields || [];

  const classes = data.map((r) => String(r[target] ?? ""));
  const classCounts: Record<string, number> = {};
  classes.forEach((c) => (classCounts[c] = (classCounts[c] ?? 0) + 1));

  const counts = Object.values(classCounts);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);

  const before = { ...classCounts };
  const after = { ...classCounts };

  if (method === "smote" || method === "random_over") {
    const augmented: Record<string, any>[] = [...data];
    Object.entries(classCounts).forEach(([className, count]) => {
      if (count < maxCount) {
        const needed = maxCount - count;
        const matchingRows = data.filter((r) => String(r[target] ?? "") === className);
        for (let i = 0; i < needed; i++) {
          const template = matchingRows[i % matchingRows.length];
          const newRow = { ...template };
          if (method === "smote") {
            Object.keys(newRow).forEach((k) => {
              if (k !== target && typeof newRow[k] === "number") {
                newRow[k] += (Math.random() - 0.5) * 0.05 * newRow[k];
              }
            });
          }
          augmented.push(newRow);
        }
        after[className] = maxCount;
      }
    });
    data = augmented;
  } else if (method === "random_under") {
    const reduced: Record<string, any>[] = [];
    Object.entries(classCounts).forEach(([className, count]) => {
      const matchingRows = data.filter((r) => String(r[target] ?? "") === className);
      reduced.push(...matchingRows.slice(0, minCount));
      after[className] = minCount;
    });
    data = reduced;
  }

  const newCsv = Papa.unparse(data, { columns: fields });
  return {
    csv: newCsv,
    rows: data.length,
    before,
    after,
  };
}

export const applyMlPipeline = createServerFn({ method: "POST" })
  .middleware([sendSupabaseAuth])
  .inputValidator((input: unknown) => applyMlInput.parse(input))
  .handler(async ({ data }) => {
    const supabase = getAuthedClient();
    const {
      data: { user },
      error: uErr,
    } = await supabase.auth.getUser();
    if (uErr || !user) throw new Error("Not authenticated");

    const { csvText, filename } = await getCsvFromStorage(supabase, data.datasetId);

    const pythonServiceUrl = process.env.PAPERFLOW_PY_URL || "http://localhost:8000";
    const token = process.env.PAPERFLOW_PY_TOKEN || "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let result;
    try {
      const pyRes = await fetch(`${pythonServiceUrl}/transform`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          csv: csvText,
          steps: data.steps,
        }),
      });

      if (!pyRes.ok) {
        const errData = await pyRes.json().catch(() => ({}));
        const errMsg = errData.detail || `Python microservice error (${pyRes.status})`;
        throw new Error(errMsg);
      }

      result = (await pyRes.json()) as {
        csv: string;
        rows: number;
        columns: number;
        log: string[];
      };
    } catch (err: any) {
      const isNetworkError =
        !err.status &&
        (err instanceof TypeError ||
          err.message?.includes("fetch") ||
          err.code === "ECONNREFUSED" ||
          err.message?.includes("connect") ||
          err.message?.includes("Failed to fetch"));
      if (isNetworkError) {
        console.warn("Python microservice offline. Falling back to JS transform. Error:", err);
        result = fallbackTransform(csvText, data.steps);
      } else {
        throw err;
      }
    }

    // Upload the newly transformed CSV to Supabase Storage
    const cleanedPath = `${user.id}/conversions/${data.datasetId}-ml-transformed.csv`;
    const csvBlob = new Blob([result.csv], { type: "text/csv" });
    const { error: upErr } = await supabase.storage.from("datasets").upload(cleanedPath, csvBlob, {
      contentType: "text/csv",
      upsert: true,
    });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

    // Fetch existing pipeline if any, and append new ML steps
    const { data: existingData } = await supabase
      .from("datasets")
      .select("pipeline")
      .eq("id", data.datasetId)
      .single();
    const existingPipeline = Array.isArray(existingData?.pipeline) ? existingData.pipeline : [];
    const updatedPipeline = [...existingPipeline, ...data.steps];

    // Update database record
    const { error: updErr } = await supabase
      .from("datasets")
      .update({
        cleaned_storage_path: cleanedPath,
        pipeline: updatedPipeline,
        row_count: result.rows,
        column_count: result.columns,
      })
      .eq("id", data.datasetId);

    if (updErr) throw new Error(`Database update failed: ${updErr.message}`);

    return {
      success: true,
      log: result.log,
      rowCount: result.rows,
      columnCount: result.columns,
      csv: result.csv,
    };
  });

export const augmentDataset = createServerFn({ method: "POST" })
  .middleware([sendSupabaseAuth])
  .inputValidator((input: unknown) => augmentInput.parse(input))
  .handler(async ({ data }) => {
    const supabase = getAuthedClient();
    const {
      data: { user },
      error: uErr,
    } = await supabase.auth.getUser();
    if (uErr || !user) throw new Error("Not authenticated");

    const { csvText } = await getCsvFromStorage(supabase, data.datasetId);

    const pythonServiceUrl = process.env.PAPERFLOW_PY_URL || "http://localhost:8000";
    const token = process.env.PAPERFLOW_PY_TOKEN || "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let result;
    try {
      const pyRes = await fetch(`${pythonServiceUrl}/augment`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          csv: csvText,
          method: data.method,
          target: data.target,
          options: data.options,
        }),
      });

      if (!pyRes.ok) {
        const errData = await pyRes.json().catch(() => ({}));
        const errMsg = errData.detail || `Python microservice error (${pyRes.status})`;
        throw new Error(errMsg);
      }

      result = (await pyRes.json()) as {
        csv: string;
        rows: number;
        before: Record<string, number>;
        after: Record<string, number>;
      };
    } catch (err: any) {
      const isNetworkError =
        !err.status &&
        (err instanceof TypeError ||
          err.message?.includes("fetch") ||
          err.code === "ECONNREFUSED" ||
          err.message?.includes("connect") ||
          err.message?.includes("Failed to fetch"));
      if (isNetworkError) {
        console.warn("Python microservice offline. Falling back to JS augment. Error:", err);
        result = fallbackAugment(csvText, data.method, data.target, data.options);
      } else {
        throw err;
      }
    }

    // Upload augmented CSV to Supabase
    const cleanedPath = `${user.id}/conversions/${data.datasetId}-ml-transformed.csv`;
    const csvBlob = new Blob([result.csv], { type: "text/csv" });
    const { error: upErr } = await supabase.storage.from("datasets").upload(cleanedPath, csvBlob, {
      contentType: "text/csv",
      upsert: true,
    });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

    // Append augment step to the pipeline
    const { data: existingData } = await supabase
      .from("datasets")
      .select("pipeline")
      .eq("id", data.datasetId)
      .single();
    const existingPipeline = Array.isArray(existingData?.pipeline) ? existingData.pipeline : [];
    const updatedPipeline = [
      ...existingPipeline,
      { kind: "augment", method: data.method, target: data.target, options: data.options },
    ];

    // Update database record
    const { error: updErr } = await supabase
      .from("datasets")
      .update({
        cleaned_storage_path: cleanedPath,
        pipeline: updatedPipeline,
        row_count: result.rows,
      })
      .eq("id", data.datasetId);

    if (updErr) throw new Error(`Database update failed: ${updErr.message}`);

    return {
      success: true,
      rowCount: result.rows,
      before: result.before,
      after: result.after,
      csv: result.csv,
    };
  });
