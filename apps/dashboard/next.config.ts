import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@thematrix/types'],
  experimental: {
    serverComponentsExternalPackages: ['@thematrix/types'],
  },
};

export default nextConfig;
