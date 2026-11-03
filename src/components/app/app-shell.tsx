import Link from "next/link";
import { SignOutButton, SiteHeader } from "@/components/app/site-header";

export type NavKey = "dashboard" | "agents" | "rules" | "chat" | "store";

const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard" },
  { key: "rules", href: "/rules", label: "Rules" },
  { key: "agents", href: "/agents", label: "Agents" },
  { key: "chat", href: "/agent", label: "Try the agent" },
];

/** Signed-in layout: header with primary navigation + centred content column. */
export function AppShell({ active, children }: { active: NavKey; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader>
        <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
          {NAV.map((n) => (
            <Link
              key={n.key}
              href={n.href}
              aria-current={active === n.key ? "page" : undefined}
              className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <SignOutButton />
      </SiteHeader>
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto border-b px-4 py-2 sm:hidden">
        {NAV.map((n) => (
          <Link
            key={n.key}
            href={n.href}
            aria-current={active === n.key ? "page" : undefined}
            className="shrink-0 rounded-md px-2.5 py-1 text-sm text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground"
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}
