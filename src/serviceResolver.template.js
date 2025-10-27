/**
 * Ordinals Service Resolver
 *
 * Automatically injected by react-onchain into deployed applications.
 * Provides runtime fallback across multiple BSV ordinals indexing services.
 *
 * This ensures your app remains accessible even if the primary service goes down.
 *
 * Placeholders (replaced during injection):
 * - __ORDINALS_SERVICES__: JSON array of known ordinals services
 * - __PRIMARY_SERVICE__: The primary service URL used during deployment
 */
(function() {
  // Configuration
  const ORDINALS_SERVICES = __ORDINALS_SERVICES__;
  const PRIMARY_SERVICE = '__PRIMARY_SERVICE__';
  const STORAGE_KEY = 'react-onchain-preferred-service';
  const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

  // State
  let preferredService = null;
  let lastCheckTime = 0;

  /**
   * Get the preferred service from localStorage
   */
  function getPreferredService() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        const age = Date.now() - data.timestamp;
        if (age < CACHE_DURATION) {
          return data.service;
        }
      }
    } catch (e) {
      console.warn('[react-onchain] Failed to read preferred service from localStorage:', e);
    }
    return null;
  }

  /**
   * Set the preferred service in localStorage
   */
  function setPreferredService(service) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        service,
        timestamp: Date.now()
      }));
      preferredService = service;
    } catch (e) {
      console.warn('[react-onchain] Failed to save preferred service to localStorage:', e);
    }
  }

  /**
   * Test if a service is accessible
   */
  async function testService(serviceUrl, outpoint) {
    try {
      const url = `${serviceUrl}/${outpoint}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Find a working service from the list
   */
  async function findWorkingService(outpoint) {
    // Try preferred service first
    const preferred = getPreferredService();
    if (preferred && await testService(preferred, outpoint)) {
      return preferred;
    }

    // Try primary service
    if (await testService(PRIMARY_SERVICE, outpoint)) {
      setPreferredService(PRIMARY_SERVICE);
      return PRIMARY_SERVICE;
    }

    // Try all known services
    for (const service of ORDINALS_SERVICES) {
      if (service === PRIMARY_SERVICE) continue; // Already tried
      if (await testService(service, outpoint)) {
        setPreferredService(service);
        return service;
      }
    }

    // No working service found
    console.error('[react-onchain] No working ordinals service found');
    return null;
  }

  /**
   * Resolve an outpoint to a full URL using the best available service
   */
  async function resolveOutpoint(outpoint) {
    const service = await findWorkingService(outpoint);
    if (!service) {
      console.error('[react-onchain] Cannot resolve outpoint:', outpoint);
      return null;
    }
    return `${service}/${outpoint}`;
  }

  /**
   * Manually override the preferred service
   * Usage: window.__setOrdinalService('https://alternative-service.com/content')
   */
  function setOrdinalsService(serviceUrl) {
    console.log('[react-onchain] Manually setting ordinals service to:', serviceUrl);
    setPreferredService(serviceUrl);

    // Reload the page to use the new service
    if (confirm('Service updated. Reload the page to apply changes?')) {
      window.location.reload();
    }
  }

  /**
   * Get the current preferred service
   */
  function getOrdinalsService() {
    return getPreferredService() || PRIMARY_SERVICE;
  }

  /**
   * Get all known services
   */
  function getKnownServices() {
    return [...ORDINALS_SERVICES];
  }

  /**
   * Rewrite all asset URLs to use the preferred service
   * This runs on page load to update any hardcoded URLs
   */
  async function rewriteAssetUrls() {
    const currentService = getOrdinalsService();

    // Update all img src attributes
    document.querySelectorAll('img[src]').forEach(img => {
      const src = img.getAttribute('src');
      if (src && src.includes('/content/')) {
        const outpoint = src.split('/content/').pop();
        if (outpoint) {
          img.setAttribute('src', `${currentService}/${outpoint}`);
        }
      }
    });

    // Update all link href attributes (for CSS, etc.)
    document.querySelectorAll('link[href]').forEach(link => {
      const href = link.getAttribute('href');
      if (href && href.includes('/content/')) {
        const outpoint = href.split('/content/').pop();
        if (outpoint) {
          link.setAttribute('href', `${currentService}/${outpoint}`);
        }
      }
    });

    // Update all script src attributes
    document.querySelectorAll('script[src]').forEach(script => {
      const src = script.getAttribute('src');
      if (src && src.includes('/content/')) {
        const outpoint = src.split('/content/').pop();
        if (outpoint) {
          // For scripts, we need to create a new script tag
          const newScript = document.createElement('script');
          newScript.src = `${currentService}/${outpoint}`;
          Array.from(script.attributes).forEach(attr => {
            if (attr.name !== 'src') {
              newScript.setAttribute(attr.name, attr.value);
            }
          });
          script.parentNode.replaceChild(newScript, script);
        }
      }
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', rewriteAssetUrls);
  } else {
    rewriteAssetUrls();
  }

  // Expose public API
  window.__setOrdinalService = setOrdinalsService;
  window.__getOrdinalService = getOrdinalsService;
  window.__getKnownServices = getKnownServices;
  window.__resolveOutpoint = resolveOutpoint;

  console.log('[react-onchain] Service resolver initialized. Current service:', getOrdinalsService());
  console.log('[react-onchain] To change service, use: window.__setOrdinalService("https://your-service.com/content")');
})();
