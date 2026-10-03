"use client";

import type { RefRow } from "@/components/settings/RefList";

export type Settings = Record<string, string | number | boolean | null>;
export type Wilaya = { code: number; nameFr: string; nameAr: string };
export type Secteur = { id: string; name: string; wilayaCode: number; isActive: boolean; wilaya: Wilaya };

export async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/// Standard add/toggle/rename/delete handlers for a RefList bound to a REST base.
export function crud(base: string, set: (r: RefRow[]) => void, confirmDelete = true) {
  return {
    onAdd: async (name: string) => {
      await api(base, { method: "POST", body: JSON.stringify({ name }) });
      set(await api(base));
    },
    onToggle: async (row: RefRow) => {
      await api(`${base}/${row.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !row.isActive }) });
      set(await api(base));
    },
    onRename: async (row: RefRow, name: string) => {
      if (!name.trim() || name === row.name) return;
      await api(`${base}/${row.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      set(await api(base));
    },
    onDelete: async (row: RefRow) => {
      if (confirmDelete && !confirm(`${row.name} ?`)) return;
      await api(`${base}/${row.id}`, { method: "DELETE" });
      set(await api(base));
    },
  };
}
