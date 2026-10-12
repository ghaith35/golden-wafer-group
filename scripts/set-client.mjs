// Per-client installer identity (baked into the EXE/DMG).
//   node scripts/set-client.mjs <client> <domain> [tunnelToken]
// Example (one level below the zone — free certs never cover two levels):
//   node scripts/set-client.mjs dist-client1 dist-client1.khiatadz.com <TOKEN>
// Writes build-client.json (GITIGNORED — tokens must never be committed).
// Then build with: npm run dist:client:mac  |  npm run dist:client:win
import { writeFileSync } from "node:fs";

const [client, domainRaw, tokenRaw] = process.argv.slice(2);

if (!client || !/^[a-z0-9][a-z0-9-_]{0,30}$/.test(client)) {
  console.error("usage: node scripts/set-client.mjs <client> <domain> [tunnelToken]");
  console.error("  e.g. node scripts/set-client.mjs dist-client1 dist-client1.khiatadz.com <TOKEN>");
  process.exit(1);
}
if (!domainRaw) {
  console.error("usage: node scripts/set-client.mjs <client> <domain> [tunnelToken]");
  process.exit(1);
}
let domain = domainRaw.trim().replace(/\/+$/, "");
if (!/^https?:\/\//i.test(domain)) domain = `https://${domain}`;
if (!/^https:\/\/[^/]+\.[^/]+$/i.test(domain)) {
  console.error(`bad domain (need public https origin): ${domainRaw}`);
  process.exit(1);
}
const token = (tokenRaw || "").trim() || null;

writeFileSync(
  "build-client.json",
  JSON.stringify({ client, domain, tunnelToken: token, createdAt: new Date().toISOString() }, null, 2) + "\n",
);
console.log(`client build identity: ${client} → ${domain}${token ? " (+tunnel token)" : " (NO tunnel token — add later via tunnel-token.txt)"}`);
console.log("next:");
console.log("  1. Cloudflare dashboard → Tunnels → public hostname");
console.log(`     ${domain.replace(/^https:\/\//, "")}  →  http://127.0.0.1:32517`);
console.log("  2. npm run dist:client:mac   (DMG for this Mac)");
console.log("     npm run dist:client:win   (EXE)");
