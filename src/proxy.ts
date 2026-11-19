import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { jwtVerify, SignJWT } from "jose";
import { routing } from "@/i18n/routing";
import { ACCESS_MAX_AGE, ACCESS_SLIDE_WINDOW } from "@/lib/auth/tokens";
import { isLocalMode, localEntitledCached, isDesktopUserAgent } from "@/lib/license/gate";

const handleI18nRouting = createMiddleware(routing);

const PROTECTED_PREFIXES = ["/dashboard", "/clients", "/suppliers", "/inventory", "/products", "/sales", "/purchases", "/expenses", "/reports", "/settings",   "/pos", "/tournees", "/vans", "/carte", "/cash", "/cash-daily", "/journal", "/users", "/devices", "/license", "/livreur", "/dettes", "/presence", "/suivi", "/commandes"];
const PORTAL_PREFIXES = ["/portal"];

/// Permanent role-based access control (server-enforced, PWA/offline-safe).
/// The sidebar only *hides* links — this is what actually blocks staff from
/// admin pages and admin APIs, even with JS disabled or a cached shell.
///
/// Livreur: ONLY his mobile flow under /livreur (day picker, vente,
/// commande, stock, dashboard-of-the-day, factures). He sees nothing else —
/// no company dashboard, no standalone lists, no admin sections.
/// Vendeur: everything except the admin-only sections below, minus sale
/// creation + factures (orders/commandes flow stays fully usable).
/// Admin: everything.
const LIVREUR_PAGES = ["/livreur"];
const STAFF_BLOCKED_PAGES = [
  "/suppliers", "/pos", "/purchases", "/products", "/inventory", "/vans",
  "/dettes", "/cash", "/cash-daily", "/expenses", "/reports", "/settings",
  "/license", "/devices", "/users", "/journal",
];

/// Admin-only API areas (any authenticated staff gets 403).
/// Method-scoped where staff legitimately use part of the route:
/// - products: staff read the catalog, only mutations are admin.
/// - tournees: staff read their day + tick stops, only planning is admin.
/// - clients: staff create/edit, only delete is admin.
/// - vans/locations: staff read, only mutations are admin.
/// Everything not listed stays login-only (operational staff flows).
const ADMIN_APIS: Array<{ p: string; m: string[] | null }> = [
  { p: "/api/suppliers", m: null },
  { p: "/api/purchases", m: null },
  { p: "/api/supplier-returns", m: null },
  { p: "/api/products", m: ["POST", "PUT", "PATCH", "DELETE"] },
  { p: "/api/categories", m: null },
  { p: "/api/reports", m: null },
  { p: "/api/journal", m: null },
  { p: "/api/dashboard", m: null },
  { p: "/api/inventory", m: null },
  { p: "/api/transfers", m: null },
  { p: "/api/counts", m: null },
  { p: "/api/losses", m: null },
  { p: "/api/tournees", m: ["PUT", "DELETE"] },
  { p: "/api/clients", m: ["DELETE"] },
  { p: "/api/deposits", m: null },
  { p: "/api/debts", m: null },
  { p: "/api/versements", m: null },
  { p: "/api/users", m: null },
  { p: "/api/vans", m: ["POST", "PUT", "PATCH", "DELETE"] },
  { p: "/api/locations", m: ["POST", "PUT", "PATCH", "DELETE"] },
];

const COOKIE_SECURE =
  process.env.COOKIE_SECURE != null ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";

type Claims = {
  sub: string;
  companyId?: string;
  username?: string;
  role?: string;
  _type?: string;
  exp?: number;
};

function superAdminSecret(): Uint8Array | null {
  const s = process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET;
  return s ? new TextEncoder().encode(s) : null;
}

async function readSuperAdmin(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get("dili_superadmin")?.value;
  const secret = superAdminSecret();
  if (!token || !secret) return false;
  try {
    const { payload } = await jwtVerify(token, secret);
    return (payload as Record<string, unknown>)._type === "superadmin";
  } catch {
    return false;
  }
}

async function readClaims(token: string): Promise<Claims | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (typeof payload.sub !== "string") return null;
    return payload as unknown as Claims;
  } catch {
    return null;
  }
}

