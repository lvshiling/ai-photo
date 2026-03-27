/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // Disable next/image optimization as it is not supported in static exports
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
