import type { NextConfig } from 'next';

const config: NextConfig = {
  // These use Node-only APIs / font files, so keep them out of the bundle.
  serverExternalPackages: ['pg', 'pdfkit'],
  // pdfkit reads its built-in font metrics (.afm) from disk at runtime; make sure hosts that trace files (Vercel)
  // ship them with the routes that build the evidence PDF.
  outputFileTracingIncludes: {
    '/api/cases/*/evidence-pack': ['./node_modules/pdfkit/js/data/**/*'],
    '/api/cases/*/act': ['./node_modules/pdfkit/js/data/**/*'],
  },
  poweredByHeader: false,
  // Safe-by-default headers. No Content-Security-Policy on purpose: PayPal's checkout script and popups need a
  // policy written against PayPal's own hosts, and a wrong one breaks paying.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default config;
