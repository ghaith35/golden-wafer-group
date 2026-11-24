import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Dev-only "N" badge floats bottom-left and sits on top of the sale cart bar,
  // stealing taps. Never shown in production builds anyway.
  devIndicators: false,
  output: "standalone",
  // Allow HMR / dev-tools WebSocket on both loopback hosts. Browsing the dev
  // server via 127.0.0.1 while Next only allows localhost (or vice versa)
  // makes the HMR socket fail with "WebSocket connection to
  // 'ws://127.0.0.1:3000/_next/webpack-hmr...' failed".
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  serverExternalPackages: ["@prisma/adapter-libsql", "@libsql/client", "libsql"],
  // The offline Prisma client is generated to a custom path, and the SQLite
  // DDL + seed DB are read at runtime — none are statically imported, so force
  // them into the standalone bundle for the desktop build.
  //
  // The DB drivers are loaded through eval("require") (see src/lib/db), which
  // Turbopack cannot trace — without the globs below the standalone server
  // boots but EVERY database route 500s with "Cannot find module
  // '@prisma/adapter-libsql-…'". Forced here instead of relying on tracing.
  //
  // DISTRIBUILI_DESKTOP_BUILD=1 (set by scripts/dist-client.mjs for Electron
  // installers + desktop web bundles): SQLite chain only. The pg chain and
  // the 71MB Prisma engines are never required in local mode (server branch
  // is lazy and unreachable there) — leaving them out keeps bundles small.
  // Docker/server builds omit the flag and trace the full chain.
  outputFileTracingIncludes: {
    "/**/*": [
      "./src/generated/prisma-sqlite/**/*",
      "./prisma/sqlite-init.sql",
      "./prisma/sqlite-seed.db",
      "./node_modules/@prisma/adapter-libsql/**/*",
      "./node_modules/@prisma/client-runtime-utils/**/*",
      "./node_modules/@prisma/driver-adapter-utils/**/*",
      "./node_modules/async-mutex/**/*",
      "./node_modules/libsql/**/*",
      "./node_modules/@libsql/**/*",
      ...(process.env.DISTRIBUILI_DESKTOP_BUILD === "1"
        ? []
        : [
            "./node_modules/@prisma/client/**/*",
            "./node_modules/@prisma/adapter-pg/**/*",
            "./node_modules/pg/**/*",
            "./node_modules/pg-connection-string/**/*",
            "./node_modules/pg-int8/**/*",
            "./node_modules/pg-pool/**/*",
            "./node_modules/pg-protocol/**/*",
            "./node_modules/pg-types/**/*",
            "./node_modules/pgpass/**/*",
            "./node_modules/postgres-array/**/*",
            "./node_modules/postgres-bytea/**/*",
            "./node_modules/postgres-date/**/*",
            "./node_modules/postgres-interval/**/*",
          ]),
    ],
  },
};

export default withNextIntl(nextConfig);
