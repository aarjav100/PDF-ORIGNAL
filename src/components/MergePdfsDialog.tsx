import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Loader2, ChevronUp, ChevronDown, Check, Trash2, Combine, Upload } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

interface DocLite {
  id: string;
  filename: string;
  storage_path: string;
  size_bytes: number;
  created_at: string;
  deleted_at: string | null;
}

interface MergeItem {
  id: string; // document id for workspace, generated uuid for local
  filename: string;
  size_bytes: number;
  source: "workspace" | "local";
  storage_path?: string; // only for workspace
  file?: File; // only for local
}

export function MergePdfsDialog({ open, onOpenChange, documents, onMerged }: { open: boolean; onOpenChange: (open: boolean) => void; documents: DocLite[]; onMerged: () => void }) {
  const { user } = useAuth();
  const [mergeItems, setMergeItems] = useState<MergeItem[]>([]);
  const [outputName, setOutputName] = useState("merged_document.pdf");
  const [merging, setMerging] = useState(false);

  // Filter available PDFs (not deleted)
  const pdfDocs = useMemo(() => {
    return documents.filter((d) => !d.deleted_at && d.filename.toLowerCase().endsWith(".pdf"));
  }, [documents]);

  const toggleWorkspaceSelect = (doc: DocLite) => {
    setMergeItems((prev) => {
      const exists = prev.some((x) => x.id === doc.id);
      if (exists) {
        return prev.filter((x) => x.id !== doc.id);
      } else {
        return [
          ...prev,
          {
            id: doc.id,
            filename: doc.filename,
            size_bytes: doc.size_bytes,
            source: "workspace",
            storage_path: doc.storage_path,
          },
        ];
      }
    });
  };

  const handleLocalFilesUpload = (files: FileList | null) => {
    if (!files) return;
    const newItems: MergeItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.name.toLowerCase().endsWith(".pdf")) {
        toast.error(`"${f.name}" is not a PDF file.`);
        continue;
      }
      newItems.push({
        id: `local-${crypto.randomUUID()}`,
        filename: f.name,
        size_bytes: f.size,
        source: "local",
        file: f,
      });
    }
    if (newItems.length > 0) {
      setMergeItems((prev) => [...prev, ...newItems]);
      toast.success(`Added ${newItems.length} file(s) from computer.`);
    }
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setMergeItems((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[index - 1];
      next[index - 1] = temp;
      return next;
    });
  };

  const moveDown = (index: number) => {
    setMergeItems((prev) => {
      if (index === prev.length - 1) return prev;
      const next = [...prev];
      const temp = next[index];
      next[index] = next[index + 1];
      next[index + 1] = temp;
      return next;
    });
  };

  const removeItem = (id: string) => {
    setMergeItems((prev) => prev.filter((x) => x.id !== id));
  };

  const handleMerge = async () => {
    if (!user) return;
    if (mergeItems.length < 2) {
      toast.error("Please select at least 2 PDF files to merge.");
      return;
    }
    if (!outputName.trim()) {
      toast.error("Please enter a name for the merged PDF.");
      return;
    }

    setMerging(true);
    try {
      const pdfBuffers: Uint8Array[] = [];

      // Process and download buffers
      for (let i = 0; i < mergeItems.length; i++) {
        const item = mergeItems[i];
        
        if (item.source === "workspace") {
          toast.info(`Downloading workspace file "${item.filename}"... (${i + 1}/${mergeItems.length})`);
          const { data: blob, error: dlErr } = await supabase.storage.from("documents").download(item.storage_path!);
          if (dlErr || !blob) {
            throw new Error(`Failed to download "${item.filename}"`);
          }
          const buf = new Uint8Array(await blob.arrayBuffer());
          pdfBuffers.push(buf);
        } else {
          toast.info(`Reading local file "${item.filename}"... (${i + 1}/${mergeItems.length})`);
          if (!item.file) {
            throw new Error(`Local file data missing for "${item.filename}"`);
          }
          const buf = new Uint8Array(await item.file.arrayBuffer());
          pdfBuffers.push(buf);
        }
      }

      toast.info("Merging PDFs client-side...");
      
      // Perform client-side merge using pdf-lib
      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const srcDoc = await PDFDocument.load(buf);
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
      }
      
      const mergedBytes = await mergedPdf.save();

      // Format filename
      let filename = outputName.trim();
      if (!filename.toLowerCase().endsWith(".pdf")) {
        filename += ".pdf";
      }
      const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${user.id}/uploads/${crypto.randomUUID()}-${safeFilename}`;

      toast.info("Uploading merged PDF to storage...");
      
      // Upload final PDF to Supabase Storage
      const { error: upErr } = await supabase.storage.from("documents").upload(path, mergedBytes, {
        contentType: "application/pdf",
      });
      if (upErr) throw upErr;

      // Insert final document entry in Supabase DB
      const { error: insErr } = await supabase.from("documents").insert({
        user_id: user.id,
        filename,
        storage_path: path,
        size_bytes: mergedBytes.byteLength,
      });
      if (insErr) throw insErr;

      toast.success("PDFs successfully merged and saved!");
      setMergeItems([]);
      onMerged();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Failed to merge PDFs");
    } finally {
      setMerging(false);
    }
  };

  const fmtBytes = (b: number) => {
    return b < 1024 * 1024
      ? `${(b / 1024).toFixed(0)} KB`
      : `${(b / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-6">
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Combine className="h-5 w-5 text-primary" /> Merge Multiple PDFs
          </DialogTitle>
          <DialogDescription>
            Select PDF files from your workspace or upload them from your computer, arrange them, and merge them into one PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 py-2 space-y-4 pr-1">
          {/* Upload and Selection Zone */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Workspace selector */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Select from workspace ({pdfDocs.length})
              </h3>
              {pdfDocs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No workspace PDFs found.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-1.5 max-h-[160px] overflow-y-auto border border-border rounded-lg bg-card p-2">
                  {pdfDocs.map((d) => {
                    const matchedIdx = mergeItems.findIndex((x) => x.id === d.id);
                    const selected = matchedIdx !== -1;
                    return (
                      <button
                        key={d.id}
                        onClick={() => toggleWorkspaceSelect(d)}
                        className={`flex items-center justify-between rounded px-3 py-2 text-left text-xs transition-colors ${
                          selected
                            ? "bg-secondary/80 hover:bg-secondary font-medium"
                            : "hover:bg-secondary/40 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <span className="truncate pr-2">{d.filename}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="font-mono text-[9px] opacity-75">{fmtBytes(d.size_bytes)}</span>
                          <div
                            className={`flex h-4 w-4 items-center justify-center rounded-full border border-border text-[9px] font-bold ${
                              selected ? "bg-primary text-primary-foreground border-primary" : "bg-background"
                            }`}
                          >
                            {selected ? matchedIdx + 1 : ""}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Computer file uploader */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Upload from computer
              </h3>
              <div className="flex items-center justify-center border border-dashed border-border rounded-lg bg-card/40 p-4 hover:bg-secondary/20 transition-colors h-[160px]">
                <label className="flex flex-col items-center justify-center cursor-pointer text-center w-full h-full">
                  <Upload className="h-7 w-7 text-muted-foreground mb-2" />
                  <span className="text-xs font-medium">Click to upload PDFs</span>
                  <span className="text-[10px] text-muted-foreground mt-1">Select multiple files if needed</span>
                  <input
                    type="file"
                    multiple
                    accept=".pdf"
                    onChange={(e) => handleLocalFilesUpload(e.target.files)}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Merge Order */}
          {mergeItems.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Merge Order ({mergeItems.length} files total)
              </h3>
              <div className="border border-border rounded-lg bg-card p-2 space-y-1.5 max-h-[220px] overflow-y-auto">
                {mergeItems.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded border border-border/40 bg-background p-2 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate pr-2">
                      <span className="font-mono text-[10px] font-bold text-muted-foreground w-4">
                        {index + 1}.
                      </span>
                      <span className="truncate font-medium">{item.filename}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide border flex-shrink-0 ${
                        item.source === "workspace" 
                          ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/20 dark:border-blue-800 dark:text-blue-400" 
                          : "bg-green-50 border-green-200 text-green-700 dark:bg-green-950/20 dark:border-green-800 dark:text-green-400"
                      }`}>
                        {item.source === "workspace" ? "Workspace" : "Computer"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => moveUp(index)}
                        disabled={index === 0}
                        title="Move up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => moveDown(index)}
                        disabled={index === mergeItems.length - 1}
                        title="Move down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={() => removeItem(item.id)}
                        title="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Output name */}
          {mergeItems.length >= 2 && (
            <div className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Merged Document Filename
                </label>
                <Input
                  value={outputName}
                  onChange={(e) => setOutputName(e.target.value)}
                  placeholder="e.g. merged_document.pdf"
                  className="h-9"
                  disabled={merging}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4 mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={merging}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleMerge}
            disabled={merging || mergeItems.length < 2 || !outputName.trim()}
          >
            {merging ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Merging...
              </>
            ) : (
              <>
                <Combine className="mr-1.5 h-4 w-4" /> Merge PDFs
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
