/**
 * Version Redirect Script
 *
 * Automatically injected by react-onchain into deployed applications.
 * Handles version resolution by querying the on-chain versioning contract.
 *
 * Placeholders (replaced during injection):
 * - VERSIONING_CONTRACT_OUTPOINT_PLACEHOLDER: The outpoint of the versioning smart contract
 * - CONTRACT_ARTIFACT_PLACEHOLDER: Inlined contract artifact JSON
 * - INDEXER_CONFIGS_PLACEHOLDER: JSON array of browser-compatible indexer configurations
 * - ORDINALS_SERVICES_PLACEHOLDER: JSON array of known ordinals content services
 */
(function() {
  const CONTRACT_OUTPOINT = 'VERSIONING_CONTRACT_OUTPOINT_PLACEHOLDER';
  const CONTRACT_ARTIFACT = CONTRACT_ARTIFACT_PLACEHOLDER;
  const INDEXER_CONFIGS_RAW = INDEXER_CONFIGS_PLACEHOLDER;
  const CONTENT_SERVICES = ORDINALS_SERVICES_PLACEHOLDER;

  // Only run if we have a versioning contract (check if placeholder was replaced)
  if (!CONTRACT_OUTPOINT || CONTRACT_OUTPOINT.indexOf('PLACEHOLDER') >= 0) {
    return; // No versioning contract configured
  }

  const params = new URLSearchParams(window.location.search);
  const requestedVersion = params.get('version');

  // No version requested, use current page
  if (!requestedVersion) {
    return;
  }

  // Reconstruct indexer configs from serialized data
  // Functions were converted to strings, need to reconstruct them
  const INDEXER_CONFIGS = INDEXER_CONFIGS_RAW.map(config => {
    return {
      name: config.name,
      baseUrl: config.baseUrl,
      endpoints: {
        fetchLatestByOrigin: new Function('origin', `return ${config.endpoints.fetchLatestByOrigin}`),
        getTransaction: new Function('txid', `return ${config.endpoints.getTransaction}`),
      },
      parseLatestByOrigin: config.parseLatestByOrigin
        ? new Function('data', `return ${config.parseLatestByOrigin}`)
        : null
    };
  });

  /**
   * Dynamically load scrypt-ts from CDN
   */
  async function loadScryptTs() {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if (window.scryptTS) {
        resolve(window.scryptTS);
        return;
      }

      const script = document.createElement('script');
      script.type = 'module';
      script.textContent = `
        import * as scryptTS from 'https://unpkg.com/scrypt-ts@latest/dist/index.js';
        window.scryptTS = scryptTS;
        window.dispatchEvent(new Event('scrypt-ts-loaded'));
      `;

      script.onerror = () => reject(new Error('Failed to load scrypt-ts from CDN'));

      window.addEventListener('scrypt-ts-loaded', () => {
        resolve(window.scryptTS);
      }, { once: true });

      document.head.appendChild(script);
    });
  }

  /**
   * Fetch the latest inscription in an origin chain
   * Tries all available indexers until one succeeds
   */
  async function fetchLatestByOrigin(origin) {
    let lastError = null;

    for (const indexerConfig of INDEXER_CONFIGS) {
      try {
        console.log('[react-onchain] Trying indexer:', indexerConfig.name);

        const endpoint = indexerConfig.endpoints.fetchLatestByOrigin(origin);
        const url = `${indexerConfig.baseUrl}${endpoint}`;

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Use custom parser if provided, otherwise use standard format
        const parsed = indexerConfig.parseLatestByOrigin
          ? indexerConfig.parseLatestByOrigin(data)
          : data;

        console.log('[react-onchain] Success with:', indexerConfig.name);
        return {
          txid: parsed.txid,
          vout: parsed.vout,
          outpoint: `${parsed.txid}_${parsed.vout}`,
          script: parsed.script,
        };
      } catch (error) {
        console.warn('[react-onchain] Failed with', indexerConfig.name, ':', error.message);
        lastError = error;
      }
    }

    throw lastError || new Error('All indexers failed');
  }

  /**
   * Load and query the contract state
   * Returns { originOutpoint, versionMap }
   */
  async function loadContractState(scryptTS, contractOrigin) {
    try {
      // Get the latest contract UTXO
      const latestContract = await fetchLatestByOrigin(contractOrigin);
      console.log('[react-onchain] Latest contract at:', latestContract.outpoint);

      // Load the contract artifact and create provider
      const { ReactOnchainVersioning, HashedMap, DefaultProvider, bsv } = scryptTS;

      // Create a provider to fetch transaction data
      const provider = new DefaultProvider({ network: bsv.Networks.mainnet });
      await provider.connect();

      // Fetch the contract transaction using scrypt-ts provider
      const txData = await provider.getTransaction(latestContract.txid);

      // Load artifact into the contract class
      await ReactOnchainVersioning.loadArtifact(CONTRACT_ARTIFACT);

      // Deserialize contract from transaction
      const currentVersionMap = new HashedMap();
      const contract = ReactOnchainVersioning.fromTx(txData, latestContract.vout, {
        versionMap: currentVersionMap,
      });

      // Read the origin outpoint from contract state
      const originOutpoint = Buffer.from(contract.originOutpoint, 'hex').toString('utf8');
      console.log('[react-onchain] Contract origin:', originOutpoint);

      return {
        originOutpoint,
        contract,
      };
    } catch (error) {
      console.error('[react-onchain] Failed to load contract state:', error);
      return null;
    }
  }

  /**
   * Query the contract's versionMap for a specific version
   */
  function getVersionOutpoint(scryptTS, contract, version) {
    try {
      const { toByteString } = scryptTS;

      // Query the versionMap
      const versionKey = toByteString(version, true);
      const versionData = contract.versionMap.get(versionKey);

      if (!versionData) {
        console.warn('[react-onchain] Version not found in contract:', version);
        return null;
      }

      // Decode the outpoint from hex to UTF-8
      const outpoint = Buffer.from(versionData.outpoint, 'hex').toString('utf8');
      console.log('[react-onchain] Found outpoint for version', version, ':', outpoint);

      return outpoint;
    } catch (error) {
      console.error('[react-onchain] Failed to query contract for version:', error);
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
    return CONTENT_SERVICES[0]; // Default to first service
  }

  async function redirectToVersion() {
    try {
      console.log('[react-onchain] Resolving version:', requestedVersion);

      // Load scrypt-ts and contract state
      console.log('[react-onchain] Loading scrypt-ts...');
      const scryptTS = await loadScryptTs();

      console.log('[react-onchain] Loading contract state...');
      const contractState = await loadContractState(scryptTS, CONTRACT_OUTPOINT);

      if (!contractState) {
        console.error('[react-onchain] Failed to load contract state');
        return;
      }

      const { originOutpoint, contract } = contractState;
      let targetOutpoint = null;

      if (requestedVersion === 'latest') {
        // For latest version, fetch the latest inscription from the origin chain
        console.log('[react-onchain] Fetching latest version from origin:', originOutpoint);

        const latestApp = await fetchLatestByOrigin(originOutpoint);
        targetOutpoint = latestApp.outpoint;

        console.log('[react-onchain] Latest version is at:', targetOutpoint);
      } else {
        // For specific versions, query the contract's versionMap
        console.log('[react-onchain] Querying contract for version:', requestedVersion);

        targetOutpoint = getVersionOutpoint(scryptTS, contract, requestedVersion);

        if (!targetOutpoint) {
          console.warn('[react-onchain] Version', requestedVersion, 'not found in contract');
        }
      }

      // Get current outpoint from URL
      const currentPath = window.location.pathname;
      const currentOutpoint = currentPath.split('/').pop();

      if (targetOutpoint && targetOutpoint !== currentOutpoint) {
        console.log('[react-onchain] Redirecting to:', targetOutpoint);

        // Use the preferred content service (or fall back to first in list)
        const contentService = getPreferredContentService();

        // Preserve hash but replace search params
        const newUrl = `${contentService}/${targetOutpoint}${window.location.hash}`;
        window.location.href = newUrl;
      } else if (!targetOutpoint) {
        console.warn('[react-onchain] Could not resolve version, staying on current page');
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
