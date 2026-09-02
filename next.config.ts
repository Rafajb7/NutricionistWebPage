import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: {
    "/api/admin/finance/invoices/[invoiceId]/pdf": [
      "./public/logo*.png",
      "./node_modules/pdfkit/js/**/*",
      "./node_modules/fontkit/**/*"
    ],
    "/api/admin/nutrition-management/plans/[planId]/pdf": [
      "./public/logo*.png",
      "./node_modules/pdfkit/js/**/*",
      "./node_modules/fontkit/**/*"
    ],
    "/api/admin/nutrition-management/plans/[planId]/publish": [
      "./public/logo*.png",
      "./node_modules/pdfkit/js/**/*",
      "./node_modules/fontkit/**/*"
    ],
    "/api/admin/nutrition-change-requests/[requestId]": [
      "./public/logo*.png",
      "./node_modules/pdfkit/js/**/*",
      "./node_modules/fontkit/**/*"
    ]
  },
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
