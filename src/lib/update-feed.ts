import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/// Single source for "what version is the server on" — used by
/// /api/apk-info AND the sync pull, so the phone hears one story.

export async function getWebBuildId(): Promise<string> {
  try {
    return (await readFile(join(process.cwd(), ".next", "BUILD_ID"), "utf-8")).trim();
  } catch {
    return ""; // dev mode
  }
}

export type ApkMeta = {
  versionCode: number;
  versionName: string;
  size: number | null;
  builtAt: string | null;
  url: string;
} | null;

export async function getApkMeta(): Promise<ApkMeta> {
  const root = process.cwd();
  const gradle = await readFile(join(root, "android", "app", "build.gradle"), "utf-8").catch(() => "");
  const code = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1] ?? 0);
  if (!(code > 0)) return null;
  const name = /versionName\s+"([^"]+)"/.exec(gradle)?.[1] ?? "";
  let size: number | null = null;
  let builtAt: string | null = null;
  try {
    const st = await stat(join(root, "public", "apk", "Distribuili-Van.apk"));
    size = st.size;
    builtAt = st.mtime.toISOString();
  } catch {
    /* not published yet */
  }
  return { versionCode: code, versionName: name, size, builtAt, url: "/apk/Distribuili-Van.apk" };
}

/// Native shells older than this MUST reinstall the APK (breaking native
/// change). 0 = no floor. Set per deploy: MIN_NATIVE_VERSION_CODE=7
export function getMinNativeVersion(): number {
  const n = Number(process.env.MIN_NATIVE_VERSION_CODE ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/// FORCE_WEB_UPDATE=1 → a newer web build cannot be dismissed (critical fix).
export function isForceWebUpdate(): boolean {
  return process.env.FORCE_WEB_UPDATE === "1";
}
