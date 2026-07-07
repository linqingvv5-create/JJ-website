(function () {
  const MODULE_ID = "jj-fitness";
  const MODULE_URL = `/api/modules/${MODULE_ID}`;
  const POLL_INTERVAL_MS = 45000;
  const SAVE_DEBOUNCE_MS = 1200;
  const STORAGE_KEYS = [
    "jj_wake_logs",
    "jj_logs",
    "jj_settings",
    "jj_wake",
    "jj_weight_logs",
    "jj_move_notes",
    "jj_circumference",
    "jj_photos",
  ];
  const STORAGE_KEY_SET = new Set(STORAGE_KEYS);

  let lastKnownRevision = 0;
  let lastSerializedState = "";
  let bootstrapped = false;
  let applyingRemoteState = false;
  let pushTimer = null;
  let pushInFlight = false;
  let queuedPush = false;

  function normalizeRemoteState(rawState) {
    const nextState = {};
    if (!rawState || typeof rawState !== "object") {
      return nextState;
    }

    for (const key of STORAGE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(rawState, key)) {
        continue;
      }

      const value = rawState[key];
      if (typeof value === "string") {
        nextState[key] = value;
      } else if (value != null) {
        nextState[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
      }
    }

    return nextState;
  }

  function collectLocalState() {
    const state = {};
    let hasAnyValue = false;

    for (const key of STORAGE_KEYS) {
      const value = localStorage.getItem(key);
      if (value === null) {
        continue;
      }

      hasAnyValue = true;
      state[key] = value;
    }

    return {
      state,
      hasAnyValue,
      serialized: JSON.stringify(state),
    };
  }

  function refreshCurrentView() {
    try {
      load();
      currentDay = getTodayIndex();
      if (userSettings && userSettings.periodStart) {
        periodStart = userSettings.periodStart;
      }
    } catch (error) {
      console.warn("[fitness-sync] reload failed", error);
    }

    try {
      const visiblePage = document.querySelector('[id^="page"]:not(.hide)')?.id || "pageHome";

      if (visiblePage === "pageFitness") {
        renderFitness();
        return;
      }
      if (visiblePage === "pageCircumference") {
        renderCircumference();
        return;
      }
      if (visiblePage === "pagePhotos") {
        renderPhotoGallery();
        return;
      }

      renderHome();
    } catch (error) {
      console.warn("[fitness-sync] render failed", error);
    }
  }

  function applyRemoteState(nextState) {
    const normalizedState = normalizeRemoteState(nextState);

    applyingRemoteState = true;
    try {
      for (const key of STORAGE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(normalizedState, key)) {
          localStorage.setItem(key, normalizedState[key]);
        } else {
          localStorage.removeItem(key);
        }
      }
    } finally {
      applyingRemoteState = false;
    }

    lastSerializedState = JSON.stringify(normalizedState);
    refreshCurrentView();
  }

  async function requestModule(method, body) {
    const response = await fetch(MODULE_URL, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return response.json();
  }

  async function pullRemoteState() {
    const remote = await requestModule("GET");
    const remoteRevision = Number(remote.revision) || 0;
    const remoteState = normalizeRemoteState(remote.state);
    const remoteSerialized = JSON.stringify(remoteState);

    if (remoteRevision > lastKnownRevision && remoteSerialized !== lastSerializedState) {
      applyRemoteState(remoteState);
    }

    lastKnownRevision = Math.max(lastKnownRevision, remoteRevision);
    if (!lastSerializedState) {
      lastSerializedState = remoteSerialized;
    }
  }

  async function pushLocalState() {
    if (!bootstrapped) {
      queuedPush = true;
      return;
    }

    if (pushInFlight) {
      queuedPush = true;
      return;
    }

    const snapshot = collectLocalState();
    if (snapshot.serialized === lastSerializedState && lastKnownRevision > 0) {
      queuedPush = false;
      return;
    }

    pushInFlight = true;
    queuedPush = false;
    try {
      const remote = await requestModule("POST", { state: snapshot.state });
      lastKnownRevision = Number(remote.revision) || 0;
      lastSerializedState = snapshot.serialized;
    } catch (error) {
      queuedPush = true;
      console.warn("[fitness-sync] push failed", error);
    } finally {
      pushInFlight = false;
    }

    if (queuedPush) {
      schedulePush(250);
    }
  }

  function schedulePush(delay = SAVE_DEBOUNCE_MS) {
    if (applyingRemoteState) {
      return;
    }

    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushLocalState().catch((error) => {
        queuedPush = true;
        console.warn("[fitness-sync] delayed push failed", error);
      });
    }, delay);
  }

  function handleLocalMutation(key) {
    if (!STORAGE_KEY_SET.has(String(key || "")) || applyingRemoteState) {
      return;
    }

    if (!bootstrapped) {
      queuedPush = true;
      return;
    }

    schedulePush();
  }

  function installStorageHooks() {
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);
    const originalClear = localStorage.clear.bind(localStorage);

    localStorage.setItem = function (key, value) {
      originalSetItem(key, value);
      handleLocalMutation(key);
    };

    localStorage.removeItem = function (key) {
      originalRemoveItem(key);
      handleLocalMutation(key);
    };

    localStorage.clear = function () {
      originalClear();
      if (!applyingRemoteState) {
        schedulePush();
      }
    };
  }

  async function bootstrapSync() {
    const localSnapshot = collectLocalState();

    try {
      const remote = await requestModule("GET");
      const remoteRevision = Number(remote.revision) || 0;
      const remoteState = normalizeRemoteState(remote.state);
      const remoteSerialized = JSON.stringify(remoteState);
      const remoteHasData = Object.keys(remoteState).length > 0;

      lastKnownRevision = remoteRevision;

      if (remoteHasData) {
        if (remoteSerialized !== localSnapshot.serialized) {
          applyRemoteState(remoteState);
        } else {
          lastSerializedState = remoteSerialized;
        }
      } else if (localSnapshot.hasAnyValue) {
        lastSerializedState = localSnapshot.serialized;
      } else {
        lastSerializedState = remoteSerialized;
      }
    } catch (error) {
      lastSerializedState = localSnapshot.serialized;
      console.warn("[fitness-sync] initial sync failed", error);
    }

    bootstrapped = true;

    if (queuedPush || (collectLocalState().hasAnyValue && lastKnownRevision === 0 && lastSerializedState)) {
      schedulePush(200);
    }
  }

  installStorageHooks();

  bootstrapSync().catch((error) => {
    bootstrapped = true;
    console.warn("[fitness-sync] bootstrap failed", error);
  });

  window.addEventListener("online", () => {
    schedulePush(200);
    pullRemoteState().catch((error) => {
      console.warn("[fitness-sync] online pull failed", error);
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      pullRemoteState().catch((error) => {
        console.warn("[fitness-sync] visibility pull failed", error);
      });
    }
  });

  window.addEventListener("focus", () => {
    pullRemoteState().catch((error) => {
      console.warn("[fitness-sync] focus pull failed", error);
    });
  });

  setInterval(() => {
    if (!document.hidden) {
      pullRemoteState().catch((error) => {
        console.warn("[fitness-sync] polling pull failed", error);
      });
    }
  }, POLL_INTERVAL_MS);
})();
