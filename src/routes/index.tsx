import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, FileText, FileType2, Sheet, Wand2, ScanText, ShieldCheck, Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { AuthProvider } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Paperflow — PDF conversion, editing & templates" },
      { name: "description", content: "Convert PDFs to Word, text, CSV. Edit, annotate, and reuse templates. OCR for scans. Built for the modern web." },
    ],
  }),
  component: () => (
    <AuthProvider>
      <Index />
    </AuthProvider>
  ),
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased selection:bg-accent/10">
      <SiteHeader />
      <Hero />
      <Features />
      <HowItWorks />
      <CTA />
      <Footer />
    </div>
  );
}

function HeroForm() {
  const [email, setEmail] = useState("");
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    navigate({
      to: "/auth",
      search: { mode: "signup", email } as never,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="mt-10 mx-auto max-w-md w-full px-4 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row items-stretch sm:items-center">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email address"
          className="flex h-12 w-full rounded-md border border-input bg-card px-4 py-2 text-base shadow-sm transition-shadow placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm"
        />
        <Button type="submit" size="lg" className="h-12 w-full px-6 text-base sm:w-auto shrink-0 font-semibold shadow-md focus-visible:ring-2 focus-visible:ring-offset-2">
          Get Started for Free <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="bg-grid absolute inset-0 opacity-60" aria-hidden />
      <div className="absolute inset-x-0 top-0 -z-0 h-[600px] bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklab,var(--accent)_18%,transparent)_0%,_transparent_60%)]" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-4 pt-16 pb-20 md:px-8 md:pt-24 md:pb-28">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/60 px-3 py-1 font-mono text-xs uppercase tracking-widest text-accent backdrop-blur">
            <Sparkles className="h-3 w-3 text-accent" /> v1 — paper, reimagined
          </span>
          <h1 className="mt-6 font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl md:text-7xl">
            Convert, Edit & Automate<br />
            <span className="gradient-text">PDFs for Your Workflow.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg md:text-xl md:leading-relaxed">
            The fast, private PDF workspace for professionals, researchers, and creators. Convert PDFs to Word, text, or structured CSV, edit contents in-browser, and turn files into reusable templates.
          </p>

          <HeroForm />

          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 text-sm">
            <a href="#features" className="text-muted-foreground hover:text-foreground font-semibold underline underline-offset-4 hover:decoration-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm px-1">
              Explore PDF Features
            </a>
            <span className="hidden sm:inline text-muted-foreground/30">|</span>
            <span className="font-mono text-xs text-muted-foreground">No credit card. Files stay private.</span>
          </div>
        </div>

        {/* Mock preview */}
        <div className="relative mx-auto mt-12 md:mt-16 max-w-5xl">
          <div className="absolute -inset-4 -z-10 rounded-3xl bg-[var(--gradient-hero)] opacity-20 blur-3xl" aria-hidden />
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-elegant)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-destructive/70" />
                <div className="h-3 w-3 rounded-full bg-warning/70" />
                <div className="h-3 w-3 rounded-full bg-success/70" />
              </div>
              <span className="font-mono text-xs text-muted-foreground">paperflow.app/dashboard</span>
              <div className="w-12" />
            </div>
            <div className="grid grid-cols-1 gap-0 md:grid-cols-[1fr_320px]">
              <div className="border-b border-border bg-[var(--gradient-paper)] p-8 md:border-b-0 md:border-r">
                <div className="rounded-lg bg-card p-6 shadow-sm">
                  <div className="mb-4 h-3 w-2/3 rounded bg-muted" />
                  <div className="space-y-2">
                    {[...Array(8)].map((_, i) => (
                      <div key={i} className="h-2 rounded bg-muted" style={{ width: `${60 + ((i * 7) % 35)}%` }} />
                    ))}
                  </div>
                  <div className="mt-6 grid grid-cols-3 gap-2">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="h-12 rounded bg-muted/60" />
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-3 p-6">
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Convert to</p>
                {[
                  { icon: FileType2, label: "Word .docx", color: "text-blue-600" },
                  { icon: FileText, label: "Text .txt", color: "text-foreground" },
                  { icon: Sheet, label: "CSV .csv", color: "text-green-600" },
                  { icon: Wand2, label: "Template", color: "text-accent" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:bg-secondary">
                    <span className="inline-flex items-center gap-2">
                      <item.icon className={`h-4 w-4 ${item.color}`} />
                      {item.label}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Features() {
  const items = [
    { icon: FileType2, title: "PDF → Word", body: "Editable .docx files that keep paragraphs, headings, and structure intact." },
    { icon: FileText, title: "PDF → Text", body: "Clean plain text extraction — perfect for analysis, search, or AI pipelines." },
    { icon: Sheet, title: "PDF → CSV", body: "Pull tabular data out of invoices, statements, and reports automatically." },
    { icon: Wand2, title: "Templates", body: "Turn any PDF into a reusable template with editable placeholders. Save and remix." },
    { icon: ScanText, title: "OCR for scans", body: "Scanned documents? We run optical character recognition to recover the text." },
    { icon: ShieldCheck, title: "Private by default", body: "Files are scoped to your account with row-level security. Only you can see them." },
  ];
  return (
    <section id="features" className="border-y border-border bg-secondary/30 py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">What it does</p>
          <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl md:text-5xl">Everything you wished Acrobat did.</h2>
          <p className="mt-4 text-base text-muted-foreground sm:text-lg">A focused toolkit, not a 90s file manager.</p>
        </div>
        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div key={it.title} className="group relative bg-card p-8 rounded-2xl border border-border shadow-sm transition-all hover:-translate-y-1 hover:shadow-md hover:border-accent/30">
              <div className="grid h-11 w-11 place-items-center rounded-lg bg-primary text-primary-foreground transition-transform group-hover:rotate-3">
                <it.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 font-display text-xl font-semibold">{it.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", title: "Upload", body: "Drag a PDF in. We store it privately in your workspace." },
    { n: "02", title: "Convert or edit", body: "Pick a format or open the editor to annotate, highlight, and rewrite." },
    { n: "03", title: "Reuse", body: "Save it as a template. Generate new docs from the same skeleton anytime." },
  ];
  return (
    <section id="how" className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <div className="grid gap-12 md:grid-cols-[1fr_2fr] md:gap-20">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-accent">How it works</p>
            <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl md:text-5xl">Three moves.<br /> That's the whole thing.</h2>
          </div>
          <div className="space-y-6">
            {steps.map((s) => (
              <div key={s.n} className="flex gap-6 rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-[var(--shadow-elegant)]">
                <span className="font-mono text-3xl font-bold text-accent">{s.n}</span>
                <div>
                  <h3 className="font-display text-xl font-semibold">{s.title}</h3>
                  <p className="mt-1 text-muted-foreground">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="px-4 pb-20 md:pb-28 md:px-8">
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-primary px-6 py-16 sm:px-12 sm:py-20 text-primary-foreground md:px-16 md:py-24">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-accent/30 blur-3xl" aria-hidden />
        <div className="absolute -bottom-20 -left-10 h-72 w-72 rounded-full bg-accent/20 blur-3xl" aria-hidden />
        <div className="relative">
          <h2 className="font-display text-3xl font-bold leading-tight sm:text-4xl md:text-5xl">Stop fighting your PDFs.</h2>
          <p className="mt-4 max-w-xl text-base text-primary-foreground/80 sm:text-lg">Sign up free and convert your first document in under a minute.</p>
          <div className="mt-8">
            <Button asChild size="lg" variant="secondary" className="h-12 w-full px-6 text-base sm:w-auto focus-visible:ring-2 focus-visible:ring-offset-2">
              <Link to="/auth" search={{ mode: "signup" } as never} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md font-semibold">
                Create Free Account <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border py-10 bg-card">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground md:flex-row md:px-8">
        <p>© {new Date().getFullYear()} Paperflow. Made with paper and pixels.</p>
        <p className="font-mono text-xs">Built on Lovable Cloud</p>
      </div>
    </footer>
  );
}
