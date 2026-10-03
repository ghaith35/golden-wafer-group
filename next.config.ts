import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
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
  outputFileTracingIncludes: {
    "/**/*": ["./src/generated/prisma-sqlite/**/*", "./prisma/sqlite-init.sql", "./prisma/sqlite-seed.db"],
  },
};

export default withNextIntl(nextConfig);
