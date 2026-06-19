import { useEffect, useState } from "react";
import {
  Loader2, Wand2, Sparkles, Image as ImageIcon, FileText, Layers,
  Download, Save, ArrowLeft, Trash2, ChevronUp, ChevronDown,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { generateSlides, type Slide } from "@/lib/slides.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Style = "bullets" | "narrative" | "questions" | "executive" | "educational";
const STYLES: { id: Style; label: string }[] = [
  { id: "bullets", label: "Bullet points" },
  { id: "narrative", label: "Narrative paragraphs" },
  { id: "questions", label: "Question-led" },
  { id: "executive", label: "Executive brief" },
  { id: "educational", label: "Educational" },
];

type Mode = "image" | "summary" | "hybrid";
type Step = "choose" | "loading" | "preview";

interface Props {
  documentId: string;
  filename: string;
  trigger?: React.ReactNode;
}

interface PageImage { page: number; dataUrl: string; }

const MODES: { id: Mode; title: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "image", title: "Image-based", desc: "Capture each PDF page as an editable image layout.", icon: ImageIcon },
  { id: "summary", title: "Summary-based", desc: "AI summarizes content into title + bullet slides.", icon: FileText },
  { id: "hybrid", title: "Hybrid", desc: "Mix page images and AI summary together.", icon: Layers },
];

