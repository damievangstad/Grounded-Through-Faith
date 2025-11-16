(function () {
  const FALLBACK_DETAILS = 'membership.html#join';
  const DEFAULT_PRICE = '$5/month';
  const state = {
    priceLabel: DEFAULT_PRICE,
    checkoutReady: false,
  };

  function applyState() {
    document.querySelectorAll('[data-membership-link]').forEach((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const intent = anchor.dataset.membershipLink || 'details';
      if (intent === 'checkout') {
        anchor.href = FALLBACK_DETAILS;
        anchor.dataset.checkoutReady = state.checkoutReady ? 'true' : 'false';
        if (!anchor.dataset.checkoutBound) {
          anchor.addEventListener('click', handleCheckoutClick);
          anchor.dataset.checkoutBound = 'true';
        }
      } else {
        anchor.href = FALLBACK_DETAILS;
      }
    });

    document.querySelectorAll('[data-membership-price]').forEach((node) => {
      node.textContent = state.priceLabel || DEFAULT_PRICE;
    });
  }

  function setBusy(button, isBusy) {
    if (!button) return;
    if (isBusy) {
      button.dataset.previousText = button.textContent;
      button.textContent = 'Connecting…';
      button.classList.add('opacity-70');
      button.disabled = true;
    } else {
      if (button.dataset.previousText) {
        button.textContent = button.dataset.previousText;
        delete button.dataset.previousText;
      }
      button.classList.remove('opacity-70');
      button.disabled = false;
    }
  }

  async function handleCheckoutClick(event) {
    const trigger = event.currentTarget;
    event.preventDefault();
    if (!trigger || trigger.dataset.checkoutReady !== 'true') {
      window.location.href = FALLBACK_DETAILS;
      return;
    }

    try {
      setBusy(trigger, true);
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          successUrl: `${window.location.origin}/membership.html#signin`,
          cancelUrl: `${window.location.origin}/membership.html`,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Checkout request failed');
      }

      const data = await response.json();
      if (data && data.url) {
        window.location.href = data.url;
        return;
      }

      throw new Error('Missing checkout URL.');
    } catch (error) {
      console.error('Membership checkout failed:', error);
      alert('We could not reach Stripe right now. Please try again in a moment.');
    } finally {
      setBusy(trigger, false);
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
      if (data && typeof data.priceLabel === 'string' && data.priceLabel.trim()) {
        state.priceLabel = data.priceLabel.trim();
      }
      if (typeof data.checkoutReady === 'boolean') {
        state.checkoutReady = data.checkoutReady;
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
    getPriceLabel: () => state.priceLabel,
    canCheckout: () => state.checkoutReady,
  };
})();
