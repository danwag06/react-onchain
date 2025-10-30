/**
 * Version Redirect Script (Inscription-Based)
 *
 * Automatically injected by react-onchain into deployed applications.
 * Handles version resolution by querying inscription metadata.
 *
 * Values replaced during injection:
 * - VERSION_INSCRIPTION_ORIGIN: The origin outpoint of the versioning inscription
 */
(function () {
  const VERSION_INSCRIPTION_ORIGIN = '__VERSION_INSCRIPTION_ORIGIN__';

  const params = new URLSearchParams(window.location.search);
  const requestedVersion = params.get('version');

  /**
   * Main redirect logic
   * 1. If ?version param exists, redirect to that specific version
   * 2. If no ?version param, check if latest is different from origin and redirect if needed
   */
  async function redirectToVersion() {
    try {
      // Use relative path for querying latest inscription
      const url = `/content/${VERSION_INSCRIPTION_ORIGIN}?seq=-1&map=true`;
      console.log('[react-onchain] Fetching latest version metadata from:', url);

      //TODO: use method head to get the headers only and fix other places that call this endpoint
      const response = await fetch(url);

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

      // Get current outpoint from URL
      const currentPath = window.location.pathname;
      const currentOutpoint = currentPath.split('/').pop();
      console.log('[react-onchain] Current outpoint:', currentOutpoint);

      let targetOutpoint = null;

      // STEP 1: Check if specific version requested
      if (requestedVersion) {
        console.log('[react-onchain] Resolving requested version:', requestedVersion);

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
      } else {
        // STEP 2: No version param - check if latest is different from origin
        console.log('[react-onchain] No version param - checking if latest differs from origin');

        // Get the latest inscription from x-bsv-inscriptions header
        // Format: "txid_vout,origin,<timestamp>; txid_vout,origin,<timestamp>; ..."
        const inscriptionsHeader = response.headers.get('x-bsv-inscriptions');

        if (inscriptionsHeader) {
          // Parse the first inscription (latest)
          const firstInscription = inscriptionsHeader.split(';')[0].trim();
          const latestOutpoint = firstInscription.split(',')[0];

          console.log('[react-onchain] Latest outpoint:', latestOutpoint);
          console.log('[react-onchain] Origin outpoint:', VERSION_INSCRIPTION_ORIGIN);

          // If latest is same as origin, no redirect needed
          if (latestOutpoint === VERSION_INSCRIPTION_ORIGIN) {
            console.log('[react-onchain] Already on latest version (same as origin)');
            return;
          }

          // Latest is different from origin - redirect to latest
          targetOutpoint = latestOutpoint;
          console.log('[react-onchain] Latest version differs from origin - will redirect');
        } else {
          console.log('[react-onchain] No inscriptions header found - staying on current page');
          return;
        }
      }

      // STEP 3: Perform redirect if needed
      if (targetOutpoint && targetOutpoint !== currentOutpoint) {
        console.log('[react-onchain] Redirecting to:', targetOutpoint);

        // Build redirect URL (use relative path for portability)
        const newUrl = `/content/${targetOutpoint}${window.location.hash}`;

        window.location.href = newUrl;
      } else {
        console.log('[react-onchain] Already on the target version');
      }
    } catch (error) {
      console.error('[react-onchain] Version redirect failed:', error);
      console.error('[react-onchain] Staying on current version');
    }
  }

  // Run the redirect logic
  redirectToVersion();
})();
