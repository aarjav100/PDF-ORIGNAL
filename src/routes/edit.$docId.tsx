import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  Loader2, ArrowLeft, Download, Highlighter, Type, Save, Pencil, Undo2, Redo2,
  Bold, Italic, Underline as UnderlineIcon, MousePointer2, Trash2, MessageCircle, X,
} from "lucide-react";
import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/edit/$docId")({
  head: () => ({ meta: [{ title: "Edit PDF — Paperflow" }] }),
  component: () => (
    <AuthProvider>
      <Guard><Editor /></Guard>
    </AuthProvider>
  ),
});

function Guard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [loading, user, navigate]);
  if (loading || !user) return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  return <>{children}</>;
}

type Tool = "select" | "text" | "highlight" | "draw" | "comment";

interface TextAnn {
  id: string; page: number; type: "text";
  x: number; y: number; w: number; h: number; // normalized 0..1
  text: string;
  fontFamily: string; fontSize: number; // PDF units
  color: string; bold: boolean; italic: boolean; underline: boolean;
}
interface HighlightAnn {
  id: string; page: number; type: "highlight";
  x: number; y: number; w: number; h: number; color: string;
}
interface DrawAnn {
  id: string; page: number; type: "draw";
  points: { x: number; y: number }[]; color: string; strokeWidth: number;
}
interface CommentAnn {
  id: string; page: number; type: "comment";
  x: number; y: number; text: string;
}
type Annotation = TextAnn | HighlightAnn | DrawAnn | CommentAnn;

interface TextSpan {
  id: string; page: number;
  pdfX: number; pdfY: number; pdfWidth: number; pdfHeight: number;
  originalText: string; originalFontName: string;
  fontFamily: string; letterSpacing: number;
  text: string; color: string; fontSize: number;
  bold: boolean; italic: boolean; underline: boolean; edited: boolean;
}

interface ParagraphBlock {
  id: string;
  page: number;
  pdfX: number;
  pdfY: number;       // bottom-most Y in PDF coords (PDF origin = bottom-left)
  pdfWidth: number;
  pdfHeight: number;
  pdfTopY: number;     // top-most Y in PDF coords (pdfY + pdfHeight)
  spans: TextSpan[];
  originalText: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  lineHeight: number;  // in PDF units
  edited: boolean;
  shiftY: number;      // accumulated vertical shift from reflow (PDF units, positive = downward shift)
}

/**
 * Groups individual text spans into logical paragraph blocks using spatial proximity.
 */
function groupSpansIntoParagraphs(spans: TextSpan[]): ParagraphBlock[] {
  if (spans.length === 0) return [];

  const blocks: ParagraphBlock[] = [];
  const pageGroups = new Map<number, TextSpan[]>();
  for (const s of spans) {
    if (!pageGroups.has(s.page)) pageGroups.set(s.page, []);
    pageGroups.get(s.page)!.push(s);
  }

  for (const [page, pageSpans] of pageGroups) {
    // Sort by Y descending (top of page first in visual order, since PDF Y=0 is bottom)
    // then by X ascending
    const sorted = [...pageSpans].sort((a, b) => {
      const aTop = a.pdfY + a.pdfHeight;
      const bTop = b.pdfY + b.pdfHeight;
      const yDiff = bTop - aTop; // descending — top of page first
      if (Math.abs(yDiff) > Math.min(a.pdfHeight, b.pdfHeight) * 0.5) return yDiff;
      return a.pdfX - b.pdfX; // left to right
    });

    // Step 1: Group into visual lines
    const lines: TextSpan[][] = [];
    let currentLine: TextSpan[] = [];
    let currentLineY = -Infinity;

    for (const span of sorted) {
      const spanTop = span.pdfY + span.pdfHeight;
      if (currentLine.length === 0) {
        currentLine.push(span);
        currentLineY = spanTop;
      } else {
        const tolerance = Math.min(span.pdfHeight, currentLine[0].pdfHeight) * 0.7;
        if (Math.abs(spanTop - currentLineY) <= tolerance) {
          currentLine.push(span);
        } else {
          // Sort line left-to-right
          currentLine.sort((a, b) => a.pdfX - b.pdfX);
          lines.push(currentLine);
          currentLine = [span];
          currentLineY = spanTop;
        }
      }
    }
    if (currentLine.length > 0) {
      currentLine.sort((a, b) => a.pdfX - b.pdfX);
      lines.push(currentLine);
    }

    // Step 2: Group lines into paragraphs based on vertical proximity and X alignment
    let paraLines: TextSpan[][] = [];
    for (let li = 0; li < lines.length; li++) {
      if (paraLines.length === 0) {
        paraLines.push(lines[li]);
        continue;
      }
      const prevLine = paraLines[paraLines.length - 1];
      const currLine = lines[li];

      const prevBottom = Math.min(...prevLine.map(s => s.pdfY));
      const currTop = Math.max(...currLine.map(s => s.pdfY + s.pdfHeight));
      const avgFontSize = (prevLine[0].pdfHeight + currLine[0].pdfHeight) / 2;
      const gap = prevBottom - currTop; // positive = space between

      // Check if left edges are roughly aligned
      const prevLeft = Math.min(...prevLine.map(s => s.pdfX));
      const currLeft = Math.min(...currLine.map(s => s.pdfX));
      const xAligned = Math.abs(prevLeft - currLeft) < avgFontSize * 3;

      // Merge if gap is small and X is roughly aligned
      if (gap < avgFontSize * 1.8 && gap > -avgFontSize * 0.5 && xAligned) {
        paraLines.push(currLine);
      } else {
        // Emit current paragraph and start new one
        blocks.push(buildParagraphBlock(page, paraLines, blocks.length));
        paraLines = [currLine];
      }
    }
    if (paraLines.length > 0) {
      blocks.push(buildParagraphBlock(page, paraLines, blocks.length));
    }
  }

  return blocks;
}

function buildParagraphBlock(page: number, lines: TextSpan[][], idx: number): ParagraphBlock {
  const allSpans = lines.flat();

  // Bounding box
  const pdfX = Math.min(...allSpans.map(s => s.pdfX));
  const pdfY = Math.min(...allSpans.map(s => s.pdfY));
  const pdfRight = Math.max(...allSpans.map(s => s.pdfX + s.pdfWidth));
  const pdfTopY = Math.max(...allSpans.map(s => s.pdfY + s.pdfHeight));
  const pdfWidth = pdfRight - pdfX;
  const pdfHeight = pdfTopY - pdfY;

  // Join text: spaces between spans on the same line, newlines between lines
  const lineTexts = lines.map(line => line.map(s => s.text).join(" "));
  const fullText = lineTexts.join("\n");

  // Dominant formatting (most common / first span)
  const dominant = allSpans[0];
  const lineHeight = lines.length > 1
    ? Math.abs((lines[0][0].pdfY + lines[0][0].pdfHeight) - (lines[1][0].pdfY + lines[1][0].pdfHeight))
    : dominant.pdfHeight * 1.3;

  return {
    id: `para-${page}-${idx}`,
    page,
    pdfX,
    pdfY,
    pdfWidth: Math.max(pdfWidth, 50), // minimum width to prevent tiny blocks
    pdfHeight,
    pdfTopY,
    spans: allSpans,
    originalText: fullText,
    text: fullText,
    fontFamily: dominant.fontFamily,
    fontSize: dominant.fontSize,
    color: dominant.color,
    bold: dominant.bold,
    italic: dominant.italic,
    underline: dominant.underline,
    lineHeight,
    edited: false,
    shiftY: 0,
  };
}

/**
 * Recalculates paragraph positions after an edit causes one block to grow/shrink.
 * Returns updated blocks with adjusted shiftY values.
 */
