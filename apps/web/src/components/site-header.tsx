import Link from "next/link";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

interface Props {
  backHref?: string;
  backLabel?: string;
  rightSlot?: React.ReactNode;
}

export function SiteHeader({ backHref, backLabel, rightSlot }: Props) {
  return (
    <header className="safe-top glass sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex items-center gap-2 text-base font-bold tracking-tight">
            <span className="bg-primary text-primary-foreground shadow-primary/30 grid size-8 place-items-center rounded-xl shadow-lg">
              <Camera className="size-4" />
            </span>
            <span className="hidden sm:inline">PhotoDost</span>
          </Link>
          {backHref ? (
            <Button asChild variant="ghost" size="sm" className="rounded-full">
              <Link href={backHref}>{backLabel ?? "Back"}</Link>
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {rightSlot}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
