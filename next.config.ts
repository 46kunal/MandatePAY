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
};

export default config;
