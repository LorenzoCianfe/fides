/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@fides/ui-web', '@fides/ui-tokens'],
  env: {
    APP_NAME: process.env.APP_NAME ?? 'Fides',
  },
};

export default nextConfig;
