(function () {
  function isSignedIn() {
    try {
      return sessionStorage.getItem('gtfMemberSession') === 'true';
    } catch (error) {
      console.warn('Session storage unavailable:', error);
      return false;
    }
  }

  function getEmail() {
    try {
      return sessionStorage.getItem('gtfMemberEmail') || '';
    } catch (error) {
      return '';
    }
  }

  function isSubscriber() {
    try {
      return sessionStorage.getItem('gtfMemberSubscriber') === 'true';
    } catch (error) {
      return false;
    }
  }

  function updateAuthUI() {
    const signedIn = isSignedIn();
    const email = getEmail();
    const subscriber = isSubscriber();

    document.querySelectorAll('[data-auth-show="signed-in"]').forEach((el) => {
      el.classList.toggle('hidden', !signedIn);
    });
    document.querySelectorAll('[data-auth-show="signed-out"]').forEach((el) => {
      el.classList.toggle('hidden', signedIn);
    });

    const navSignIn = document.querySelector('[data-auth-link="signin"]');
    const navPortal = document.querySelector('[data-auth-link="portal"]');
    if (navSignIn) {
      navSignIn.classList.toggle('hidden', signedIn && subscriber);
      navSignIn.classList.toggle('inline-flex', !signedIn || !subscriber);
      navSignIn.classList.toggle('inline-block', !signedIn || !subscriber);
      navSignIn.textContent = !signedIn ? 'Sign In' : 'Subscribe';
      navSignIn.href = !signedIn ? 'signin.html' : 'membership.html#join';
      navSignIn.classList.toggle('text-[var(--color-cerulean)]', signedIn && !subscriber);
    }

    if (navPortal) {
      navPortal.classList.toggle('hidden', !signedIn || !subscriber);
      navPortal.classList.toggle('inline-flex', signedIn && subscriber);
      navPortal.classList.toggle('inline-block', signedIn && subscriber);
      navPortal.textContent = 'Member Portal';
      navPortal.href = 'member-portal.html';
      navPortal.classList.add('text-[var(--color-cerulean)]');
    }

    document.querySelectorAll('[data-auth-indicator]').forEach((el) => {
      if (signedIn) {
        const label = email ? `Signed in • ${email}` : 'Signed in';
        el.textContent = label;
        el.classList.remove('hidden');
      } else {
        el.textContent = '';
        el.classList.add('hidden');
      }
    });
  }

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      updateAuthUI();
    }
  });

  try {
    window.addEventListener('storage', updateAuthUI);
  } catch (error) {
    /* noop */
  }

  updateAuthUI();

  window.gtfAuth = {
    refresh: updateAuthUI,
    signedIn: isSignedIn,
    email: getEmail,
    subscriber: isSubscriber,
  };
})();
