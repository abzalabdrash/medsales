import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite is a Node 24 builtin; keep it external to the bundler.
  serverExternalPackages: ["node:sqlite"],
};

export default nextConfig;
