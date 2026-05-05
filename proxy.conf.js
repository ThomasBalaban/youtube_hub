// Skip proxying when the browser is navigating to a page (hard refresh on
// /shorts-editor, /shorts-analyzer, etc.) so the dev server serves index.html
// and the Angular router can take over.
const bypassPageNav = (req) => {
  const accept = req.headers.accept || '';
  if (req.method === 'GET' && accept.includes('text/html')) {
    return '/index.html';
  }
  return null;
};

module.exports = {
  '/launcher': {
    target: 'http://localhost:9011',
    secure: false,
    bypass: bypassPageNav,
  },
  '/shorts-editor': {
    target: 'http://localhost:9020',
    secure: false,
    pathRewrite: { '^/shorts-editor': '' },
    bypass: bypassPageNav,
  },
  '/shorts-analyzer': {
    target: 'http://localhost:9021',
    secure: false,
    pathRewrite: { '^/shorts-analyzer': '' },
    bypass: bypassPageNav,
  },
  '/shorts-strategist': {
    target: 'http://localhost:9022',
    secure: false,
    pathRewrite: { '^/shorts-strategist': '' },
    bypass: bypassPageNav,
  },
};
