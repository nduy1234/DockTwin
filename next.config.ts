import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The SAM parser ships ESM; let Next bundle it for server routes.
  transpilePackages: ["@meta-sam/parser"],
};

export default nextConfig;
