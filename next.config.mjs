/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // Disable next/image optimization as it is not supported in static exports
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
      child_process: false,
      canvas: false,
    };
    return config;
  },
};

export default nextConfig;
