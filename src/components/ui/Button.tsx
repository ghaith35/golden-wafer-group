import * as React from "react";
import { cn } from "@/lib/utils";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive" };

export function Button({ variant = "primary", className, ...props }: Props) {
  const base = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition active:translate-y-px disabled:opacity-50";
  const variants: Record<string, string> = {
    primary: "bg-gradient-brand text-(--brand-contrast) hover:opacity-95",
    secondary: "bg-(--bg-sunken) text-(--text-primary) hover:bg-(--border-subtle)",
    outline: "border border-(--border-default) bg-transparent hover:bg-(--bg-sunken)",
    ghost: "bg-transparent hover:bg-(--bg-sunken)",
    destructive: "bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white",
  };
  return <button className={cn(base, variants[variant], className)} {...props} />;
}
