/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Google client library loads gRPC and its .proto/JSON files at runtime: keep it out of the bundle
  // and load it from node_modules on the server (it is only imported by /api/tts, never by client code).
  serverExternalPackages: ["@google-cloud/text-to-speech", "google-gax", "google-auth-library", "@vercel/oidc"],
};
export default nextConfig;
