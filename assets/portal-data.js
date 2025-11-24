(function () {
  const DEFAULT_STATE = {
    reading: {
      otChapters: 0,
      ntChapters: 0,
      bookChapters: {},
      streakCount: 0,
      lastReadingDate: null,
    },
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

  function normalizeCustomEntry(entry) {
    if (!entry || !entry.id) return null;

    const mergedSteps = Array.isArray(entry.steps) && entry.steps.length > 0
      ? entry.steps
      : [{ id: `${entry.id}-step-1`, title: 'First step' }];

    const merged = {
      ...entry,
      title: (entry.title || 'Faith Formation AI Study').trim(),
      steps: mergedSteps,
      stepsProgress: entry.stepsProgress || {},
      link: entry.link || `custom-study.html?id=${encodeURIComponent(entry.id)}`,
    };

    return merged;
  }

  function normalizeCustomCollection(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map(normalizeCustomEntry)
      .filter(Boolean);
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
      const normalizedCustom = normalizeCustomCollection(parsed.studies?.custom);
      const completedMap = { ...(parsed.studies && parsed.studies.completed) };
      normalizedCustom.forEach((entry) => {
        if (typeof completedMap[entry.id] === 'undefined') {
          const stepsComplete = Array.isArray(entry.steps)
            ? entry.steps.every((step) => entry.stepsProgress && entry.stepsProgress[step.id])
            : false;
          completedMap[entry.id] = stepsComplete;
        }
      });

      return {
        reading: {
          ...DEFAULT_STATE.reading,
          ...(parsed.reading || {}),
          bookChapters: {
            ...(DEFAULT_STATE.reading.bookChapters || {}),
            ...(parsed.reading && parsed.reading.bookChapters),
          },
        },
        studies: {
          completed: completedMap,
          custom: normalizedCustom,
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
    const normalizedStudy = normalizeCustomEntry({ ...study, stepsProgress: study.stepsProgress || {} });
    if (!normalizedStudy) return state;

    const existingIndex = state.studies.custom.findIndex((item) => item.id === study.id);
    if (existingIndex >= 0) {
      const prior = state.studies.custom[existingIndex];
      const mergedSteps = Array.isArray(normalizedStudy.steps) && normalizedStudy.steps.length > 0
        ? normalizedStudy.steps
        : prior.steps;
      state.studies.custom[existingIndex] = {
        ...prior,
        ...normalizedStudy,
        steps: mergedSteps,
        stepsProgress: {
          ...(prior.stepsProgress || {}),
          ...(normalizedStudy.stepsProgress || {}),
        },
        link: normalizedStudy.link || prior.link || `custom-study.html?id=${encodeURIComponent(normalizedStudy.id)}`,
      };
    } else {
      state.studies.custom.push(normalizedStudy);
      state.studies.completed[study.id] = false;
    }
    return state;
  }

  function updateStreak(state) {
    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const last = state.reading.lastReadingDate;

    if (last === todayKey) return state;

    if (last) {
      const lastDate = new Date(last);
      const diffDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        state.reading.streakCount = (state.reading.streakCount || 0) + 1;
      } else if (diffDays > 1) {
        state.reading.streakCount = 1;
      }
    } else {
      state.reading.streakCount = 1;
    }

    state.reading.lastReadingDate = todayKey;
    return state;
  }

  function setReading(state, updates) {
    const existing = state.reading || DEFAULT_STATE.reading;
    state.reading = {
      ...existing,
      otChapters: clampNumber(updates.otChapters, 0, TOTALS.ot),
      ntChapters: clampNumber(updates.ntChapters, 0, TOTALS.nt),
      bookChapters: { ...(existing.bookChapters || {}) },
    };
    updateStreak(state);
    saveState(state);
    return state;
  }

  function toggleBookChapter(state, bookId, chapterIndex, testament) {
    if (!bookId || typeof chapterIndex !== 'number') return state;
    state.reading.bookChapters = state.reading.bookChapters || {};
    const current = Array.isArray(state.reading.bookChapters[bookId])
      ? [...state.reading.bookChapters[bookId]]
      : [];

    const isComplete = Boolean(current[chapterIndex]);
    current[chapterIndex] = !isComplete;
    state.reading.bookChapters[bookId] = current;

    const delta = isComplete ? -1 : 1;
    if (testament === 'nt') {
      state.reading.ntChapters = clampNumber(
        (state.reading.ntChapters || 0) + delta,
        0,
        TOTALS.nt,
      );
    } else {
      state.reading.otChapters = clampNumber(
        (state.reading.otChapters || 0) + delta,
        0,
        TOTALS.ot,
      );
    }

    updateStreak(state);
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

  function toggleCustomStep(state, studyId, stepId, completed) {
    if (!studyId || !stepId) return state;
    const target = state.studies.custom.find((entry) => entry.id === studyId);
    if (!target) return state;

    target.stepsProgress = target.stepsProgress || {};
    target.stepsProgress[stepId] = Boolean(completed);

    const allStepsComplete = Array.isArray(target.steps)
      ? target.steps.every((step) => target.stepsProgress[step.id])
      : false;

    state.studies.completed[studyId] = allStepsComplete;
    saveState(state);
    return state;
  }

  function removeCustomStudy(stateOrId, idMaybe) {
    const hasStateArg = stateOrId && typeof stateOrId === 'object' && stateOrId.studies;
    const id = hasStateArg ? idMaybe : stateOrId;
    const state = hasStateArg ? stateOrId : loadState();

    if (!id || !state.studies || !Array.isArray(state.studies.custom)) return state;

    const nextCustom = state.studies.custom.filter((entry) => entry && entry.id !== id);
    if (nextCustom.length === state.studies.custom.length) return state;

    state.studies.custom = nextCustom;
    if (state.studies.completed) {
      delete state.studies.completed[id];
    }

    saveState(state);
    return state;
  }

  function renameCustomStudy(state, id, title) {
    if (!id || !state.studies || !Array.isArray(state.studies.custom)) return state;
    const target = state.studies.custom.find((entry) => entry && entry.id === id);
    if (!target) return state;

    const nextTitle = (title || '').trim();
    if (!nextTitle) return state;

    target.title = nextTitle;
    saveState(state);
    return state;
  }

  function addCustomStudy(study) {
    const state = loadState();
    upsertCustomStudy(state, study);
    saveState(state);
    return state;
  }

  function getCustomStudy(id) {
    const state = loadState();
    const study = state.studies.custom.find((entry) => entry.id === id);
    return study ? { ...study } : null;
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
    toggleBookChapter,
    toggleStudyCompletion,
    toggleCustomStep,
    removeCustomStudy,
    renameCustomStudy,
    addCustomStudy,
    getCustomStudy,
    exportState,
  };
})();