export function GenerateTemplateDialog({ documentId, filename, trigger }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<Mode>("summary");
  const [progress, setProgress] = useState("");

  const [name, setName] = useState("");
  const [images, setImages] = useState<PageImage[]>([]);
  const [deckTitle, setDeckTitle] = useState("");
  const [slides, setSlides] = useState<Slide[]>([]);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [slideCount, setSlideCount] = useState(4);
  const [style, setStyle] = useState<Style>("bullets");
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep("choose"); setImages([]); setSlides([]); setDeckTitle(""); setProgress(""); setName("");
    }
  }, [open]);

  const renderImages = async (): Promise<PageImage[]> => {
    setProgress("Loading PDF…");
    const { data: doc, error } = await supabase.from("documents").select("storage_path").eq("id", documentId).single();
    if (error || !doc) throw new Error("Document not found");
    const { data: blob, error: dlErr } = await supabase.storage.from("documents").download(doc.storage_path);
    if (dlErr || !blob) throw new Error("Could not download PDF");
    const buf = new Uint8Array(await blob.arrayBuffer());

    const pdfjs = await import("pdfjs-dist");
    const workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    const pdf = await pdfjs.getDocument({ data: buf.slice() }).promise;
    const total = Math.min(pdf.numPages, 12);
    const out: PageImage[] = [];
    for (let i = 1; i <= total; i++) {
      setProgress(`Rendering page ${i} of ${total}…`);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvas, canvasContext: ctx, viewport } as Parameters<typeof page.render>[0]).promise;
      out.push({ page: i, dataUrl: canvas.toDataURL("image/jpeg", 0.85) });
    }
    return out;
  };

  const run = async () => {
    setStep("loading");
    try {
      let imgs: PageImage[] = [];
      let title = filename.replace(/\.pdf$/i, "");
      let sl: Slide[] = [];

      if (mode === "image" || mode === "hybrid") {
        imgs = await renderImages();
      }
      if (mode === "summary" || mode === "hybrid") {
        setProgress("AI is summarizing your document…");
        const res = await generateSlides({ data: { documentId, mode: "detailed", slideCount, style } });
        title = res.deckTitle;
        sl = res.slides;
      }

      setDeckTitle(title);
      setName(`${title} template`);
      setImages(imgs);
      setSlides(sl);
      setStep("preview");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
      setStep("choose");
    }
  };

  const regenerateSummary = async () => {
    setRegenerating(true);
    try {
      const res = await generateSlides({ data: { documentId, mode: "detailed", slideCount, style } });
      setDeckTitle(res.deckTitle);
      setSlides(res.slides);
      toast.success(`Regenerated as ${slideCount} ${STYLES.find(s => s.id === style)?.label.toLowerCase()} slides`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Regenerate failed");
    } finally {
      setRegenerating(false);
    }
  };
  const updateSlide = (i: number, patch: Partial<Slide>) =>
    setSlides((arr) => arr.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const moveImg = (i: number, dir: -1 | 1) => setImages((arr) => {
    const j = i + dir; if (j < 0 || j >= arr.length) return arr;
    const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });
  const removeImg = (i: number) => setImages((arr) => arr.filter((_, idx) => idx !== i));

  // ---- Exports ----
  const exportPptx = async () => {
    setExporting(true);
    try {
      const PptxGenJS = (await import("pptxgenjs")).default;
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.title = deckTitle || name;

      const cover = pptx.addSlide();
      cover.background = { color: "0F172A" };
      cover.addText(deckTitle || name, {
        x: 0.6, y: 2.6, w: 12, h: 1.6, fontSize: 44, bold: true, color: "FFFFFF",
      });
      cover.addText(`Template from ${filename}`, {
        x: 0.6, y: 4.3, w: 12, h: 0.5, fontSize: 16, color: "94A3B8",
      });

      // Image slides
      for (const img of images) {
        const slide = pptx.addSlide();
        slide.background = { color: "FFFFFF" };
        slide.addImage({ data: img.dataUrl, x: 0.5, y: 0.4, w: 12.3, h: 6.7, sizing: { type: "contain", w: 12.3, h: 6.7 } });
      }
      // Summary slides
      for (const s of slides) {
        const slide = pptx.addSlide();
        slide.background = { color: "FFFFFF" };
        slide.addShape("rect", { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: "6366F1" } });
        slide.addText(s.title, { x: 0.6, y: 0.4, w: 12, h: 1, fontSize: 32, bold: true, color: "0F172A" });
        if (s.subtitle) slide.addText(s.subtitle, { x: 0.6, y: 1.3, w: 12, h: 0.5, fontSize: 16, italic: true, color: "6366F1" });
        if (s.bullets.length) {
          slide.addText(
            s.bullets.map((b) => ({ text: b, options: { bullet: { code: "25A0" }, breakLine: true } })),
            { x: 0.7, y: s.subtitle ? 2.0 : 1.6, w: 11.8, h: 5.0, fontSize: 18, color: "1E293B", paraSpaceAfter: 8 },
          );
        }
      }

      const safe = (deckTitle || name).replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 60) || "template";
      await pptx.writeFile({ fileName: `${safe}.pptx` });
      toast.success("Downloaded .pptx");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally { setExporting(false); }
  };

  const exportPdf = async () => {
    setExporting(true);
    try {
      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
      const pdf = await PDFDocument.create();
      const helv = await pdf.embedFont(StandardFonts.Helvetica);
      const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);

      const cover = pdf.addPage([960, 540]);
      cover.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.06, 0.09, 0.16) });
      cover.drawText(deckTitle || name, { x: 48, y: 300, size: 36, font: helvB, color: rgb(1, 1, 1) });
      cover.drawText(`Template from ${filename}`, { x: 48, y: 260, size: 14, font: helv, color: rgb(0.7, 0.75, 0.85) });

      for (const img of images) {
        const png = await pdf.embedJpg(img.dataUrl);
        const page = pdf.addPage([960, 540]);
        const ratio = Math.min(900 / png.width, 480 / png.height);
        const w = png.width * ratio, h = png.height * ratio;
        page.drawImage(png, { x: (960 - w) / 2, y: (540 - h) / 2, width: w, height: h });
      }
      for (const s of slides) {
        const page = pdf.addPage([960, 540]);
        page.drawText(s.title, { x: 48, y: 470, size: 28, font: helvB, color: rgb(0.06, 0.09, 0.16) });
        if (s.subtitle) page.drawText(s.subtitle, { x: 48, y: 440, size: 14, font: helv, color: rgb(0.39, 0.4, 0.95) });
        let y = 400;
        for (const b of s.bullets) {
          page.drawText(`• ${b}`, { x: 56, y, size: 14, font: helv, color: rgb(0.12, 0.16, 0.23) });
          y -= 24;
        }
      }
      const bytes = await pdf.save();
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const a = document.createElement("a");
      const safe = (deckTitle || name).replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 60) || "template";
      a.href = URL.createObjectURL(blob); a.download = `${safe}.pdf`; a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Downloaded PDF");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally { setExporting(false); }
  };

  const exportJson = () => {
    const data = {
      kind: mode, name, deckTitle, sourceFilename: filename,
      slideCount, style,
      images: images.map((i) => ({ page: i.page })), // metadata only — keep file small
      slides,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(name || "template").replace(/[^a-zA-Z0-9 _-]/g, "")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const saveTemplate = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const content = {
        kind: mode,
        deckTitle,
        slides,
        slideCount,
        style,
        // Skip raw image data in DB (too large). Store page numbers; user can re-render.
        imagePages: images.map((i) => i.page),
        body: slides.map((s) => `# ${s.title}\n\n${s.bullets.map((b) => `- ${b}`).join("\n")}`).join("\n\n"),
        placeholders: [],
      };
      const { error } = await supabase.from("templates").insert({
        user_id: user.id, name: name || `Template from ${filename}`,
        source_document_id: documentId, content,
      });
      if (error) throw error;
      toast.success("Saved to Templates");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" variant="outline">
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />Template
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Sparkles className="h-5 w-5 text-accent" />Generate Template
          </DialogTitle>
          <DialogDescription>From <span className="font-medium">{filename}</span> — choose how you want it built.</DialogDescription>
        </DialogHeader>

        {step === "choose" && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {MODES.map((m) => {
                const Icon = m.icon;
                const active = mode === m.id;
                return (
                  <button key={m.id} onClick={() => setMode(m.id)}
                    className={`rounded-lg border-2 p-4 text-left transition-colors ${active ? "border-accent bg-accent/5" : "border-border hover:border-accent/40"}`}>
                    <Icon className={`h-5 w-5 ${active ? "text-accent" : "text-muted-foreground"}`} />
                    <p className="mt-2 font-display font-semibold">{m.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{m.desc}</p>
                  </button>
                );
              })}
            </div>
            {(mode === "summary" || mode === "hybrid") && (
              <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="slideCount" className="text-xs">Slide count</Label>
                  <Input id="slideCount" type="number" min={1} max={20} value={slideCount}
                    onChange={(e) => setSlideCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Outline style</Label>
                  <Select value={style} onValueChange={(v) => setStyle(v as Style)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STYLES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <Button className="w-full" onClick={run}>
              <Sparkles className="mr-2 h-4 w-4" />Generate {MODES.find((m) => m.id === mode)?.title.toLowerCase()} template
            </Button>
          </div>
        )}

        {step === "loading" && (
          <div className="grid place-items-center gap-3 py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <p className="font-display text-lg">{progress || "Working…"}</p>
            <p className="text-xs text-muted-foreground">This may take a moment for large PDFs.</p>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setStep("choose")}>
                <ArrowLeft className="mr-1 h-4 w-4" />Back
              </Button>
              <div className="flex-1" />
              <Label htmlFor="tname" className="text-xs">Name</Label>
              <Input id="tname" value={name} onChange={(e) => setName(e.target.value)} className="h-8 max-w-xs" />
            </div>

            <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-2">
              {images.length > 0 && (
                <div>
                  <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Page images</p>
                  <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {images.map((img, i) => (
                      <Card key={img.page} className="group relative overflow-hidden p-0">
                        <img src={img.dataUrl} alt={`Page ${img.page}`} className="aspect-[3/4] w-full object-cover" />
                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-background/90 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <span className="font-mono text-[10px]">P{img.page}</span>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveImg(i, -1)}><ChevronUp className="h-3 w-3" /></Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveImg(i, 1)}><ChevronDown className="h-3 w-3" /></Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeImg(i)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {slides.length > 0 && (
                <div>
                  <div className="flex flex-wrap items-end gap-2">
                    <p className="flex-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">Summary slides — click to edit</p>
                    <div className="flex items-end gap-2 rounded-md border border-border bg-muted/30 p-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Slides</Label>
                        <Input type="number" min={1} max={20} value={slideCount}
                          onChange={(e) => setSlideCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                          className="h-8 w-16" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Style</Label>
                        <Select value={style} onValueChange={(v) => setStyle(v as Style)}>
                          <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STYLES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button size="sm" variant="secondary" onClick={regenerateSummary} disabled={regenerating}>
                        {regenerating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                        Regenerate
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 space-y-2">
                    {slides.map((s, i) => (
                      <Card key={i} className="space-y-2 p-3">
                        <Input value={s.title} onChange={(e) => updateSlide(i, { title: e.target.value })} className="font-display font-semibold" />
                        <Textarea
                          value={s.bullets.join("\n")}
                          onChange={(e) => updateSlide(i, { bullets: e.target.value.split("\n").filter(Boolean) })}
                          rows={Math.max(3, s.bullets.length)} className="font-mono text-xs"
                        />
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="flex-wrap gap-2 sm:gap-2">
              <Button variant="outline" onClick={exportJson}><Download className="mr-1.5 h-3.5 w-3.5" />JSON</Button>
              <Button variant="outline" onClick={exportPdf} disabled={exporting}>
                {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}PDF
              </Button>
              <Button variant="outline" onClick={exportPptx} disabled={exporting}>
                {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}PPTX
              </Button>
              <Button onClick={saveTemplate} disabled={saving}>
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}Save template
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
