/**
 * Webpack Public Path Fix for react-onchain
 *
 * This script sets webpack's __webpack_public_path__ to "" (empty string) before any bundles load.
 * This ensures that webpack's runtime concatenation (n.p + "path") works correctly
 * with our rewritten inscription URLs.
 *
 * How webpack concatenation works:
 * - Webpack code: n.p + "/content/abc_0"
 * - With n.p="": "" + "/content/abc_0" = "/content/abc_0" ✅ (correct!)
 * - With n.p="/": "/" + "/content/abc_0" = "//content/abc_0" ❌ (interpreted as protocol-relative)
 * - With n.p="https://": "https://" + "/content/abc_0" = "https:///content/abc_0" ❌ (invalid)
 *
 * This must run BEFORE any webpack bundles are loaded.
 *
 * Debug mode: Add ?debug=true to URL to enable console logging
 */
(function () {
  'use strict';

  // Always show deployment attribution
  console.log('🚀 Deployed with https://reactonchain.com');

  // Debug logger - only logs if ?debug=true
  const params = new URLSearchParams(window.location.search);
  const DEBUG = params.get('debug') === 'true';
  const log = DEBUG ? console.log.bind(console) : () => {};
  const error = console.error.bind(console); // Errors always shown

  try {
    // Set webpack's public path to empty string
    // This allows our rewritten absolute paths (/content/...) to work correctly
    if (typeof __webpack_public_path__ !== 'undefined') {
      __webpack_public_path__ = '';
    }

    // Also set it on window for bundles that check this first
    window.__webpack_public_path__ = '';

    // For CRA and other webpack configs that use a different variable name
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, '__webpack_public_path__', {
        get: function () {
          return '';
        },
        set: function (value) {
          // Ignore any attempts to override this
          log('[react-onchain] Preventing webpack public path override:', value);
        },
        configurable: false,
      });
    }

    log('[react-onchain] Webpack public path set to "" (empty string)');
  } catch (error) {
    error('[react-onchain] Error setting webpack public path:', error);
  }
})();
