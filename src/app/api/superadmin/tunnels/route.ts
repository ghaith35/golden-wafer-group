import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin, audit } from "@/lib/superadmin/session";
import { cfConfigured, provisionTunnel, tunnelBaseDomain } from "@/lib/tunnels/cloudflare";

/// Vendor tunnel slots: one public hostname per client (client1, client2…).
/// POST {label?} allocates the next free clientN, provisions the Cloudflare
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
  const { label } = (await req.json().catch(() => ({}))) as { label?: string };

  // Next free clientN (skips taken/deleted numbers, race-safe via unique).
  const existing = await prisma.tunnelSlot.findMany({ select: { subdomain: true } });
  const taken = new Set(existing.map((r) => r.subdomain));
  let n = 1;
  while (taken.has(`client${n}`)) n += 1;
  const subdomain = `client${n}`;
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
