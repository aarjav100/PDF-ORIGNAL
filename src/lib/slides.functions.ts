import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getRequestHeader } from "@tanstack/react-start/server";
import { sendSupabaseAuth } from "./auth-client-middleware";
import { callAi } from "./ai";


/**
 * AI slide generation from a stored PDF.
 * 1. Downloads the PDF
 * 2. Extracts text (pdfjs, with OCR.space fallback for scans)
 * 3. Sends text to Lovable AI with a tool-call schema
 * 4. Returns structured slide JSON for the client to render with pptxgenjs
 */

const inputSchema = z.object({
  documentId: z.string().uuid(),
  mode: z.enum(["summary", "detailed"]).default("detailed"),
  slideCount: z.number().int().min(1).max(20).optional(),
  style: z.enum(["bullets", "narrative", "questions", "executive", "educational"]).optional(),
});

const slideSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  bullets: z.array(z.string()).default([]),
  imageSuggestion: z.string().optional(),
});

export type Slide = z.infer<typeof slideSchema>;

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

async function extractText(buf: ArrayBuffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    return (result.text || "").trim();
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function ocrFallback(buf: ArrayBuffer, filename: string): Promise<string> {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) return "";
  const fd = new FormData();
  fd.append("apikey", apiKey);
  fd.append("language", "eng");
  fd.append("OCREngine", "2");
  fd.append("filetype", "PDF");
  fd.append("file", new Blob([buf], { type: "application/pdf" }), filename);
  const res = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: fd });
  if (!res.ok) return "";
  const json = (await res.json()) as { ParsedResults?: Array<{ ParsedText?: string }> };
  return (json.ParsedResults || []).map((p) => p.ParsedText || "").join("\n\n");
}

export const generateSlides = createServerFn({ method: "POST" })
  .middleware([sendSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = getAuthedClient();
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) throw new Error("Not authenticated");

    const { data: doc, error: docErr } = await supabase.from("documents").select("*").eq("id", data.documentId).single();
    if (docErr || !doc) throw new Error("Document not found");

    const { data: file, error: dlErr } = await supabase.storage.from("documents").download(doc.storage_path);
    if (dlErr || !file) throw new Error("Could not download PDF");
    const buf = await file.arrayBuffer();

    let text = await extractText(buf);
    if (text.replace(/\s/g, "").length < 30) text = await ocrFallback(buf, doc.filename);
    if (!text.trim()) throw new Error("Could not extract any text from this PDF");

    // Truncate to keep prompt small
    const trimmed = text.slice(0, 18000);

    const requestedCount = data.slideCount
      ?? (data.mode === "summary" ? 1 : 4);
    const countInstr = requestedCount === 1
      ? "exactly 1 slide that captures the entire essence"
      : `exactly ${requestedCount} slides covering the document end-to-end`;
    const styleGuides: Record<NonNullable<typeof data.style>, string> = {
      bullets: "Use concise bullet points (3-5 per slide, max 14 words each).",
      narrative: "Write 2-3 short narrative sentences per slide instead of bullets; keep bullets array filled with these sentences.",
      questions: "Frame each slide title as a question the audience would ask, with bullets that answer it.",
      executive: "Executive briefing tone: 2-3 high-signal bullets per slide, lead with outcomes and metrics.",
      educational: "Teaching tone: each slide introduces a concept, then 3-4 bullets explaining it with examples.",
    };
    const styleInstr = data.style ? styleGuides[data.style] : "Use concise bullet points (3-5 per slide, max 14 words each).";
    const systemPrompt = `You are an expert presentation designer. Convert source documents into clear, well-structured slide decks. ${styleInstr} Titles max 8 words. Suggest a simple image concept per slide.`;
    const userPrompt = `Build a presentation from the document below. Generate ${countInstr}.\n\nDOCUMENT:\n${trimmed}`;

    const json = await callAi({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [{
        type: "function",
        function: {
          name: "build_deck",
          description: "Return a structured slide deck.",
          parameters: {
            type: "object",
            properties: {
              deckTitle: { type: "string", description: "Overall presentation title" },
              slides: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    subtitle: { type: "string" },
                    bullets: { type: "array", items: { type: "string" } },
                    imageSuggestion: { type: "string", description: "1-line description of an illustrative image" },
                  },
                  required: ["title", "bullets"],
                  additionalProperties: false,
                },
              },
            },
            required: ["deckTitle", "slides"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "build_deck" } },
    });

    const argStr = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argStr) throw new Error("AI did not return slide data");

    const parsed = z.object({
      deckTitle: z.string(),
      slides: z.array(slideSchema).min(1),
    }).parse(JSON.parse(argStr));

    return { deckTitle: parsed.deckTitle, slides: parsed.slides, sourceFilename: doc.filename };
  });
