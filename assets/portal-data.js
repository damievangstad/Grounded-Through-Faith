(function () {
  const DEFAULT_STATE = {
    reading: {
      otChapters: 0,
      ntChapters: 0,
      bookChapters: {},
      streakCount: 0,
      lastReadingDate: null,
    },
    // Only one custom plan is kept at a time.
    studies: { completed: {}, custom: [] },
  };

  const TOTALS = {
    ot: 929,
    nt: 260,
  };

  const API_ENDPOINT = '/api/bible/progress';
  const STATE_ENDPOINT = '/api/portal-state';

  const BOOK_METADATA = [
    { id: 'genesis', name: 'Genesis', chapters: 50, testament: 'ot' },
    { id: 'exodus', name: 'Exodus', chapters: 40, testament: 'ot' },
    { id: 'leviticus', name: 'Leviticus', chapters: 27, testament: 'ot' },
    { id: 'numbers', name: 'Numbers', chapters: 36, testament: 'ot' },
    { id: 'deuteronomy', name: 'Deuteronomy', chapters: 34, testament: 'ot' },
    { id: 'joshua', name: 'Joshua', chapters: 24, testament: 'ot' },
    { id: 'judges', name: 'Judges', chapters: 21, testament: 'ot' },
    { id: 'ruth', name: 'Ruth', chapters: 4, testament: 'ot' },
    { id: '1-samuel', name: '1 Samuel', chapters: 31, testament: 'ot' },
    { id: '2-samuel', name: '2 Samuel', chapters: 24, testament: 'ot' },
    { id: '1-kings', name: '1 Kings', chapters: 22, testament: 'ot' },
    { id: '2-kings', name: '2 Kings', chapters: 25, testament: 'ot' },
    { id: '1-chronicles', name: '1 Chronicles', chapters: 29, testament: 'ot' },
    { id: '2-chronicles', name: '2 Chronicles', chapters: 36, testament: 'ot' },
    { id: 'ezra', name: 'Ezra', chapters: 10, testament: 'ot' },
    { id: 'nehemiah', name: 'Nehemiah', chapters: 13, testament: 'ot' },
    { id: 'esther', name: 'Esther', chapters: 10, testament: 'ot' },
    { id: 'job', name: 'Job', chapters: 42, testament: 'ot' },
    { id: 'psalms', name: 'Psalms', chapters: 150, testament: 'ot' },
    { id: 'proverbs', name: 'Proverbs', chapters: 31, testament: 'ot' },
    { id: 'ecclesiastes', name: 'Ecclesiastes', chapters: 12, testament: 'ot' },
    { id: 'song-of-songs', name: 'Song of Songs', chapters: 8, testament: 'ot' },
    { id: 'isaiah', name: 'Isaiah', chapters: 66, testament: 'ot' },
    { id: 'jeremiah', name: 'Jeremiah', chapters: 52, testament: 'ot' },
    { id: 'lamentations', name: 'Lamentations', chapters: 5, testament: 'ot' },
    { id: 'ezekiel', name: 'Ezekiel', chapters: 48, testament: 'ot' },
    { id: 'daniel', name: 'Daniel', chapters: 12, testament: 'ot' },
    { id: 'hosea', name: 'Hosea', chapters: 14, testament: 'ot' },
    { id: 'joel', name: 'Joel', chapters: 3, testament: 'ot' },
    { id: 'amos', name: 'Amos', chapters: 9, testament: 'ot' },
    { id: 'obadiah', name: 'Obadiah', chapters: 1, testament: 'ot' },
    { id: 'jonah', name: 'Jonah', chapters: 4, testament: 'ot' },
    { id: 'micah', name: 'Micah', chapters: 7, testament: 'ot' },
    { id: 'nahum', name: 'Nahum', chapters: 3, testament: 'ot' },
    { id: 'habakkuk', name: 'Habakkuk', chapters: 3, testament: 'ot' },
    { id: 'zephaniah', name: 'Zephaniah', chapters: 3, testament: 'ot' },
    { id: 'haggai', name: 'Haggai', chapters: 2, testament: 'ot' },
    { id: 'zechariah', name: 'Zechariah', chapters: 14, testament: 'ot' },
    { id: 'malachi', name: 'Malachi', chapters: 4, testament: 'ot' },
    { id: 'matthew', name: 'Matthew', chapters: 28, testament: 'nt' },
    { id: 'mark', name: 'Mark', chapters: 16, testament: 'nt' },
    { id: 'luke', name: 'Luke', chapters: 24, testament: 'nt' },
    { id: 'john', name: 'John', chapters: 21, testament: 'nt' },
    { id: 'acts', name: 'Acts', chapters: 28, testament: 'nt' },
    { id: 'romans', name: 'Romans', chapters: 16, testament: 'nt' },
    { id: '1-corinthians', name: '1 Corinthians', chapters: 16, testament: 'nt' },
    { id: '2-corinthians', name: '2 Corinthians', chapters: 13, testament: 'nt' },
    { id: 'galatians', name: 'Galatians', chapters: 6, testament: 'nt' },
    { id: 'ephesians', name: 'Ephesians', chapters: 6, testament: 'nt' },
    { id: 'philippians', name: 'Philippians', chapters: 4, testament: 'nt' },
    { id: 'colossians', name: 'Colossians', chapters: 4, testament: 'nt' },
    { id: '1-thessalonians', name: '1 Thessalonians', chapters: 5, testament: 'nt' },
    { id: '2-thessalonians', name: '2 Thessalonians', chapters: 3, testament: 'nt' },
    { id: '1-timothy', name: '1 Timothy', chapters: 6, testament: 'nt' },
    { id: '2-timothy', name: '2 Timothy', chapters: 4, testament: 'nt' },
    { id: 'titus', name: 'Titus', chapters: 3, testament: 'nt' },
    { id: 'philemon', name: 'Philemon', chapters: 1, testament: 'nt' },
    { id: 'hebrews', name: 'Hebrews', chapters: 13, testament: 'nt' },
    { id: 'james', name: 'James', chapters: 5, testament: 'nt' },
    { id: '1-peter', name: '1 Peter', chapters: 5, testament: 'nt' },
    { id: '2-peter', name: '2 Peter', chapters: 3, testament: 'nt' },
    { id: '1-john', name: '1 John', chapters: 5, testament: 'nt' },
    { id: '2-john', name: '2 John', chapters: 1, testament: 'nt' },
    { id: '3-john', name: '3 John', chapters: 1, testament: 'nt' },
    { id: 'jude', name: 'Jude', chapters: 1, testament: 'nt' },
    { id: 'revelation', name: 'Revelation', chapters: 22, testament: 'nt' },
  ];

  const BOOK_BY_ID = BOOK_METADATA.reduce((map, item) => {
    map[item.id] = item;
    return map;
  }, {});

  let syncInFlight = null;
  let stateSyncInFlight = null;

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

  function normalizeBookId(bookNameOrId) {
    if (!bookNameOrId) return '';
    const simplified = String(bookNameOrId)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');
    return simplified;
  }

  function broadcastProgress(state) {
    try {
      window.dispatchEvent(new CustomEvent('gtf:progress-sync', { detail: { state: { ...state } } }));
    } catch (error) {
      console.warn('Unable to broadcast progress update:', error);
    }
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
      link: entry.link || `study-plan.html?id=${encodeURIComponent(entry.id)}`,
    };

    return merged;
  }

  function normalizeCustomCollection(list) {
    if (!Array.isArray(list)) return [];
    const normalized = list
      .map(normalizeCustomEntry)
      .filter(Boolean);
    // Enforce a single custom entry; newest item wins.
    return normalized.slice(-1);
  }

  function mergeRemoteState(state, remoteState) {
    if (!remoteState || typeof remoteState !== 'object') return state;

    const remoteReading = remoteState.reading || {};
    const remoteStudies = remoteState.studies || {};

    state.reading = {
      ...DEFAULT_STATE.reading,
      ...remoteReading,
      bookChapters: {
        ...(DEFAULT_STATE.reading.bookChapters || {}),
        ...(remoteReading.bookChapters || {}),
      },
    };

    const normalizedCustom = normalizeCustomCollection(remoteStudies.custom);
    const completedMap = { ...(remoteStudies.completed || {}) };
    normalizedCustom.forEach((entry) => {
      if (typeof completedMap[entry.id] === 'undefined') {
        const stepsComplete = Array.isArray(entry.steps)
          ? entry.steps.every((step) => entry.stepsProgress && entry.stepsProgress[step.id])
          : false;
        completedMap[entry.id] = stepsComplete;
      }
    });

    state.studies = {
      completed: completedMap,
      custom: normalizedCustom,
    };

    recomputeTotalsFromBooks(state);
    return state;
  }

  function recomputeTotalsFromBooks(state) {
    if (!state || !state.reading) return state;
    let otChapters = 0;
    let ntChapters = 0;

    Object.entries(state.reading.bookChapters || {}).forEach(([bookId, chapters]) => {
      const meta = BOOK_BY_ID[bookId];
      if (!meta || !Array.isArray(chapters)) return;

      chapters.forEach((isComplete) => {
        if (isComplete) {
          if (meta.testament === 'nt') ntChapters += 1;
          else otChapters += 1;
        }
      });
    });

    state.reading.otChapters = otChapters;
    state.reading.ntChapters = ntChapters;
    return state;
  }

  function mergeRemoteProgress(state, progressRows) {
    if (!state || !Array.isArray(progressRows)) return state;

    state.reading.bookChapters = {};
    let otChapters = 0;
    let ntChapters = 0;

    progressRows.forEach((row) => {
      const bookId = normalizeBookId(row.book);
      const meta = BOOK_BY_ID[bookId];
      if (!meta) return;

      const chapterIndex = Number(row.chapter) - 1;
      if (Number.isNaN(chapterIndex) || chapterIndex < 0 || chapterIndex >= meta.chapters) return;

      const chapters = Array.isArray(state.reading.bookChapters[bookId])
        ? [...state.reading.bookChapters[bookId]]
        : Array(meta.chapters).fill(false);

      chapters[chapterIndex] = Boolean(row.completed);
      state.reading.bookChapters[bookId] = chapters;

      if (row.completed) {
        if (meta.testament === 'nt') ntChapters += 1;
        else otChapters += 1;
        if (row.completedDate) {
          state.reading.lastReadingDate = row.completedDate;
        }
      }
    });

    state.reading.otChapters = otChapters;
    state.reading.ntChapters = ntChapters;
    return state;
  }

  function syncFromServer(state) {
    if (!isSignedIn()) return state;
    if (syncInFlight) return state;

    const userId = getEmail();
    if (!userId) return state;

    syncInFlight = fetch(API_ENDPOINT, {
      headers: {
        'Content-Type': 'application/json',
        'x-gtf-user-id': userId,
      },
    })
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load saved progress');
        return response.json();
      })
      .then((payload) => {
        if (payload && Array.isArray(payload.progress)) {
          mergeRemoteProgress(state, payload.progress);
          saveState(state, { force: true });
          broadcastProgress(state);
        }
      })
      .catch((error) => {
        console.warn('Sync from server failed:', error);
      })
      .finally(() => {
        syncInFlight = null;
      });

    return state;
  }

  function syncPortalState(state) {
    if (!isSignedIn()) return state;
    if (stateSyncInFlight) return state;

    const userId = getEmail();
    if (!userId) return state;

    stateSyncInFlight = fetch(STATE_ENDPOINT, {
      headers: {
        'Content-Type': 'application/json',
        'x-gtf-user-id': userId,
      },
    })
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load saved portal state');
        return response.json();
      })
      .then((payload) => {
        if (payload && payload.state) {
          mergeRemoteState(state, payload.state);
          saveState(state, { force: true, skipRemote: true });
          broadcastProgress(state);
        }
      })
      .catch((error) => {
        console.warn('Sync portal state failed:', error);
      })
      .finally(() => {
        stateSyncInFlight = null;
      });

    return state;
  }

  function persistChapterUpdate(bookId, chapterIndex, completed) {
    if (!isSignedIn()) return;
    const userId = getEmail();
    const meta = BOOK_BY_ID[bookId];
    if (!userId || !meta || typeof chapterIndex !== 'number') return;

    const payload = {
      updates: [
        {
          book: meta.name,
          chapter: chapterIndex + 1,
          completed: Boolean(completed),
          completedDate: completed ? new Date().toISOString() : null,
        },
      ],
    };

    fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gtf-user-id': userId,
      },
      body: JSON.stringify(payload),
    }).catch((error) => {
      console.warn('Unable to persist chapter update:', error);
    });
  }

  function loadState() {
    const baseState = {
      reading: { ...DEFAULT_STATE.reading },
      studies: { completed: {}, custom: [] },
    };

    if (!isSignedIn()) return baseState;

    let hydratedState = { ...baseState };

    try {
      const raw = localStorage.getItem(storageKey());
      if (raw) {
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

        hydratedState = {
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
      }
    } catch (error) {
      console.warn('Portal data unavailable:', error);
    }

    syncPortalState(hydratedState);
    syncFromServer(hydratedState);

    return hydratedState;
  }

  function saveState(state, options = {}) {
    const force = Boolean(options.force);
    const skipRemote = Boolean(options.skipRemote);
    if (!isSignedIn() && !force) return state;
    try {
      localStorage.setItem(storageKey(), JSON.stringify(state));
    } catch (error) {
      console.warn('Unable to persist portal data:', error);
    }

    if (!skipRemote && isSignedIn()) {
      persistPortalState(state);
    }
    return state;
  }

  function sanitizeStateForServer(state) {
    if (!state || typeof state !== 'object') return DEFAULT_STATE;
    const sanitized = {
      reading: {
        ...DEFAULT_STATE.reading,
        ...(state.reading || {}),
        bookChapters: { ...(state.reading?.bookChapters || {}) },
      },
      studies: {
        completed: { ...(state.studies?.completed || {}) },
        custom: normalizeCustomCollection(state.studies?.custom),
      },
    };
    recomputeTotalsFromBooks(sanitized);
    return sanitized;
  }

  function persistPortalState(state) {
    const userId = getEmail();
    if (!userId) return;
    const payload = { state: sanitizeStateForServer(state) };

    fetch(STATE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gtf-user-id': userId,
      },
      body: JSON.stringify(payload),
    }).catch((error) => {
      console.warn('Unable to persist portal state:', error);
    });
  }

  function upsertCustomStudy(state, study) {
    if (!study || !study.id) return state;
    const normalizedStudy = normalizeCustomEntry({ ...study, stepsProgress: study.stepsProgress || {} });
    if (!normalizedStudy) return state;

    // Always keep a single custom plan, replacing any prior save.
    state.studies.custom = [normalizedStudy];
    state.studies.completed = { ...state.studies.completed, [normalizedStudy.id]: false };
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
    broadcastProgress(state);
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
    broadcastProgress(state);
    persistChapterUpdate(bookId, chapterIndex, current[chapterIndex]);
    return state;
  }

  function clampNumber(value, min, max) {
    const num = Number(value) || 0;
    if (num < min) return min;
    if (num > max) return max;
    return Math.floor(num);
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

    saveState(state, { force: true });
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
    toggleCustomStep,
    removeCustomStudy,
    renameCustomStudy,
    addCustomStudy,
    getCustomStudy,
    exportState,
  };
})();
