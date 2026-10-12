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
  // version.json (written next to the APK at publish time) is the source of
  // truth: android/app/build.gradle is NOT deployed with the server, and a
  // stale copy of it once told every phone "1.7" for weeks while 1.10 was
  // already downloadable. Gradle remains as a dev fallback.
  let code = 0;
  let name = "";
  try {
    const meta = JSON.parse(await readFile(join(root, "public", "apk", "version.json"), "utf-8")) as {
      versionCode?: unknown;
      versionName?: unknown;
    };
    if (typeof meta.versionCode === "number") code = meta.versionCode;
    if (typeof meta.versionName === "string") name = meta.versionName;
  } catch {
    /* fall through to gradle */
  }
  if (!(code > 0)) {
    const gradle = await readFile(join(root, "android", "app", "build.gradle"), "utf-8").catch(() => "");
    code = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1] ?? 0);
    if (!(code > 0)) return null;
    name = /versionName\s+"([^"]+)"/.exec(gradle)?.[1] ?? "";
  }
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