async function mintAccess(c: Claims): Promise<string | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret || !c.sub || !c.companyId || !c.username || !c.role) return null;
  return new SignJWT({ sub: c.sub, companyId: c.companyId, username: c.username, role: c.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(new TextEncoder().encode(secret));
}

function withAccessCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set("access_token", token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    maxAge: ACCESS_MAX_AGE,
    path: "/",
  });
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const localeMatch = pathname.match(/^\/(ar|fr|en)(\/|$)/);
  const locale = localeMatch ? localeMatch[1] : null;
  const routePath = localeMatch ? pathname.slice(localeMatch[1].length + 1) || "/" : pathname;
  const accessToken = request.cookies.get("access_token")?.value;
  const refreshToken = request.cookies.get("refresh_token")?.value;
  // Always redirect to a locale-prefixed URL so next-intl (localePrefix: "always")
  // never needs a second hop.
  const localized = (target: string) => (locale ? `/${locale}${target}` : `/${routing.defaultLocale}${target}`);

  // Sliding session: a valid access token keeps you in (renewed silently
  // near expiry); an expired one is re-minted from the refresh cookie.
  // Only a missing/invalid refresh cookie sends you back to login.
  const now = Math.floor(Date.now() / 1000);
  let claims = accessToken ? await readClaims(accessToken) : null;
  let renewed: string | null = null;
  if (claims && claims.exp != null && claims.exp - now < ACCESS_SLIDE_WINDOW) {
    renewed = await mintAccess(claims);
    if (!renewed) claims = null;
  }
  if (!claims && refreshToken) {
    const r = await readClaims(refreshToken);
    if (r && r._type === "refresh") {
      renewed = await mintAccess(r);
      if (renewed) claims = { sub: r.sub, companyId: r.companyId, username: r.username, role: r.role };
      else claims = null;
    }
  }

  // Match exact route or a full segment ("/pos" must not match "/postal").
  const isPath = (route: string, prefix: string) => route === prefix || route.startsWith(prefix + "/");

  // API + pages alike: an expired access token is refreshed in passing so
  // background fetches never 401 while the refresh cookie lives.
  if (routePath.startsWith("/api")) {
    // Local-install license gate (Node runtime): a locked/expired desktop
    // install gets 402 on everything except the license flows themselves,
    // health, auth (trial/redeem need no session) and the update feed.
    // Phones/tablets skip it (desktop UA only) — staff keep working from
    // mobile while the shop PC itself stays gated. Central/vendor installs
    // and plain dev servers are never gated.
    if (
      isLocalMode() &&
      isDesktopUserAgent(request.headers.get("user-agent")) &&
      !(
        routePath === "/api/license" ||
        routePath.startsWith("/api/license/") ||
        routePath === "/api/health" ||
        routePath.startsWith("/api/auth/") ||
        routePath === "/api/apk-info"
      ) &&
      !localEntitledCached()
    ) {
      return NextResponse.json({ error: "not_entitled" }, { status: 402 });
    }
    // Central API authorization (permanent, method-aware). Route-level
    // requireAdmin calls remain as defense in depth.
    if (claims && claims.role !== "Admin") {
      const denied = ADMIN_APIS.some(
        ({ p, m }) => isPath(routePath, p) && (m === null || m.includes(request.method))
      );
      if (denied) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return renewed ? withAccessCookie(NextResponse.next(), renewed) : NextResponse.next();
  }

  // Never interfere with Next internals, static files, or service worker.
  // (The `config.matcher` already excludes most of these; this is defense in depth.)
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/__nextjs_font") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js"
  ) {
    return NextResponse.next();
  }

  // Vendor superadmin console: own session, own login. Never falls
  // through to company auth (a locked-out company admin must not matter).
  if (routePath === "/superadmin" || routePath.startsWith("/superadmin/")) {
    if (routePath === "/superadmin/login") return handleI18nRouting(request);
    if (await readSuperAdmin(request)) return handleI18nRouting(request);
    return NextResponse.redirect(new URL(localized("/superadmin/login"), request.url));
  }

  // Client portal: public login, own session cookie (portal_token) elsewhere.
  if (PORTAL_PREFIXES.some((p) => routePath === p || routePath.startsWith(p + "/"))) {
    return handleI18nRouting(request);
  }

  if (!localeMatch) {
    const preferred = request.cookies.get("NEXT_LOCALE")?.value;
    if (preferred && preferred !== routing.defaultLocale && (routing.locales as readonly string[]).includes(preferred)) {
      return NextResponse.redirect(new URL(`/${preferred}${routePath}`, request.url));
    }
  }

  const isProtected = PROTECTED_PREFIXES.some((p) => isPath(routePath, p));

  if (isProtected) {
    if (!claims) {
      const loginUrl = new URL(localized("/login"), request.url);
      loginUrl.searchParams.set("from", routePath);
      return NextResponse.redirect(loginUrl);
    }
    // Permanent page-level role enforcement (the sidebar only hides links).
    // Unknown/missing roles default to the most restricted (livreur) view.
    if (claims.role === "Livreur" || (claims.role !== "Admin" && claims.role !== "Vendeur")) {
      const ok = LIVREUR_PAGES.some((p) => isPath(routePath, p));
      if (!ok) return NextResponse.redirect(new URL(localized("/livreur"), request.url));
    } else if (claims.role === "Vendeur") {
      // Mandob: no sale creation, no factures — anywhere. And never the
      // admin dashboard (like Livreur): the van flow is his whole app.
      if (isPath(routePath, "/dashboard")) {
        return NextResponse.redirect(new URL(localized("/livreur"), request.url));
      }
      if (isPath(routePath, "/sales")) {
        return NextResponse.redirect(new URL(localized("/livreur"), request.url));
      }
      const seg = routePath.split("/").filter(Boolean);
      if (seg[0] === "livreur" && (seg[2] === "vente" || seg[2] === "factures" || seg[2] === "demande")) {
        return NextResponse.redirect(new URL(localized(`/livreur/${seg[1]}/dashboard`), request.url));
      }
      const blocked = STAFF_BLOCKED_PAGES.some((p) => isPath(routePath, p));
      if (blocked) return NextResponse.redirect(new URL(localized("/dashboard"), request.url));
    } else if (claims.role !== "Admin") {
      const blocked = STAFF_BLOCKED_PAGES.some((p) => isPath(routePath, p));
      if (blocked) return NextResponse.redirect(new URL(localized("/dashboard"), request.url));
    }
    // Must pass through the i18n handler (not plain NextResponse.next()),
    // otherwise the locale is never resolved and every page renders Arabic.
    const res = handleI18nRouting(request);
    return renewed ? withAccessCookie(res, renewed) : res;
  }

  // NOTE: no bounce for authenticated users visiting /login. A still-valid
  // JWT can carry a dead companyId (DB reset) while getSession() is null —
  // bouncing to /dashboard then loops forever. Rendering the form lets
  // re-login heal the session; harmless for valid sessions.
  if (renewed) return withAccessCookie(handleI18nRouting(request), renewed);

  return handleI18nRouting(request);
}

export const config = {
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
