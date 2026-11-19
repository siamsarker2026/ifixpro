import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/dashboard/settings/requests/:path*',
        destination: '/dashboard/reports/requests/:path*',
        permanent: false,
      },
      {
        source: '/',
        destination: '/login',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;