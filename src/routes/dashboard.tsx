import { useEffect, useState, useCallback, useMemo } from "react";
import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  FileText,
  Loader2,
  Trash2,
  FileType2,
  Sheet as SheetIcon,
  Wand2,
  ScanText,
  Download,
  Pencil,
  MoreHorizontal,
  Search,
  Star,
  FolderPlus,
  Folder,
  Inbox,
  Clock,
  RotateCcw,
  FolderInput,
  Crown,
  LayoutGrid,
  List,
  ArrowUpDown,
  Share2,
  Copy as CopyIcon,
  Edit3,
  Cloud,
  Combine,
  Menu,
} from "lucide-react";
import { BackupRestoreDialog } from "@/components/BackupRestoreDialog";
import { MergePdfsDialog } from "@/components/MergePdfsDialog";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { convertPdf } from "@/lib/convert.functions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { GeneratePptDialog } from "@/components/GeneratePptDialog";
import { GenerateTemplateDialog } from "@/components/GenerateTemplateDialog";
import { AdSlot } from "@/components/AdSlot";
import { RewardedAdDialog } from "@/components/RewardedAdDialog";
import { usePro } from "@/lib/usePro";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Paperflow" },
      { name: "description", content: "Your PDF workspace." },
    ],
  }),
  component: () => (
    <AuthProvider>
      <Guard>
        <Dashboard />
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
  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <>{children}</>;
}

interface DocRow {
  id: string;
  filename: string;
  storage_path: string;
  size_bytes: number;
  page_count: number | null;
  status: string;
  created_at: string;
  folder_id: string | null;
  is_favorite: boolean;
  deleted_at: string | null;
  last_opened_at: string | null;
}

interface ConvRow {
  id: string;
  document_id: string;
  target_format: string;
  output_path: string | null;
  status: string;
  error: string | null;
  ocr: boolean;
  created_at: string;
}

interface FolderRow {
  id: string;
  name: string;
}

type View =
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "favorites" }
  | { kind: "trash" }
  | { kind: "folder"; id: string };

