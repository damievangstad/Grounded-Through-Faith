(function () {
  const FALLBACK_DETAILS = 'membership.html#join';
  const DEFAULT_PAYMENT_LINK = 'https://buy.stripe.com/dRmbITcDo3DY9JA5JvfIs00';

  const state = {
    membershipLink: DEFAULT_PAYMENT_LINK,
  };

  function applyState() {
    const ready = Boolean(state.membershipLink);
    document.querySelectorAll('[data-membership-link]').forEach((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const intent = anchor.dataset.membershipLink || 'details';
      const isCheckout = intent === 'checkout';

      if (isCheckout) {
        anchor.href = ready ? state.membershipLink : FALLBACK_DETAILS;
        anchor.dataset.checkoutReady = ready ? 'true' : 'false';
        anchor.setAttribute('aria-disabled', ready ? 'false' : 'true');
        anchor.classList.toggle('opacity-60', !ready);
      } else {
        anchor.href = FALLBACK_DETAILS;
      }
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
      if (data && typeof data.membershipLink === 'string' && data.membershipLink.trim()) {
        state.membershipLink = data.membershipLink.trim();
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
    getLink: () => state.membershipLink,
    canCheckout: () => Boolean(state.membershipLink),
  };
})();
