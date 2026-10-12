import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin, audit } from "@/lib/superadmin/session";
import { cfConfigured, provisionTunnel, tunnelBaseDomain } from "@/lib/tunnels/cloudflare";

/// Vendor tunnel slots: one public hostname per client (dist-client1, …).
/// POST {label?} allocates the next free dist-clientN, provisions the Cloudflare
/// tunnel + DNS when credentials exist, otherwise leaves the slot `manual`
/// with instructions. Audited.
export async function GET() {
  const su = await requireSuperAdmin();
  if (!su.ok) return su.response;
  const rows = await prisma.tunnelSlot.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return NextResponse.json({ rows, cfConfigured: cfConfigured(), base: tunnelBaseDomain() });
}

export async function POST(req: Request) {
  const su = await requireSuperAdmin();
  if (!su.ok) return su.response;
  const { label, subdomain: wantSub } = (await req.json().catch(() => ({}))) as { label?: string; subdomain?: string };

  // Custom subdomain (client name) or next free dist-clientN. Race-safe via
  // the unique constraint — a clash returns 409, never a duplicate tunnel.
  const existing = await prisma.tunnelSlot.findMany({ select: { subdomain: true } });
  const taken = new Set(existing.map((r) => r.subdomain));
  let subdomain: string;
  const want = String(wantSub ?? "").trim().toLowerCase();
  if (want) {
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(want)) return NextResponse.json({ error: "bad_subdomain" }, { status: 400 });
    if (taken.has(want)) return NextResponse.json({ error: "subdomain_taken" }, { status: 409 });
    subdomain = want;
  } else {
    let n = 1;
    while (taken.has(`dist-client${n}`)) n += 1;
    subdomain = `dist-client${n}`;
  }
  const domain = `${subdomain}.${tunnelBaseDomain()}`;

  let status = "manual";
  let tunnelId: string | null = null;
  let token: string | null = null;
  if (cfConfigured()) {
    const p = await provisionTunnel(subdomain);
    if (p) {
      status = "active";
      tunnelId = p.tunnel.id;
      token = p.tunnel.token;
    }
  }
  const row = await prisma.tunnelSlot.create({
    data: { subdomain, domain, label: label?.trim() || null, status, tunnelId, token },
  });
  await audit(su.admin.adminId, "tunnel.allocate", "tunnel", row.id, { subdomain, status });
  return NextResponse.json(
    {
      ...row,
      manual: status === "manual"
        ? `Cloudflare credentials absent/failed — create tunnel "${subdomain}" + CNAME ${domain} manually, then paste the connector token to the client.`
        : null,
    },
    { status: 201 }
  );
}
