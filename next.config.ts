import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.MAILOPS_E2E_FAULTS === "true" ? ".next-e2e" : ".next",
};

export default nextConfig;
