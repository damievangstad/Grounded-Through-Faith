(function () {
  const FALLBACK_DETAILS = 'membership.html#join';
  const DEFAULT_PAYMENT_LINK = '';

  const state = {
    membershipLink: DEFAULT_PAYMENT_LINK,
    checkoutReady: false,
  };

  function decorateCheckoutAnchors() {
    document.querySelectorAll('[data-membership-link="checkout"]').forEach((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.dataset.checkoutBound === 'true') return;
      anchor.dataset.checkoutBound = 'true';
      anchor.addEventListener('click', (event) => {
        if (state.membershipLink) {
          return;
        }
        if (state.checkoutReady) {
          event.preventDefault();
          startCheckout(anchor);
          return;
        }
        if (anchor.getAttribute('aria-disabled') === 'true') {
          event.preventDefault();
        }
      });
    });
  }

  function applyState() {
    const hasDirectLink = Boolean(state.membershipLink);
    const checkoutActive = hasDirectLink || state.checkoutReady;

    document.querySelectorAll('[data-membership-link]').forEach((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const intent = anchor.dataset.membershipLink || 'details';
      const isCheckout = intent === 'checkout';

      if (isCheckout) {
        anchor.href = hasDirectLink ? state.membershipLink : FALLBACK_DETAILS;
        anchor.dataset.checkoutMode = !hasDirectLink && state.checkoutReady ? 'api' : 'link';
        anchor.setAttribute('aria-disabled', checkoutActive ? 'false' : 'true');
        anchor.classList.toggle('opacity-60', !checkoutActive);
        if (!checkoutActive) {
          anchor.setAttribute('tabindex', '-1');
        } else {
          anchor.removeAttribute('tabindex');
        }
      } else {
        anchor.href = FALLBACK_DETAILS;
      }
    });

    decorateCheckoutAnchors();
  }

  async function startCheckout(anchor) {
    if (anchor) {
      anchor.classList.add('opacity-70');
      anchor.setAttribute('aria-busy', 'true');
    }

    try {
      const response = await fetch('/api/create-checkout', { method: 'POST' });
      if (!response.ok) throw new Error('Checkout request failed');
      const data = await response.json();
      if (data && data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('No checkout URL received');
    } catch (error) {
      console.warn('Stripe checkout unavailable:', error);
      alert('Stripe checkout is getting set up. Please check back shortly or contact TheMissionEffect@gmail.com.');
    } finally {
      if (anchor) {
        anchor.classList.remove('opacity-70');
        anchor.removeAttribute('aria-busy');
      }
    }
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
      state.checkoutReady = Boolean(data && data.checkoutReady);
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
    canCheckout: () => Boolean(state.membershipLink || state.checkoutReady),
  };
})();