function Dashboard() {
  const { user } = useAuth();
  const { isPro } = usePro();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [working, setWorking] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>({ kind: "all" });
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">(
    () =>
      (typeof window !== "undefined" && (localStorage.getItem("pf-view") as "list" | "grid")) ||
      "list",
  );
  const [sortBy, setSortBy] = useState<"date" | "name" | "size" | "opened">("date");
  const [initialLoading, setInitialLoading] = useState(true);
  const [backupOpen, setBackupOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("pf-view", viewMode);
  }, [viewMode]);

  const refresh = useCallback(async () => {
    const [d, c, f] = await Promise.all([
      supabase.from("documents").select("*").order("created_at", { ascending: false }),
      supabase.from("conversions").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("folders").select("id,name").order("name"),
    ]);
    if (d.data) setDocs(d.data as DocRow[]);
    if (c.data) setConvs(c.data as ConvRow[]);
    if (f.data) setFolders(f.data as FolderRow[]);
    setInitialLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("conv-watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversions", filter: `user_id=eq.${user.id}` },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, refresh]);

  const onDrop = useCallback(
    async (files: File[]) => {
      if (!user) return;
      const file = files[0];
      if (!file) return;
      const lower = file.name.toLowerCase();
      const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf");
      const isImg =
        /^image\/(png|jpe?g|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/.test(lower);
      if (!isPdf && !isImg) {
        toast.error("Only PDF or image files (PNG, JPG, WEBP) are supported.");
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        toast.error("File too large. Max 25 MB.");
        return;
      }
      setUploading(true);
      try {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${user.id}/uploads/${crypto.randomUUID()}-${safe}`;
        const contentType = isPdf ? "application/pdf" : file.type || "image/png";
        const { error: upErr } = await supabase.storage
          .from("documents")
          .upload(path, file, { contentType });
        if (upErr) throw upErr;
        const insert = z
          .object({ filename: z.string(), storage_path: z.string(), size_bytes: z.number() })
          .parse({
            filename: file.name,
            storage_path: path,
            size_bytes: file.size,
          });
        const folderId = view.kind === "folder" ? view.id : null;
        const { error: insErr } = await supabase
          .from("documents")
          .insert({ ...insert, user_id: user.id, folder_id: folderId });
        if (insErr) throw insErr;
        toast.success("Uploaded.");
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [user, refresh, view],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
    },
    maxFiles: 1,
    multiple: false,
  });

  const runConvert = async (doc: DocRow, format: "txt" | "docx" | "csv", ocr = false) => {
    const key = `${doc.id}-${format}-${ocr ? "ocr" : "x"}`;
    setWorking((w) => ({ ...w, [key]: "running" }));
    try {
      await convertPdf({ data: { documentId: doc.id, format, ocr } });
      toast.success(`Converted to ${format.toUpperCase()}`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setWorking((w) => {
        const n = { ...w };
        delete n[key];
        return n;
      });
    }
  };

  const downloadConv = async (c: ConvRow, doc: DocRow | undefined) => {
    if (!c.output_path) return;
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(c.output_path, 60);
    if (error || !data) {
      toast.error("Could not generate download");
      return;
    }
    const baseName = (doc?.filename || "document").replace(/\.pdf$/i, "");
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = `${baseName}.${c.target_format}`;
    a.click();
  };

  const toggleFavorite = async (doc: DocRow) => {
    await supabase.from("documents").update({ is_favorite: !doc.is_favorite }).eq("id", doc.id);
    refresh();
  };

  const moveToTrash = async (doc: DocRow) => {
    await supabase
      .from("documents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", doc.id);
    toast.success("Moved to trash");
    refresh();
  };

  const restoreFromTrash = async (doc: DocRow) => {
    await supabase.from("documents").update({ deleted_at: null }).eq("id", doc.id);
    toast.success("Restored");
    refresh();
  };

  const deleteForever = async (doc: DocRow) => {
    if (!confirm(`Permanently delete "${doc.filename}"? This cannot be undone.`)) return;
    const { data: convList } = await supabase
      .from("conversions")
      .select("output_path")
      .eq("document_id", doc.id);
    const paths = [
      doc.storage_path,
      ...((convList || []).map((c) => c.output_path).filter(Boolean) as string[]),
    ];
    if (paths.length) await supabase.storage.from("documents").remove(paths);
    await supabase.from("documents").delete().eq("id", doc.id);
    toast.success("Deleted");
    refresh();
  };

  const moveToFolder = async (doc: DocRow, folderId: string | null) => {
    await supabase.from("documents").update({ folder_id: folderId }).eq("id", doc.id);
    refresh();
  };

  const createFolder = async () => {
    if (!user) return;
    const name = prompt("Folder name");
    if (!name?.trim()) return;
    const { error } = await supabase
      .from("folders")
      .insert({ name: name.trim(), user_id: user.id });
    if (error) {
      toast.error(error.message);
      return;
    }
    refresh();
  };

  const renameFolder = async (f: FolderRow) => {
    const name = prompt("Rename folder", f.name);
    if (!name?.trim() || name.trim() === f.name) return;
    await supabase.from("folders").update({ name: name.trim() }).eq("id", f.id);
    refresh();
  };

  const deleteFolder = async (f: FolderRow) => {
    if (!confirm(`Delete folder "${f.name}"? Files inside will move to "No folder".`)) return;
    await supabase.from("documents").update({ folder_id: null }).eq("folder_id", f.id);
    await supabase.from("folders").delete().eq("id", f.id);
    if (view.kind === "folder" && view.id === f.id) setView({ kind: "all" });
    refresh();
  };

  const renameDoc = async (doc: DocRow) => {
    const name = prompt("Rename file", doc.filename);
    if (!name?.trim() || name.trim() === doc.filename) return;
    await supabase.from("documents").update({ filename: name.trim() }).eq("id", doc.id);
    refresh();
  };

  const shareDoc = async (doc: DocRow) => {
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60 * 60);
    if (error || !data) {
      toast.error("Could not generate link");
      return;
    }
    try {
      await navigator.clipboard.writeText(data.signedUrl);
      toast.success("Link copied (valid 1h)");
    } catch {
      window.prompt("Copy link", data.signedUrl);
    }
  };

  const duplicateDoc = async (doc: DocRow) => {
    if (!user) return;
    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from("documents")
        .download(doc.storage_path);
      if (dlErr || !blob) throw new Error("Download failed");
      const ext = doc.filename.split(".").pop() || "pdf";
      const base = doc.filename.replace(/\.[^.]+$/, "");
      const newName = `${base} (copy).${ext}`;
      const safe = newName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${user.id}/uploads/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, blob, { contentType: blob.type || "application/pdf" });
      if (upErr) throw upErr;
      await supabase.from("documents").insert({
        filename: newName,
        storage_path: path,
        size_bytes: doc.size_bytes,
        user_id: user.id,
        folder_id: doc.folder_id,
      });
      toast.success("Duplicated");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Duplicate failed");
    }
  };

  const filtered = useMemo(() => {
    let list = docs;
    if (view.kind === "trash") list = list.filter((d) => d.deleted_at);
    else list = list.filter((d) => !d.deleted_at);
    if (view.kind === "favorites") list = list.filter((d) => d.is_favorite);
    if (view.kind === "folder") list = list.filter((d) => d.folder_id === view.id);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((d) => d.filename.toLowerCase().includes(q));
    }
    if (view.kind === "recent") {
      list = [...list]
        .sort((a, b) =>
          (b.last_opened_at || b.created_at).localeCompare(a.last_opened_at || a.created_at),
        )
        .slice(0, 20);
    } else {
      list = [...list].sort((a, b) => {
        if (sortBy === "name") return a.filename.localeCompare(b.filename);
        if (sortBy === "size") return b.size_bytes - a.size_bytes;
        if (sortBy === "opened")
          return (b.last_opened_at || "").localeCompare(a.last_opened_at || "");
        return b.created_at.localeCompare(a.created_at);
      });
    }
    return list;
  }, [docs, view, search, sortBy]);

  const counts = useMemo(
    () => ({
      all: docs.filter((d) => !d.deleted_at).length,
      fav: docs.filter((d) => !d.deleted_at && d.is_favorite).length,
      trash: docs.filter((d) => d.deleted_at).length,
    }),
    [docs],
  );

  const storageBytes = useMemo(
    () => docs.filter((d) => !d.deleted_at).reduce((s, d) => s + (d.size_bytes || 0), 0),
    [docs],
  );
  const STORAGE_QUOTA = (isPro ? 5 : 1) * 1024 * 1024 * 1024;
  const storagePct = Math.min(100, (storageBytes / STORAGE_QUOTA) * 100);
  const fmtBytes = (b: number) =>
    b < 1024 * 1024
      ? `${(b / 1024).toFixed(0)} KB`
      : b < 1024 ** 3
        ? `${(b / 1024 / 1024).toFixed(1)} MB`
        : `${(b / 1024 ** 3).toFixed(2)} GB`;

  const NavItem = ({
    active,
    onClick,
    icon: Icon,
    label,
    count,
  }: {
    active: boolean;
    onClick: () => void;
    icon: typeof Inbox;
    label: string;
    count?: number;
  }) => (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}
    >
      <Icon className="h-4 w-4" /> <span className="flex-1 text-left">{label}</span>
      {count !== undefined && (
        <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
      )}
    </button>
  );

  const inTrash = view.kind === "trash";

  const renderSidebarContent = (isMobile = false) => {
    const handleSelectView = (v: View) => {
      setView(v);
      if (isMobile) setSidebarOpen(false);
    };

    return (
      <div className="space-y-1">
        <NavItem
          active={view.kind === "all"}
          onClick={() => handleSelectView({ kind: "all" })}
          icon={Inbox}
          label="All files"
          count={counts.all}
        />
        <NavItem
          active={view.kind === "recent"}
          onClick={() => handleSelectView({ kind: "recent" })}
          icon={Clock}
          label="Recent"
        />
        <NavItem
          active={view.kind === "favorites"}
          onClick={() => handleSelectView({ kind: "favorites" })}
          icon={Star}
          label="Favorites"
          count={counts.fav}
        />
        <NavItem
          active={view.kind === "trash"}
          onClick={() => handleSelectView({ kind: "trash" })}
          icon={Trash2}
          label="Trash"
          count={counts.trash}
        />
        <div className="mt-6 flex items-center justify-between px-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Folders
          </p>
          <button
            onClick={createFolder}
            className="text-muted-foreground hover:text-foreground"
            aria-label="New folder"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-1 space-y-0.5">
          {folders.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No folders yet</p>
          )}
          {folders.map((f) => {
            const active = view.kind === "folder" && view.id === f.id;
            return (
              <div
                key={f.id}
                className={`group flex items-center gap-1 rounded-md pr-1 ${active ? "bg-secondary" : "hover:bg-secondary/60"}`}
              >
                <button
                  onClick={() => handleSelectView({ kind: "folder", id: f.id })}
                  className={`flex flex-1 items-center gap-2.5 px-3 py-2 text-sm ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}
                >
                  <Folder className="h-4 w-4" />
                  <span className="truncate">{f.name}</span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Folder options"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => renameFolder(f)}>
                      <Edit3 className="mr-2 h-4 w-4" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => deleteFolder(f)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
        <div className="mt-6 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <span>Storage</span>
            <span>{isPro ? "Pro" : "Free"}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-primary transition-all" style={{ width: `${storagePct}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {fmtBytes(storageBytes)} of {fmtBytes(STORAGE_QUOTA)}
          </p>
          <button
            onClick={() => {
              setBackupOpen(true);
              if (isMobile) setSidebarOpen(false);
            }}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <Cloud className="h-3 w-3" /> Backup & Restore
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 md:grid-cols-[220px_1fr] md:px-8 md:py-10">
        {/* Sidebar */}
        <aside className="hidden md:block space-y-1">{renderSidebarContent(false)}</aside>

        {/* Mobile Sidebar Sheet Drawer */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-[280px] p-6 overflow-y-auto">
            <SheetHeader className="pb-4 border-b">
              <SheetTitle className="flex items-center gap-2">
                <LayoutGrid className="h-5 w-5 text-primary" />
                <span>Navigation</span>
              </SheetTitle>
            </SheetHeader>
            <div className="py-4">{renderSidebarContent(true)}</div>
          </SheetContent>
        </Sheet>

        <BackupRestoreDialog open={backupOpen} onOpenChange={setBackupOpen} onRestored={refresh} />
        <MergePdfsDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          documents={docs}
          onMerged={refresh}
        />

        {/* Main */}
        <section>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-accent">Workspace</p>
              <h1 className="mt-1 font-display text-3xl font-bold md:text-4xl">
                {view.kind === "all" && "All files"}
                {view.kind === "recent" && "Recent"}
                {view.kind === "favorites" && "Favorites"}
                {view.kind === "trash" && "Trash"}
                {view.kind === "folder" &&
                  (folders.find((f) => f.id === view.id)?.name || "Folder")}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="md:hidden inline-flex items-center gap-1.5 h-9"
                onClick={() => setSidebarOpen(true)}
              >
                <Menu className="h-4 w-4" />
                <span>Filters</span>
              </Button>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name…"
                  className="h-9 w-56 pl-8"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
                    Sort
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setSortBy("date")}>
                    Date added {sortBy === "date" && "✓"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy("name")}>
                    Name {sortBy === "name" && "✓"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy("size")}>
                    Size {sortBy === "size" && "✓"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy("opened")}>
                    Last opened {sortBy === "opened" && "✓"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="flex items-center rounded-md border border-border">
                <button
                  onClick={() => setViewMode("list")}
                  className={`grid h-9 w-9 place-items-center rounded-l-md ${viewMode === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  aria-label="List view"
                >
                  <List className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setViewMode("grid")}
                  className={`grid h-9 w-9 place-items-center rounded-r-md ${viewMode === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  aria-label="Grid view"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMergeOpen(true)}
                className="inline-flex items-center gap-1.5"
              >
                <Combine className="h-3.5 w-3.5" />
                <span>Merge PDFs</span>
              </Button>
              <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
                <Link to="/templates">Templates →</Link>
              </Button>
            </div>
          </div>

          {!inTrash && (
            <div
              {...getRootProps()}
              className={`mt-6 cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
                isDragActive
                  ? "border-accent bg-accent/5"
                  : "border-border bg-card hover:border-accent/50 hover:bg-secondary/30"
              }`}
            >
              <input {...getInputProps()} />
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground">
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Upload className="h-5 w-5" />
                )}
              </div>
              <p className="mt-3 font-display text-lg font-semibold">
                {uploading
                  ? "Uploading…"
                  : isDragActive
                    ? "Drop it here"
                    : "Drop a PDF or image, or click to upload"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Max 25 MB · Stored privately</p>
            </div>
          )}

          {!isPro && (
            <div className="mt-6">
              <AdSlot
                slot="dashboard-banner"
                placement="dashboard-banner"
                format="horizontal"
                minHeight={90}
              />
            </div>
          )}

          <div className="mt-8">
            {initialLoading ? (
              <div
                className={
                  viewMode === "grid"
                    ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
                    : "space-y-3"
                }
              >
                {Array.from({ length: viewMode === "grid" ? 8 : 4 }).map((_, i) => (
                  <Card
                    key={i}
                    className={
                      viewMode === "grid"
                        ? "h-40 animate-pulse bg-secondary/40"
                        : "h-20 animate-pulse bg-secondary/40"
                    }
                  />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <Card className="border-dashed bg-transparent p-10 text-center text-muted-foreground">
                <FileText className="mx-auto h-8 w-8 opacity-40" />
                <p className="mt-3 text-sm">
                  {search
                    ? "No files match your search."
                    : inTrash
                      ? "Trash is empty."
                      : "No files here yet."}
                </p>
              </Card>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {filtered.map((d) => (
                  <Card
                    key={d.id}
                    className="group relative flex flex-col p-4 transition-colors hover:border-accent/50"
                  >
                    <Link
                      to={inTrash ? "/dashboard" : "/edit/$docId"}
                      params={{ docId: d.id }}
                      className="flex flex-1 flex-col items-center justify-center py-4"
                      onClick={(e) => {
                        if (inTrash) e.preventDefault();
                      }}
                    >
                      <div className="grid h-14 w-14 place-items-center rounded-lg bg-destructive/10 text-destructive">
                        <FileText className="h-7 w-7" />
                      </div>
                    </Link>
                    <p className="mt-2 truncate text-sm font-medium">{d.filename}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {fmtBytes(d.size_bytes)} · {new Date(d.created_at).toLocaleDateString()}
                    </p>
                    <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {!inTrash && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => toggleFavorite(d)}
                          className="h-7 w-7"
                        >
                          <Star
                            className={`h-3.5 w-3.5 ${d.is_favorite ? "fill-accent text-accent" : ""}`}
                          />
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {!inTrash ? (
                            <>
                              <DropdownMenuItem onClick={() => renameDoc(d)}>
                                <Edit3 className="mr-2 h-4 w-4" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => shareDoc(d)}>
                                <Share2 className="mr-2 h-4 w-4" />
                                Copy share link
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => duplicateDoc(d)}>
                                <CopyIcon className="mr-2 h-4 w-4" />
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  <FolderInput className="mr-2 h-4 w-4" />
                                  Move to folder
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  <DropdownMenuItem onClick={() => moveToFolder(d, null)}>
                                    No folder
                                  </DropdownMenuItem>
                                  {folders.map((f) => (
                                    <DropdownMenuItem
                                      key={f.id}
                                      onClick={() => moveToFolder(d, f.id)}
                                    >
                                      {f.name}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => moveToTrash(d)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Move to trash
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <>
                              <DropdownMenuItem onClick={() => restoreFromTrash(d)}>
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Restore
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => deleteForever(d)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete forever
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((d, idx) => {
                  const docConvs = convs.filter((c) => c.document_id === d.id);
                  return (
                    <div key={d.id} className="space-y-3">
                      <Card className="overflow-hidden p-0">
                        <div className="flex flex-wrap items-center gap-4 p-5">
                          <div className="grid h-11 w-11 place-items-center rounded-lg bg-destructive/10 text-destructive">
                            <FileText className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{d.filename}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {(d.size_bytes / 1024).toFixed(1)} KB ·{" "}
                              {new Date(d.created_at).toLocaleString()}
                              {d.deleted_at && (
                                <span className="ml-2 text-destructive">deleted</span>
                              )}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {!inTrash && (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => toggleFavorite(d)}
                                  aria-label="Favorite"
                                  className="h-8 w-8"
                                >
                                  <Star
                                    className={`h-4 w-4 ${d.is_favorite ? "fill-accent text-accent" : ""}`}
                                  />
                                </Button>
                                <RewardedAdDialog
                                  feature="PDF → Word"
                                  slot="rewarded-word"
                                  onReward={() => runConvert(d, "docx")}
                                  trigger={
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={!!working[`${d.id}-docx-x`]}
                                    >
                                      {working[`${d.id}-docx-x`] ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <FileType2 className="h-3.5 w-3.5" />
                                      )}
                                      <span className="ml-1.5">Word</span>
                                      {!isPro && <Crown className="ml-1 h-3 w-3 text-accent" />}
                                    </Button>
                                  }
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => runConvert(d, "txt")}
                                  disabled={!!working[`${d.id}-txt-x`]}
                                >
                                  {working[`${d.id}-txt-x`] ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <FileText className="h-3.5 w-3.5" />
                                  )}
                                  <span className="ml-1.5">Text</span>
                                </Button>
                                <RewardedAdDialog
                                  feature="PDF → CSV"
                                  slot="rewarded-csv"
                                  onReward={() => runConvert(d, "csv")}
                                  trigger={
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={!!working[`${d.id}-csv-x`]}
                                    >
                                      {working[`${d.id}-csv-x`] ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <SheetIcon className="h-3.5 w-3.5" />
                                      )}
                                      <span className="ml-1.5">CSV</span>
                                      {!isPro && <Crown className="ml-1 h-3 w-3 text-accent" />}
                                    </Button>
                                  }
                                />
                                <GeneratePptDialog documentId={d.id} filename={d.filename} />
                                <GenerateTemplateDialog documentId={d.id} filename={d.filename} />
                                <Button asChild size="sm" variant="default">
                                  <Link to="/edit/$docId" params={{ docId: d.id }}>
                                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                    Edit
                                  </Link>
                                </Button>
                              </>
                            )}
                            {inTrash && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => restoreFromTrash(d)}
                              >
                                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                                Restore
                              </Button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {!inTrash && (
                                  <>
                                    <DropdownMenuItem onClick={() => renameDoc(d)}>
                                      <Edit3 className="mr-2 h-4 w-4" />
                                      Rename
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => shareDoc(d)}>
                                      <Share2 className="mr-2 h-4 w-4" />
                                      Copy share link
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => duplicateDoc(d)}>
                                      <CopyIcon className="mr-2 h-4 w-4" />
                                      Duplicate
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => runConvert(d, "txt", true)}>
                                      <ScanText className="mr-2 h-4 w-4" /> OCR → Text
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => runConvert(d, "docx", true)}>
                                      <ScanText className="mr-2 h-4 w-4" /> OCR → Word
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger>
                                        <FolderInput className="mr-2 h-4 w-4" />
                                        Move to folder
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuSubContent>
                                        <DropdownMenuItem onClick={() => moveToFolder(d, null)}>
                                          No folder
                                        </DropdownMenuItem>
                                        {folders.map((f) => (
                                          <DropdownMenuItem
                                            key={f.id}
                                            onClick={() => moveToFolder(d, f.id)}
                                          >
                                            {f.name}
                                          </DropdownMenuItem>
                                        ))}
                                      </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                    <DropdownMenuItem asChild>
                                      <Link to="/templates">
                                        <Wand2 className="mr-2 h-4 w-4" />
                                        All templates
                                      </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={() => moveToTrash(d)}
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" /> Move to trash
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {inTrash && (
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => deleteForever(d)}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" /> Delete forever
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                        {docConvs.length > 0 && !inTrash && (
                          <div className="border-t border-border bg-secondary/40 px-5 py-3">
                            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                              Conversions
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {docConvs.map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => c.status === "done" && downloadConv(c, d)}
                                  className="group inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs transition-colors hover:bg-background disabled:opacity-50"
                                  disabled={c.status !== "done"}
                                >
                                  <Badge
                                    variant="outline"
                                    className="px-1.5 py-0 font-mono text-[10px] uppercase"
                                  >
                                    {c.target_format}
                                  </Badge>
                                  {c.ocr && (
                                    <span className="font-mono text-[10px] text-accent">OCR</span>
                                  )}
                                  {c.status === "processing" && (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  )}
                                  {c.status === "done" && (
                                    <Download className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                                  )}
                                  {c.status === "failed" && (
                                    <span className="text-destructive">failed</span>
                                  )}
                                  <span className="text-muted-foreground">
                                    {new Date(c.created_at).toLocaleTimeString()}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </Card>
                      {!isPro &&
                        !inTrash &&
                        idx > 0 &&
                        (idx + 1) % 3 === 0 &&
                        idx !== filtered.length - 1 && (
                          <AdSlot
                            slot="dashboard-native"
                            placement={`dashboard-native-${idx}`}
                            format="fluid"
                            layoutKey="-6t+ed+2i-1n-4w"
                            minHeight={120}
                            label="Sponsored"
                          />
                        )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
      <Outlet />
    </div>
  );
}
