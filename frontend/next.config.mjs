/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Old airefill components have warnings — don't block deploy
    // Will be cleaned up when old code is removed
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
