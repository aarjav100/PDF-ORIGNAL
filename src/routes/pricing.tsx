import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Crown, Sparkles, ShieldOff, BarChart3 } from "lucide-react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePro } from "@/lib/usePro";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Paperflow Pro" },
      {
        name: "description",
        content:
          "Go Pro to remove ads and unlock PDF compression, merging, AI summarization and PDF→Word conversion.",
      },
    ],
  }),
  component: () => (
    <AuthProvider>
      <PricingPage />
    </AuthProvider>
  ),
});

interface Stats {
  impressions: number;
  clicks: number;
  rewards: number;
  revenue: number;
}

function PricingPage() {
  const { user } = useAuth();
  const { isPro, activatePro, deactivatePro } = usePro();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("ad_events")
      .select("event_type,revenue_micros")
      .then(({ data }) => {
        if (!data) return;
        const s: Stats = { impressions: 0, clicks: 0, rewards: 0, revenue: 0 };
        for (const r of data as { event_type: string; revenue_micros: number }[]) {
          if (r.event_type === "impression") s.impressions++;
          else if (r.event_type === "click") s.clicks++;
          else if (r.event_type === "reward") s.rewards++;
          s.revenue += r.revenue_micros || 0;
        }
        setStats(s);
      });
  }, [user, isPro]);

  const goPro = async () => {
    if (!user) {
      toast.error("Sign in first");
      return;
    }
    await activatePro();
    toast.success("Welcome to Pro — ads are gone.");
  };
  const downgrade = async () => {
    await deactivatePro();
    toast.success("Back on the Free plan.");
  };

  const free = [
    "Upload & view PDFs",
    "Basic editing & annotations",
    "Limited conversions",
    "Ads in dashboard & file lists",
  ];
  const pro = [
    "Everything in Free",
    "No ads, anywhere",
    "Unlimited PDF compression",
    "Unlimited merge & split",
    "AI summarization & notes",
    "Priority PDF → Word conversion",
  ];

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-16 md:px-8 md:py-24">
        <div className="text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Pricing</p>
          <h1 className="mt-2 font-display text-4xl font-bold md:text-5xl">
            Simple plans, no surprises
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Stay on Free with ads, or go Pro to unlock everything and remove ads for good.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Card className="p-7">
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Free
            </p>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-display text-4xl font-bold">$0</span>
              <span className="text-sm text-muted-foreground">/ forever</span>
            </div>
            <ul className="mt-6 space-y-2.5 text-sm">
              {free.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  {f}
                </li>
              ))}
            </ul>
            <Button variant="outline" className="mt-7 w-full" disabled={!isPro} onClick={downgrade}>
              {isPro ? "Switch to Free" : "Current plan"}
            </Button>
          </Card>

          <Card className="relative overflow-hidden border-accent/40 bg-gradient-to-br from-accent/5 to-transparent p-7">
            <div className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-accent-foreground">
              <Crown className="h-3 w-3" /> Pro
            </div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-accent">Pro</p>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-display text-4xl font-bold">$6</span>
              <span className="text-sm text-muted-foreground">/ month</span>
            </div>
            <ul className="mt-6 space-y-2.5 text-sm">
              {pro.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 text-accent" />
                  {f}
                </li>
              ))}
            </ul>
            {isPro ? (
              <Button className="mt-7 w-full" disabled>
                <Sparkles className="mr-1.5 h-4 w-4" />
                You're on Pro
              </Button>
            ) : (
              <Button className="mt-7 w-full" onClick={goPro}>
                <Crown className="mr-1.5 h-4 w-4" />
                Activate Pro
              </Button>
            )}
            <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Billing not connected yet — activates instantly for testing
            </p>
          </Card>
        </div>

        {user && (
          <Card className="mt-10 p-6">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-accent" />
              <h2 className="font-display text-lg font-semibold">Your ad activity</h2>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Impressions" value={stats?.impressions ?? 0} />
              <Stat label="Clicks" value={stats?.clicks ?? 0} />
              <Stat label="Rewards" value={stats?.rewards ?? 0} />
              <Stat
                label="Est. revenue"
                value={`$${((stats?.revenue ?? 0) / 1_000_000).toFixed(4)}`}
              />
            </div>
            {isPro && (
              <p className="mt-4 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                <ShieldOff className="h-3.5 w-3.5" /> Ads are disabled on your account.
              </p>
            )}
          </Card>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Questions?{" "}
          <Link to="/" className="underline">
            Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
    </div>
  );
}
