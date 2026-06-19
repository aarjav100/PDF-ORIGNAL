import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { getRequestHeader } from "@tanstack/react-start/server";
import { sendSupabaseAuth } from "./auth-client-middleware";

/**
 * Conversion server function.
 * Reads a PDF from the user's storage, converts it, writes the output back,
 * and records a row in the `conversions` table.
 */

const inputSchema = z.object({
  documentId: z.string().uuid(),
  format: z.enum(["txt", "docx", "csv"]),
  ocr: z.boolean().optional().default(false),
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

async function extractTextFromPdf(buf: ArrayBuffer): Promise<{ text: string; pageTexts: string[] }> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    const text = (result.text || "").trim();
    const pageTexts = (result.pages || []).map((p) => p.text || "");
    return { text, pageTexts: pageTexts.length ? pageTexts : [text] };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function ocrPdf(buf: ArrayBuffer, filename: string): Promise<string> {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) throw new Error("OCR is not configured (missing OCR_SPACE_API_KEY)");

  const fd = new FormData();
  fd.append("apikey", apiKey);
  fd.append("language", "eng");
  fd.append("isTable", "true");
  fd.append("scale", "true");
  fd.append("OCREngine", "2");
  fd.append("filetype", "PDF");
  fd.append("file", new Blob([buf], { type: "application/pdf" }), filename);

  const res = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`OCR service error (${res.status})`);
  const json = (await res.json()) as {
    IsErroredOnProcessing?: boolean;
    ErrorMessage?: string | string[];
    ParsedResults?: Array<{ ParsedText?: string }>;
  };
  if (json.IsErroredOnProcessing) {
    const msg = Array.isArray(json.ErrorMessage) ? json.ErrorMessage.join("; ") : (json.ErrorMessage || "OCR failed");
    throw new Error(msg);
  }
  return (json.ParsedResults || []).map((p) => p.ParsedText || "").join("\n\n");
}

function textToDocxBuffer(text: string): Promise<Uint8Array> {
  const paras = text.split(/\n{2,}/).map((block) => {
    const lines = block.split(/\n/);
    const isHeading = lines.length === 1 && lines[0].length < 80 && /^[A-Z0-9].{0,80}$/.test(lines[0].trim());
    return new Paragraph({
      heading: isHeading ? HeadingLevel.HEADING_2 : undefined,
      children: lines.map((l, i) =>
        new TextRun({ text: l, break: i === 0 ? 0 : 1 })
      ),
      spacing: { after: 160 },
    });
  });

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: paras.length ? paras : [new Paragraph("(empty document)")],
    }],
  });
  return Packer.toBuffer(doc).then((b) => new Uint8Array(b));
}

function textToCsv(text: string): string {
  // Heuristic: each non-empty line becomes a row; split on runs of 2+ spaces or tabs.
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const rows = lines.map((l) => l.split(/\t|\s{2,}/).map((c) => c.trim()).filter(Boolean));
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 1);
  return rows
    .map((r) => {
      const padded = [...r, ...Array(maxCols - r.length).fill("")];
      return padded.map((cell) => {
        const s = cell.replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      }).join(",");
    })
    .join("\n");
}

export const convertPdf = createServerFn({ method: "POST" })
  .middleware([sendSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = getAuthedClient();
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) throw new Error("Not authenticated");

    const { data: doc, error: docErr } = await supabase
      .from("documents").select("*").eq("id", data.documentId).single();
    if (docErr || !doc) throw new Error("Document not found");

    // Insert pending conversion row
    const { data: conv, error: convInsertErr } = await supabase
      .from("conversions")
      .insert({ user_id: user.id, document_id: doc.id, target_format: data.format, status: "processing", ocr: data.ocr })
      .select().single();
    if (convInsertErr || !conv) throw new Error(convInsertErr?.message || "Could not create conversion");

    try {
      const { data: file, error: dlErr } = await supabase.storage.from("documents").download(doc.storage_path);
      if (dlErr || !file) throw new Error(dlErr?.message || "Could not download PDF");
      const buf = await file.arrayBuffer();

      let text: string;
      if (data.ocr) {
        text = await ocrPdf(buf, doc.filename);
      } else {
        const r = await extractTextFromPdf(buf);
        text = r.text;
        // Auto-fallback to OCR if extraction returned almost nothing
        if (text.replace(/\s/g, "").length < 20 && process.env.OCR_SPACE_API_KEY) {
          text = await ocrPdf(buf, doc.filename);
        }
      }

      let outBytes: Uint8Array;
      let outMime: string;
      let ext: string;
      if (data.format === "txt") {
        outBytes = new TextEncoder().encode(text);
        outMime = "text/plain";
        ext = "txt";
      } else if (data.format === "csv") {
        outBytes = new TextEncoder().encode(textToCsv(text));
        outMime = "text/csv";
        ext = "csv";
      } else {
        outBytes = await textToDocxBuffer(text);
        outMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        ext = "docx";
      }

      const baseName = doc.filename.replace(/\.pdf$/i, "");
      const outPath = `${user.id}/conversions/${conv.id}.${ext}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(outPath, outBytes, { contentType: outMime, upsert: true });
      if (upErr) throw new Error(upErr.message);

      const { error: updErr } = await supabase.from("conversions")
        .update({ status: "done", output_path: outPath })
        .eq("id", conv.id);
      if (updErr) throw new Error(updErr.message);

      return { conversionId: conv.id, outputPath: outPath, filename: `${baseName}.${ext}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Conversion failed";
      await supabase.from("conversions").update({ status: "failed", error: msg }).eq("id", conv.id);
      throw new Error(msg);
    }
  });
