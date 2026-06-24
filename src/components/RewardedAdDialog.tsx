import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Gift, Crown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { usePro } from "@/lib/usePro";
import { trackAdEvent } from "@/lib/adTracking";

interface RewardedAdDialogProps {
  feature: string; // human-readable, e.g. "PDF Compression"
  slot: string; // ad slot id
  onReward: () => void; // unlock callback
  trigger: ReactNode;
}

export function RewardedAdDialog({ feature, slot, onReward, trigger }: RewardedAdDialogProps) {
  const { isPro } = usePro();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "playing" | "done">("idle");
  const [secs, setSecs] = useState(5);

  useEffect(() => {
    if (phase !== "playing") return;
    if (secs <= 0) {
      setPhase("done");
      return;
    }
    const t = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, secs]);

  // Pro: bypass everything.
  const handleProClick = () => {
    onReward();
  };
  if (isPro) {
    return <span onClick={handleProClick}>{trigger}</span>;
  }

  const start = () => {
    setSecs(5);
    setPhase("playing");
    trackAdEvent({ slot, placement: `rewarded:${feature}`, event_type: "impression" });
  };
  const claim = () => {
    trackAdEvent({ slot, placement: `rewarded:${feature}`, event_type: "reward" });
    onReward();
    setOpen(false);
    setPhase("idle");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setPhase("idle");
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" /> Unlock {feature}
          </DialogTitle>
          <DialogDescription>
            Watch a short ad to use {feature} for free, or go Pro to skip ads forever.
          </DialogDescription>
        </DialogHeader>

        {phase === "idle" && (
          <div className="rounded-lg border border-dashed border-border bg-secondary/40 p-6 text-center">
            <Gift className="mx-auto h-8 w-8 text-accent" />
            <p className="mt-2 text-sm">
              A 5-second ad will play. You'll then unlock{" "}
              <span className="font-medium">{feature}</span>.
            </p>
          </div>
        )}
        {phase === "playing" && (
          <div className="grid min-h-[200px] place-items-center rounded-lg bg-black text-white">
            <div className="text-center">
              <p className="font-mono text-[10px] uppercase tracking-widest opacity-60">
                Sponsored
              </p>
              <p className="mt-2 font-display text-2xl font-bold">Your ad here</p>
              <p className="mt-4 text-sm opacity-80">Reward ready in {secs}s…</p>
            </div>
          </div>
        )}
        {phase === "done" && (
          <div className="rounded-lg border border-accent/50 bg-accent/10 p-6 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-accent" />
            <p className="mt-2 text-sm font-medium">Ad complete — tap claim to unlock.</p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/pricing">
              <Crown className="mr-1.5 h-4 w-4" />
              Go Pro
            </Link>
          </Button>
          {phase === "idle" && <Button onClick={start}>Watch ad</Button>}
          {phase === "playing" && <Button disabled>Please wait…</Button>}
          {phase === "done" && <Button onClick={claim}>Claim reward</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
