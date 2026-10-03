import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

/// Resolve a Google Maps share link (e.g. https://maps.app.goo.gl/xxx) into
/// { lat, lng }. Short links are followed server-side (no CORS issues) and
/// the final URL is parsed for coordinates. No API key needed.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  const raw = (url ?? "").trim();
  if (!raw) return NextResponse.json({ error: "missing_url" }, { status: 400 });

  // Plain "lat, lng" pasted directly — no network needed.
  const direct = raw.match(/(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/);
  if (direct) {
    const lat = Number(direct[1]);
    const lng = Number(direct[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return NextResponse.json({ ok: true, lat, lng });
    }
  }

  let href = raw;
  if (!/^https?:\/\//i.test(href)) href = `https://${href}`;
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return NextResponse.json({ error: "bad_url" }, { status: 400 });
  }
  if (!/google|goo\.gl|maps\.app/i.test(parsed.hostname)) {
    return NextResponse.json({ error: "not_google_maps" }, { status: 400 });
  }

  // Follow short links to the canonical URL (contains @lat,lng or ?q=lat,lng).
  let final = href;
  try {
    const res = await fetch(href, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
    // Drain so the socket closes cleanly.
    await res.arrayBuffer().catch(() => null);
    if (res.url) final = res.url;
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 400 });
  }

  const at = final.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const q = final.match(/[?&](?:q|query)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  const m = at ?? q;
  if (!m) return NextResponse.json({ error: "no_coords", final }, { status: 400 });
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "no_coords" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, lat, lng });
}
