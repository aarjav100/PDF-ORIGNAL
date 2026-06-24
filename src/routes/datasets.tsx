import { useEffect, useState, useCallback } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useDropzone } from "react-dropzone";
import { Database, Upload, Loader2, Trash2, FileSpreadsheet, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export const Route = createFileRoute("/datasets")({
  head: () => ({
    meta: [
      { title: "Dataset Studio — Paperflow" },
      { name: "description", content: "Upload CSVs and prepare them for analysis with AI-assisted cleaning." },
    ],
  }),
  component: () => (
    <AuthProvider>
      <Guard>
        <Studio />
      </Guard>
    </AuthProvider>
  ),
});

function Guard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [loading, user, navigate]);
  if (loading || !user) {
    return <div className="grid min-h-screen place-items-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  return <>{children}</>;
}

interface DatasetRow {
  id: string;
  filename: string;
  size_bytes: number;
  row_count: number | null;
  column_count: number | null;
  created_at: string;
  status: string;
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Studio() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("datasets")
      .select("id, filename, size_bytes, row_count, column_count, created_at, status")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setDatasets((data as DatasetRow[]) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onDrop = useCallback(async (files: File[]) => {
    if (!user || !files.length) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".csv")) { toast.error("Only .csv files are supported"); return; }
    if (file.size > MAX_BYTES) { toast.error(`File exceeds 50 MB limit`); return; }
    setUploading(true);
    setProgress(0);
    try {
      const path = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("datasets").upload(path, file, { contentType: "text/csv", upsert: false });
      if (upErr) throw upErr;
      setProgress(60);

      // Quick profile (row/column count) without parsing the whole file deeply yet
      const { parseCsv, profileDataset } = await import("@/lib/csvUtils");
      const { rows, columns } = await parseCsv(file);
      const profile = profileDataset(rows, columns);
      setProgress(90);

      const { data: inserted, error: insErr } = await supabase
        .from("datasets")
        .insert({
          user_id: user.id,
          filename: file.name,
          storage_path: path,
          size_bytes: file.size,
          row_count: profile.rowCount,
          column_count: profile.columnCount,
          columns: profile.columns.map((c) => ({ name: c.name, dtype: c.dtype })),
        })
        .select("id")
        .single();
      if (insErr) throw insErr;

      toast.success("Dataset uploaded");
      navigate({ to: "/dataset/$datasetId", params: { datasetId: inserted.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }, [user, navigate]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"] },
    maxFiles: 1,
    disabled: uploading,
  });

  const handleDelete = async (id: string, path: string) => {
    if (!confirm("Delete this dataset?")) return;
    await supabase.storage.from("datasets").remove([path]);
    await supabase.from("datasets").delete().eq("id", id);
    toast.success("Deleted");
    void refresh();
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-12 md:px-8 md:py-16">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-accent">Dataset Studio</p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight md:text-4xl">CSV preparation, with AI</h1>
            <p className="mt-1 text-sm text-muted-foreground">Upload a CSV, get an instant analysis, and clean it without writing code.</p>
          </div>
        </div>

        <Card
          {...getRootProps()}
          className={`mb-8 cursor-pointer border-2 border-dashed p-10 text-center transition-colors ${isDragActive ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"}`}
        >
          <input {...getInputProps()} />
          {uploading ? (
            <div className="space-y-3">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
              <p className="text-sm text-muted-foreground">Uploading & profiling…</p>
              <div className="mx-auto h-2 w-64 overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : (
            <>
              <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-3 font-display text-lg font-semibold">Drop a CSV here</p>
              <p className="mt-1 text-sm text-muted-foreground">or click to choose · max 50 MB</p>
            </>
          )}
        </Card>

        <div className="mb-3 flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-display text-lg font-semibold">Your datasets</h2>
        </div>

        {loading ? (
          <div className="grid place-items-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : datasets.length === 0 ? (
          <Card className="grid place-items-center py-16 text-center text-sm text-muted-foreground">
            <FileSpreadsheet className="mb-2 h-8 w-8" />
            No datasets yet — upload one above.
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {datasets.map((d) => (
              <Card key={d.id} className="group flex flex-col gap-3 p-4 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium" title={d.filename}>{d.filename}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{new Date(d.created_at).toLocaleString()}</p>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(d.id, "")} aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{d.row_count ?? "?"} rows</Badge>
                  <Badge variant="secondary">{d.column_count ?? "?"} cols</Badge>
                  <Badge variant="outline">{fmtBytes(d.size_bytes)}</Badge>
                </div>
                <Button asChild size="sm" className="mt-auto">
                  <Link to="/dataset/$datasetId" params={{ datasetId: d.id }}>
                    Open <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
