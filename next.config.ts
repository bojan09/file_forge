import type { NextConfig } from "next";

// Static export: no server runtime, no API routes. File bytes never leave the browser.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default config;
