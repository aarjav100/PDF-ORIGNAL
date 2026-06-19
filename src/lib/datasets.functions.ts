import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getRequestHeader } from "@tanstack/react-start/server";
import { sendSupabaseAuth } from "./auth-client-middleware";
import { callAi } from "./ai";


/**
 * AI dataset analysis. Receives a compact statistical summary (computed client-side)
 * and asks Lovable AI to produce human-readable insights + suggested preprocessing steps.
 */

const colStatSchema = z.object({
  name: z.string(),
  dtype: z.enum(["numeric", "categorical", "boolean", "datetime", "text"]),
  missing: z.number().int().nonnegative(),
  unique: z.number().int().nonnegative(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  mean: z.number().nullable().optional(),
  median: z.number().nullable().optional(),
  std: z.number().nullable().optional(),
  topValues: z.array(z.object({ value: z.string(), count: z.number().int() })).optional(),
});

const inputSchema = z.object({
  datasetId: z.string().uuid(),
  rowCount: z.number().int().nonnegative(),
  columnCount: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  memoryBytes: z.number().int().nonnegative(),
  columns: z.array(colStatSchema).max(80),
  sampleRows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(10),
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

const reportSchema = z.object({
  summary: z.string(),
  dataQuality: z.object({
    score: z.number().min(0).max(100),
    issues: z.array(z.string()),
  }),
  missingValueAnalysis: z.string(),
  duplicateAnalysis: z.string(),
  outlierAnalysis: z.string(),
  classImbalance: z.string().optional(),
  suggestedTarget: z.string().optional(),
  preprocessingSteps: z.array(z.object({
    step: z.string(),
    rationale: z.string(),
    column: z.string().optional(),
  })).min(1),
});

export type DatasetReport = z.infer<typeof reportSchema>;

export const analyzeDataset = createServerFn({ method: "POST" })
  .middleware([sendSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = getAuthedClient();
    const { data: { user }, error: uErr } = await supabase.auth.getUser();
    if (uErr || !user) throw new Error("Not authenticated");

    const systemPrompt = `You are a senior data scientist. Given a dataset profile, produce a clear, plain-English report for a non-technical user. Always recommend concrete preprocessing steps tied to specific columns when relevant. Score data quality 0-100 (100 = pristine).`;

    const userPrompt = `Profile of dataset "${data.datasetId}":
Rows: ${data.rowCount}, Columns: ${data.columnCount}, Duplicates: ${data.duplicateRows}, Memory: ${(data.memoryBytes / 1024).toFixed(1)} KB

COLUMNS:
${JSON.stringify(data.columns, null, 2)}

SAMPLE (first ${data.sampleRows.length} rows):
${JSON.stringify(data.sampleRows, null, 2)}

Analyze: missing values, duplicates, outliers (use IQR signals from min/max/median), class imbalance (if a column looks like a target), and recommend a preprocessing pipeline.`;

    const json = await callAi({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [{
        type: "function",
        function: {
          name: "report",
          description: "Return a structured dataset analysis report.",
          parameters: {
            type: "object",
            properties: {
              summary: { type: "string" },
              dataQuality: {
                type: "object",
                properties: {
                  score: { type: "number" },
                  issues: { type: "array", items: { type: "string" } },
                },
                required: ["score", "issues"],
                additionalProperties: false,
              },
              missingValueAnalysis: { type: "string" },
              duplicateAnalysis: { type: "string" },
              outlierAnalysis: { type: "string" },
              classImbalance: { type: "string" },
              suggestedTarget: { type: "string" },
              preprocessingSteps: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    step: { type: "string" },
                    rationale: { type: "string" },
                    column: { type: "string" },
                  },
                  required: ["step", "rationale"],
                  additionalProperties: false,
                },
              },
            },
            required: ["summary", "dataQuality", "missingValueAnalysis", "duplicateAnalysis", "outlierAnalysis", "preprocessingSteps"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "report" } },
    });

    const argStr = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argStr) throw new Error("AI did not return a report");


    const parsed = reportSchema.parse(JSON.parse(argStr));

    await supabase.from("datasets").update({ analysis: parsed }).eq("id", data.datasetId);

    return parsed;
  });
