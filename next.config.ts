import type { NextConfig } from 'next';

const config: NextConfig = {
  // These use Node-only APIs / font files, so keep them out of the bundle.
  serverExternalPackages: ['pg', 'pdfkit'],
};

export default config;