function reflowParagraphs(
  blocks: ParagraphBlock[],
  editedBlockId: string,
  heightDeltaPdfUnits: number,
): ParagraphBlock[] {
  // Only reflow blocks on the same page, below the edited block
  const editedBlock = blocks.find(b => b.id === editedBlockId);
  if (!editedBlock || Math.abs(heightDeltaPdfUnits) < 0.5) return blocks;

  return blocks.map(b => {
    if (b.page !== editedBlock.page) return b;
    if (b.id === editedBlockId) return b;

    // Block is below the edited block if its top is below edited block's bottom
    const editedBottom = editedBlock.pdfY - editedBlock.shiftY; // original bottom
    const blockTop = b.pdfTopY - b.shiftY; // original top

    if (blockTop < editedBottom) {
      // This block is visually below the edited block — shift it down
      return { ...b, shiftY: b.shiftY + heightDeltaPdfUnits };
    }
    return b;
  });
}

/**
 * Word-wraps text for PDF export given font metrics.
 */
function wrapTextForPdf(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const inputLines = text.split("\n");
  const result: string[] = [];

  for (const line of inputLines) {
    if (!line.trim()) {
      result.push("");
      continue;
    }
    const words = line.split(/(\s+)/); // preserve whitespace tokens
    let current = "";
    for (const word of words) {
      if (!word) continue;
      const test = current + word;
      try {
        if (current && font.widthOfTextAtSize(test, fontSize) > maxWidth) {
          result.push(current.trimEnd());
          current = word.trimStart();
        } else {
          current = test;
        }
      } catch {
        current = test; // fallback if font metrics fail
      }
    }
    if (current) result.push(current.trimEnd());
  }

  return result;
}

const FONT_FAMILIES = [
  "Helvetica, Arial, sans-serif",
  "'Times New Roman', Times, serif",
  "Georgia, serif",
  "'Courier New', monospace",
];
const HIGHLIGHT_COLORS = ["#fde047", "#86efac", "#f9a8d4", "#93c5fd"];

