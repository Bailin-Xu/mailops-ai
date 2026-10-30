import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.MAILOPS_E2E_FAULTS === "true" ? ".next-e2e" : process.env.AGENT_UI_ENABLED === "true" ? ".next-agent-ui" : ".next",
};

export default nextConfig;
