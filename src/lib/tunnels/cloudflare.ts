/// Cloudflare Tunnel provisioning (vendor side only).
/// Every call fail-softs to null — the slot stays `manual` with instructions
/// instead of breaking the vendor console when credentials are absent.
/// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID,
///      TUNNEL_BASE_DOMAIN (default khiatadz.com).
/// NOTE: per-client hostnames must stay ONE level below the zone
/// (dist-client1.khiatadz.com ✓) — the free Universal cert never covers
/// two levels (client1.distribuili.khiatadz.com ✗).

const API = "https://api.cloudflare.com/client/v4";

function cfg(): { token: string; account: string; zone: string; base: string } | null {
  const token = process.env.CLOUDFLARE_API_TOKEN || "";
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || "";
  const zone = process.env.CLOUDFLARE_ZONE_ID || "";
  if (!token || !account || !zone) return null;
  return { token, account, zone, base: (process.env.TUNNEL_BASE_DOMAIN || "khiatadz.com").trim().replace(/\/+$/, "") };
}

export function tunnelBaseDomain(): string {
  return (process.env.TUNNEL_BASE_DOMAIN || "khiatadz.com").trim().replace(/\/+$/, "");
}

export function cfConfigured(): boolean {
  return cfg() !== null;
}

async function cf(path: string, init?: RequestInit): Promise<{ ok: boolean; result?: unknown; errors?: unknown }> {
  const c = cfg();
  if (!c) return { ok: false };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: unknown; errors?: unknown };
    return { ok: res.ok && body.success !== false, result: body.result, errors: body.errors };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(t);
  }
}

export type CfTunnel = { id: string; token: string | null };

/// Create a cloudflared tunnel + CNAME hostname → it. Returns null on any
/// failure (caller keeps the slot in `manual` state).
export async function provisionTunnel(subdomain: string): Promise<{ tunnel: CfTunnel; hostname: string } | null> {
  const c = cfg();
  if (!c) return null;
  const hostname = `${subdomain}.${c.base}`;
  const created = await cf(`/accounts/${c.account}/cfd_tunnel`, {
    method: "POST",
    body: JSON.stringify({ name: subdomain, config_src: "cloudflare" }),
  });
  const r = created.result as { id?: string; token?: string; credentials?: string } | undefined;
  if (!created.ok || !r?.id) return null;
  const dns = await cf(`/zones/${c.zone}/dns_records`, {
    method: "POST",
    body: JSON.stringify({ type: "CNAME", name: hostname, content: `${r.id}.cfargotunnel.com`, proxied: true }),
  });
  if (!dns.ok) {
    // Don't leak a dangling tunnel: best-effort cleanup.
    await cf(`/accounts/${c.account}/cfd_tunnel/${r.id}?force=true`, { method: "DELETE" }).catch(() => {});
    return null;
  }
  return { tunnel: { id: r.id, token: r.token ?? null }, hostname };
}

/// Revoke: delete DNS record(s) by hostname + the tunnel. Best-effort.
export async function revokeTunnel(hostname: string, tunnelId: string | null): Promise<void> {
  const c = cfg();
  if (!c) return;
  try {
    const list = await cf(`/zones/${c.zone}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`);
    const arr = (list.result as Array<{ id?: string }> | undefined) ?? [];
    for (const rec of arr) {
      if (rec?.id) await cf(`/zones/${c.zone}/dns_records/${rec.id}`, { method: "DELETE" }).catch(() => {});
    }
  } catch {
    /* keep going */
  }
  if (tunnelId) {
    await cf(`/accounts/${c.account}/cfd_tunnel/${tunnelId}?force=true`, { method: "DELETE" }).catch(() => {});
  }
}
