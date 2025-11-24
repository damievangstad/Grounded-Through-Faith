(function () {
  const DEFAULT_STATE = {
    reading: { otChapters: 0, ntChapters: 0 },
    studies: { completed: {}, custom: [] },
  };

  const TOTALS = {
    ot: 929,
    nt: 260,
  };

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

  function storageKey() {
    const email = getEmail() || 'member';
    return `gtfPortal:${email}`;
  }

  function loadState() {
    const baseState = {
      reading: { ...DEFAULT_STATE.reading },
      studies: { completed: {}, custom: [] },
    };

    if (!isSignedIn()) return baseState;

    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return baseState;

      const parsed = JSON.parse(raw);
      return {
        reading: { ...DEFAULT_STATE.reading, ...(parsed.reading || {}) },
        studies: {
          completed: { ...(parsed.studies && parsed.studies.completed) },
          custom: Array.isArray(parsed.studies?.custom) ? [...parsed.studies.custom] : [],
        },
      };
    } catch (error) {
      console.warn('Portal data unavailable:', error);
      return baseState;
    }
  }

  function saveState(state) {
    if (!isSignedIn()) return;
    try {
      localStorage.setItem(storageKey(), JSON.stringify(state));
    } catch (error) {
      console.warn('Unable to persist portal data:', error);
    }
  }

  function upsertCustomStudy(state, study) {
    if (!study || !study.id) return state;
    const existingIndex = state.studies.custom.findIndex((item) => item.id === study.id);
    if (existingIndex >= 0) {
      state.studies.custom[existingIndex] = { ...state.studies.custom[existingIndex], ...study };
    } else {
      state.studies.custom.push({ title: 'Faith Formation AI Study', ...study });
    }
    return state;
  }

  function setReading(state, updates) {
    state.reading = {
      otChapters: clampNumber(updates.otChapters, 0, TOTALS.ot),
      ntChapters: clampNumber(updates.ntChapters, 0, TOTALS.nt),
    };
    saveState(state);
    return state;
  }

  function clampNumber(value, min, max) {
    const num = Number(value) || 0;
    if (num < min) return min;
    if (num > max) return max;
    return Math.floor(num);
  }

  function toggleStudyCompletion(state, id, completed) {
    if (!id) return state;
    state.studies.completed[id] = Boolean(completed);
    saveState(state);
    return state;
  }

  function addCustomStudy(study) {
    const state = loadState();
    upsertCustomStudy(state, study);
    saveState(state);
    return state;
  }

  function exportState() {
    return loadState();
  }

  window.gtfPortalData = {
    isSignedIn,
    email: getEmail,
    totals: TOTALS,
    load: loadState,
    save: saveState,
    setReading,
    toggleStudyCompletion,
    addCustomStudy,
    exportState,
  };
})();
