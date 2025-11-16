(function () {
  const FALLBACK_DETAILS = 'membership.html#join';
  const state = {
    checkoutReady: false,
  };

  function applyState() {
    document.querySelectorAll('[data-membership-link]').forEach((anchor) => {
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const intent = anchor.dataset.membershipLink || 'details';
      const isCheckout = intent === 'checkout';

      if (isCheckout) {
        anchor.href = FALLBACK_DETAILS;
        anchor.dataset.checkoutReady = state.checkoutReady ? 'true' : 'false';
        anchor.setAttribute('aria-disabled', state.checkoutReady ? 'false' : 'true');
        anchor.classList.toggle('opacity-60', !state.checkoutReady);
        if (!anchor.dataset.checkoutBound) {
          anchor.addEventListener('click', handleCheckoutClick);
          anchor.dataset.checkoutBound = 'true';
        }
      } else {
        anchor.href = FALLBACK_DETAILS;
      }
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

    try {
      if (!state.checkoutReady) {
        throw new Error('checkout-not-ready');
      }
      setBusy(trigger, true);
      const successUrl = `${window.location.origin}/member-portal.html`;
      const cancelUrl = `${window.location.origin}/membership.html`;
      const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ successUrl, cancelUrl }),
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
      if (error && error.message === 'checkout-not-ready') {
        alert('Stripe checkout is getting set up. Please check back shortly or contact TheMissionEffect@gmail.com.');
        window.location.href = FALLBACK_DETAILS;
      } else {
        alert('We could not reach Stripe right now. Please try again in a moment.');
      }
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
    canCheckout: () => state.checkoutReady,
  };
})();
