import { useEffect, useState, useCallback } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Loader2, Wand2, Save, Trash2, Plus, FileText, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/templates")({
  validateSearch: (s: Record<string, unknown>) => ({ from: typeof s.from === "string" ? s.from : undefined }),
  head: () => ({ meta: [{ title: "Templates — Paperflow" }] }),
  component: () => (
    <AuthProvider>
      <Guard><Templates /></Guard>
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

interface Template {
  id: string;
  name: string;
  source_document_id: string | null;
  content: { body?: string; placeholders?: string[] };
  created_at: string;
  updated_at: string;
}

function Templates() {
  const { user } = useAuth();
  const { from } = Route.useSearch();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [active, setActive] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from("templates").select("*").order("updated_at", { ascending: false });
    if (data) setTemplates(data as unknown as Template[]);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-generate from a source doc if ?from=<docId>
  useEffect(() => {
    if (!from || !user) return;
    (async () => {
      setGenerating(true);
      try {
        const { convertPdf } = await import("@/lib/convert.functions");
        const { conversionId } = await convertPdf({ data: { documentId: from, format: "txt" } });
        const { data: conv } = await supabase.from("conversions").select("output_path").eq("id", conversionId).single();
        if (!conv?.output_path) throw new Error("Could not extract text");
        const { data: signed } = await supabase.storage.from("documents").createSignedUrl(conv.output_path, 60);
        const text = await fetch(signed!.signedUrl).then((r) => r.text());

        // Convert numbers, dates, emails, currency into {{placeholders}}
        let withHoles = text;
        let i = 1;
        const placeholders: string[] = [];
        const add = (label: string) => { const k = `${label}_${i++}`; placeholders.push(k); return `{{${k}}}`; };
        withHoles = withHoles
          .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, () => add("email"))
          .replace(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g, () => add("date"))
          .replace(/\$\s?\d[\d,]*(\.\d+)?/g, () => add("amount"))
          .replace(/\b\d{4,}\b/g, () => add("number"));

        const { data: doc } = await supabase.from("documents").select("filename").eq("id", from).single();
        const { data: tpl, error } = await supabase.from("templates").insert({
          user_id: user.id,
          name: `Template from ${doc?.filename || "PDF"}`,
          source_document_id: from,
          content: { body: withHoles, placeholders },
        }).select().single();
        if (error) throw error;
        toast.success("Template generated");
        await refresh();
        setActive(tpl as unknown as Template);
        setName(tpl.name);
        setBody(withHoles);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not generate template");
      } finally {
        setGenerating(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, user]);

  const open = (t: Template) => {
    setActive(t);
    setName(t.name);
    setBody(t.content?.body || "");
  };

  const newBlank = () => {
    setActive(null);
    setName("Untitled template");
    setBody("Hello {{name}},\n\nThis is your reusable template. Edit anything — use {{placeholders}} where you'd like.");
  };

  const save = async () => {
    if (!user) return;
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const placeholders = [...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      if (active) {
        const { error } = await supabase.from("templates").update({
          name, content: { body, placeholders }, updated_at: new Date().toISOString(),
        }).eq("id", active.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("templates").insert({
          user_id: user.id, name, content: { body, placeholders },
        }).select().single();
        if (error) throw error;
        setActive(data as unknown as Template);
      }
      toast.success("Saved");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: Template) => {
    if (!confirm(`Delete "${t.name}"?`)) return;
    await supabase.from("templates").delete().eq("id", t.id);
    if (active?.id === t.id) { setActive(null); setName(""); setBody(""); }
    refresh();
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-accent">Reusable</p>
            <h1 className="mt-2 font-display text-4xl font-bold md:text-5xl">Templates</h1>
          </div>
          <Button onClick={newBlank}><Plus className="mr-1.5 h-4 w-4" />New template</Button>
        </div>

        {generating && (
          <Card className="mt-6 flex items-center gap-3 p-4 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            Generating template from your PDF…
          </Card>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-2">
            {templates.length === 0 ? (
              <Card className="border-dashed bg-transparent p-6 text-center text-sm text-muted-foreground">
                <Wand2 className="mx-auto h-6 w-6 opacity-50" />
                <p className="mt-2">No templates yet. Create one or generate from a PDF in the dashboard.</p>
                <Button asChild variant="link" className="mt-2"><Link to="/dashboard"><ArrowLeft className="mr-1 h-3.5 w-3.5" />Go to dashboard</Link></Button>
              </Card>
            ) : (
              templates.map((t) => (
                <button key={t.id} onClick={() => open(t)} className={`group flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${active?.id === t.id ? "border-accent bg-accent/5" : "border-border bg-card hover:bg-secondary"}`}>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{t.content?.placeholders?.length || 0} placeholders</p>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); remove(t); }} className="opacity-0 transition-opacity group-hover:opacity-100">
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </button>
                </button>
              ))
            )}
          </aside>

          <Card className="p-6">
            {active === null && !name ? (
              <div className="grid place-items-center py-20 text-center text-muted-foreground">
                <FileText className="h-10 w-10 opacity-40" />
                <p className="mt-3">Select a template or create a new one.</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="tname">Name</Label>
                  <Input id="tname" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="mt-4 space-y-2">
                  <Label htmlFor="tbody">Body — use <code className="rounded bg-muted px-1 font-mono text-xs">{`{{placeholder}}`}</code> for editable spots</Label>
                  <Textarea id="tbody" value={body} onChange={(e) => setBody(e.target.value)} rows={20} className="font-mono text-sm" />
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button onClick={save} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-1.5 h-4 w-4" />Save</>}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
