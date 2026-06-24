import { useEffect, useRef } from "react";
import { usePro } from "@/lib/usePro";
import { trackAdEvent } from "@/lib/adTracking";

const CLIENT_ID =
  (import.meta.env.VITE_ADSENSE_CLIENT as string | undefined) || "ca-pub-8816514726616311";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

interface AdSlotProps {
  slot: string; // AdSense ad slot id
  placement: string; // dashboard-banner, dashboard-native, etc.
  format?: "auto" | "fluid" | "rectangle" | "horizontal";
  layoutKey?: string; // for native/in-feed
  className?: string;
  minHeight?: number;
  label?: string;
}

export function AdSlot({
  slot,
  placement,
  format = "auto",
  layoutKey,
  className = "",
  minHeight = 100,
  label = "Advertisement",
}: AdSlotProps) {
  const { isPro, loading } = usePro();
  const ref = useRef<HTMLModElement>(null);
  const tracked = useRef(false);

  useEffect(() => {
    if (isPro || loading) return;
    if (!CLIENT_ID) return; // placeholder only
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      if (!tracked.current) {
        tracked.current = true;
        trackAdEvent({ slot, placement, event_type: "impression" });
      }
    } catch {
      // ignore push errors
    }
  }, [isPro, loading, slot, placement]);

  // Pro users never see ads.
  if (isPro || loading) return null;

  const onClickCapture = () => {
    trackAdEvent({ slot, placement, event_type: "click" });
  };

  // No AdSense client configured → render a clearly-labeled placeholder so layout/UX is verifiable.
  if (!CLIENT_ID) {
    return (
      <div
        className={`relative overflow-hidden rounded-lg border border-dashed border-border bg-secondary/40 ${className}`}
        style={{ minHeight }}
        onClickCapture={onClickCapture}
        role="complementary"
        aria-label={label}
      >
        <span className="absolute left-2 top-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <div className="flex h-full min-h-[inherit] items-center justify-center p-6 text-center">
          <p className="text-xs text-muted-foreground">
            Ad slot <span className="font-mono">{placement}</span> · configure{" "}
            <span className="font-mono">VITE_ADSENSE_CLIENT</span> to serve live ads
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} onClickCapture={onClickCapture}>
      <span className="absolute -top-4 left-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <ins
        ref={ref}
        className="adsbygoogle block"
        style={{ display: "block", minHeight }}
        data-ad-client={CLIENT_ID}
        data-ad-slot={slot}
        data-ad-format={format}
        data-ad-layout-key={layoutKey}
        data-full-width-responsive="true"
      />
    </div>
  );
}
