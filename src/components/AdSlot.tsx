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

  // Map string identifiers to environment variables if set, otherwise fallback to slot value
  const SLOT_MAPPING: Record<string, string | undefined> = {
    "dashboard-banner": import.meta.env.VITE_ADSENSE_SLOT_BANNER,
    "dashboard-native": import.meta.env.VITE_ADSENSE_SLOT_NATIVE,
  };

  const activeSlot = SLOT_MAPPING[slot] || slot;
  const isNumericSlot = /^\d+$/.test(activeSlot);

  useEffect(() => {
    if (isPro || loading) return;
    if (!CLIENT_ID || !isNumericSlot) return; // Only push ads for valid clients & numerical slot IDs
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      if (!tracked.current) {
        tracked.current = true;
        trackAdEvent({ slot: activeSlot, placement, event_type: "impression" });
      }
    } catch {
      // ignore push errors
    }
  }, [isPro, loading, activeSlot, placement, isNumericSlot]);

  // Pro users never see ads.
  if (isPro || loading) return null;

  const onClickCapture = () => {
    if (isNumericSlot) {
      trackAdEvent({ slot: activeSlot, placement, event_type: "click" });
    }
  };

  // If no AdSense client is configured or the slot is a placeholder string (non-numeric),
  // render a placeholder to prevent AdSense from throwing HTTP 400 errors.
  if (!CLIENT_ID || !isNumericSlot) {
    const envVarName =
      slot === "dashboard-banner"
        ? "VITE_ADSENSE_SLOT_BANNER"
        : slot === "dashboard-native"
          ? "VITE_ADSENSE_SLOT_NATIVE"
          : "appropriate slot environment variable";

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
            <span className="font-mono">{envVarName}</span> with a numeric ID to serve live ads
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
        data-ad-slot={activeSlot}
        data-ad-format={format}
        data-ad-layout-key={layoutKey}
        data-full-width-responsive="true"
      />
    </div>
  );
}
