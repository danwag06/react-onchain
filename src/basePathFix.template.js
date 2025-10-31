/**
 * React Router Base Path Setup for react-onchain
 *
 * This script detects ordfs deployment paths and sets up the environment
 * for React Router's BrowserRouter to work correctly.
 *
 * How it works:
 * 1. Detects ordfs deployment path (/content/{txid}_{vout})
 * 2. Injects HTML <base> tag for automatic URL resolution
 * 3. Sets window.__REACT_ONCHAIN_BASE__ for React Router
 *
 * For React Router apps, add this ONE LINE to your Router:
 *   <Router basename={window.__REACT_ONCHAIN_BASE__ || '/'}>
 *
 * This enables your app to work on ordfs deployments AND locally with zero config changes!
 *
 * Handles three scenarios:
 * 1. ordfs deployment: /content/{txid}_{vout} → Sets up base path
 * 2. Custom domain: / → No changes needed
 * 3. Local development: localhost → Falls back to '/'
 */
(function () {
  'use strict';

  try {
    const currentPath = window.location.pathname;

    // Match ordfs content path pattern: /content/{txid}_{vout}
    // txid: 64 hex characters, vout: one or more digits
    const contentPathMatch = currentPath.match(/^\/content\/[a-f0-9]{64}_\d+/);

    if (!contentPathMatch) {
      // Not on ordfs, assume root path (custom domain or local dev)
      console.log('[react-onchain] Running at root path (custom domain or local)');
      return;
    }

    const basePath = contentPathMatch[0];
    console.log('[react-onchain] ordfs deployment detected, base path:', basePath);

    // Set base path immediately as fallback
    // If versionRedirect.template.js is present, it will update this after version resolution
    // If there's no versioning, this is the final value

    // Set/update <base> tag for automatic URL resolution
    let baseTag = document.querySelector('base');
    if (!baseTag) {
      baseTag = document.createElement('base');
      const head = document.head || document.getElementsByTagName('head')[0];
      if (head.firstChild) {
        head.insertBefore(baseTag, head.firstChild);
      } else {
        head.appendChild(baseTag);
      }
    }
    baseTag.href = basePath + '/'; // MUST have trailing slash

    // Set global for React Router (no trailing slash)
    window.__REACT_ONCHAIN_BASE__ = basePath;

    // Helper function for apps
    window.__getReactOnchainBase = function () {
      return basePath;
    };

    console.log('[react-onchain] Base path configured (will be updated if version redirect occurs):', basePath);

    // Patch link clicks to work correctly with React Router and base path
    // This handles cases where React Router intercepts <a> clicks
    (function patchLinks() {
      document.addEventListener('click', function(e) {
        const anchor = e.target.closest('a');
        if (!anchor) return;

        const href = anchor.getAttribute('href');

        // Only process root-relative paths that start with /
        // Skip if already has basePath or is external
        if (href && href.startsWith('/') && !href.startsWith(basePath)) {
          // Don't modify external links
          if (anchor.hostname && anchor.hostname !== window.location.hostname) return;

          // Prevent default and manually navigate with basePath
          e.preventDefault();
          e.stopPropagation();

          const newPath = basePath + href;

          // Use pushState and trigger popstate for React Router
          window.history.pushState(null, '', newPath);
          window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

          console.log('[react-onchain] Link navigation:', href, '→', newPath);
        }
      }, true); // Capture phase to intercept before React Router

      console.log('[react-onchain] Link patching enabled');
    })();
  } catch (error) {
    console.error('[react-onchain] Error setting up routing:', error);
  }
})();
