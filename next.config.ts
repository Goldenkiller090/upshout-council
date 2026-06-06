import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module — must load from node_modules at runtime, not be bundled.
  serverExternalPackages: ["better-sqlite3"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "arweave.net" },
      { protocol: "https", hostname: "upshot.cards" },
    ],
  },
};

export default nextConfig;
