import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { FileText, ArrowRight, Loader2 } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    mode: (s.mode as string) === "signup" ? "signup" : "signin",
    email: typeof s.email === "string" ? s.email : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Paperflow" },
      { name: "description", content: "Sign in to your Paperflow account." },
    ],
  }),
  component: AuthPage,
});

const schema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "Min 6 characters").max(72),
});

function AuthPage() {
  const { mode: initialMode, email: queryEmail } = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState(queryEmail || "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // If already signed in, redirect
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) throw error;
        toast.success(
          "Account created! Check your email to confirm, or sign in if confirmation is disabled.",
        );
        // Try sign in immediately in case auto-confirm is on
        const { data } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (data.session) navigate({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left visual */}
      <div className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:block">
        <div className="bg-grid absolute inset-0 opacity-20" aria-hidden />
        <div
          className="absolute -right-20 top-1/4 h-96 w-96 rounded-full bg-accent/30 blur-3xl"
          aria-hidden
        />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Link to="/" className="inline-flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary-foreground text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <span className="font-display text-lg font-semibold">Paperflow</span>
          </Link>
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-accent">Welcome</p>
            <h1 className="mt-3 font-display text-5xl font-bold leading-tight">
              The PDF workspace
              <br />
              for actual humans.
            </h1>
            <p className="mt-4 max-w-md text-primary-foreground/70">
              Convert, edit, and template your documents — all in one private workspace.
            </p>
          </div>
          <p className="font-mono text-xs text-primary-foreground/50">Built on Lovable Cloud</p>
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-8 inline-flex items-center gap-2 lg:hidden">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <FileText className="h-5 w-5" />
            </div>
            <span className="font-display text-lg font-semibold">Paperflow</span>
          </Link>

          <h2 className="font-display text-3xl font-bold">
            {mode === "signup" ? "Create your account" : "Welcome back"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signup"
              ? "Start converting and editing PDFs in seconds."
              : "Sign in to continue to your workspace."}
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              onClick={async () => {
                const { error } = await supabase.auth.signInWithOAuth({
                  provider: "google",
                  options: {
                    redirectTo: `${window.location.origin}/auth/callback`,
                  },
                });
                if (error) toast.error(error.message);
              }}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.25 1.05-3.72 1.05-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.94l3.66-2.84Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.65l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
                />
              </svg>
              Continue with Google
            </Button>
            <div className="relative my-2">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs uppercase text-muted-foreground">
                or
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11"
              />
            </div>
            <Button type="submit" className="h-11 w-full" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {mode === "signup" ? "Create account" : "Sign in"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signup" ? "Already have an account?" : "New to Paperflow?"}{" "}
            <button
              onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {mode === "signup" ? "Sign in" : "Create one"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
