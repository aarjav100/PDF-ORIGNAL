import { useState } from "react";
import { Loader2, Presentation, Download, Sparkles, Image as ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { generateSlides, type Slide } from "@/lib/slides.functions";

interface Props {
  documentId: string;
  filename: string;
  trigger?: React.ReactNode;
}

export function GeneratePptDialog({ documentId, filename, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"summary" | "detailed">("detailed");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deck, setDeck] = useState<{ deckTitle: string; slides: Slide[] } | null>(null);

  const run = async () => {
    setLoading(true);
    setDeck(null);
    try {
      const res = await generateSlides({ data: { documentId, mode } });
      setDeck({ deckTitle: res.deckTitle, slides: res.slides });
      toast.success(`Generated ${res.slides.length} slide${res.slides.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate");
    } finally {
      setLoading(false);
    }
  };

  const exportPptx = async () => {
    if (!deck) return;
    setExporting(true);
    try {
      const PptxGenJS = (await import("pptxgenjs")).default;
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.title = deck.deckTitle;

      // Title slide
      const title = pptx.addSlide();
      title.background = { color: "0F172A" };
      title.addText(deck.deckTitle, {
        x: 0.6, y: 2.6, w: 12, h: 1.6,
        fontSize: 44, bold: true, color: "FFFFFF", fontFace: "Calibri",
      });
      title.addText("Generated from " + filename, {
        x: 0.6, y: 4.3, w: 12, h: 0.5,
        fontSize: 16, color: "94A3B8", fontFace: "Calibri",
      });

      // Content slides
      for (const s of deck.slides) {
        const slide = pptx.addSlide();
        slide.background = { color: "FFFFFF" };
        // Accent bar
        slide.addShape("rect", { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: "6366F1" } });
        slide.addText(s.title, {
          x: 0.6, y: 0.4, w: 12, h: 1,
          fontSize: 32, bold: true, color: "0F172A", fontFace: "Calibri",
        });
        if (s.subtitle) {
          slide.addText(s.subtitle, {
            x: 0.6, y: 1.3, w: 12, h: 0.5,
            fontSize: 16, italic: true, color: "6366F1", fontFace: "Calibri",
          });
        }
        if (s.bullets.length) {
          slide.addText(
            s.bullets.map((b) => ({ text: b, options: { bullet: { code: "25A0" }, breakLine: true } })),
            {
              x: 0.7, y: s.subtitle ? 2.0 : 1.6, w: 11.8, h: 5.0,
              fontSize: 18, color: "1E293B", fontFace: "Calibri", paraSpaceAfter: 8,
            },
          );
        }
        if (s.imageSuggestion) {
          slide.addText(`💡 ${s.imageSuggestion}`, {
            x: 0.6, y: 6.9, w: 12, h: 0.4,
            fontSize: 11, italic: true, color: "94A3B8", fontFace: "Calibri",
          });
        }
      }

      const safe = (deck.deckTitle || filename.replace(/\.pdf$/i, "")).replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 60) || "presentation";
      await pptx.writeFile({ fileName: `${safe}.pptx` });
      toast.success("Downloaded .pptx");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setDeck(null); }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" variant="outline">
            <Presentation className="mr-1.5 h-3.5 w-3.5" />PPT
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Sparkles className="h-5 w-5 text-accent" />
            AI Slide Generator
          </DialogTitle>
          <DialogDescription>Turn <span className="font-medium">{filename}</span> into a polished PowerPoint deck.</DialogDescription>
        </DialogHeader>

        {!deck && (
          <div className="space-y-4">
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "summary" | "detailed")} className="grid grid-cols-2 gap-3">
              <Label htmlFor="m-sum" className={`cursor-pointer rounded-lg border-2 p-4 transition-colors ${mode === "summary" ? "border-accent bg-accent/5" : "border-border"}`}>
                <RadioGroupItem id="m-sum" value="summary" className="sr-only" />
                <p className="font-display text-base font-semibold">Quick summary</p>
                <p className="mt-1 text-xs text-muted-foreground">1 slide · whole document at a glance</p>
              </Label>
              <Label htmlFor="m-det" className={`cursor-pointer rounded-lg border-2 p-4 transition-colors ${mode === "detailed" ? "border-accent bg-accent/5" : "border-border"}`}>
                <RadioGroupItem id="m-det" value="detailed" className="sr-only" />
                <p className="font-display text-base font-semibold">Detailed deck</p>
                <p className="mt-1 text-xs text-muted-foreground">3–5 slides · full breakdown</p>
              </Label>
            </RadioGroup>
            <Button className="w-full" onClick={run} disabled={loading}>
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing PDF…</> : <><Sparkles className="mr-2 h-4 w-4" />Generate slides</>}
            </Button>
          </div>
        )}

        {deck && (
          <div className="space-y-3">
            <p className="font-display text-lg font-semibold">{deck.deckTitle}</p>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-2">
              {deck.slides.map((s, i) => (
                <Card key={i} className="p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-display font-semibold">{s.title}</p>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Slide {i + 1}</span>
                  </div>
                  {s.subtitle && <p className="mt-0.5 text-xs italic text-accent">{s.subtitle}</p>}
                  {s.bullets.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {s.bullets.map((b, j) => (
                        <li key={j} className="flex gap-2 text-sm text-foreground/80">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />{b}
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.imageSuggestion && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ImageIcon className="h-3 w-3" />{s.imageSuggestion}
                    </p>
                  )}
                </Card>
              ))}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => setDeck(null)}>Regenerate</Button>
              <Button onClick={exportPptx} disabled={exporting}>
                {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Download .pptx
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
