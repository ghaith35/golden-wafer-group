import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-lg border border-(--border-default) bg-(--bg-surface) px-3 text-sm outline-none placeholder:text-(--text-tertiary) focus:border-(--brand-500)",
        className
      )}
      {...props}
    />
  );
}
