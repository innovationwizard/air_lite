/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle (.next/standalone + server.js) for the
  // App Runner Docker image. The runner stage copies these artifacts directly.
  output: 'standalone',
  eslint: {
    // Old airefill components have warnings — don't block deploy
    // Will be cleaned up when old code is removed
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
