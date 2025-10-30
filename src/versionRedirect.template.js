/**
 * Version Redirect Script (Inscription-Based)
 *
 * Automatically injected by react-onchain into deployed applications.
 * Handles version resolution by querying inscription metadata.
 *
 * Placeholders (replaced during injection):
 * - VERSION_INSCRIPTION_ORIGIN_PLACEHOLDER: The origin outpoint of the versioning inscription
 * - ORDINALS_CONTENT_URL_PLACEHOLDER: The base service URL (e.g., https://ordfs.network)
 */
(function () {
  const VERSION_INSCRIPTION_ORIGIN = 'VERSION_INSCRIPTION_ORIGIN_PLACEHOLDER';
  const ORDINALS_CONTENT_URL = 'ORDINALS_CONTENT_URL_PLACEHOLDER';

  // Only run if we have a versioning inscription (check if placeholder was replaced)
  if (!VERSION_INSCRIPTION_ORIGIN || VERSION_INSCRIPTION_ORIGIN.indexOf('PLACEHOLDER') >= 0) {
    return; // No versioning inscription configured (likely first deployment)
  }

  const params = new URLSearchParams(window.location.search);
  const requestedVersion = params.get('version');

  // No version requested, use current page
  if (!requestedVersion) {
    return;
  }

  /**
   * Fetch version metadata from the latest inscription
   * Returns parsed metadata object with version:outpoint mappings
   */
  async function getVersionMetadata() {
    try {
      // Fetch the latest inscription in the origin chain using seq=-1
      const url = `${ORDINALS_CONTENT_URL}/content/${VERSION_INSCRIPTION_ORIGIN}?seq=-1&map=true`;

      console.log('[react-onchain] Fetching version metadata from:', url);

      const response = await fetch(url, {
        method: 'HEAD', // Only need headers, not content
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Read x-map header which contains the metadata
      const mapHeader = response.headers.get('x-map');

      if (!mapHeader) {
        throw new Error('No version metadata found (x-map header missing)');
      }

      // Parse JSON metadata
      const metadata = JSON.parse(mapHeader);
      console.log('[react-onchain] Version metadata loaded:', metadata);

      return metadata;
    } catch (error) {
      console.error('[react-onchain] Failed to fetch version metadata:', error);
      return null;
    }
  }

  /**
   * Get the preferred content service from localStorage
   */
  function getPreferredContentService() {
    try {
      const stored = localStorage.getItem('react-onchain-preferred-service');
      if (stored) {
        const data = JSON.parse(stored);
        return data.service;
      }
    } catch (e) {
      // Ignore errors
    }
    return ORDINALS_CONTENT_URL; // Default to injected URL
  }

  /**
   * Main redirect logic
   */
  async function redirectToVersion() {
    try {
      console.log('[react-onchain] Resolving version:', requestedVersion);

      let targetOutpoint = null;

      if (requestedVersion === 'latest') {
        // For latest version, ordfs.network handles this natively with seq=-1
        // We can redirect to the origin with seq=-1
        targetOutpoint = `${VERSION_INSCRIPTION_ORIGIN}?seq=-1`;
        console.log('[react-onchain] Redirecting to latest version');
      } else {
        // For specific versions, query the metadata
        console.log('[react-onchain] Fetching metadata for version:', requestedVersion);

        const metadata = await getVersionMetadata();

        if (!metadata) {
          console.error('[react-onchain] Failed to load metadata, staying on current page');
          return;
        }

        // Look up version in metadata (format: version.X.X.X)
        const versionKey = `version.${requestedVersion}`;
        const versionData = metadata[versionKey];

        if (!versionData) {
          console.warn('[react-onchain] Version', requestedVersion, 'not found in metadata');
          // Extract available versions from metadata keys
          const availableVersions = Object.keys(metadata)
            .filter(k => k.startsWith('version.'))
            .map(k => k.replace('version.', ''));
          console.log('[react-onchain] Available versions:', availableVersions);
          return;
        }

        // Parse the nested JSON to get the outpoint
        try {
          const versionMetadata = JSON.parse(versionData);
          targetOutpoint = versionMetadata.outpoint;
          console.log('[react-onchain] Found outpoint for version', requestedVersion, ':', targetOutpoint);
        } catch (error) {
          console.error('[react-onchain] Failed to parse version metadata:', error);
          return;
        }
      }

      // Get current outpoint from URL
      const currentPath = window.location.pathname;
      const currentOutpoint = currentPath.split('/').pop();

      // Check if we're already on the target version
      if (targetOutpoint && targetOutpoint !== currentOutpoint && !targetOutpoint.includes(currentOutpoint)) {
        console.log('[react-onchain] Redirecting to:', targetOutpoint);

        // Use the preferred content service (or fall back to injected URL)
        const contentService = getPreferredContentService();

        // Build redirect URL
        // If targetOutpoint already has query params (like ?seq=-1), preserve them
        const newUrl = targetOutpoint.includes('?')
          ? `${contentService}/content/${targetOutpoint}${window.location.hash}`
          : `${contentService}/content/${targetOutpoint}${window.location.hash}`;

        window.location.href = newUrl;
      } else {
        console.log('[react-onchain] Already on the requested version');
      }
    } catch (error) {
      console.error('[react-onchain] Version redirect failed:', error);
      console.error('[react-onchain] Staying on current version');
    }
  }

  // Run the redirect logic
  redirectToVersion();
})();
