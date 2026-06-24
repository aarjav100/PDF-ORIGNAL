import { Link, useNavigate } from "@tanstack/react-router";
import { FileText, LogOut, LayoutGrid, FilePlus2, Database, User, Shield, Sparkles, Menu } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { usePro } from "@/lib/usePro";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { toast } from "sonner";

export function SiteHeader() {
  const { user, signOut } = useAuth();
  const { isPro, activatePro, deactivatePro } = usePro();
  const navigate = useNavigate();

  const handleTogglePro = async () => {
    try {
      if (isPro) {
        await deactivatePro();
        toast.success("Switched to Free plan");
      } else {
        await activatePro();
        toast.success("Switched to Pro plan!");
      }
    } catch (err) {
      toast.error("Failed to toggle plan status");
    }
  };

  const emailInitial = user?.email ? user.email.charAt(0).toUpperCase() : "U";

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
        <Link to="/" className="group flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground transition-transform group-hover:-rotate-6">
            <FileText className="h-5 w-5" />
          </div>
          <span className="font-display text-lg font-semibold tracking-tight">Paperflow</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden items-center gap-1 md:flex">
          {user ? (
            <>
              <Link to="/dashboard" className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" activeProps={{ className: "rounded-md px-3 py-2 text-sm font-medium text-foreground bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" }}>
                <span className="inline-flex items-center gap-1.5"><LayoutGrid className="h-4 w-4" /> Dashboard</span>
              </Link>
              <Link to="/datasets" className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" activeProps={{ className: "rounded-md px-3 py-2 text-sm font-medium text-foreground bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" }}>
                <span className="inline-flex items-center gap-1.5"><Database className="h-4 w-4" /> Datasets</span>
              </Link>
              <Link to="/templates" className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" activeProps={{ className: "rounded-md px-3 py-2 text-sm font-medium text-foreground bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" }}>
                Templates
              </Link>
              <Link to="/pricing" className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" activeProps={{ className: "rounded-md px-3 py-2 text-sm font-medium text-foreground bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" }}>
                Pricing Plans
              </Link>
            </>
          ) : (
            <>
              <a href="/#features" className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Explore Features</a>
              <a href="/#how" className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">How It Works</a>
              <Link to="/pricing" className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Pricing Plans</Link>
            </>
          )}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <>
              <Button asChild size="sm" variant="default" className="hidden sm:inline-flex">
                <Link to="/dashboard"><FilePlus2 className="mr-1.5 h-4 w-4" /> New upload</Link>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-10 w-10 rounded-full p-0 ring-offset-background transition-transform hover:scale-105">
                    <Avatar className="h-9 w-9 border border-border">
                      <AvatarFallback className="bg-primary/10 text-primary font-medium text-sm">
                        {emailInitial}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none text-foreground truncate">{user.email}</p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {isPro ? (
                          <Badge variant="default" className="bg-gradient-to-r from-violet-600 to-indigo-600 text-[10px] text-white border-none font-semibold px-2 py-0.5">
                            <Sparkles className="mr-0.5 h-3.5 w-3.5 inline align-text-bottom" /> Pro Plan
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] font-semibold px-2 py-0.5">
                            Free Plan
                          </Badge>
                        )}
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  
                  <DropdownMenuItem className="cursor-pointer" onClick={handleTogglePro}>
                    <Shield className="mr-2 h-4 w-4 text-violet-600" />
                    <span>Toggle Pro Status</span>
                  </DropdownMenuItem>

                  <DropdownMenuItem asChild className="cursor-pointer">
                    <Link to="/pricing">
                      <Sparkles className="mr-2 h-4 w-4 text-yellow-600" />
                      <span>Upgrade Pricing</span>
                    </Link>
                  </DropdownMenuItem>
                  
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={async () => { await signOut(); navigate({ to: "/" }); }}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Sign out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="h-10"><Link to="/auth">Sign in</Link></Button>
              <Button asChild size="sm" className="h-10"><Link to="/auth" search={{ mode: "signup" } as never}>Get started</Link></Button>
            </>
          )}

          {/* Mobile Sheet Navigation */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label="Open navigation menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] p-6">
              <SheetHeader className="pb-6 border-b">
                <SheetTitle className="flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                    <FileText className="h-4 w-4" />
                  </div>
                  <span className="font-display text-base font-semibold">Paperflow</span>
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-4 py-6">
                {user ? (
                  <>
                    <Link to="/dashboard" className="flex items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" activeProps={{ className: "flex items-center gap-2 rounded-lg px-3 py-2 text-base font-semibold text-foreground bg-secondary" }}>
                      <LayoutGrid className="h-5 w-5" /> Dashboard
                    </Link>
                    <Link to="/datasets" className="flex items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" activeProps={{ className: "flex items-center gap-2 rounded-lg px-3 py-2 text-base font-semibold text-foreground bg-secondary" }}>
                      <Database className="h-5 w-5" /> Datasets
                    </Link>
                    <Link to="/templates" className="flex items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" activeProps={{ className: "flex items-center gap-2 rounded-lg px-3 py-2 text-base font-semibold text-foreground bg-secondary" }}>
                      <FilePlus2 className="h-5 w-5" /> Templates
                    </Link>
                    <Link to="/pricing" className="flex items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" activeProps={{ className: "flex items-center gap-2 rounded-lg px-3 py-2 text-base font-semibold text-foreground bg-secondary" }}>
                      <Sparkles className="h-5 w-5" /> Pricing Plans
                    </Link>
                  </>
                ) : (
                  <>
                    <a href="/#features" className="flex items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Explore Features
                    </a>
                    <a href="/#how" className="flex items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      How It Works
                    </a>
                    <Link to="/pricing" className="flex items-center gap-2 rounded-lg px-3 py-2 text-base font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" activeProps={{ className: "flex items-center gap-2 rounded-lg px-3 py-2 text-base font-semibold text-foreground bg-secondary" }}>
                      Pricing Plans
                    </Link>
                    <div className="border-t my-2 pt-4 flex flex-col gap-2">
                      <Button asChild variant="outline" className="w-full">
                        <Link to="/auth">Sign in</Link>
                      </Button>
                      <Button asChild className="w-full">
                        <Link to="/auth" search={{ mode: "signup" } as never}>Get started</Link>
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
