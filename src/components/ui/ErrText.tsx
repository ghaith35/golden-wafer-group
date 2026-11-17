"use client";

import { useTranslations } from "next-intl";

/// Server/validation errors are snake_case codes ("insufficient_stock", or
/// "insufficient_stock: Product (0/5)"). Show them in the user's language;
/// unknown text passes through untouched.
export function ErrText({ code }: { code: unknown }) {
  const t = useTranslations("errors");
  const raw = typeof code === "string" ? code : String(code ?? "");
  const m = /^([a-z][a-z0-9_]*)(?::\s*([\s\S]*))?$/.exec(raw.trim());
  if (m && t.has(m[1] as never)) {
    const base = t(m[1] as never);
    return <>{m[2] ? `${base}: ${m[2]}` : base}</>;
  }
  return <>{raw}</>;
}
