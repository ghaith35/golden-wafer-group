import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { issueSession } from "@/lib/auth/issue-session";

export async function POST(req: Request) {
  const { username, password, qrToken } = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    qrToken?: string;
  };

  // QR scan login: long-lived staff token (revocable via regenerate).
  // Payload format: {"app":"distribuili","type":"staff-login","u":"...","k":"..."}
  // — the client may send the raw token or the full JSON payload.
  let token: string | null = null;
  if (typeof qrToken === "string" && qrToken.trim()) {
    const raw = qrToken.trim();
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.k === "string") token = parsed.k;
      else token = raw;
    } catch {
      token = raw;
    }
  }
  if (token) {
    const user = await prisma.user.findFirst({
      where: { qrToken: token, isActive: true },
      include: { company: true },
    });
    if (!user) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    if (username && user.username.toLowerCase() !== String(username).trim().toLowerCase()) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }
    return issueSession(user);
  }

  if (!username || !password) return NextResponse.json({ error: "missing_credentials" }, { status: 400 });

  // Username matches case-insensitively: phone keyboards autocapitalize the
  // first letter, which otherwise locks mobile users out with a 401.
  // Staff may also sign in with their phone number (User.phone).
  // NOTE: Prisma `mode: "insensitive"` throws on SQLite (offline desktop
  // builds) — so exact-match first, then a JS case-insensitive fallback.
  const ident = username.trim();
  let user = await prisma.user.findFirst({
    where: { OR: [{ username: ident }, { phone: ident }], isActive: true },
    include: { company: true },
  });
  if (!user && ident.toLowerCase() !== ident) {
    const candidates = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, username: true },
    });
    const hit = candidates.find((c) => c.username.toLowerCase() === ident.toLowerCase());
    if (hit) {
      user = await prisma.user.findFirst({
        where: { id: hit.id, isActive: true },
        include: { company: true },
      });
    }
  }
  if (!user) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });

  return issueSession(user);
}
