import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = [
  "from-amber-400/30 to-amber-600/20 text-amber-600",
  "from-emerald-400/30 to-emerald-600/20 text-emerald-600",
  "from-sky-400/30 to-sky-600/20 text-sky-600",
  "from-rose-400/30 to-rose-600/20 text-rose-500",
  "from-violet-400/30 to-violet-600/20 text-violet-500",
  "from-orange-400/30 to-orange-600/20 text-orange-500",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/// Initials tile with a stable colour per name (walk-in = neutral person icon).
export function Avatar({ name, size = "md", walkin }: { name: string; size?: "sm" | "md" | "lg"; walkin?: boolean }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br font-black",
        size === "sm" ? "h-9 w-9 text-[12px]" : size === "lg" ? "h-14 w-14 rounded-2xl text-lg" : "h-11 w-11 text-sm",
        walkin ? "from-(--bg-sunken) to-(--bg-sunken) text-(--text-tertiary)" : TONES[hash(name) % TONES.length]
      )}
    >
      {walkin ? <UserRound size={size === "lg" ? 22 : 16} /> : initials}
    </span>
  );
}
