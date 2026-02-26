import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { dev, isServer }) => {
    // Avoid eval-based sourcemaps in dev to prevent SES/extension runtime conflicts.
    if (dev && !isServer) {
      config.devtool = "source-map";
    }
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "drive.google.com"
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com"
      },
      {
        protocol: "https",
        hostname: "googleusercontent.com"
      }
    ]
  }
};

export default nextConfig;
