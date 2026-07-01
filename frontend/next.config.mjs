/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle (.next/standalone + server.js) for the
  // App Runner Docker image. The runner stage copies these artifacts directly.
  output: 'standalone',
};

export default nextConfig;
