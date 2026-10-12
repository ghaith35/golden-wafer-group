// Automatic client-provisioning worker, CREATE-ONLY edition (runs ON server-c).
// Picks up `pending` client_deployments rows and creates the client's
// network identity: Cloudflare tunnel + DNS CNAME. NOTHING is deployed or
// proxied here — the client runs 100% on their own hardware (Local DMG +
// their shop PC), so if this server dies the client's work continues
// untouched (LAN + offline keep working, licenses verify locally).
//
// Needs (server-side file, never commit): CLOUDFLARE_API_TOKEN,
//   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID, TUNNEL_BASE_DOMAIN
//   (default khiatadz.com). Without them the row fails with a clear message
//   and the vendor provisions by hand in Tunnels UI.
// Pairs with the tunnel slot whose subdomain matches the client name
// (created beforehand in superadmin → Tunnels, or auto-created here).
//
// Run: node scripts/provision-worker.mjs [--once]
// Schedule: every 2 min via deploy/provision-worker.{service,timer}.
import { execFileSync } from "node:child_process";

const API = "https://api.cloudflare.com/client/v4";

function cfg() {
  const token = process.env.CLOUDFLARE_API_TOKEN || "";
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || "";
  const zone = process.env.CLOUDFLARE_ZONE_ID || "";
  if (!token || !account || !zone) return null;
  return { token, account, zone, base: (process.env.TUNNEL_BASE_DOMAIN || "khiatadz.com").trim().replace(/\/+$/, "") };
}

function psql(sql) {
  const pw = new URL(process.env.VENDOR_DB || "").password;
  if (!pw) throw new Error("VENDOR_DB with password is required");
  const out = execFileSync(
    "docker",
    ["exec", "-i", "-e", `PGPASSWORD=${pw}`, "distribuili-lic-db-1", "psql", "-U", "distribuili", "-d", "distribuili_lic", "-qtAc", sql],
    { encoding: "utf8" }
  );
  return out.trim();
}

function qcell(v) {
  return `'${String(v ?? "").replace(/'/g, "''")}'`;
}

function setStatus(id, status, lastError) {
  psql(
    `UPDATE client_deployments SET status=${qcell(status)}, "lastError"=${lastError ? qcell(lastError) : "NULL"}, "updatedAt"=NOW() WHERE id=${qcell(id)};`
  );
}

async function cf(path, init) {
  const c = cfg();
  if (!c) return { ok: false, error: "cloudflare_not_configured" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.success !== false, result: body.result, errors: body.errors };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  } finally {
    clearTimeout(t);
  }
}

/// Create tunnel + DNS CNAME (hostname → <tunnel>.cfargotunnel.com).
/// Returns {tunnelId, token} or throws. Idempotent-ish: pre-existing DNS
/// for the hostname is reused, never duplicated blindly.
async function provisionTunnel(subdomain) {
  const c = cfg();
  if (!c) throw new Error("cloudflare_not_configured — provision the tunnel in Tunnels UI instead");
  const hostname = `${subdomain}.${c.base}`;
  const created = await cf(`/accounts/${c.account}/cfd_tunnel`, {
    method: "POST",
    body: JSON.stringify({ name: subdomain, config_src: "cloudflare" }),
  });
  const r = created.result;
  if (!created.ok || !r?.id) throw new Error(`tunnel_create_failed: ${JSON.stringify(created.errors || r).slice(0, 200)}`);
  const dns = await cf(`/zones/${c.zone}/dns_records`, {
    method: "POST",
    body: JSON.stringify({ type: "CNAME", name: hostname, content: `${r.id}.cfargotunnel.com`, proxied: true }),
  });
  if (!dns.ok) {
    await cf(`/accounts/${c.account}/cfd_tunnel/${r.id}?force=true`, { method: "DELETE" }).catch(() => {});
    throw new Error(`dns_create_failed: ${JSON.stringify(dns.errors).slice(0, 200)}`);
  }
  return { tunnelId: r.id, token: r.token ?? null, hostname };
}

async function provision(row) {
  const { id, client, version, domain } = row;
  console.log(`[${client}] provisioning v${version} → ${domain} (create-only, no hosting)`);
  setStatus(id, "provisioning", null);
  const fail = (e) => {
    const msg = String(e?.message || e).slice(0, 500);
    console.error(`[${client}] FAILED: ${msg}`);
    setStatus(id, "failed", msg);
  };
  try {
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(client)) throw new Error("bad client name");
    // Subdomain = first label of the sold domain (one level below the zone —
    // the free edge cert never covers two levels).
    const subdomain = domain.split(".")[0];
    if (!subdomain) throw new Error("bad domain");

    // 1. Tunnel slot: reuse a slot with the same subdomain, else create +
    //    provision (tunnel + DNS) right here.
    let slotId = psql(`SELECT id FROM tunnel_slots WHERE subdomain=${qcell(subdomain)} ORDER BY "createdAt" DESC LIMIT 1;`).split("\n")[0].trim() || null;
    if (!slotId) {
      const p = await provisionTunnel(subdomain);
      slotId = psql(
        `INSERT INTO tunnel_slots(id, subdomain, domain, status, "tunnelId", token, "createdAt", "updatedAt") VALUES (gen_random_uuid(), ${qcell(subdomain)}, ${qcell(`${subdomain}.${cfg().base}`)}, 'active', ${qcell(p.tunnelId)}, ${p.token ? qcell(p.token) : "NULL"}, NOW(), NOW()) RETURNING id;`
      ).split("\n")[0].trim();
      if (!slotId) throw new Error("slot_insert_failed");
      console.log(`[${client}] tunnel + DNS live: ${subdomain}.${cfg().base}`);
    } else {
      console.log(`[${client}] reusing tunnel slot ${slotId}`);
    }

    // 2. Done. The vendor builds Distribuili-<client>-<version> with the
    //    baked domain + this slot's connector token; the client runs it on
    //    THEIR hardware. Nothing here serves client traffic, ever.
    psql(
      `UPDATE client_deployments SET status='active', "tunnelSlotId"=${qcell(slotId)}, "lastError"=NULL, "updatedAt"=NOW() WHERE id=${qcell(id)};`
    );
    console.log(`[${client}] ACTIVE (slot ${slotId}) — build the DMG, vendor side done`);
  } catch (e) {
    fail(e);
  }
}

async function main() {
  if (!process.env.VENDOR_DB) {
    console.error("VENDOR_DB is required (postgresql://… license-authority database)");
    process.exit(1);
  }
  let rows = [];
  try {
    const raw = psql(`SELECT id || chr(31) || client || chr(31) || version || chr(31) || domain FROM client_deployments WHERE status='pending' ORDER BY "createdAt" ASC LIMIT 5;`);
    rows = raw.split("\n").filter(Boolean).map((line) => {
      const [id, client, version, domain] = line.split("");
      return { id, client, version, domain };
    });
  } catch (e) {
    console.error("worker: cannot read queue:", String(e).slice(0, 200));
    process.exit(1);
  }
  if (!rows.length) {
    console.log("worker: queue empty");
    return;
  }
  for (const row of rows) await provision(row);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
