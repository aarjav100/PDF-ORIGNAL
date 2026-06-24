import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="font-mono text-sm uppercase tracking-widest text-accent">404 / lost page</p>
        <h1 className="mt-4 font-display text-7xl font-bold text-foreground">Off the page.</h1>
        <p className="mt-4 text-muted-foreground">That URL doesn't exist in this archive.</p>
        <div className="mt-8">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Paperflow — PDF conversion, editing & templates" },
      {
        name: "description",
        content:
          "Upload, convert, edit and template PDFs in your browser. Export to Word, text, CSV. OCR for scanned documents.",
      },
      { property: "og:title", content: "Paperflow — PDF conversion, editing & templates" },
      {
        property: "og:description",
        content: "Upload, convert, edit and template PDFs. Export to Word, text, CSV.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const adsenseClient =
    (import.meta.env.VITE_ADSENSE_CLIENT as string | undefined) || "ca-pub-8816514726616311";
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `try{var t=localStorage.getItem('paperflow-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}`,
        }}
      />
      {adsenseClient && (
        <script
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient}`}
          crossOrigin="anonymous"
        />
      )}
      <Outlet />
      <Toaster richColors position="top-right" />
    </>
  );
}
