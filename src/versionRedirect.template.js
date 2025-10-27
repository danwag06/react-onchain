/**
 * Version Redirect Script
 *
 * Automatically injected by react-onchain into deployed applications.
 * Handles version resolution by querying the on-chain versioning contract.
 *
 * Placeholders (replaced during injection):
 * - __VERSIONING_CONTRACT_OUTPOINT__: The outpoint of the versioning smart contract
 * - __ORIGIN_OUTPOINT__: The original deployment outpoint
 * - __CONTRACT_API_SERVICES__: JSON array of known contract API services
 * - __ORDINALS_SERVICES__: JSON array of known ordinals content services
 */
(function() {
  const CONTRACT_OUTPOINT = '__VERSIONING_CONTRACT_OUTPOINT__';
  const ORIGIN_OUTPOINT = '__ORIGIN_OUTPOINT__';
  const CONTRACT_API_SERVICES = __CONTRACT_API_SERVICES__;
  const ORDINALS_SERVICES = __ORDINALS_SERVICES__;

  // Only run if we have a versioning contract
  if (CONTRACT_OUTPOINT === '__VERSIONING_CONTRACT_OUTPOINT__') {
    return; // No versioning contract configured
  }

  const params = new URLSearchParams(window.location.search);
  const requestedVersion = params.get('version');

  // No version requested, use current page
  if (!requestedVersion) {
    return;
  }

  /**
   * Try to fetch contract data from multiple API services
   */
  async function fetchContractData() {
    let lastError = null;

    for (const apiService of CONTRACT_API_SERVICES) {
      try {
        console.log('[react-onchain] Trying contract API:', apiService);

        const response = await fetch(`${apiService}/inscriptions/latest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([CONTRACT_OUTPOINT])
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('[react-onchain] Contract data fetched from:', apiService);
        return data;
      } catch (error) {
        console.warn('[react-onchain] Failed to fetch from', apiService, ':', error.message);
        lastError = error;
      }
    }

    throw lastError || new Error('All contract API services failed');
  }

  /**
   * Get the preferred ordinals service from localStorage
   */
  function getPreferredOrdinalsService() {
    try {
      const stored = localStorage.getItem('react-onchain-preferred-service');
      if (stored) {
        const data = JSON.parse(stored);
        return data.service;
      }
    } catch (e) {
      // Ignore errors
    }
    return ORDINALS_SERVICES[0]; // Default to first service
  }

  async function redirectToVersion() {
    try {
      console.log('[react-onchain] Resolving version:', requestedVersion);

      // Fetch the latest inscription data for the versioning contract
      const contractData = await fetchContractData();
      console.log('[react-onchain] Contract data:', contractData);

      // Parse the contract state to get version information
      // The contract data includes the current state with versionMap and latestVersion
      let targetOutpoint = null;

      if (requestedVersion === 'latest') {
        // Get the latest version from contract state
        // The contract's latestVersion property contains the most recent version
        // We need to parse the contract inscription data
        const inscriptionData = contractData.data?.insc?.json;
        if (inscriptionData && inscriptionData.latestVersion) {
          // The latestVersion is stored in the contract state
          // We need to look it up in the versionMap
          targetOutpoint = inscriptionData.latestOutpoint || ORIGIN_OUTPOINT;
        } else {
          // Fallback to origin if we can't parse the latest version
          targetOutpoint = ORIGIN_OUTPOINT;
        }
      } else {
        // Look up specific version in the contract's versionMap
        // This requires querying the contract state
        const inscriptionData = contractData.data?.insc?.json;
        if (inscriptionData && inscriptionData.versions && inscriptionData.versions[requestedVersion]) {
          targetOutpoint = inscriptionData.versions[requestedVersion].outpoint;
        }
      }

      if (targetOutpoint && targetOutpoint !== window.location.pathname.split('/').pop()) {
        console.log('[react-onchain] Redirecting to version:', requestedVersion, 'at', targetOutpoint);

        // Use the preferred ordinals service (or fall back to first in list)
        const ordinalsService = getPreferredOrdinalsService();
        window.location.href = `${ordinalsService}/${targetOutpoint}${window.location.hash}`;
      } else if (!targetOutpoint) {
        console.warn(`[react-onchain] Version ${requestedVersion} not found, staying on current version`);
      }
    } catch (error) {
      console.error('[react-onchain] Version redirect failed:', error);
      console.error('[react-onchain] Staying on current version');
    }
  }

  // Run the redirect logic
  redirectToVersion();
})();
