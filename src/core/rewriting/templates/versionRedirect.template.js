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
   * Sets the base path for the application after version resolution
   * This configures both the HTML <base> tag and React Router's basename
   */
  function setBasePath(outpoint) {
    const basePath = `/content/${outpoint}`;

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

    console.log('[react-onchain] Base path configured:', basePath);
  }

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
      // Handle trailing slash: /content/abc_0/ → abc_0
      const currentPath = window.location.pathname;
      const pathParts = currentPath.split('/').filter(part => part.length > 0);
      const currentOutpoint = pathParts[pathParts.length - 1] || '';
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
        // STEP 2: No version param - check if latest is different from current
        console.log('[react-onchain] No version param - checking if latest differs from current');

        // Parse all version entries from metadata
        const versionEntries = [];
        for (const key in metadata) {
          if (key.startsWith('version.')) {
            try {
              const versionData = JSON.parse(metadata[key]);
              versionEntries.push({
                version: key.replace('version.', ''),
                outpoint: versionData.outpoint,
                timestamp: versionData.utcTimeStamp || 0,
              });
            } catch (error) {
              console.warn('[react-onchain] Failed to parse version entry:', key, error);
            }
          }
        }

        if (versionEntries.length === 0) {
          console.log('[react-onchain] No versions found in metadata - staying on current page');
          return;
        }

        // Find latest version by timestamp
        versionEntries.sort((a, b) => b.timestamp - a.timestamp);
        const latestVersion = versionEntries[0];

        console.log('[react-onchain] Latest version:', latestVersion.version, 'at', latestVersion.outpoint);
        console.log('[react-onchain] Current outpoint:', currentOutpoint);

        // Check if we're already on the latest version
        if (latestVersion.outpoint === currentOutpoint) {
          console.log('[react-onchain] Already on latest version');
          // Log the current version info
          console.log(`%c[react-onchain] Version: ${latestVersion.version} | Deployment: /content/${currentOutpoint}`, 'color: #22c55e; font-weight: bold');
          // Set base path for this final outpoint
          setBasePath(currentOutpoint);
          return;
        }

        // Redirect to latest version
        targetOutpoint = latestVersion.outpoint;
        console.log('[react-onchain] Will redirect to latest version');
      }

      // STEP 3: Perform redirect if needed
      if (targetOutpoint && targetOutpoint !== currentOutpoint) {
        console.log('[react-onchain] Redirecting to:', targetOutpoint);

        // Extract the path after the current outpoint (e.g., /about-us from /content/abc_0/about-us)
        const currentPathAfterOutpoint = currentPath.replace(`/content/${currentOutpoint}`, '');

        // Build redirect URL preserving the subpath, query params, and hash
        const newUrl = `/content/${targetOutpoint}${currentPathAfterOutpoint}${window.location.search}${window.location.hash}`;

        console.log('[react-onchain] Preserving path:', currentPathAfterOutpoint);
        window.location.href = newUrl;
      } else if (targetOutpoint === currentOutpoint) {
        console.log('[react-onchain] Already on the target version');
        // Find version number for current outpoint
        let currentVersionNumber = 'unknown';
        for (const key in metadata) {
          if (key.startsWith('version.')) {
            try {
              const versionData = JSON.parse(metadata[key]);
              if (versionData.outpoint === currentOutpoint) {
                currentVersionNumber = key.replace('version.', '');
                break;
              }
            } catch (e) {
              // Skip parse errors
            }
          }
        }
        console.log(`%c[react-onchain] Version: ${currentVersionNumber} | Deployment: /content/${currentOutpoint}`, 'color: #22c55e; font-weight: bold');
        // Set base path for this final outpoint
        setBasePath(currentOutpoint);
      }
    } catch (error) {
      console.error('[react-onchain] Version redirect failed:', error);
      console.error('[react-onchain] Staying on current version');
      // Log deployment path even if version fetch failed
      const currentPath = window.location.pathname;
      const pathParts = currentPath.split('/').filter(part => part.length > 0);
      const currentOutpoint = pathParts[pathParts.length - 1] || '';
      console.log(`%c[react-onchain] Deployment: /content/${currentOutpoint}`, 'color: #ef4444; font-weight: bold');
      // Set base path even if version fetch failed
      if (currentOutpoint) {
        setBasePath(currentOutpoint);
      }
    }
  }

  // Run the redirect logic
  redirectToVersion();
})();
