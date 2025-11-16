(function () {
  const FALLBACK_DETAILS = 'membership.html#join';
  const DEFAULT_PRICE = '$5/month';
  const state = {
    checkoutUrl: FALLBACK_DETAILS,
    priceLabel: DEFAULT_PRICE,
  };

  function applyState() {
    document.querySelectorAll('[data-membership-link]').forEach((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const intent = anchor.dataset.membershipLink || 'details';
      if (intent === 'checkout') {
        anchor.href = state.checkoutUrl || FALLBACK_DETAILS;
        anchor.target = '_blank';
        anchor.rel = 'noreferrer';
      } else {
        anchor.href = FALLBACK_DETAILS;
      }
    });

    document.querySelectorAll('[data-membership-price]').forEach((node) => {
      node.textContent = state.priceLabel || DEFAULT_PRICE;
    });
  }

  async function loadConfig() {
    applyState();
    try {
      const response = await fetch('/api/config', {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Config request failed');
      const data = await response.json();
      if (data && typeof data.membershipUrl === 'string' && data.membershipUrl.trim()) {
        state.checkoutUrl = data.membershipUrl.trim();
      }
      if (data && typeof data.priceLabel === 'string' && data.priceLabel.trim()) {
        state.priceLabel = data.priceLabel.trim();
      }
    } catch (error) {
      console.warn('Membership config unavailable:', error);
    } finally {
      applyState();
    }
  }

  const ready = loadConfig();
  window.gtfMembership = {
    ready,
    getCheckoutUrl: () => state.checkoutUrl,
    getPriceLabel: () => state.priceLabel,
  };
})();
