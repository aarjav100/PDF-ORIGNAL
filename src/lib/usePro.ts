import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export function usePro() {
  const { user } = useAuth();
  const [isPro, setIsPro] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!user) {
      setIsPro(false);
      setLoading(false);
      return;
    }
    supabase
      .from("profiles")
      .select("is_pro")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        setIsPro(!!data?.is_pro);
        setLoading(false);
      });
    const ch = supabase.channel(`pro-${user.id}-${Math.random().toString(36).slice(2)}`);
    ch.on(
      "postgres_changes" as never,
      { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
      (p: { new: { is_pro?: boolean } }) => {
        setIsPro(!!p.new?.is_pro);
      },
    ).subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [user]);

  const activatePro = async () => {
    if (!user) return;
    await supabase
      .from("profiles")
      .update({ is_pro: true, pro_since: new Date().toISOString() })
      .eq("id", user.id);
    setIsPro(true);
  };
  const deactivatePro = async () => {
    if (!user) return;
    await supabase.from("profiles").update({ is_pro: false, pro_since: null }).eq("id", user.id);
    setIsPro(false);
  };

  return { isPro, loading, activatePro, deactivatePro };
}
