import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingIncludes: {
    "/*": ["./data/*.json"],
  },
  outputFileTracingExcludes: {
    "/*": ["./data/articles/**/*"],
  },
};

export default nextConfig;
