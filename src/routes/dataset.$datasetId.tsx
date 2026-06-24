import { useEffect, useMemo, useState, useCallback } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  Loader2,
  ArrowLeft,
  Sparkles,
  Download,
  Trash2,
  Plus,
  FileText,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  parseCsv,
  profileDataset,
  toCsv,
  applyCleaning,
  remainingColumns,
  type Row,
  type DatasetProfile,
  type CleaningStep,
} from "@/lib/csvUtils";
import { analyzeDataset, type DatasetReport } from "@/lib/datasets.functions";
import { applyMlPipeline, augmentDataset } from "@/lib/datasetsAdvanced.functions";

export const Route = createFileRoute("/dataset/$datasetId")({
  head: () => ({ meta: [{ title: "Dataset — Paperflow" }] }),
  component: () => (
    <AuthProvider>
      <Guard>
        <DatasetView />
      </Guard>
    </AuthProvider>
  ),
});

function Guard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);
  if (loading || !user)
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  return <>{children}</>;
}

interface DatasetMeta {
  id: string;
  filename: string;
  storage_path: string;
  cleaned_storage_path?: string | null;
  size_bytes: number;
  analysis: DatasetReport | null;
  pipeline?: any[] | null;
}

function DatasetView() {
  const { datasetId } = Route.useParams();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [profile, setProfile] = useState<DatasetProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [steps, setSteps] = useState<CleaningStep[]>([]);
  const [mlSteps, setMlSteps] = useState<any[]>([]);
  const [applyingMl, setApplyingMl] = useState(false);
  const [augmenting, setAugmenting] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  // Load dataset
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("datasets")
        .select("id, filename, storage_path, cleaned_storage_path, size_bytes, analysis, pipeline")
        .eq("id", datasetId)
        .single();
      if (error || !data) {
        toast.error(error?.message ?? "Not found");
        navigate({ to: "/datasets" });
        return;
      }
      const downloadPath = data.cleaned_storage_path || data.storage_path;
      const { data: file, error: dlErr } = await supabase.storage
        .from("datasets")
        .download(downloadPath);
      if (dlErr || !file) {
        toast.error(dlErr?.message ?? "Could not download file");
        return;
      }
      const blob = new File([file], data.filename, { type: "text/csv" });
      const parsed = await parseCsv(blob);
      if (cancelled) return;
      setMeta(data as DatasetMeta);
      setRows(parsed.rows);
      setColumns(parsed.columns);
      setProfile(profileDataset(parsed.rows, parsed.columns));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [datasetId, navigate]);

  // Apply cleaning steps in real time for preview
  const cleaned = useMemo(() => {
    if (!rows.length || !steps.length) return { rows, log: [] as string[] };
    return applyCleaning(rows, columns, steps);
  }, [rows, columns, steps]);

  const activeColumns = useMemo(() => remainingColumns(columns, steps), [columns, steps]);
  const currentProfile = useMemo(
    () => (steps.length ? profileDataset(cleaned.rows, activeColumns) : profile),
    [steps, cleaned.rows, activeColumns, profile],
  );

  // Filter + paginate preview
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cleaned.rows;
    return cleaned.rows.filter((r) =>
      activeColumns.some((c) =>
        String(r[c] ?? "")
          .toLowerCase()
          .includes(q),
      ),
    );
  }, [cleaned.rows, search, activeColumns]);
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const handleAnalyze = async () => {
    if (!profile || !meta) return;
    setAnalyzing(true);
    try {
      const report = await analyzeDataset({
        data: {
          datasetId: meta.id,
          rowCount: profile.rowCount,
          columnCount: profile.columnCount,
          duplicateRows: profile.duplicateRows,
          memoryBytes: profile.memoryBytes,
          columns: profile.columns.map((c) => ({
            name: c.name,
            dtype: c.dtype,
            missing: c.missing,
            unique: c.unique,
            min: c.min ?? null,
            max: c.max ?? null,
            mean: c.mean ?? null,
            median: c.median ?? null,
            std: c.std ?? null,
            topValues: c.topValues,
          })),
          sampleRows: rows.slice(0, 10) as Record<string, string | number | boolean | null>[],
        },
      });
      setMeta({ ...meta, analysis: report });
      toast.success("Analysis ready");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const addStep = (step: CleaningStep) => setSteps((s) => [...s, step]);
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));

  // AI Auto-Fix Functions
  const autoFixMissing = () => {
    const newSteps: CleaningStep[] = [];
    currentProfile?.columns.forEach((c) => {
      if (c.missing > 0) {
        if (c.dtype === "numeric") {
          newSteps.push({ kind: "fill_numeric", column: c.name, method: "mean" });
        } else {
          newSteps.push({ kind: "fill_categorical", column: c.name, method: "mode" });
        }
      }
    });
    if (newSteps.length > 0) {
      setSteps((s) => [...s, ...newSteps]);
      toast.success(`Added ${newSteps.length} steps to handle missing values`);
    } else {
      toast.info("No missing values found to fix!");
    }
  };

  const autoFixDuplicates = () => {
    if (steps.some((s) => s.kind === "drop_duplicates")) {
      toast.info("Duplicate removal is already in the pipeline.");
      return;
    }
    setSteps((s) => [...s, { kind: "drop_duplicates" }]);
    toast.success("Added step to drop duplicate rows");
  };

  const autoFixOutliers = () => {
    const newSteps: CleaningStep[] = [];
    currentProfile?.columns.forEach((c) => {
      if (c.dtype === "numeric") {
        newSteps.push({ kind: "outliers_iqr", column: c.name, action: "cap" });
      }
    });
    if (newSteps.length > 0) {
      setSteps((s) => [...s, ...newSteps]);
      toast.success(`Added ${newSteps.length} outlier capping steps`);
    } else {
      toast.info("No numeric columns found for outlier processing.");
    }
  };

  const autoFixAll = () => {
    // 1. Missing values
    const missingSteps: CleaningStep[] = [];
    currentProfile?.columns.forEach((c) => {
      if (c.missing > 0) {
        if (c.dtype === "numeric") {
          missingSteps.push({ kind: "fill_numeric", column: c.name, method: "mean" });
        } else {
          missingSteps.push({ kind: "fill_categorical", column: c.name, method: "mode" });
        }
      }
    });
    
    // 2. Duplicates
    const hasDupStep = steps.some((s) => s.kind === "drop_duplicates");
    const dupSteps: CleaningStep[] = [];
    if (!hasDupStep && (profile?.duplicateRows ?? 0) > 0) {
      dupSteps.push({ kind: "drop_duplicates" });
    }
    
    // 3. Outliers
    const outlierSteps: CleaningStep[] = [];
    currentProfile?.columns.forEach((c) => {
      if (c.dtype === "numeric") {
        outlierSteps.push({ kind: "outliers_iqr", column: c.name, action: "cap" });
      }
    });

    const combined = [...missingSteps, ...dupSteps, ...outlierSteps];
    if (combined.length > 0) {
      setSteps((s) => [...s, ...combined]);
      toast.success(`Applied all ${combined.length} recommended fixes! Check the Preview or Pipeline tab.`);
    } else {
      toast.info("No unresolved issues detected!");
    }
  };

  const handleApplySuggestion = (step: any) => {
    const name = step.step.toLowerCase();
    const colName = step.column;

    if (name.includes("missing") || name.includes("impute") || name.includes("fill") || name.includes("null")) {
      if (colName) {
        const col = currentProfile?.columns.find((c) => c.name === colName);
        if (col) {
          if (col.dtype === "numeric") {
            addStep({ kind: "fill_numeric", column: colName, method: "mean" });
          } else {
            addStep({ kind: "fill_categorical", column: colName, method: "mode" });
          }
          toast.success(`Imputed missing values for ${colName}`);
        } else {
          addStep({ kind: "fill_categorical", column: colName, method: "mode" });
          toast.success(`Imputed missing values for ${colName}`);
        }
      } else {
        autoFixMissing();
      }
    } else if (name.includes("duplicate") || name.includes("deduplicate")) {
      autoFixDuplicates();
    } else if (name.includes("outlier") || name.includes("iqr")) {
      if (colName) {
        addStep({ kind: "outliers_iqr", column: colName, action: "cap" });
        toast.success(`Capped outliers for ${colName}`);
      } else {
        autoFixOutliers();
      }
    } else if (name.includes("drop") || name.includes("remove") || name.includes("delete")) {
      if (colName) {
        addStep({ kind: "drop_columns", columns: [colName] });
        toast.success(`Dropped column ${colName}`);
      }
    } else {
      toast.info(`Could not automatically apply step: "${step.step}". Please configure it manually in the Cleaning Pipeline tab.`);
    }
  };

  const handleApplyMl = async () => {
    if (!mlSteps.length) return;
    setApplyingMl(true);
    try {
      const res = await applyMlPipeline({
        data: {
          datasetId: datasetId,
          steps: mlSteps,
        },
      });
      if (res.success) {
        toast.success("ML pipeline applied successfully");
        const blob = new Blob([res.csv], { type: "text/csv" });
        const parsed = await parseCsv(blob);
        setRows(parsed.rows);
        setColumns(parsed.columns);
        setProfile(profileDataset(parsed.rows, parsed.columns));
        setMlSteps([]);
        setMeta((m) =>
          m ? { ...m, column_count: res.columnCount, row_count: res.rowCount } : null,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply ML pipeline");
    } finally {
      setApplyingMl(false);
    }
  };

  const handleAugment = async (
    method: "smote" | "random_over" | "random_under",
    target: string,
    options: any,
  ) => {
    if (!target) {
      toast.error("Please select a target column");
      return;
    }
    setAugmenting(true);
    try {
      const res = await augmentDataset({
        data: {
          datasetId: datasetId,
          method,
          target,
          options,
        },
      });
      if (res.success) {
        toast.success("Dataset balanced successfully");
        const blob = new Blob([res.csv], { type: "text/csv" });
        const parsed = await parseCsv(blob);
        setRows(parsed.rows);
        setColumns(parsed.columns);
        setProfile(profileDataset(parsed.rows, parsed.columns));
        setMeta((m) => (m ? { ...m, row_count: res.rowCount } : null));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to balance dataset");
    } finally {
      setAugmenting(false);
    }
  };

  const handleExport = async () => {
    if (!meta) return;
    const csv = toCsv(cleaned.rows, activeColumns);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = meta.filename.replace(/\.csv$/i, "") + "-cleaned.csv";
    a.click();
    URL.revokeObjectURL(url);

    // Also upload cleaned version to storage
    const path = meta.storage_path.replace(/\.csv$/i, "") + "-cleaned.csv";
    await supabase.storage
      .from("datasets")
      .upload(path, blob, { contentType: "text/csv", upsert: true });
    await supabase
      .from("datasets")
      .update({ cleaned_storage_path: path, pipeline: steps })
      .eq("id", meta.id);
    toast.success("Cleaned CSV downloaded & saved");
  };

  if (loading || !profile || !meta) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="grid place-items-center py-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <Link
              to="/datasets"
              className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> All datasets
            </Link>
            <h1
              className="mt-1 truncate font-display text-2xl font-bold md:text-3xl"
              title={meta.filename}
            >
              {meta.filename}
            </h1>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="secondary">{currentProfile?.rowCount.toLocaleString()} rows</Badge>
              <Badge variant="secondary">{activeColumns.length} cols</Badge>
              <Badge variant="outline">{currentProfile?.duplicateRows ?? 0} duplicates</Badge>
              {steps.length > 0 && (
                <Badge className="bg-accent text-accent-foreground">
                  {steps.length} cleaning steps
                </Badge>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleAnalyze} disabled={analyzing}>
              {analyzing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {meta.analysis ? "Re-analyze" : "AI analysis"}
            </Button>
            <Button onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Export cleaned
            </Button>
          </div>
        </div>

        <Tabs defaultValue="preview" className="w-full">
          <TabsList>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="schema">Schema</TabsTrigger>
            <TabsTrigger value="analysis">AI Analysis</TabsTrigger>
            <TabsTrigger value="clean">Cleaning Pipeline</TabsTrigger>
            <TabsTrigger value="ml">Advanced ML Preprocessing</TabsTrigger>
          </TabsList>

          {/* PREVIEW */}
          <TabsContent value="preview" className="mt-4">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <Input
                  placeholder="Search rows…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                  className="max-w-sm"
                />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="overflow-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/50 text-left">
                    <tr>
                      <th className="px-2 py-1.5 font-mono text-muted-foreground">#</th>
                      {activeColumns.map((c) => (
                        <th key={c} className="px-2 py-1.5 font-medium">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1 font-mono text-muted-foreground">
                          {page * PAGE_SIZE + i + 1}
                        </td>
                        {activeColumns.map((c) => (
                          <td
                            key={c}
                            className={`px-2 py-1 ${r[c] == null || r[c] === "" ? "text-muted-foreground/50 italic" : ""}`}
                          >
                            {r[c] == null || r[c] === "" ? "—" : String(r[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* SCHEMA */}
          <TabsContent value="schema" className="mt-4">
            <Card className="p-4">
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4">Column</th>
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 pr-4">Missing</th>
                      <th className="py-2 pr-4">Unique</th>
                      <th className="py-2 pr-4">Min / Max</th>
                      <th className="py-2 pr-4">Mean / Median</th>
                      <th className="py-2 pr-4">Top values</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentProfile?.columns.map((c) => (
                      <tr key={c.name} className="border-t">
                        <td className="py-2 pr-4 font-medium">{c.name}</td>
                        <td className="py-2 pr-4">
                          <Badge variant="outline">{c.dtype}</Badge>
                        </td>
                        <td className="py-2 pr-4">
                          {c.missing > 0 ? (
                            <span className="text-destructive">{c.missing}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">{c.unique}</td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {c.dtype === "numeric" ? `${c.min} / ${c.max}` : "—"}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {c.dtype === "numeric" ? `${c.mean} / ${c.median}` : "—"}
                        </td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">
                          {c.topValues
                            ?.slice(0, 3)
                            .map((t) => `${t.value} (${t.count})`)
                            .join(", ") ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* ANALYSIS */}
          <TabsContent value="analysis" className="mt-4">
            {!meta.analysis ? (
              <Card className="grid place-items-center gap-3 py-16 text-center">
                <Sparkles className="h-8 w-8 text-accent" />
                <p className="text-sm text-muted-foreground">
                  Run AI analysis to get insights and recommendations.
                </p>
                <Button onClick={handleAnalyze} disabled={analyzing}>
                  {analyzing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Analyze with AI
                </Button>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="p-5 md:col-span-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-widest text-accent">
                        Summary
                      </p>
                      <p className="mt-2 text-sm">{meta.analysis.summary}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                        Quality
                      </p>
                      <p
                        className={`mt-1 font-display text-4xl font-bold ${meta.analysis.dataQuality.score >= 70 ? "text-green-600" : meta.analysis.dataQuality.score >= 40 ? "text-amber-600" : "text-destructive"}`}
                      >
                        {meta.analysis.dataQuality.score}
                      </p>
                    </div>
                  </div>
                  {meta.analysis.dataQuality.issues.length > 0 && (
                    <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border/60 pt-4">
                      <p className="text-xs text-muted-foreground">
                        AI found {meta.analysis.dataQuality.issues.length} data quality issues in this dataset.
                      </p>
                      <Button
                        size="sm"
                        onClick={autoFixAll}
                        className="shrink-0 gap-1.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Fix All Issues Automatically
                      </Button>
                    </div>
                  )}
                </Card>

                <Card className="p-4 flex flex-col justify-between gap-4">
                  <div>
                    <p className="mb-1 font-display font-semibold">Missing values</p>
                    <p className="text-sm text-muted-foreground">
                      {meta.analysis.missingValueAnalysis}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={autoFixMissing}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-accent animate-pulse" />
                    Auto-fill Missing Values
                  </Button>
                </Card>

                <Card className="p-4 flex flex-col justify-between gap-4">
                  <div>
                    <p className="mb-1 font-display font-semibold">Duplicates</p>
                    <p className="text-sm text-muted-foreground">{meta.analysis.duplicateAnalysis}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={autoFixDuplicates}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-accent animate-pulse" />
                    Remove Duplicate Rows
                  </Button>
                </Card>

                <Card className="p-4 flex flex-col justify-between gap-4">
                  <div>
                    <p className="mb-1 font-display font-semibold">Outliers</p>
                    <p className="text-sm text-muted-foreground">{meta.analysis.outlierAnalysis}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={autoFixOutliers}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-accent animate-pulse" />
                    Auto-cap Outliers (IQR)
                  </Button>
                </Card>

                {meta.analysis.classImbalance && (
                  <Card className="p-4">
                    <p className="mb-1 font-display font-semibold">
                      Class balance
                      {meta.analysis.suggestedTarget ? ` (${meta.analysis.suggestedTarget})` : ""}
                    </p>
                    <p className="text-sm text-muted-foreground">{meta.analysis.classImbalance}</p>
                  </Card>
                )}

                <Card className="p-4 md:col-span-2">
                  <p className="mb-3 flex items-center gap-2 font-display font-semibold">
                    <FileText className="h-4 w-4" />
                    Suggested preprocessing
                  </p>
                  <ol className="space-y-2 text-sm">
                    {meta.analysis.preprocessingSteps.map((s, k) => (
                      <li key={k} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border bg-secondary/30 p-3">
                        <div className="flex gap-3">
                          <span className="font-mono text-xs text-accent mt-0.5">
                            {(k + 1).toString().padStart(2, "0")}
                          </span>
                          <div className="flex-1">
                            <p className="font-medium">
                              {s.step}
                              {s.column && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  on {s.column}
                                </span>
                              )}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{s.rationale}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleApplySuggestion(s)}
                          className="shrink-0 text-xs gap-1.5 focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Sparkles className="h-3 w-3 text-accent" />
                          Apply Suggestion
                        </Button>
                      </li>
                    ))}
                  </ol>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* CLEANING */}
          <TabsContent value="clean" className="mt-4">
            <div className="grid gap-4 md:grid-cols-[1fr_320px]">
              <CleaningBuilder columns={activeColumns} profile={currentProfile} onAdd={addStep} />
              <Card className="p-4">
                <p className="mb-3 flex items-center gap-2 font-display font-semibold">
                  <CheckCircle2 className="h-4 w-4 text-accent" />
                  Pipeline
                </p>
                {steps.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No steps yet. Add one from the left.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {steps.map((s, i) => (
                      <li
                        key={i}
                        className="flex items-start justify-between gap-2 rounded border bg-secondary/30 p-2 text-xs"
                      >
                        <div>
                          <p className="font-mono text-[10px] uppercase text-accent">
                            Step {i + 1}
                          </p>
                          <p className="mt-0.5">{describeStep(s)}</p>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeStep(i)}
                          className="h-6 w-6"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
                {cleaned.log.length > 0 && (
                  <div className="mt-4 border-t pt-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Transformation log
                    </p>
                    <ul className="space-y-1 text-[11px] text-muted-foreground">
                      {cleaned.log.map((l, i) => (
                        <li key={i}>· {l}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            </div>
          </TabsContent>

          {/* ADVANCED ML PREPROCESSING */}
          <TabsContent value="ml" className="mt-4">
            <div className="grid gap-6 md:grid-cols-[1fr_360px]">
              <MlPipelineBuilder
                columns={activeColumns}
                profile={currentProfile}
                onAdd={(step) => setMlSteps((prev) => [...prev, step])}
                onAugment={handleAugment}
                augmenting={augmenting}
              />
              <Card className="p-5 flex flex-col justify-between border-border bg-card">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <p className="font-display font-semibold flex items-center gap-2 text-foreground">
                      <Sparkles className="h-4 w-4 text-accent" />
                      ML Pipeline Queue
                    </p>
                    {mlSteps.length > 0 && (
                      <Badge
                        variant="outline"
                        className="animate-pulse border-accent/30 text-accent bg-accent/5"
                      >
                        {mlSteps.length} pending
                      </Badge>
                    )}
                  </div>
                  {mlSteps.length === 0 ? (
                    <div className="py-8 px-4 text-center text-xs text-muted-foreground border border-dashed rounded-lg bg-secondary/10">
                      No ML steps queued yet. Configure and add steps from the builder panel on the
                      left.
                    </div>
                  ) : (
                    <ol className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {mlSteps.map((s, i) => (
                        <li
                          key={i}
                          className="flex items-start justify-between gap-2 rounded-lg border bg-secondary/20 p-2.5 text-xs transition-colors hover:bg-secondary/30"
                        >
                          <div>
                            <p className="font-mono text-[9px] uppercase tracking-wider text-accent">
                              Step {i + 1}
                            </p>
                            <p className="mt-0.5 font-medium text-foreground">
                              {describeMlStep(s)}
                            </p>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setMlSteps((prev) => prev.filter((_, idx) => idx !== i))}
                            className="h-6 w-6 shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </li>
                      ))}
                    </ol>
                  )}

                  {meta?.pipeline && meta.pipeline.length > 0 && (
                    <div className="mt-6 pt-5 border-t">
                      <p className="mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Applied Pipeline History
                      </p>
                      <ul className="space-y-2 text-xs text-muted-foreground max-h-[200px] overflow-y-auto pr-1">
                        {meta.pipeline.map((p: any, i: number) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 bg-secondary/10 p-2 rounded"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0 mt-1.5" />
                            <div className="flex-1">
                              <span className="font-mono text-[9px] uppercase text-muted-foreground">
                                Action {i + 1}
                              </span>
                              <p className="font-medium text-foreground/80 mt-0.5">
                                {p.kind === "augment"
                                  ? `Augmentation (${p.method.toUpperCase()}) on [${p.target}]`
                                  : describeMlStep(p)}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="mt-6 pt-4 border-t">
                  <Button
                    onClick={handleApplyMl}
                    disabled={mlSteps.length === 0 || applyingMl}
                    className="w-full bg-accent hover:bg-accent/90 text-accent-foreground font-semibold shadow-md py-5"
                  >
                    {applyingMl ? (
                      <>
                        <Loader2 className="mr-2 h-4.5 w-4.5 animate-spin" />
                        Applying ML Pipeline...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4.5 w-4.5" />
                        Apply ML Pipeline ({mlSteps.length} steps)
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function describeStep(s: CleaningStep): string {
  switch (s.kind) {
    case "drop_missing_rows":
      return `Drop rows with missing values${s.columns?.length ? ` in ${s.columns.join(", ")}` : ""}`;
    case "fill_numeric":
      return `Fill "${s.column}" with ${s.method}${s.method === "constant" ? ` (${s.constant})` : ""}`;
    case "fill_categorical":
      return `Fill "${s.column}" with ${s.method}${s.method === "constant" ? ` ("${s.constant}")` : ""}`;
    case "drop_duplicates":
      return "Remove duplicate rows";
    case "outliers_iqr":
      return `${s.action === "remove" ? "Remove" : "Cap"} IQR outliers in "${s.column}"`;
    case "drop_columns":
      return `Drop columns: ${s.columns.join(", ")}`;
  }
}

function CleaningBuilder({
  columns,
  profile,
  onAdd,
}: {
  columns: string[];
  profile: DatasetProfile | null;
  onAdd: (s: CleaningStep) => void;
}) {
  const [fillCol, setFillCol] = useState("");
  const [fillMethod, setFillMethod] = useState<"mean" | "median" | "mode" | "constant">("mean");
  const [fillConst, setFillConst] = useState("");
  const [catCol, setCatCol] = useState("");
  const [catMethod, setCatMethod] = useState<"mode" | "constant">("mode");
  const [catConst, setCatConst] = useState("");
  const [outCol, setOutCol] = useState("");
  const [outAction, setOutAction] = useState<"remove" | "cap">("remove");
  const [dropCol, setDropCol] = useState("");

  const numericCols =
    profile?.columns.filter((c) => c.dtype === "numeric").map((c) => c.name) ?? [];
  const catCols = profile?.columns.filter((c) => c.dtype !== "numeric").map((c) => c.name) ?? [];

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <p className="mb-2 font-display font-semibold">Missing values</p>
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="outline" onClick={() => onAdd({ kind: "drop_missing_rows" })}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Drop rows with any missing
          </Button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_140px_120px_auto]">
          <Select value={fillCol} onValueChange={setFillCol}>
            <SelectTrigger>
              <SelectValue placeholder="Numeric column" />
            </SelectTrigger>
            <SelectContent>
              {numericCols.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={fillMethod} onValueChange={(v) => setFillMethod(v as typeof fillMethod)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mean">Mean</SelectItem>
              <SelectItem value="median">Median</SelectItem>
              <SelectItem value="mode">Mode</SelectItem>
              <SelectItem value="constant">Constant</SelectItem>
            </SelectContent>
          </Select>
          {fillMethod === "constant" ? (
            <Input
              type="number"
              placeholder="0"
              value={fillConst}
              onChange={(e) => setFillConst(e.target.value)}
            />
          ) : (
            <div />
          )}
          <Button
            size="sm"
            disabled={!fillCol}
            onClick={() =>
              onAdd({
                kind: "fill_numeric",
                column: fillCol,
                method: fillMethod,
                constant: fillMethod === "constant" ? Number(fillConst) : undefined,
              })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_140px_120px_auto]">
          <Select value={catCol} onValueChange={setCatCol}>
            <SelectTrigger>
              <SelectValue placeholder="Categorical column" />
            </SelectTrigger>
            <SelectContent>
              {catCols.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={catMethod} onValueChange={(v) => setCatMethod(v as typeof catMethod)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mode">Mode</SelectItem>
              <SelectItem value="constant">Constant</SelectItem>
            </SelectContent>
          </Select>
          {catMethod === "constant" ? (
            <Input
              placeholder="unknown"
              value={catConst}
              onChange={(e) => setCatConst(e.target.value)}
            />
          ) : (
            <div />
          )}
          <Button
            size="sm"
            disabled={!catCol}
            onClick={() =>
              onAdd({
                kind: "fill_categorical",
                column: catCol,
                method: catMethod,
                constant: catMethod === "constant" ? catConst : undefined,
              })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <p className="mb-2 font-display font-semibold">Duplicates</p>
        <Button size="sm" variant="outline" onClick={() => onAdd({ kind: "drop_duplicates" })}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Remove duplicate rows
        </Button>
      </Card>

      <Card className="p-4">
        <p className="mb-2 font-display font-semibold">Outliers (IQR)</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
          <Select value={outCol} onValueChange={setOutCol}>
            <SelectTrigger>
              <SelectValue placeholder="Numeric column" />
            </SelectTrigger>
            <SelectContent>
              {numericCols.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={outAction} onValueChange={(v) => setOutAction(v as typeof outAction)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="remove">Remove</SelectItem>
              <SelectItem value="cap">Cap to bounds</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!outCol}
            onClick={() => onAdd({ kind: "outliers_iqr", column: outCol, action: outAction })}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <p className="mb-2 font-display font-semibold">Drop columns</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Select value={dropCol} onValueChange={setDropCol}>
            <SelectTrigger>
              <SelectValue placeholder="Column" />
            </SelectTrigger>
            <SelectContent>
              {columns.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!dropCol}
            onClick={() => {
              onAdd({ kind: "drop_columns", columns: [dropCol] });
              setDropCol("");
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </Card>
    </div>
  );
}

function describeMlStep(s: any): string {
  const colsText = s.columns && s.columns.length > 0 ? ` [${s.columns.join(", ")}]` : "";
  switch (s.kind) {
    case "label_encode":
      return `Label Encode${colsText}`;
    case "one_hot_encode":
      return `One-Hot Encode${colsText}`;
    case "standard_scale":
      return `Standard Scale${colsText}`;
    case "minmax_scale":
      return `Min-Max Scale${colsText}`;
    case "robust_scale":
      return `Robust Scale${colsText}`;
    case "polynomial_features":
      return `Polynomial Features (degree ${s.options?.degree ?? 2})${colsText}`;
    case "log_transform":
      return `Log Transform${colsText}`;
    case "binning":
      return `Binning (${s.options?.bins ?? 5} bins)${colsText}`;
    case "variance_threshold":
      return `Variance Threshold (threshold ${s.options?.threshold ?? 0})`;
    case "correlation_drop":
      return `Correlation Drop (threshold ${s.options?.threshold ?? 0.95})`;
    default:
      return String(s.kind);
  }
}

interface MlPipelineBuilderProps {
  columns: string[];
  profile: DatasetProfile | null;
  onAdd: (step: any) => void;
  onAugment: (
    method: "smote" | "random_over" | "random_under",
    target: string,
    options: any,
  ) => void;
  augmenting: boolean;
}

function MlPipelineBuilder({
  columns,
  profile,
  onAdd,
  onAugment,
  augmenting,
}: MlPipelineBuilderProps) {
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [polyDegree, setPolyDegree] = useState("2");
  const [binsCount, setBinsCount] = useState("5");
  const [varThreshold, setVarThreshold] = useState("0.0");
  const [corrThreshold, setCorrThreshold] = useState("0.95");

  // Balancing state
  const [augMethod, setAugMethod] = useState<"smote" | "random_over" | "random_under">("smote");
  const [augTarget, setAugTarget] = useState("");
  const [augRandomState, setAugRandomState] = useState("42");

  const numericCols =
    profile?.columns.filter((c) => c.dtype === "numeric").map((c) => c.name) ?? [];
  const catCols = profile?.columns.filter((c) => c.dtype !== "numeric").map((c) => c.name) ?? [];

  const handleToggleCol = (c: string) => {
    setSelectedCols((prev) => (prev.includes(c) ? prev.filter((col) => col !== c) : [...prev, c]));
  };

  const handleSelectAll = (cols: string[]) => {
    setSelectedCols(cols);
  };

  const handleClearSelection = () => {
    setSelectedCols([]);
  };

  return (
    <Card className="p-5 border-border bg-card">
      <Tabs defaultValue="encoding" className="w-full">
        <TabsList className="grid grid-cols-5 w-full bg-secondary/50">
          <TabsTrigger value="encoding" onClick={handleClearSelection} className="text-xs">
            Encoding
          </TabsTrigger>
          <TabsTrigger value="scaling" onClick={handleClearSelection} className="text-xs">
            Scaling
          </TabsTrigger>
          <TabsTrigger value="features" onClick={handleClearSelection} className="text-xs">
            Features
          </TabsTrigger>
          <TabsTrigger value="selection" onClick={handleClearSelection} className="text-xs">
            Selection
          </TabsTrigger>
          <TabsTrigger value="balance" onClick={handleClearSelection} className="text-xs">
            Balancing
          </TabsTrigger>
        </TabsList>

        {/* ENCODING */}
        <TabsContent value="encoding" className="mt-4 space-y-4">
          <div>
            <h3 className="font-semibold text-sm">Categorical Encoding</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Convert string and category columns into numerical formats for machine learning
              models.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAdd({ kind: "one_hot_encode", columns: selectedCols })}
              disabled={selectedCols.length === 0}
              className="flex-1"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> One-Hot Encode ({selectedCols.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAdd({ kind: "label_encode", columns: selectedCols })}
              disabled={selectedCols.length === 0}
              className="flex-1"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Label Encode ({selectedCols.length})
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-muted-foreground">
                Select Columns ({catCols.length} available)
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSelectAll(catCols)}
                  className="hover:text-foreground underline"
                >
                  All
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="hover:text-foreground underline"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-[220px] overflow-y-auto border rounded-md p-2 bg-secondary/10 space-y-1.5">
              {catCols.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No categorical columns available.
                </p>
              ) : (
                catCols.map((c) => (
                  <label
                    key={c}
                    className="flex items-center gap-2 text-xs cursor-pointer p-1 rounded hover:bg-secondary/30"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCols.includes(c)}
                      onChange={() => handleToggleCol(c)}
                      className="rounded border-input text-accent focus:ring-accent"
                    />
                    <span className="truncate">{c}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </TabsContent>

        {/* SCALING */}
        <TabsContent value="scaling" className="mt-4 space-y-4">
          <div>
            <h3 className="font-semibold text-sm">Feature Scaling</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Normalize or standardize numeric features to improve model convergence and training
              speed.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAdd({ kind: "standard_scale", columns: selectedCols })}
              disabled={selectedCols.length === 0}
              className="flex-1"
            >
              Standard Scaler ({selectedCols.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAdd({ kind: "minmax_scale", columns: selectedCols })}
              disabled={selectedCols.length === 0}
              className="flex-1"
            >
              MinMax Scaler ({selectedCols.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAdd({ kind: "robust_scale", columns: selectedCols })}
              disabled={selectedCols.length === 0}
              className="flex-1"
            >
              Robust Scaler ({selectedCols.length})
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-muted-foreground">
                Select Numeric Columns ({numericCols.length} available)
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSelectAll(numericCols)}
                  className="hover:text-foreground underline"
                >
                  All
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="hover:text-foreground underline"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-[220px] overflow-y-auto border rounded-md p-2 bg-secondary/10 space-y-1.5">
              {numericCols.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No numeric columns available.
                </p>
              ) : (
                numericCols.map((c) => (
                  <label
                    key={c}
                    className="flex items-center gap-2 text-xs cursor-pointer p-1 rounded hover:bg-secondary/30"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCols.includes(c)}
                      onChange={() => handleToggleCol(c)}
                      className="rounded border-input text-accent"
                    />
                    <span className="truncate">{c}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </TabsContent>

        {/* FEATURES & TRANSFORMS */}
        <TabsContent value="features" className="mt-4 space-y-4">
          <div>
            <h3 className="font-semibold text-sm">Features & Transforms</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Generate polynomial features, bin numeric fields, or apply log transformation.
            </p>
          </div>

          <div className="space-y-3 p-3.5 border rounded-lg bg-secondary/5">
            <div className="flex items-end justify-between gap-2.5">
              <div className="flex-1 space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground">
                  Polynomial Degree
                </label>
                <Input
                  type="number"
                  min="2"
                  max="5"
                  value={polyDegree}
                  onChange={(e) => setPolyDegree(e.target.value)}
                  className="h-8 py-1 text-xs"
                />
              </div>
              <Button
                size="sm"
                onClick={() =>
                  onAdd({
                    kind: "polynomial_features",
                    columns: selectedCols,
                    options: { degree: Number(polyDegree) || 2 },
                  })
                }
                disabled={selectedCols.length === 0}
              >
                Add Poly Step
              </Button>
            </div>

            <div className="flex items-end justify-between gap-2.5 border-t pt-3">
              <div className="flex-1 space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground">
                  Log Transformation (log1p)
                </label>
                <p className="text-[10px] text-muted-foreground">
                  Applies log(x + 1) to compress right-skewed ranges.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => onAdd({ kind: "log_transform", columns: selectedCols })}
                disabled={selectedCols.length === 0}
              >
                Add Log Step
              </Button>
            </div>

            <div className="flex items-end justify-between gap-2.5 border-t pt-3">
              <div className="flex-1 space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground">
                  Number of Bins
                </label>
                <Input
                  type="number"
                  min="2"
                  max="100"
                  value={binsCount}
                  onChange={(e) => setBinsCount(e.target.value)}
                  className="h-8 py-1 text-xs"
                />
              </div>
              <Button
                size="sm"
                onClick={() =>
                  onAdd({
                    kind: "binning",
                    columns: selectedCols,
                    options: { bins: Number(binsCount) || 5 },
                  })
                }
                disabled={selectedCols.length === 0}
              >
                Add Binning
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-muted-foreground">
                Select Numeric Columns ({numericCols.length} available)
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSelectAll(numericCols)}
                  className="hover:text-foreground underline"
                >
                  All
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="hover:text-foreground underline"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-[140px] overflow-y-auto border rounded-md p-2 bg-secondary/10 space-y-1.5">
              {numericCols.map((c) => (
                <label
                  key={c}
                  className="flex items-center gap-2 text-xs cursor-pointer p-1 rounded hover:bg-secondary/30"
                >
                  <input
                    type="checkbox"
                    checked={selectedCols.includes(c)}
                    onChange={() => handleToggleCol(c)}
                    className="rounded border-input text-accent"
                  />
                  <span className="truncate">{c}</span>
                </label>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* DIMENSION SELECTION */}
        <TabsContent value="selection" className="mt-4 space-y-4">
          <div>
            <h3 className="font-semibold text-sm">Feature Selection</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Remove features with low variance (constant values) or drop highly correlated
              features.
            </p>
          </div>

          <div className="space-y-3.5">
            <div className="p-3.5 border rounded-lg bg-secondary/5 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-foreground">Variance Threshold</span>
                <Badge className="bg-secondary text-secondary-foreground text-[10px]">
                  VarianceFilter
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Drops columns whose variance falls below the threshold. Good for eliminating columns
                with zero or near-zero variance.
              </p>
              <div className="flex gap-2 items-center pt-1">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={varThreshold}
                  onChange={(e) => setVarThreshold(e.target.value)}
                  className="h-8 text-xs max-w-[120px]"
                />
                <Button
                  size="sm"
                  onClick={() =>
                    onAdd({
                      kind: "variance_threshold",
                      columns: [],
                      options: { threshold: Number(varThreshold) || 0.0 },
                    })
                  }
                >
                  Add Variance Threshold
                </Button>
              </div>
            </div>

            <div className="p-3.5 border rounded-lg bg-secondary/5 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-foreground">High Correlation Drop</span>
                <Badge className="bg-secondary text-secondary-foreground text-[10px]">
                  CorrelationFilter
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Drops highly collinear features to prevent multi-collinearity issues. Threshold
                ranges from 0.0 (drop all) to 1.0 (keep all).
              </p>
              <div className="flex gap-2 items-center pt-1">
                <Input
                  type="number"
                  step="0.01"
                  min="0.5"
                  max="1.0"
                  value={corrThreshold}
                  onChange={(e) => setCorrThreshold(e.target.value)}
                  className="h-8 text-xs max-w-[120px]"
                />
                <Button
                  size="sm"
                  onClick={() =>
                    onAdd({
                      kind: "correlation_drop",
                      columns: [],
                      options: { threshold: Number(corrThreshold) || 0.95 },
                    })
                  }
                >
                  Add Correlation Drop
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* CLASS BALANCING */}
        <TabsContent value="balance" className="mt-4 space-y-4">
          <div>
            <h3 className="font-semibold text-sm">Class Balancing & Augmentation</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Address class imbalance by applying SMOTE (Synthetic Minority Over-sampling Technique)
              or random sampling directly on backend.
            </p>
          </div>

          <div className="p-4 border rounded-lg bg-secondary/5 space-y-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground">
                Balancing Method
              </label>
              <Select value={augMethod} onValueChange={(v) => setAugMethod(v as typeof augMethod)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="smote">SMOTE (Synthetic Over-sampling)</SelectItem>
                  <SelectItem value="random_over">Random Over-Sampling</SelectItem>
                  <SelectItem value="random_under">Random Under-Sampling</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground">
                Target (Class) Column
              </label>
              <Select value={augTarget} onValueChange={setAugTarget}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select class column..." />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground">
                Random State Seed
              </label>
              <Input
                type="number"
                value={augRandomState}
                onChange={(e) => setAugRandomState(e.target.value)}
                className="h-8 py-1 text-xs"
              />
            </div>

            <div className="pt-2">
              <Button
                onClick={() =>
                  onAugment(augMethod, augTarget, { random_state: Number(augRandomState) || 42 })
                }
                disabled={!augTarget || augmenting}
                className="w-full bg-accent text-accent-foreground font-semibold text-xs"
                size="sm"
              >
                {augmenting ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Balancing Dataset...
                  </>
                ) : (
                  <>
                    <Database className="mr-1.5 h-3.5 w-3.5" /> Run Augmentation
                  </>
                )}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
