// Generates the license Ed25519 keypair (run once per business).
//   node scripts/gen-license-keys.mjs
// Output:
//   - LICENSE_PRIVATE_KEY  → server .env (base64 PKCS8 DER, NEVER committed)
//   - public key           → paste into electron/license.ts
//     DISTRIBUILI_LICENSE_PUBLIC_KEY_DER_B64 (base64 SPKI DER)
import crypto from "node:crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pubDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const privDer = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

console.log("Add to the SERVER .env (secret — never commit):");
console.log(`LICENSE_PRIVATE_KEY="${privDer}"`);
console.log("");
console.log("Paste into electron/license.ts DISTRIBUILI_LICENSE_PUBLIC_KEY_DER_B64:");
console.log(pubDer);
