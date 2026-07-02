import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [{ title: "Completing Sign in — Paperflow" }],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const url = new URL(window.location.href);
        const searchParams = url.searchParams;
        
        // Parse hash params if present (sometimes redirect returns hash fragment)
        const hashParams = new URLSearchParams(
          url.hash.startsWith("#") ? url.hash.substring(1) : url.hash
        );

        // 1. Check for error parameters in URL (query or hash)
        const error = searchParams.get("error") || hashParams.get("error");
        const errorDescription =
          searchParams.get("error_description") || hashParams.get("error_description");

        if (error) {
          throw new Error(errorDescription || `Authentication error: ${error}`);
        }

        // 2. Exchange code for session (PKCE Flow)
        const code = searchParams.get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          // 3. Fallback: Wait briefly for Supabase to process session from hash fragment (Implicit Flow)
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            // Give it a brief delay to process the hash fragment
            await new Promise((resolve) => setTimeout(resolve, 800));
            const { data: { session: delayedSession } } = await supabase.auth.getSession();
            if (!delayedSession) {
              throw new Error("No session active. Please sign in again.");
            }
          }
        }

        // Success -> Redirect to dashboard
        toast.success("Successfully signed in!");
        navigate({ to: "/dashboard", replace: true });
      } catch (err) {
        console.error("Error during authentication callback:", err);
        const message = err instanceof Error ? err.message : "Authentication failed";
        toast.error(message);
        navigate({ to: "/auth", replace: true });
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
        <p className="text-muted-foreground text-sm font-medium">Completing sign in...</p>
      </div>
    </div>
  );
}
