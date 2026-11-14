import type { NextConfig } from "next";

// Static export: the same build is served by factory/server.py locally and by Vercel.
const nextConfig: NextConfig = { output: "export", images: { unoptimized: true } };

export default nextConfig;
