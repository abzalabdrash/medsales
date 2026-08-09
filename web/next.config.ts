import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite is a Node 24 builtin; keep it external to the bundler.
  serverExternalPackages: ["node:sqlite"],
  // SQLite must ship with serverless functions on Vercel (copied into web/data by prebuild).
  outputFileTracingIncludes: {
    "/**/*": ["./data/medsales.db"],
  },
};

export default nextConfig;
