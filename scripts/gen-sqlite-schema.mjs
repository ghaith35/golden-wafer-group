// Generates prisma/schema.sqlite.prisma from prisma/schema.prisma so the two
// never drift. SQLite (via Prisma) cannot express everything the Postgres
// schema uses, so this transform downgrades the unsupported pieces:
//
//   • enums               -> `String`  (values still validated by Zod)
//   • enum @default(Val)  -> @default("Val")  (bare identifier must be quoted)
//   • scalar list `T[]`   -> `String`  (JSON-encoded at the app boundary)
//   • @db.* native attrs  -> stripped (Postgres-only)
//   • datasource provider -> sqlite
//   • client output       -> src/generated/prisma-sqlite (second client)
//
// Decimal / Json carry over unchanged (Prisma's SQLite connector supports
// them). Run: `node scripts/gen-sqlite-schema.mjs`.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "prisma/schema.prisma");
const OUT = resolve(ROOT, "prisma/schema.sqlite.prisma");

const PRISMA_SCALARS = new Set([
  "String",
  "Boolean",
  "Int",
  "BigInt",
  "Float",
  "Decimal",
  "DateTime",
  "Json",
  "Bytes",
]);

const raw = readFileSync(SRC, "utf8").replace(/\r\n?/g, "\n");

// 1) Collect enum names.
const enumNames = new Set();
for (const m of raw.matchAll(/^enum\s+(\w+)\s*\{/gm)) enumNames.add(m[1]);

const lines = raw.split("\n");
const out = [];

let inEnum = false; // skip enum declaration blocks entirely
let inGenerator = false;
let inDatasource = false;

for (const line of lines) {
  const trimmed = line.trim();

  // --- Drop enum blocks ---
  if (inEnum) {
    if (trimmed === "}") inEnum = false;
    continue;
  }
  if (/^enum\s+\w+\s*\{/.test(trimmed)) {
    inEnum = true;
    continue;
  }

  // --- Rewrite generator block (custom output for the 2nd client) ---
  if (/^generator\s+client\s*\{/.test(trimmed)) {
    inGenerator = true;
    out.push("generator client {");
    out.push('  provider = "prisma-client-js"');
    out.push('  output   = "../src/generated/prisma-sqlite"');
    continue;
  }
  if (inGenerator) {
    if (trimmed === "}") {
      inGenerator = false;
      out.push("}");
    }
    continue; // drop original generator body
  }

  // --- Rewrite datasource block (postgresql -> sqlite) ---
  if (/^datasource\s+\w+\s*\{/.test(trimmed)) {
    inDatasource = true;
    out.push("datasource db {");
    out.push('  provider = "sqlite"');
    continue;
  }
  if (inDatasource) {
    if (trimmed === "}") {
      inDatasource = false;
      out.push("}");
    }
    continue; // drop original datasource body (provider line)
  }

  out.push(transformFieldLine(line, enumNames));
}

function transformFieldLine(line, enums) {
  // Only touch model field lines: `  name   Type   @attrs`
  const m = line.match(/^(\s+)(\w+)(\s+)([\w[\]?]+)(.*)$/);
  if (!m) return stripDbAttrs(line);

  let [, indent, fieldName, gap, type, rest] = m;

  const optional = type.endsWith("?");
  const isList = type.endsWith("[]");
  const baseType = type.replace(/[?[\]]/g, "");

  const isEnum = enums.has(baseType);
  const isScalarList = isList && (PRISMA_SCALARS.has(baseType) || isEnum);

  if (isEnum) {
    // Enum -> String. Quote a bare enum-value default.
    type = isList ? "String" : optional ? "String?" : "String";
    rest = quoteEnumDefault(rest);
  } else if (isScalarList) {
    // Scalar list -> single String (JSON-encoded by the app).
    type = "String";
    rest = quoteListDefault(rest);
  }

  return stripDbAttrs(`${indent}${fieldName}${gap}${type}${rest}`);
}

function quoteListDefault(rest) {
  return rest.replace(/@default\(\s*\[([^\]]*)\]\s*\)/g, (full, inner) => {
    const items = inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        if (
          (s.startsWith('"') && s.endsWith('"')) ||
          (s.startsWith("'") && s.endsWith("'"))
        ) {
          return s.slice(1, -1);
        }
        if (s === "true") return true;
        if (s === "false") return false;
        if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
        return s;
      });
    return `@default(${JSON.stringify(JSON.stringify(items))})`;
  });
}

function quoteEnumDefault(rest) {
  // @default(received) -> @default("received"); leave functions/quoted/[] alone.
  return rest.replace(/@default\(([^)]*)\)/g, (full, val) => {
    const v = val.trim();
    if (
      v.startsWith('"') ||
      v.startsWith("[") ||
      v.endsWith(")") || // function call e.g. now()/cuid()
      v === "true" ||
      v === "false" ||
      /^-?\d+(\.\d+)?$/.test(v)
    ) {
      return full;
    }
    return `@default("${v}")`;
  });
}

function stripDbAttrs(line) {
  // Remove @db.Xxx and @db.Xxx(...) native type attributes.
  return line.replace(/\s*@db\.\w+(\([^)]*\))?/g, "");
}

mkdirSync(resolve(ROOT, "src/generated"), { recursive: true });
writeFileSync(
  OUT,
  "// AUTO-GENERATED from schema.prisma by scripts/gen-sqlite-schema.mjs — do not edit.\n" +
    out.join("\n"),
);
console.log(`Wrote ${OUT}`);
console.log(`Downgraded ${enumNames.size} enums to String.`);
