/**
 * The API sets its own headers via helmet (ADR-0027); these cover the documents
 * Next serves, which helmet never sees. The policy is written for this app
 * specifically: it renders no third-party content and calls exactly one origin.
 */
const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts, so 'unsafe-inline' is required until
  // a nonce-based setup lands. Deliberately no 'unsafe-eval'.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin}`,
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Browsers ignore HSTS over plain HTTP, so it is safe locally and correct the
  // moment TLS terminates in front of the app.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Permissions-Policy',
    // publickey-credentials-get must stay enabled: it is what passkeys use.
    value: 'camera=(), microphone=(), geolocation=(), payment=(), publickey-credentials-get=(self)',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@fides/ui-web', '@fides/ui-tokens'],
  env: {
    APP_NAME: process.env.APP_NAME ?? 'Fides',
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
