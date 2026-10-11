/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

/** Security headers on every response (the Content Security Policy is set per request in src/middleware.ts). */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The microphone is used by this site only (voice input); nothing else is needed.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Never ship source maps of the app to the browser.
  productionBrowserSourceMaps: false,
  // The Google client library loads gRPC and its .proto/JSON files at runtime: keep it out of the bundle
  // and load it from node_modules on the server (it is only imported by /api/tts, never by client code).
  serverExternalPackages: ["@google-cloud/text-to-speech", "google-gax", "google-auth-library", "@vercel/oidc"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default nextConfig;
