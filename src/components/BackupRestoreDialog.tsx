import { useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  Cloud,
  CloudUpload,
  Download,
  ShieldCheck,
  Loader2,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileJson,
  FileWarning,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

interface DocLite {
  id: string;
  filename: string;
  storage_path: string;
  size_bytes: number;
  page_count: number | null;
  created_at: string;
  folder_id: string | null;
  is_favorite: boolean;
  last_opened_at: string | null;
}

interface MissingFile {
  filename: string;
  size_bytes: number;
  page_count: number | null;
  storage_path: string;
  is_favorite: boolean;
  last_opened_at: string | null;
}

function fmt(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function BackupRestoreDialog({
  open,
  onOpenChange,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRestored?: () => void;
}) {
  const { user } = useAuth();
  const [docs, setDocs] = useState<DocLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: number; missing: number } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    supabase
      .from("documents")
      .select(
        "id,filename,storage_path,size_bytes,page_count,created_at,folder_id,is_favorite,last_opened_at",
      )
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setDocs((data || []) as DocLite[]);
        setLoading(false);
      });
  }, [open, user]);

  const totals = useMemo(
    () => ({
      count: docs.length,
      size: docs.reduce((s, d) => s + (d.size_bytes || 0), 0),
      lastBackup: docs[0]?.created_at,
    }),
    [docs],
  );

  const downloadManifest = () => {
    const manifest = {
      generated_at: new Date().toISOString(),
      user_id: user?.id,
      total_files: totals.count,
      total_bytes: totals.size,
      files: docs.map((d) => ({
        filename: d.filename,
        size_bytes: d.size_bytes,
        page_count: d.page_count,
        created_at: d.created_at,
        is_favorite: d.is_favorite,
        last_opened_at: d.last_opened_at,
        storage_path: d.storage_path,
      })),
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `paperflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Backup manifest downloaded");
  };

  const verifyBackup = async () => {
    if (!docs.length) {
      setVerifyResult({ ok: 0, missing: 0 });
      return;
    }
    setVerifying(true);
    setVerifyResult(null);
    let ok = 0,
      missing = 0;
    for (const d of docs) {
      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(d.storage_path, 30);
      if (error || !data?.signedUrl) missing++;
      else ok++;
    }
    setVerifyResult({ ok, missing });
    setVerifying(false);
    if (missing === 0) toast.success(`All ${ok} files verified in cloud backup`);
    else toast.warning(`${missing} file(s) missing from cloud — re-upload recommended`);
  };

  const onDrop = async (files: File[]) => {
    if (!user || !files.length) return;
    setRestoring(true);
    setProgress({ done: 0, total: files.length });
    const existing = new Set(docs.map((d) => `${d.filename}::${d.size_bytes}`));
    let added = 0,
      skipped = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const key = `${f.name}::${f.size}`;
      if (existing.has(key)) {
        skipped++;
        setProgress({ done: i + 1, total: files.length });
        continue;
      }
      const ext = f.name.split(".").pop()?.toLowerCase() || "pdf";
      const isImg = ["png", "jpg", "jpeg", "webp"].includes(ext);
      const contentType = isImg ? `image/${ext === "jpg" ? "jpeg" : ext}` : "application/pdf";
      const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${user.id}/uploads/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, f, { contentType });
      if (!upErr) {
        await supabase
          .from("documents")
          .insert({ filename: f.name, storage_path: path, size_bytes: f.size, user_id: user.id });
        added++;
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setRestoring(false);
    setProgress(null);
    toast.success(`Restored ${added} file(s)${skipped ? `, skipped ${skipped} duplicate(s)` : ""}`);
    onRestored?.();
    onOpenChange(false);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
    },
    disabled: restoring,
  });

  const [manifestBusy, setManifestBusy] = useState(false);
  const [manifestResult, setManifestResult] = useState<{
    recovered: number;
    alreadyPresent: number;
    missing: MissingFile[];
  } | null>(null);
  const manifestEntriesRef = useRef<MissingFile[]>([]);

  const onManifestFile = async (file: File) => {
    if (!user) return;
    setManifestBusy(true);
    setManifestResult(null);
    manifestEntriesRef.current = [];
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        files?: Array<{
          filename: string;
          size_bytes: number;
          page_count?: number | null;
          storage_path: string;
          is_favorite?: boolean;
          last_opened_at?: string | null;
        }>;
      };
      const entries = Array.isArray(parsed.files) ? parsed.files : [];
      if (!entries.length) {
        toast.error("Manifest contains no files");
        setManifestBusy(false);
        return;
      }

      const existingKeys = new Set(docs.map((d) => `${d.filename}::${d.size_bytes}`));
      const existingPaths = new Set(docs.map((d) => d.storage_path));
      let recovered = 0,
        alreadyPresent = 0;
      const missing: MissingFile[] = [];

      for (const e of entries) {
        if (!e.storage_path || !e.filename) continue;
        if (
          existingKeys.has(`${e.filename}::${e.size_bytes}`) ||
          existingPaths.has(e.storage_path)
        ) {
          alreadyPresent++;
          continue;
        }
        const { data: signed, error: sErr } = await supabase.storage
          .from("documents")
          .createSignedUrl(e.storage_path, 30);
        if (sErr || !signed?.signedUrl) {
          missing.push({
            filename: e.filename,
            size_bytes: e.size_bytes || 0,
            page_count: e.page_count ?? null,
            storage_path: e.storage_path,
            is_favorite: !!e.is_favorite,
            last_opened_at: e.last_opened_at ?? null,
          });
          continue;
        }
        const { error: insErr } = await supabase.from("documents").insert({
          user_id: user.id,
          filename: e.filename,
          storage_path: e.storage_path,
          size_bytes: e.size_bytes || 0,
          page_count: e.page_count ?? null,
          is_favorite: !!e.is_favorite,
          last_opened_at: e.last_opened_at ?? null,
        });
        if (insErr) {
          missing.push({
            filename: e.filename,
            size_bytes: e.size_bytes || 0,
            page_count: e.page_count ?? null,
            storage_path: e.storage_path,
            is_favorite: !!e.is_favorite,
            last_opened_at: e.last_opened_at ?? null,
          });
        } else {
          recovered++;
        }
      }

      manifestEntriesRef.current = missing;
      setManifestResult({ recovered, alreadyPresent, missing });
      if (recovered > 0) {
        toast.success(`Recovered ${recovered} file(s) from manifest`);
        onRestored?.();
      } else if (missing.length === 0) {
        toast.info("All manifest entries already present");
      } else {
        toast.warning(`${missing.length} file(s) need to be re-uploaded from device`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read manifest");
    } finally {
      setManifestBusy(false);
    }
  };

  const downloadMissingReport = () => {
    const missing = manifestEntriesRef.current;
    if (!missing.length) return;
    const header = "filename,size_bytes,page_count,storage_path,is_favorite,last_opened_at";
    const rows = missing.map((m) =>
      [
        `"${m.filename.replace(/"/g, '""')}"`,
        m.size_bytes,
        m.page_count ?? "",
        `"${m.storage_path}"`,
        m.is_favorite ? "true" : "false",
        m.last_opened_at ? new Date(m.last_opened_at).toLocaleString() : "",
      ].join(","),
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `missing-files-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Missing files report downloaded");
  };

  const manifestDz = useDropzone({
    onDrop: (f) => f[0] && onManifestFile(f[0]),
    accept: { "application/json": [".json"] },
    multiple: false,
    disabled: manifestBusy,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" /> Backup & Restore
          </DialogTitle>
          <DialogDescription>
            Your files are continuously synced to secure cloud storage. Sign in on any device to
            restore instantly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Cloud backup active</span>
              </div>
              <Badge variant="secondary">Auto-sync</Badge>
            </div>
            {loading ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="font-display text-xl font-bold">{totals.count}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Files
                  </div>
                </div>
                <div>
                  <div className="font-display text-xl font-bold">{fmt(totals.size)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Total size
                  </div>
                </div>
                <div>
                  <div className="font-display text-xl font-bold">
                    {totals.lastBackup ? new Date(totals.lastBackup).toLocaleDateString() : "—"}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Last sync
                  </div>
                </div>
              </div>
            )}
            {verifyResult && (
              <div
                className={`mt-3 flex items-center gap-2 rounded-md p-2 text-xs ${verifyResult.missing === 0 ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}
              >
                {verifyResult.missing === 0 ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" />
                )}
                {verifyResult.ok} verified · {verifyResult.missing} missing
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={verifyBackup}
              disabled={verifying || loading}
            >
              {verifying ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              )}
              Verify backup
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadManifest}
              disabled={loading || !docs.length}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export manifest
            </Button>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Restore from device
            </p>
            <div
              {...getRootProps()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"} ${restoring ? "pointer-events-none opacity-60" : ""}`}
            >
              <input {...getInputProps()} />
              {restoring && progress ? (
                <>
                  <Loader2 className="mb-2 h-6 w-6 animate-spin text-primary" />
                  <p className="text-sm font-medium">
                    Restoring {progress.done} of {progress.total}…
                  </p>
                </>
              ) : (
                <>
                  <CloudUpload className="mb-2 h-6 w-6 text-muted-foreground" />
                  <p className="text-sm font-medium">Drop files to restore, or click to browse</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Duplicates (same name + size) are skipped automatically
                  </p>
                </>
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Restore from manifest
            </p>
            <div
              {...manifestDz.getRootProps()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-5 text-center transition-colors ${manifestDz.isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"} ${manifestBusy ? "pointer-events-none opacity-60" : ""}`}
            >
              <input {...manifestDz.getInputProps()} />
              {manifestBusy ? (
                <>
                  <Loader2 className="mb-2 h-5 w-5 animate-spin text-primary" />
                  <p className="text-sm font-medium">Reading manifest…</p>
                </>
              ) : (
                <>
                  <FileJson className="mb-2 h-5 w-5 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    Drop a backup .json file, or click to browse
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Re-links files that still exist in cloud storage
                  </p>
                </>
              )}
            </div>
            {manifestResult && (
              <div className="mt-2 space-y-2 rounded-md border border-border bg-card p-2.5 text-xs">
                <div className="flex items-center gap-1.5 text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {manifestResult.recovered} recovered ·{" "}
                  {manifestResult.alreadyPresent} already present
                </div>
                {manifestResult.missing.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-muted-foreground">
                      <AlertCircle className="mr-1 inline h-3 w-3" />
                      {manifestResult.missing.length} not in cloud — re-upload below:{" "}
                      <span className="text-foreground">
                        {manifestResult.missing
                          .slice(0, 3)
                          .map((m) => m.filename)
                          .join(", ")}
                        {manifestResult.missing.length > 3
                          ? ` +${manifestResult.missing.length - 3} more`
                          : ""}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-[11px]"
                      onClick={downloadMissingReport}
                    >
                      <FileWarning className="h-3 w-3" /> Download missing-files report
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
