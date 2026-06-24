import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getRequestHeader } from "@tanstack/react-start/server";
import { sendSupabaseAuth } from "./auth-client-middleware";
import { callAi } from "./ai";

const inputSchema = z.object({
  documentId: z.string().uuid(),
});

const flashcardSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

const quizSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  answerIndex: z.number().int(),
  explanation: z.string(),
});

const outputSchema = z.object({
  summary: z.string(),
  flashcards: z.array(flashcardSchema),
  quizzes: z.array(quizSchema),
});

export type Flashcard = z.infer<typeof flashcardSchema>;
export type Quiz = z.infer<typeof quizSchema>;

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

export const generateStudyMaterials = createServerFn({ method: "POST" })
  .middleware([sendSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = getAuthedClient();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) throw new Error("Not authenticated");

    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("*")
      .eq("id", data.documentId)
      .single();
    if (docErr || !doc) throw new Error("Document not found");

    const { data: file, error: dlErr } = await supabase.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlErr || !file) throw new Error("Could not download PDF");
    const buf = await file.arrayBuffer();

    let text = await extractText(buf);
    if (text.replace(/\s/g, "").length < 30) {
      text = await ocrFallback(buf, doc.filename);
    }
    if (!text.trim()) throw new Error("Could not extract any text from this PDF");

    // Keep prompt size manageable
    const trimmed = text.slice(0, 18000);

    const systemPrompt = "You are an expert tutor. Create interactive study materials from the provided document contents, including a set of flashcards (Q&A) and a set of multiple-choice questions (MCQs) with correct answers and explanations. Return structured outputs matching the schema.";
    const userPrompt = `Build study materials from the document below. Generate exactly 6 to 8 flashcards and 4 to 6 multiple-choice questions.\n\nDOCUMENT:\n${trimmed}`;

    const json = await callAi({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "build_study_materials",
            description: "Return structured flashcards and quizzes for studying.",
            parameters: {
              type: "object",
              properties: {
                summary: {
                  type: "string",
                  description: "A cohesive, high-level summary of the PDF contents in 2-3 paragraphs.",
                },
                flashcards: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      question: { type: "string", description: "Direct question, e.g. What is supervised learning?" },
                      answer: { type: "string", description: "Detailed, clear answer" },
                    },
                    required: ["question", "answer"],
                  },
                },
                quizzes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      question: { type: "string", description: "Quiz question" },
                      options: {
                        type: "array",
                        items: { type: "string" },
                        description: "List of 3 or 4 choice strings",
                      },
                      answerIndex: {
                        type: "integer",
                        description: "0-indexed index of the correct option in options array",
                      },
                      explanation: { type: "string", description: "Short explanation why this option is correct" },
                    },
                    required: ["question", "options", "answerIndex", "explanation"],
                  },
                },
              },
              required: ["summary", "flashcards", "quizzes"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "build_study_materials" } },
    });

    const call = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      throw new Error("AI did not call the generation tool correctly");
    }
    const parsed = JSON.parse(call.function.arguments);
    return outputSchema.parse(parsed);
  });
