import { supabase } from "@/integrations/supabase/client";

export type AdEventType = "impression" | "click" | "reward";

export async function trackAdEvent(opts: {
  slot: string;
  event_type: AdEventType;
  placement?: string;
  revenue_micros?: number;
  metadata?: Record<string, unknown>;
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("ad_events").insert({
    user_id: user.id,
    slot: opts.slot,
    event_type: opts.event_type,
    placement: opts.placement ?? null,
    revenue_micros: opts.revenue_micros ?? 0,
    metadata: (opts.metadata ?? {}) as never,
  });
}