function Editor() {
  const { docId } = Route.useParams();
  const { user } = useAuth();
  const [filename, setFilename] = useState("");
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [isImage, setIsImage] = useState(false);
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null);
  const [pages, setPages] = useState<{ width: number; height: number; pdfWidth: number; pdfHeight: number }[]>([]);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [textSpans, setTextSpans] = useState<TextSpan[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [past, setPast] = useState<Annotation[][]>([]);
  const [future, setFuture] = useState<Annotation[][]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSpanId, setActiveSpanId] = useState<string | null>(null);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [paragraphBlocks, setParagraphBlocks] = useState<ParagraphBlock[]>([]);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Tool defaults
  const [highlightColor, setHighlightColor] = useState("#fde047");
  const [drawColor, setDrawColor] = useState("#dc2626");
  const [drawWidth, setDrawWidth] = useState(3);
  const [textDefaults, setTextDefaults] = useState({
    fontFamily: FONT_FAMILIES[0], fontSize: 16, color: "#111827",
    bold: false, italic: false, underline: false,
  });

  // Active drag/draw refs
  const dragRef = useRef<
    | { kind: "draw"; id: string; page: number }
    | { kind: "rect"; id: string; page: number; startX: number; startY: number }
    | { kind: "move"; id: string; page: number; offX: number; offY: number }
    | { kind: "resize"; id: string; page: number; corner: "nw" | "ne" | "sw" | "se"; startX: number; startY: number; orig: { x: number; y: number; w: number; h: number } }
    | null
  >(null);
  const spanRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ---------- History helpers ----------
  const commit = useCallback((updater: (prev: Annotation[]) => Annotation[]) => {
    setAnnotations((prev) => {
      const next = updater(prev);
      setPast((p) => [...p, prev]);
      setFuture([]);
      return next;
    });
  }, []);
  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setAnnotations((curr) => { setFuture((f) => [...f, curr]); return prev; });
      setSelectedAnnId(null); setEditingTextId(null);
      return p.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setAnnotations((curr) => { setPast((p) => [...p, curr]); return next; });
      setSelectedAnnId(null); setEditingTextId(null);
      return f.slice(0, -1);
    });
  }, []);

  // Load PDF
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: doc, error } = await supabase.from("documents").select("*").eq("id", docId).single();
        if (error || !doc) throw new Error("Document not found");
        setFilename(doc.filename);
        supabase.from("documents").update({ last_opened_at: new Date().toISOString() }).eq("id", docId).then(() => {});

        const { data: blob, error: dlErr } = await supabase.storage.from("documents").download(doc.storage_path);
        if (dlErr || !blob) throw new Error("Download failed");

        const lower = (doc.filename as string).toLowerCase();
        const looksImage = /\.(png|jpe?g|webp|gif|bmp)$/.test(lower) || blob.type.startsWith("image/");

        if (looksImage) {
          // ---------- Image mode ----------
          const url = URL.createObjectURL(blob);
          setImageBlobUrl(url);
          setIsImage(true);
          const img = new Image();
          img.crossOrigin = "anonymous";
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("Image load failed"));
            img.src = url;
          });
          setPageImages([url]);
          setPages([{ width: img.naturalWidth, height: img.naturalHeight, pdfWidth: img.naturalWidth, pdfHeight: img.naturalHeight }]);
          setTextSpans([]);
          setPdfBytes(null);
          return;
        }

        const buf = new Uint8Array(await blob.arrayBuffer());
        setPdfBytes(buf);

        const pdfjs = await import("pdfjs-dist");
        const workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

        const pdf = await pdfjs.getDocument({ data: buf.slice() }).promise;
        const imgs: string[] = [];
        const dims: { width: number; height: number; pdfWidth: number; pdfHeight: number }[] = [];
        const allSpans: TextSpan[] = [];
        const SCALE = 1.5;

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: SCALE });
          const pdfViewport = page.getViewport({ scale: 1 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width; canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvas, canvasContext: ctx, viewport } as Parameters<typeof page.render>[0]).promise;
          imgs.push(canvas.toDataURL("image/png"));
          dims.push({ width: viewport.width, height: viewport.height, pdfWidth: pdfViewport.width, pdfHeight: pdfViewport.height });

          const tc = await page.getTextContent();
          const styles = (tc as unknown as { styles: Record<string, { fontFamily?: string }> }).styles || {};

          const sampleColor = (cx: number, cy: number, w: number, h: number): string => {
            try {
              const sx = Math.max(0, Math.floor(cx)), sy = Math.max(0, Math.floor(cy));
              const sw = Math.max(1, Math.min(canvas.width - sx, Math.floor(w)));
              const sh = Math.max(1, Math.min(canvas.height - sy, Math.floor(h)));
              const data = ctx.getImageData(sx, sy, sw, sh).data;
              let r = 0, g = 0, b = 0, n = 0;
              for (let p = 0; p < data.length; p += 4) {
                const rr = data[p], gg = data[p + 1], bb = data[p + 2], aa = data[p + 3];
                if (aa < 32) continue;
                if (rr > 235 && gg > 235 && bb > 235) continue;
                r += rr; g += gg; b += bb; n++;
              }
              if (n === 0) return "#000000";
              const toHex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
              return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            } catch { return "#000000"; }
          };

          for (const item of tc.items as Array<{ str: string; transform: number[]; width: number; height: number; fontName: string }>) {
            if (!item.str || !item.str.trim()) continue;
            const t = item.transform;
            const pdfX = t[4], pdfY = t[5];
            const fontHeight = Math.hypot(t[2], t[3]) || item.height || 10;
            const fontName = item.fontName || "";
            const bold = /bold|black|heavy|semibold/i.test(fontName);
            const italic = /italic|oblique/i.test(fontName);
            const styleFamily = styles[fontName]?.fontFamily;
            const lname = fontName.toLowerCase();
            const fallbackFamily = /mono|courier|consolas|menlo/.test(lname)
              ? "ui-monospace, 'Courier New', monospace"
              : /times|serif|roman|georgia|cambria/.test(lname)
                ? "'Times New Roman', Times, serif"
                : "Helvetica, Arial, sans-serif";
            const fontFamily = styleFamily ? `${styleFamily}, ${fallbackFamily}` : fallbackFamily;
            const cx = pdfX * SCALE, cyTop = (pdfViewport.height - pdfY - fontHeight) * SCALE;
            const color = sampleColor(cx, cyTop, item.width * SCALE, fontHeight * SCALE);

            let letterSpacing = 0;
            if (item.str.length > 1 && ctx) {
              ctx.save();
              ctx.font = `${italic ? "italic " : ""}${bold ? "700 " : ""}${fontHeight * SCALE}px ${fontFamily}`;
              const natural = ctx.measureText(item.str).width / SCALE;
              ctx.restore();
              const extra = (item.width - natural) / (item.str.length - 1);
              if (Number.isFinite(extra) && Math.abs(extra) > 0.05) letterSpacing = extra;
            }

            allSpans.push({
              id: `p${i - 1}-${allSpans.length}`, page: i - 1,
              pdfX, pdfY, pdfWidth: item.width, pdfHeight: fontHeight,
              originalText: item.str, originalFontName: fontName,
              fontFamily, letterSpacing,
              text: item.str, color, fontSize: fontHeight,
              bold, italic, underline: false, edited: false,
            });
          }
        }
        setPageImages(imgs); setPages(dims); setTextSpans(allSpans);
        setParagraphBlocks(groupSpansIntoParagraphs(allSpans));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load");
      } finally { setLoading(false); }
    })();
  }, [docId]);

  const updateSpan = useCallback((id: string, patch: Partial<TextSpan>) => {
    setTextSpans((spans) => spans.map((s) => s.id === id ? { ...s, ...patch, edited: true } : s));
  }, []);

  // ---- Paragraph block helpers ----
  const updateBlock = useCallback((id: string, patch: Partial<ParagraphBlock>) => {
    setParagraphBlocks((blocks) => blocks.map((b) => b.id === id ? { ...b, ...patch } : b));
  }, []);

  const saveBlock = useCallback((id: string) => {
    setParagraphBlocks((blocks) => {
      const block = blocks.find(b => b.id === id);
      if (!block) return blocks;

      // Mark as edited and compute height change
      const el = blockRefs.current[id];
      let updated = blocks.map(b => b.id === id ? { ...b, edited: true } : b);

      if (el) {
        const renderedHeight = el.scrollHeight;
        // Convert rendered pixel height to PDF units
        // The block is rendered at xScale/yScale of the page
        const pageInfo = pages[block.page];
        if (pageInfo) {
          const yScale = pageInfo.height / pageInfo.pdfHeight;
          const newPdfHeight = renderedHeight / yScale;
          const heightDelta = newPdfHeight - block.pdfHeight;

          if (Math.abs(heightDelta) > 0.5) {
            // Update the block's height
            updated = updated.map(b => b.id === id ? { ...b, pdfHeight: newPdfHeight } : b);
            // Reflow blocks below
            updated = reflowParagraphs(updated, id, heightDelta);
          }
        }
      }

      return updated;
    });
    setEditingBlockId(null);
    toast.success("Changes saved");
  }, [pages]);

  const cancelBlock = useCallback((id: string) => {
    setParagraphBlocks((blocks) => blocks.map(b => {
      if (b.id !== id) return b;
      return { ...b, text: b.originalText, edited: b.edited }; // revert text but keep prior edits
    }));
    setEditingBlockId(null);
  }, []);

  const updateAnn = useCallback(<T extends Annotation>(id: string, patch: Partial<T>) => {
    commit((prev) => prev.map((a) => a.id === id ? ({ ...a, ...patch } as Annotation) : a));
  }, [commit]);

  const deleteAnn = useCallback((id: string) => {
    commit((prev) => prev.filter((a) => a.id !== id));
    setSelectedAnnId(null); setEditingTextId(null);
  }, [commit]);

  // ---------- Page interaction ----------
  const getPagePos = (e: React.MouseEvent | MouseEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height, rect };
  };

  const onPageMouseDown = (e: React.MouseEvent<HTMLDivElement>, page: number) => {
    if (tool === "select") return;
    // ignore if interaction started on an existing annotation handle
    if ((e.target as HTMLElement).dataset.annHit) return;
    const { x, y } = getPagePos(e, e.currentTarget);
    const id = crypto.randomUUID();
    if (tool === "text") {
      const w = 0.18, h = 0.04;
      const newAnn: TextAnn = {
        id, page, type: "text", x, y, w, h, text: "",
        fontFamily: textDefaults.fontFamily, fontSize: textDefaults.fontSize,
        color: textDefaults.color, bold: textDefaults.bold,
        italic: textDefaults.italic, underline: textDefaults.underline,
      };
      commit((prev) => [...prev, newAnn]);
      setSelectedAnnId(id);
      setEditingTextId(id);
      setTool("select");
      // focus once mounted
      setTimeout(() => {
        const el = document.getElementById(`text-ann-${id}`);
        el?.focus();
      }, 0);
    } else if (tool === "highlight") {
      dragRef.current = { kind: "rect", id, page, startX: x, startY: y };
      const newAnn: HighlightAnn = { id, page, type: "highlight", x, y, w: 0, h: 0, color: highlightColor };
      // tentative — not committed until mouseup
      setAnnotations((a) => [...a, newAnn]);
    } else if (tool === "draw") {
      dragRef.current = { kind: "draw", id, page };
      const newAnn: DrawAnn = { id, page, type: "draw", points: [{ x, y }], color: drawColor, strokeWidth: drawWidth };
      setAnnotations((a) => [...a, newAnn]);
    } else if (tool === "comment") {
      const newAnn: CommentAnn = { id, page, type: "comment", x, y, text: "" };
      commit((prev) => [...prev, newAnn]);
      setSelectedAnnId(id);
      setEditingTextId(id);
      setTool("select");
    }
  };

  const onPageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const { x, y } = getPagePos(e, e.currentTarget);
    if (d.kind === "draw") {
      setAnnotations((a) => a.map((an) => an.id === d.id && an.type === "draw" ? { ...an, points: [...an.points, { x, y }] } : an));
    } else if (d.kind === "rect") {
      const nx = Math.min(d.startX, x), ny = Math.min(d.startY, y);
      const nw = Math.abs(x - d.startX), nh = Math.abs(y - d.startY);
      setAnnotations((a) => a.map((an) => an.id === d.id && an.type === "highlight" ? { ...an, x: nx, y: ny, w: nw, h: nh } : an));
    } else if (d.kind === "move") {
      setAnnotations((a) => a.map((an) => {
        if (an.id !== d.id) return an;
        if (an.type === "text" || an.type === "highlight") {
          return { ...an, x: Math.max(0, Math.min(1 - an.w, x - d.offX)), y: Math.max(0, Math.min(1 - an.h, y - d.offY)) };
        }
        return an;
      }));
    } else if (d.kind === "resize") {
      setAnnotations((a) => a.map((an) => {
        if (an.id !== d.id || (an.type !== "text" && an.type !== "highlight")) return an;
        const o = d.orig; let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
        const dx = x - d.startX, dy = y - d.startY;
        if (d.corner.includes("e")) nw = Math.max(0.02, o.w + dx);
        if (d.corner.includes("s")) nh = Math.max(0.02, o.h + dy);
        if (d.corner.includes("w")) { nw = Math.max(0.02, o.w - dx); nx = o.x + (o.w - nw); }
        if (d.corner.includes("n")) { nh = Math.max(0.02, o.h - dy); ny = o.y + (o.h - nh); }
        return { ...an, x: nx, y: ny, w: nw, h: nh };
      }));
    }
  };

  const onPageMouseUp = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.kind === "rect") {
      // Discard tiny highlights, otherwise commit history snapshot (push prior state without that ann)
      setAnnotations((a) => {
        const ann = a.find((x) => x.id === d.id);
        if (!ann || ann.type !== "highlight" || ann.w < 0.005 || ann.h < 0.005) {
          return a.filter((x) => x.id !== d.id);
        }
        // push previous state (without this ann) to history
        setPast((p) => [...p, a.filter((x) => x.id !== d.id)]);
        setFuture([]);
        setSelectedAnnId(d.id);
        return a;
      });
    } else if (d.kind === "draw") {
      setAnnotations((a) => {
        const ann = a.find((x) => x.id === d.id);
        if (!ann || ann.type !== "draw" || ann.points.length < 2) {
          return a.filter((x) => x.id !== d.id);
        }
        setPast((p) => [...p, a.filter((x) => x.id !== d.id)]);
        setFuture([]);
        return a;
      });
    } else if (d.kind === "move" || d.kind === "resize") {
      // push history snapshot of pre-drag state (we don't have it explicitly, so accept current; could improve)
      setPast((p) => [...p, annotations]);
      setFuture([]);
    }
  };

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditing = target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
        if (isEditing) return;
        e.preventDefault(); undo();
      } else if ((meta && e.key.toLowerCase() === "y") || (meta && e.shiftKey && e.key.toLowerCase() === "z")) {
        if (isEditing) return;
        e.preventDefault(); redo();
      } else if (e.key === "Escape") {
        if (editingBlockId) { cancelBlock(editingBlockId); (document.activeElement as HTMLElement)?.blur(); }
        else if (editingTextId) { setEditingTextId(null); (document.activeElement as HTMLElement)?.blur(); }
        else { setSelectedAnnId(null); setActiveSpanId(null); setTool("select"); }
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedAnnId && !isEditing) {
        e.preventDefault(); deleteAnn(selectedAnnId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectedAnnId, editingTextId, editingBlockId, deleteAnn, cancelBlock]);

  // Click outside to deselect / auto-save paragraph blocks
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;

      if (editingBlockId) {
        const blockEl = blockRefs.current[editingBlockId];
        const clickedInsideBlock = blockEl?.contains(t) || t.closest(`[data-block-id="${editingBlockId}"]`);
        const clickedToolbar = t.closest("[data-toolbar]");
        if (!clickedInsideBlock && !clickedToolbar) {
          saveBlock(editingBlockId);
        }
      }

      if (t.closest("[data-page-canvas]") || t.closest("[data-toolbar]")) return;
      setSelectedAnnId(null); setEditingTextId(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [editingBlockId, saveBlock]);

  // ---------- Export ----------
  const pickStandardFont = (family: string, bold: boolean, italic: boolean): StandardFonts => {
    const n = family.toLowerCase();
    const isMono = /mono|courier/.test(n);
    const isSerif = /times|serif|georgia/.test(n);
    if (isMono) return bold && italic ? StandardFonts.CourierBoldOblique : bold ? StandardFonts.CourierBold : italic ? StandardFonts.CourierOblique : StandardFonts.Courier;
    if (isSerif) return bold && italic ? StandardFonts.TimesRomanBoldItalic : bold ? StandardFonts.TimesRomanBold : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
    return bold && italic ? StandardFonts.HelveticaBoldOblique : bold ? StandardFonts.HelveticaBold : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
  };

  const exportPdf = useCallback(async (download = true) => {
    if (!pdfBytes) return null;
    setSaving(true);
    try {
      const pdf = await PDFDocument.load(pdfBytes);
      const pdfPages = pdf.getPages();
      const fontCache: Partial<Record<StandardFonts, PDFFont>> = {};
      const getFont = async (sf: StandardFonts) => { if (!fontCache[sf]) fontCache[sf] = await pdf.embedFont(sf); return fontCache[sf]!; };
      const hexToRgb = (hex: string) => {
        const m = hex.replace("#", "").match(/.{2}/g)!;
        const [r, g, b] = m.map((h) => parseInt(h, 16) / 255);
        return rgb(r, g, b);
      };

      // Edited paragraph blocks — white-out original area and draw reflowed text
      for (const block of paragraphBlocks) {
        if (!block.edited) continue;
        const p = pdfPages[block.page]; if (!p) continue;
        const font = await getFont(pickStandardFont(block.fontFamily, block.bold, block.italic));

        // White-out the original bounding box (with padding)
        const pad = block.fontSize * 0.2;
        p.drawRectangle({
          x: block.pdfX - 2,
          y: block.pdfY - pad - block.shiftY,
          width: block.pdfWidth + 4,
          height: block.pdfHeight + pad * 2,
          color: rgb(1, 1, 1),
        });

        // Also white-out all original span positions to handle any residual text
        for (const span of block.spans) {
          const sPad = span.pdfHeight * 0.15;
          p.drawRectangle({
            x: span.pdfX - 1,
            y: span.pdfY - sPad,
            width: span.pdfWidth + 2,
            height: span.pdfHeight + sPad * 1.5,
            color: rgb(1, 1, 1),
          });
        }

        // Draw the new text with word wrapping
        if (block.text.trim()) {
          const wrappedLines = wrapTextForPdf(block.text, font, block.fontSize, block.pdfWidth);
          const startY = block.pdfTopY - block.shiftY - block.fontSize; // top of text area
          const lineSpacing = block.lineHeight || block.fontSize * 1.3;
          const textColor = hexToRgb(block.color);

          for (let li = 0; li < wrappedLines.length; li++) {
            const lineText = wrappedLines[li];
            if (!lineText.trim()) continue;
            const lineY = startY - li * lineSpacing;

            p.drawText(lineText, {
              x: block.pdfX,
              y: lineY,
              size: block.fontSize,
              font,
              color: textColor,
            });

            if (block.underline) {
              const tw = font.widthOfTextAtSize(lineText, block.fontSize);
              p.drawLine({
                start: { x: block.pdfX, y: lineY - block.fontSize * 0.12 },
                end: { x: block.pdfX + tw, y: lineY - block.fontSize * 0.12 },
                thickness: Math.max(0.5, block.fontSize * 0.05),
                color: textColor,
              });
            }
          }
        }
      }

      // Highlights first (below text), then draws, then text annotations, then comments
      const ordered = [
        ...annotations.filter((a) => a.type === "highlight"),
        ...annotations.filter((a) => a.type === "draw"),
        ...annotations.filter((a) => a.type === "text"),
        ...annotations.filter((a) => a.type === "comment"),
      ];
      for (const a of ordered) {
        const p = pdfPages[a.page]; if (!p) continue;
        const { width: pw, height: ph } = p.getSize();
        if (a.type === "highlight") {
          p.drawRectangle({ x: a.x * pw, y: ph - (a.y + a.h) * ph, width: a.w * pw, height: a.h * ph, color: hexToRgb(a.color), opacity: 0.35 });
        } else if (a.type === "draw") {
          for (let i = 1; i < a.points.length; i++) {
            const p0 = a.points[i - 1], p1 = a.points[i];
            p.drawLine({ start: { x: p0.x * pw, y: ph - p0.y * ph }, end: { x: p1.x * pw, y: ph - p1.y * ph }, thickness: a.strokeWidth * (pw / 900), color: hexToRgb(a.color) });
          }
        } else if (a.type === "text" && a.text) {
          const font = await getFont(pickStandardFont(a.fontFamily, a.bold, a.italic));
          // CSS px font size on rendered page (max 900px wide); convert to PDF units
          const renderedW = Math.min(900, pw);
          const sizePx = a.fontSize; // we stored as PDF units already
          const size = sizePx * (pw / renderedW);
          p.drawText(a.text, { x: a.x * pw, y: ph - a.y * ph - size, size, font, color: hexToRgb(a.color) });
          if (a.underline) {
            const tw = font.widthOfTextAtSize(a.text, size);
            const yLine = ph - a.y * ph - size * 1.1;
            p.drawLine({ start: { x: a.x * pw, y: yLine }, end: { x: a.x * pw + tw, y: yLine }, thickness: Math.max(0.5, size * 0.05), color: hexToRgb(a.color) });
          }
        } else if (a.type === "comment") {
          const cx = a.x * pw, cy = ph - a.y * ph;
          p.drawCircle({ x: cx, y: cy, size: 8, color: hexToRgb("#facc15"), borderColor: hexToRgb("#a16207"), borderWidth: 1.5 });
        }
      }

      const out = await pdf.save();
      if (download) {
        const blob = new Blob([out as BlobPart], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = filename.replace(/\.pdf$/i, "") + "-edited.pdf"; link.click();
        URL.revokeObjectURL(url);
      } else if (user) {
        const path = `${user.id}/uploads/${crypto.randomUUID()}-edited-${filename}`;
        await supabase.storage.from("documents").upload(path, out, { contentType: "application/pdf" });
        await supabase.from("documents").insert({ user_id: user.id, filename: `edited-${filename}`, storage_path: path, size_bytes: out.byteLength });
        toast.success("Saved as new document");
      }
      return out;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
      return null;
    } finally { setSaving(false); }
  }, [pdfBytes, annotations, paragraphBlocks, filename, user]);

  const exportImage = useCallback(async (download = true) => {
    if (!isImage || !imageBlobUrl || !pages[0]) return null;
    setSaving(true);
    try {
      const dim = pages[0];
      const canvas = document.createElement("canvas");
      canvas.width = dim.width; canvas.height = dim.height;
      const ctx = canvas.getContext("2d")!;
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("img")); img.src = imageBlobUrl; });
      ctx.drawImage(img, 0, 0, dim.width, dim.height);

      const pageAnns = annotations.filter((a) => a.page === 0);
      // highlights
      for (const a of pageAnns) {
        if (a.type !== "highlight") continue;
        ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = a.color;
        ctx.fillRect(a.x * dim.width, a.y * dim.height, a.w * dim.width, a.h * dim.height);
        ctx.restore();
      }
      // draws
      for (const a of pageAnns) {
        if (a.type !== "draw" || a.points.length < 2) continue;
        ctx.save(); ctx.strokeStyle = a.color; ctx.lineWidth = a.strokeWidth * (dim.width / 900);
        ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
        ctx.moveTo(a.points[0].x * dim.width, a.points[0].y * dim.height);
        for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i].x * dim.width, a.points[i].y * dim.height);
        ctx.stroke(); ctx.restore();
      }
      // text
      for (const a of pageAnns) {
        if (a.type !== "text" || !a.text) continue;
        const size = a.fontSize * (dim.width / Math.min(900, dim.width));
        ctx.save();
        ctx.fillStyle = a.color;
        ctx.font = `${a.italic ? "italic " : ""}${a.bold ? "700 " : ""}${size}px ${a.fontFamily}`;
        ctx.textBaseline = "top";
        ctx.fillText(a.text, a.x * dim.width, a.y * dim.height);
        if (a.underline) {
          const tw = ctx.measureText(a.text).width;
          ctx.strokeStyle = a.color; ctx.lineWidth = Math.max(1, size * 0.06);
          ctx.beginPath(); ctx.moveTo(a.x * dim.width, a.y * dim.height + size * 1.05);
          ctx.lineTo(a.x * dim.width + tw, a.y * dim.height + size * 1.05); ctx.stroke();
        }
        ctx.restore();
      }
      // comments: small yellow pin
      for (const a of pageAnns) {
        if (a.type !== "comment") continue;
        const cx = a.x * dim.width, cy = a.y * dim.height;
        ctx.save(); ctx.fillStyle = "#facc15"; ctx.strokeStyle = "#a16207"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }

      const blob: Blob | null = await new Promise((r) => canvas.toBlob((b) => r(b), "image/png"));
      if (!blob) throw new Error("Encode failed");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (download) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const base = filename.replace(/\.(png|jpe?g|webp|gif|bmp)$/i, "");
        link.href = url; link.download = `${base}-edited.png`; link.click();
        URL.revokeObjectURL(url);
      } else if (user) {
        const path = `${user.id}/uploads/${crypto.randomUUID()}-edited-${filename.replace(/\.[^.]+$/, "")}.png`;
        await supabase.storage.from("documents").upload(path, bytes, { contentType: "image/png" });
        await supabase.from("documents").insert({ user_id: user.id, filename: `edited-${filename.replace(/\.[^.]+$/, "")}.png`, storage_path: path, size_bytes: bytes.byteLength });
        toast.success("Saved as new document");
      }
      return bytes;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
      return null;
    } finally { setSaving(false); }
  }, [isImage, imageBlobUrl, pages, annotations, filename, user]);

  const exportFile = useCallback((download = true) => {
    return isImage ? exportImage(download) : exportPdf(download);
  }, [isImage, exportImage, exportPdf]);

  const editedCount = useMemo(() => paragraphBlocks.filter((b) => b.edited).length + annotations.length, [paragraphBlocks, annotations]);
  const activeSpan = textSpans.find((s) => s.id === activeSpanId) || null;
  const selectedAnn = annotations.find((a) => a.id === selectedAnnId) || null;

  if (loading) return <div className="grid min-h-screen place-items-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const tools: { id: Tool; icon: typeof Type; label: string; cursor: string }[] = [
    { id: "select", icon: MousePointer2, label: "Select", cursor: "default" },
    { id: "text", icon: Type, label: "Text", cursor: "copy" },
    { id: "draw", icon: Pencil, label: "Draw", cursor: "crosshair" },
    { id: "highlight", icon: Highlighter, label: "Highlight", cursor: "crosshair" },
    { id: "comment", icon: MessageCircle, label: "Comment", cursor: "crosshair" },
  ];
  const toolCursor = tools.find((t) => t.id === tool)?.cursor || "default";

  // Smooth path builder for draw
  const buildSmoothPath = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return "";
    if (pts.length < 3) return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ");
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <Button asChild variant="ghost" size="sm"><Link to="/dashboard"><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Link></Button>
          <p className="truncate font-display text-lg font-semibold">{filename}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => exportFile(false)} disabled={saving}>
              <Save className="mr-1.5 h-4 w-4" />Save copy
            </Button>
            <Button size="sm" onClick={() => exportFile(true)} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Download className="mr-1.5 h-4 w-4" />Export {isImage ? "PNG" : "PDF"}</>}
            </Button>
          </div>
        </div>

        {/* Floating bottom-center toolbar */}
        <div data-toolbar className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex flex-col items-center gap-2 px-4">
          {/* Contextual sub-panels float ABOVE the pill */}
          {tool === "highlight" && (
            <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1.5 shadow-lg backdrop-blur">
              <span className="text-xs text-muted-foreground">Color</span>
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c} onClick={() => setHighlightColor(c)} className={`h-5 w-5 rounded-full border ${highlightColor === c ? "ring-2 ring-primary" : "border-border"}`} style={{ background: c }} />
              ))}
            </div>
          )}
          {tool === "draw" && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 shadow-lg backdrop-blur">
              <input type="color" value={drawColor} onChange={(e) => setDrawColor(e.target.value)} className="h-7 w-7 cursor-pointer rounded-full border border-border bg-transparent" />
              <span className="text-xs text-muted-foreground">Width</span>
              <input type="range" min={1} max={20} value={drawWidth} onChange={(e) => setDrawWidth(Number(e.target.value))} className="h-1 w-24" />
              <span className="w-5 text-xs font-mono">{drawWidth}</span>
            </div>
          )}
          {tool === "text" && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 shadow-lg backdrop-blur">
              <select value={textDefaults.fontFamily} onChange={(e) => setTextDefaults((d) => ({ ...d, fontFamily: e.target.value }))} className="h-7 rounded border border-border bg-background text-xs">
                {FONT_FAMILIES.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f.split(",")[0].replace(/['"]/g, "")}</option>)}
              </select>
              <Input type="number" min={6} max={144} value={textDefaults.fontSize} onChange={(e) => setTextDefaults((d) => ({ ...d, fontSize: Number(e.target.value) || 16 }))} className="h-7 w-14" />
              <input type="color" value={textDefaults.color} onChange={(e) => setTextDefaults((d) => ({ ...d, color: e.target.value }))} className="h-7 w-7 cursor-pointer rounded-full border border-border bg-transparent" />
            </div>
          )}

          {/* Selected annotation mini-toolbars */}
          {selectedAnn && selectedAnn.type === "text" && (
            <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-full border border-primary/40 bg-background/95 px-3 py-1.5 shadow-lg backdrop-blur">
              <select value={selectedAnn.fontFamily} onChange={(e) => updateAnn<TextAnn>(selectedAnn.id, { fontFamily: e.target.value })} className="h-7 rounded border border-border bg-background text-xs">
                {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f.split(",")[0].replace(/['"]/g, "")}</option>)}
              </select>
              <Input type="number" min={6} max={144} value={Math.round(selectedAnn.fontSize)} onChange={(e) => updateAnn<TextAnn>(selectedAnn.id, { fontSize: Number(e.target.value) || selectedAnn.fontSize })} className="h-7 w-14" />
              <Button size="sm" variant={selectedAnn.bold ? "default" : "outline"} className="h-7 w-7 p-0" onClick={() => updateAnn<TextAnn>(selectedAnn.id, { bold: !selectedAnn.bold })}><Bold className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant={selectedAnn.italic ? "default" : "outline"} className="h-7 w-7 p-0" onClick={() => updateAnn<TextAnn>(selectedAnn.id, { italic: !selectedAnn.italic })}><Italic className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant={selectedAnn.underline ? "default" : "outline"} className="h-7 w-7 p-0" onClick={() => updateAnn<TextAnn>(selectedAnn.id, { underline: !selectedAnn.underline })}><UnderlineIcon className="h-3.5 w-3.5" /></Button>
              <input type="color" value={selectedAnn.color} onChange={(e) => updateAnn<TextAnn>(selectedAnn.id, { color: e.target.value })} className="h-7 w-7 cursor-pointer rounded-full border border-border bg-transparent" />
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteAnn(selectedAnn.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          )}
          {selectedAnn && selectedAnn.type === "highlight" && (
            <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-primary/40 bg-background/95 px-3 py-1.5 shadow-lg backdrop-blur">
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c} onClick={() => updateAnn<HighlightAnn>(selectedAnn.id, { color: c })} className={`h-5 w-5 rounded-full border ${selectedAnn.color === c ? "ring-2 ring-primary" : "border-border"}`} style={{ background: c }} />
              ))}
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteAnn(selectedAnn.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          )}
          {selectedAnn && selectedAnn.type === "draw" && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-primary/40 bg-background/95 px-3 py-1.5 shadow-lg backdrop-blur">
              <input type="color" value={selectedAnn.color} onChange={(e) => updateAnn<DrawAnn>(selectedAnn.id, { color: e.target.value })} className="h-7 w-7 cursor-pointer rounded-full border border-border bg-transparent" />
              <input type="range" min={1} max={20} value={selectedAnn.strokeWidth} onChange={(e) => updateAnn<DrawAnn>(selectedAnn.id, { strokeWidth: Number(e.target.value) })} className="h-1 w-24" />
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteAnn(selectedAnn.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          )}
          {editingBlockId && tool === "select" && !selectedAnn && (() => {
            const activeBlock = paragraphBlocks.find((b) => b.id === editingBlockId);
            if (!activeBlock) return null;
            return (
              <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 shadow-lg backdrop-blur">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1">Block Style</span>
                <select
                  value={activeBlock.fontFamily}
                  onChange={(e) => updateBlock(activeBlock.id, { fontFamily: e.target.value })}
                  className="h-7 rounded border border-border bg-background text-xs px-1"
                >
                  {FONT_FAMILIES.map((f) => (
                    <option key={f} value={f} style={{ fontFamily: f }}>
                      {f.split(",")[0].replace(/['"]/g, "")}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  min={4}
                  max={144}
                  value={Math.round(activeBlock.fontSize)}
                  onChange={(e) => updateBlock(activeBlock.id, { fontSize: Number(e.target.value) || activeBlock.fontSize })}
                  className="h-7 w-16"
                />
                <Button
                  size="sm"
                  variant={activeBlock.bold ? "default" : "outline"}
                  className="h-7 w-7 p-0"
                  onClick={() => updateBlock(activeBlock.id, { bold: !activeBlock.bold })}
                >
                  <Bold className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant={activeBlock.italic ? "default" : "outline"}
                  className="h-7 w-7 p-0"
                  onClick={() => updateBlock(activeBlock.id, { italic: !activeBlock.italic })}
                >
                  <Italic className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant={activeBlock.underline ? "default" : "outline"}
                  className="h-7 w-7 p-0"
                  onClick={() => updateBlock(activeBlock.id, { underline: !activeBlock.underline })}
                >
                  <UnderlineIcon className="h-3.5 w-3.5" />
                </Button>
                <input
                  type="color"
                  value={activeBlock.color}
                  onChange={(e) => updateBlock(activeBlock.id, { color: e.target.value })}
                  className="h-7 w-7 cursor-pointer rounded-full border border-border bg-transparent"
                />
              </div>
            );
          })()}

          {/* Main pill */}
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-foreground/90 px-2 py-1.5 shadow-2xl backdrop-blur dark:bg-background/95">
            {tools.map((t) => {
              const active = tool === t.id;
              return (
                <button
                  key={t.id}
                  title={t.label}
                  onClick={() => { setTool(t.id); if (t.id !== "select") { setActiveSpanId(null); setSelectedAnnId(null); setEditingTextId(null); } }}
                  className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${active ? "bg-primary text-primary-foreground" : "text-background/90 hover:bg-background/15 dark:text-foreground/80 dark:hover:bg-foreground/10"}`}
                >
                  <t.icon className="h-4 w-4" />
                </button>
              );
            })}
            <div className="mx-1 h-6 w-px bg-background/20 dark:bg-foreground/20" />
            <button
              title="Undo (Ctrl+Z)"
              onClick={undo}
              disabled={past.length === 0}
              className="grid h-9 w-9 place-items-center rounded-full text-background/90 transition-colors hover:bg-background/15 disabled:opacity-30 dark:text-foreground/80 dark:hover:bg-foreground/10"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              title="Redo (Ctrl+Y)"
              onClick={redo}
              disabled={future.length === 0}
              className="grid h-9 w-9 place-items-center rounded-full text-background/90 transition-colors hover:bg-background/15 disabled:opacity-30 dark:text-foreground/80 dark:hover:bg-foreground/10"
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </div>
          <span className="pointer-events-none font-mono text-[10px] text-muted-foreground">{editedCount} edits</span>
        </div>


        <div className="space-y-6">
          {pageImages.map((src, i) => {
            const dim = pages[i];
            const xScale = dim.width / dim.pdfWidth;
            const yScale = dim.height / dim.pdfHeight;
            const pageAnns = annotations.filter((a) => a.page === i);
            return (
              <div
                key={i}
                data-page-canvas
                className="relative mx-auto select-none overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-elegant)]"
                style={{ aspectRatio: `${dim.width} / ${dim.height}`, maxWidth: 900, cursor: tool === "select" ? "default" : toolCursor }}
              >
                <img src={src} alt={`Page ${i + 1}`} className="pointer-events-none absolute inset-0 h-full w-full" draggable={false} />

                {/* Paragraph blocks (edit mode = select tool only) */}
                {tool === "select" && paragraphBlocks.filter((b) => b.page === i).map((block) => {
                  const effectiveShiftY = block.shiftY;
                  const leftPct = (block.pdfX * xScale) / dim.width * 100;
                  const topPct = ((dim.pdfHeight - block.pdfTopY + effectiveShiftY) * yScale) / dim.height * 100;
                  const widthPct = (block.pdfWidth * xScale) / dim.width * 100;
                  const minHeightPct = (block.pdfHeight * yScale) / dim.height * 100;
                  const isEditing = editingBlockId === block.id;

                  return (
                    <div
                      key={block.id}
                      data-block-id={block.id}
                      style={{ position: "absolute", left: `${leftPct}%`, top: `${topPct}%`, width: `${widthPct}%`, minHeight: `${minHeightPct}%` }}
                    >
                      <div
                        ref={(el) => { blockRefs.current[block.id] = el; }}
                        contentEditable={isEditing}
                        suppressContentEditableWarning
                        spellCheck={false}
                        className={`rounded-sm outline-none transition-colors content-editable-block ${
                          isEditing
                            ? "ring-2 ring-primary bg-white cursor-text"
                            : block.edited
                              ? "bg-white cursor-pointer hover:ring-1 hover:ring-primary/40"
                              : "cursor-pointer hover:ring-1 hover:ring-primary/40"
                        }`}
                        style={{
                          color: block.color,
                          caretColor: block.color,
                          fontFamily: block.fontFamily,
                          fontSize: `${block.fontSize * yScale}px`,
                          fontWeight: block.bold ? 700 : 400,
                          fontStyle: block.italic ? "italic" : "normal",
                          textDecoration: block.underline ? "underline" : "none",
                          lineHeight: `${block.lineHeight * yScale}px`,
                          width: "100%",
                          minHeight: "100%",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          overflowWrap: "break-word",
                          padding: "2px 4px",
                          boxSizing: "border-box",
                          background: isEditing || block.edited ? "#ffffff" : "transparent",
                        }}
                        onClick={(e) => {
                          if (isEditing) return;
                          e.stopPropagation();
                          if (editingBlockId && editingBlockId !== block.id) {
                            saveBlock(editingBlockId);
                          }
                          const clickX = e.clientX;
                          const clickY = e.clientY;
                          setEditingBlockId(block.id);
                          setActiveSpanId(null);
                          setSelectedAnnId(null);
                          setTimeout(() => {
                            const el = blockRefs.current[block.id];
                            if (el) {
                              el.focus();
                              const sel = window.getSelection();
                              if (sel) {
                                let range: Range | null = null;
                                if (document.caretRangeFromPoint) {
                                  range = document.caretRangeFromPoint(clickX, clickY);
                                } else if ((document as any).caretPositionFromPoint) {
                                  const pos = (document as any).caretPositionFromPoint(clickX, clickY);
                                  if (pos) {
                                    range = document.createRange();
                                    range.setStart(pos.offsetNode, pos.offset);
                                    range.collapse(true);
                                  }
                                }
                                if (range) {
                                  sel.removeAllRanges();
                                  sel.addRange(range);
                                } else {
                                  const fallbackRange = document.createRange();
                                  fallbackRange.selectNodeContents(el);
                                  fallbackRange.collapse(false);
                                  sel.removeAllRanges();
                                  sel.addRange(fallbackRange);
                                }
                              }
                            }
                          }, 0);
                        }}
                        onInput={(e) => {
                          if (!isEditing) return;
                          const newText = e.currentTarget.textContent ?? "";
                          updateBlock(block.id, { text: newText });
                        }}
                        onPaste={(e) => {
                          e.preventDefault();
                          const text = e.clipboardData.getData("text/plain");
                          document.execCommand("insertText", false, text);
                        }}
                        onMouseDown={(e) => {
                          if (isEditing) e.stopPropagation();
                        }}
                      />
                      {/* Save / Cancel toolbar */}
                      {isEditing && (
                        <div
                          className="flex items-center gap-1.5 mt-1 mb-1"
                          style={{ zIndex: 30, position: "relative" }}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => saveBlock(block.id)}
                            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                          >
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                            Save Changes
                          </button>
                          <button
                            onClick={() => cancelBlock(block.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-secondary"
                          >
                            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Interaction layer for create tools */}
                <div
                  className="absolute inset-0"
                  style={{ pointerEvents: tool === "select" ? "none" : "auto" }}
                  onMouseDown={(e) => onPageMouseDown(e, i)}
                  onMouseMove={onPageMouseMove}
                  onMouseUp={onPageMouseUp}
                  onMouseLeave={onPageMouseUp}
                />

                {/* SVG layer for highlights + draws */}
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                >
                  {pageAnns.filter((a) => a.type === "highlight").map((a) => (
                    <rect
                      key={a.id}
                      data-ann-hit
                      x={(a as HighlightAnn).x} y={(a as HighlightAnn).y}
                      width={(a as HighlightAnn).w} height={(a as HighlightAnn).h}
                      fill={(a as HighlightAnn).color} opacity={0.35}
                      style={{ pointerEvents: tool === "select" ? "auto" : "none", cursor: tool === "select" ? "pointer" : "inherit" }}
                      onMouseDown={(e) => { if (tool !== "select") return; e.stopPropagation(); setSelectedAnnId(a.id); setActiveSpanId(null); }}
                    />
                  ))}
                  {pageAnns.filter((a) => a.type === "draw").map((a) => {
                    const da = a as DrawAnn;
                    return (
                      <path
                        key={a.id}
                        data-ann-hit
                        d={buildSmoothPath(da.points)}
                        stroke={da.color}
                        strokeWidth={da.strokeWidth}
                        strokeLinecap="round" strokeLinejoin="round"
                        fill="none"
                        vectorEffect="non-scaling-stroke"
                        style={{ pointerEvents: tool === "select" ? "stroke" : "none", cursor: tool === "select" ? "pointer" : "inherit" }}
                        onMouseDown={(e) => { if (tool !== "select") return; e.stopPropagation(); setSelectedAnnId(a.id); setActiveSpanId(null); }}
                      />
                    );
                  })}
                </svg>

                {/* Selected highlight/draw bbox */}
                {selectedAnn && selectedAnn.page === i && selectedAnn.type === "highlight" && (
                  <div className="pointer-events-none absolute border-2 border-primary" style={{
                    left: `${selectedAnn.x * 100}%`, top: `${selectedAnn.y * 100}%`,
                    width: `${selectedAnn.w * 100}%`, height: `${selectedAnn.h * 100}%`,
                  }} />
                )}
                {selectedAnn && selectedAnn.page === i && selectedAnn.type === "draw" && (() => {
                  const pts = selectedAnn.points;
                  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
                  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
                  return <div className="pointer-events-none absolute border-2 border-dashed border-primary" style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }} />;
                })()}

                {/* Text annotations */}
                {pageAnns.filter((a) => a.type === "text").map((a) => {
                  const ta = a as TextAnn;
                  const isSelected = selectedAnnId === ta.id;
                  const isEditing = editingTextId === ta.id;
                  return (
                    <div
                      key={ta.id}
                      data-ann-hit
                      id={`text-ann-${ta.id}`}
                      contentEditable={isEditing}
                      suppressContentEditableWarning
                      spellCheck={false}
                      onMouseDown={(e) => {
                        if (tool !== "select") return;
                        e.stopPropagation();
                        const isAlreadySelected = selectedAnnId === ta.id;
                        setSelectedAnnId(ta.id); setActiveSpanId(null);
                        if (isEditing) return;

                        if (isAlreadySelected) {
                          setEditingTextId(ta.id);
                          const clickX = e.clientX;
                          const clickY = e.clientY;
                          setTimeout(() => {
                            const el = document.getElementById(`text-ann-${ta.id}`);
                            if (el) {
                              el.focus();
                              const sel = window.getSelection();
                              if (sel) {
                                let range: Range | null = null;
                                if (document.caretRangeFromPoint) {
                                  range = document.caretRangeFromPoint(clickX, clickY);
                                } else if ((document as any).caretPositionFromPoint) {
                                  const pos = (document as any).caretPositionFromPoint(clickX, clickY);
                                  if (pos) {
                                    range = document.createRange();
                                    range.setStart(pos.offsetNode, pos.offset);
                                    range.collapse(true);
                                  }
                                }
                                if (range) {
                                  sel.removeAllRanges();
                                  sel.addRange(range);
                                }
                              }
                            }
                          }, 0);
                          return;
                        }

                        // start move
                        const parent = (e.currentTarget.parentElement) as HTMLElement;
                        const rect = parent.getBoundingClientRect();
                        const px = (e.clientX - rect.left) / rect.width;
                        const py = (e.clientY - rect.top) / rect.height;
                        dragRef.current = { kind: "move", id: ta.id, page: i, offX: px - ta.x, offY: py - ta.y };
                        const onMove = (ev: MouseEvent) => {
                          const x = (ev.clientX - rect.left) / rect.width;
                          const y = (ev.clientY - rect.top) / rect.height;
                          setAnnotations((arr) => arr.map((an) => an.id === ta.id && an.type === "text"
                            ? { ...an, x: Math.max(0, Math.min(1 - an.w, x - (px - ta.x))), y: Math.max(0, Math.min(1 - an.h, y - (py - ta.y))) }
                            : an));
                        };
                        const onUp = () => {
                          window.removeEventListener("mousemove", onMove);
                          window.removeEventListener("mouseup", onUp);
                          dragRef.current = null;
                          setPast((p) => [...p, annotations]); setFuture([]);
                        };
                        window.addEventListener("mousemove", onMove);
                        window.addEventListener("mouseup", onUp);
                      }}
                      onDoubleClick={(e) => {
                        if (tool !== "select") return;
                        e.stopPropagation();
                        setEditingTextId(ta.id); setSelectedAnnId(ta.id);
                        const clickX = e.clientX;
                        const clickY = e.clientY;
                        setTimeout(() => {
                          const el = document.getElementById(`text-ann-${ta.id}`);
                          if (el) {
                            el.focus();
                            const sel = window.getSelection();
                            if (sel) {
                              let range: Range | null = null;
                              if (document.caretRangeFromPoint) {
                                range = document.caretRangeFromPoint(clickX, clickY);
                              } else if ((document as any).caretPositionFromPoint) {
                                const pos = (document as any).caretPositionFromPoint(clickX, clickY);
                                if (pos) {
                                  range = document.createRange();
                                  range.setStart(pos.offsetNode, pos.offset);
                                  range.collapse(true);
                                }
                              }
                              if (range) {
                                sel.removeAllRanges();
                                sel.addRange(range);
                              }
                            }
                          }
                        }, 0);
                      }}
                      onInput={(e) => {
                        const v = (e.currentTarget.textContent ?? "");
                        setAnnotations((arr) => arr.map((an) => an.id === ta.id && an.type === "text" ? { ...an, text: v } : an));
                      }}
                      onBlur={() => { setEditingTextId(null); setPast((p) => [...p, annotations]); setFuture([]); }}
                      onPaste={(e) => {
                        e.preventDefault();
                        const text = e.clipboardData.getData("text/plain");
                        document.execCommand("insertText", false, text);
                      }}
                      className={`absolute overflow-hidden rounded-sm px-1 outline-none content-editable-block ${isSelected ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-primary/40"} ${isEditing ? "cursor-text bg-background/80" : "cursor-move"}`}
                      style={{
                        left: `${ta.x * 100}%`, top: `${ta.y * 100}%`,
                        width: `${ta.w * 100}%`, minHeight: `${ta.h * 100}%`,
                        color: ta.color, caretColor: ta.color,
                        fontFamily: ta.fontFamily,
                        fontSize: `${ta.fontSize * yScale}px`,
                        fontWeight: ta.bold ? 700 : 400,
                        fontStyle: ta.italic ? "italic" : "normal",
                        textDecoration: ta.underline ? "underline" : "none",
                        lineHeight: 1.2,
                        pointerEvents: tool === "select" ? "auto" : "none",
                      }}
                    >
                      {isEditing ? null : (ta.text || (isSelected ? "" : <span className="opacity-50">Text</span>))}
                      {isSelected && !isEditing && (
                        <>
                          {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                            <span
                              key={corner}
                              data-ann-hit
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                const parent = (e.currentTarget.parentElement!.parentElement) as HTMLElement;
                                const rect = parent.getBoundingClientRect();
                                const sx = (e.clientX - rect.left) / rect.width;
                                const sy = (e.clientY - rect.top) / rect.height;
                                dragRef.current = { kind: "resize", id: ta.id, page: i, corner, startX: sx, startY: sy, orig: { x: ta.x, y: ta.y, w: ta.w, h: ta.h } };
                                const onMove = (ev: MouseEvent) => {
                                  const x = (ev.clientX - rect.left) / rect.width;
                                  const y = (ev.clientY - rect.top) / rect.height;
                                  setAnnotations((arr) => arr.map((an) => {
                                    if (an.id !== ta.id || an.type !== "text") return an;
                                    const o = { x: ta.x, y: ta.y, w: ta.w, h: ta.h };
                                    let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
                                    const dx = x - sx, dy = y - sy;
                                    if (corner.includes("e")) nw = Math.max(0.03, o.w + dx);
                                    if (corner.includes("s")) nh = Math.max(0.02, o.h + dy);
                                    if (corner.includes("w")) { nw = Math.max(0.03, o.w - dx); nx = o.x + (o.w - nw); }
                                    if (corner.includes("n")) { nh = Math.max(0.02, o.h - dy); ny = o.y + (o.h - nh); }
                                    return { ...an, x: nx, y: ny, w: nw, h: nh };
                                  }));
                                };
                                const onUp = () => {
                                  window.removeEventListener("mousemove", onMove);
                                  window.removeEventListener("mouseup", onUp);
                                  dragRef.current = null;
                                  setPast((p) => [...p, annotations]); setFuture([]);
                                };
                                window.addEventListener("mousemove", onMove);
                                window.addEventListener("mouseup", onUp);
                              }}
                              className="absolute h-2 w-2 rounded-sm border border-primary bg-background"
                              style={{
                                cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                                left: corner.includes("w") ? -4 : undefined,
                                right: corner.includes("e") ? -4 : undefined,
                                top: corner.includes("n") ? -4 : undefined,
                                bottom: corner.includes("s") ? -4 : undefined,
                              }}
                            />
                          ))}
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Comment pins */}
                {pageAnns.filter((a) => a.type === "comment").map((a) => {
                  const ca = a as CommentAnn;
                  const isSelected = selectedAnnId === ca.id;
                  const isEditing = editingTextId === ca.id;
                  return (
                    <div
                      key={ca.id}
                      data-ann-hit
                      className="absolute"
                      style={{ left: `${ca.x * 100}%`, top: `${ca.y * 100}%`, transform: "translate(-50%, -50%)", pointerEvents: tool === "select" ? "auto" : "none" }}
                    >
                      <button
                        data-ann-hit
                        onClick={(e) => { e.stopPropagation(); if (tool !== "select") return; setSelectedAnnId(ca.id); setActiveSpanId(null); setEditingTextId(ca.id); }}
                        className={`grid h-7 w-7 place-items-center rounded-full border-2 bg-yellow-300 text-yellow-900 shadow-md transition-transform hover:scale-110 ${isSelected ? "border-primary ring-2 ring-primary/40" : "border-yellow-600"}`}
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </button>
                      {(isSelected || isEditing) && (
                        <div data-ann-hit className="absolute left-8 top-0 z-20 w-56 rounded-lg border border-border bg-popover p-2 shadow-xl">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Comment</span>
                            <button onClick={(e) => { e.stopPropagation(); deleteAnn(ca.id); }} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
                          </div>
                          <textarea
                            value={ca.text}
                            autoFocus={isEditing}
                            placeholder="Add a note…"
                            onChange={(e) => updateAnn<CommentAnn>(ca.id, { text: e.target.value })}
                            onMouseDown={(e) => e.stopPropagation()}
                            onBlur={() => setEditingTextId(null)}
                            className="h-20 w-full resize-none rounded border border-border bg-background p-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}

                {!isImage && <span className="absolute bottom-2 right-2 rounded bg-background/80 px-2 py-0.5 font-mono text-[10px] text-muted-foreground backdrop-blur">Page {i + 1}</span>}
              </div>
            );
          })}
          {/* spacer so floating toolbar doesn't cover the last page */}
          <div className="h-28" />
        </div>
      </main>
    </div>
  );
}


interface EditableSpanProps {
  text: string; isActive: boolean;
  className?: string; style?: React.CSSProperties;
  refCb?: (el: HTMLDivElement | null) => void;
  onFocus?: () => void;
  onTextChange?: (text: string) => void;
}

function EditableSpan({ text, isActive, className, style, refCb, onFocus, onTextChange }: EditableSpanProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = elRef.current; if (!el) return;
    if (document.activeElement === el) return;
    if (el.textContent !== text) el.textContent = text;
  }, [text, isActive]);
  return (
    <div
      ref={(el) => {
        elRef.current = el; refCb?.(el);
        if (el && el.textContent !== text && document.activeElement !== el) el.textContent = text;
      }}
      className={className}
      style={style}
      spellCheck={false}
      contentEditable
      suppressContentEditableWarning
      onFocus={onFocus}
      onInput={(e) => onTextChange?.(e.currentTarget.textContent ?? "")}
    />
  );
}
