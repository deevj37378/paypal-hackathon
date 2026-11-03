import Link from "next/link";

export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="grid size-6 place-items-center rounded-md bg-primary text-xs text-primary-foreground">
            A
          </span>
          Allowance
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 uppercase">Sandbox</span>
        </Link>
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </header>
  );
}

export function SignOutButton() {
  return (
    <form action="/api/session/logout" method="post">
      <button className="text-sm text-muted-foreground hover:text-foreground">Sign out</button>
    </form>
  );
}
