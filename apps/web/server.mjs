import { server } from './build/index.js';

const NO_CACHE_PATHS = new Set([
  '/service-worker.js',
  '/manifest.webmanifest',
  '/_app/version.json'
]);

server.server.prependListener('request', (req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  if (NO_CACHE_PATHS.has(pathname)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'no-store');
  }
});
