"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

export type ThemeChoice = "light" | "dark" | "system";
const KEY = "distribuili-theme";

export function applyTheme(choice: ThemeChoice) {
  const dark =
    choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  const flipping = root.classList.contains("dark") !== dark;
  if (flipping) {
    // Briefly enable colour transitions so the flip fades instead of snapping.
    root.classList.add("theme-anim");
    window.setTimeout(() => root.classList.remove("theme-anim"), 450);
  }
  root.classList.toggle("dark", dark);
}

export const THEME_KEY = "distribuili-theme";
export const THEME_NAME_KEY = "distribuili-theme-name";
export const DEFAULT_THEME = "gold";
/// Fired on window whenever the light/dark choice changes, so scattered
/// toggles (sidebar selector, topbar button) stay in sync.
export const THEME_CHANGED_EVENT = "distribuili:theme-changed";

function readChoice(): ThemeChoice {
  if (typeof localStorage === "undefined") return "light";
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "light";
}

/// Current effective darkness (resolves "system" via matchMedia).
export function isDarkNow(): boolean {
  if (typeof window === "undefined") return false;
  const choice = readChoice();
  return choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/// Quick light↔dark flip used by the topbar button. Persists an explicit
/// choice and notifies other toggles.
export function toggleDark(): boolean {
  const next: ThemeChoice = isDarkNow() ? "light" : "dark";
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch { /* private mode */ }
  applyTheme(next);
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT));
  return next === "dark";
}

export function readThemeName(): string {
  return localStorage.getItem(THEME_NAME_KEY) || DEFAULT_THEME;
}

export function applyThemeName(name: string) {
  document.documentElement.dataset.theme = name;
  try {
    localStorage.setItem(THEME_NAME_KEY, name);
  } catch { /* private mode */ }
}

/// Segmented Light / Dark / System selector. Persists to localStorage and
/// follows the OS live when "system" is active.
export function ThemeSelector({ labels }: { labels: { light: string; dark: string; system: string } }) {
  const [choice, setChoice] = useState<ThemeChoice>("light");

  useEffect(() => {
    const current = readChoice();
    setChoice(current);
    applyTheme(current);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readChoice() === "system") applyTheme("system");
    };
    const onExternal = () => setChoice(readChoice());
    mq.addEventListener("change", onChange);
    window.addEventListener(THEME_CHANGED_EVENT, onExternal);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener(THEME_CHANGED_EVENT, onExternal);
    };
  }, []);

  function pick(c: ThemeChoice) {
    localStorage.setItem(KEY, c);
    setChoice(c);
    applyTheme(c);
    window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT));
  }

  const opts: Array<{ v: ThemeChoice; label: string; Icon: typeof Sun }> = [
    { v: "light", label: labels.light, Icon: Sun },
    { v: "dark", label: labels.dark, Icon: Moon },
    { v: "system", label: labels.system, Icon: Monitor },
  ];

  return (
    <div className="flex rounded-lg bg-(--bg-sunken) p-0.5" role="radiogroup" aria-label="theme">
      {opts.map(({ v, label, Icon }) => (
        <button
          key={v}
          role="radio"
          aria-checked={choice === v}
          title={label}
          onClick={() => pick(v)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-bold transition-colors",
            choice === v ? "bg-(--bg-overlay) shadow" : "opacity-60 hover:opacity-100"
          )}
        >
          <Icon size={14} />
          <span className="hidden xl:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
