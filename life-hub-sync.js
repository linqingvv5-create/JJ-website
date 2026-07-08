(function () {
  const MODULE_ID = "jj-life-hub";
  const MODULE_URL = `/api/modules/${MODULE_ID}`;
  const STORAGE_KEY = "jj_life_hub_state_v1";
  const POLL_INTERVAL_MS = 45000;
  const SAVE_DEBOUNCE_MS = 1000;

  let lastKnownRevision = 0;
  let lastSerializedState = "";
  let bootstrapped = false;
  let applyingRemoteState = false;
  let pushTimer = null;
  let pushInFlight = false;
  let queuedPush = false;

  function emitStatus(mode, savedAt) {
    window.dispatchEvent(new CustomEvent("life-hub-sync-status", {
      detail: {
        mode,
        savedAt: savedAt || ""
      }
    }));
  }

  function emitStateUpdated() {
    window.dispatchEvent(new Event("life-hub-state-updated"));
  }

  function normalizeState(rawState) {
    if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
      return {};
    }
    return rawState;
  }

  function collectLocalState() {
    const rawValue = localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return {
        state: {},
        hasAnyValue: false,
        serialized: "{}"
      };
    }

    try {
      const parsed = normalizeState(JSON.parse(rawValue));
      return {
        state: parsed,
        hasAnyValue: Object.keys(parsed).length > 0,
        serialized: JSON.stringify(parsed)
      };
    } catch (error) {
      return {
        state: {},
        hasAnyValue: false,
        serialized: "{}"
      };
    }
  }

  function applyRemoteState(nextState) {
    const normalizedState = normalizeState(nextState);
    applyingRemoteState = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedState));
    } finally {
      applyingRemoteState = false;
    }

    lastSerializedState = JSON.stringify(normalizedState);
    emitStateUpdated();
  }

  async function requestModule(method, body) {
    const response = await fetch(MODULE_URL, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return response.json();
  }

  async function pullRemoteState() {
    const remote = await requestModule("GET");
    const remoteRevision = Number(remote.revision) || 0;
    const remoteState = normalizeState(remote.state);
    const remoteSerialized = JSON.stringify(remoteState);

    if (remoteRevision > lastKnownRevision && remoteSerialized !== lastSerializedState) {
      applyRemoteState(remoteState);
    }

    lastKnownRevision = Math.max(lastKnownRevision, remoteRevision);
    if (!lastSerializedState) {
      lastSerializedState = remoteSerialized;
    }

    emitStatus("online", remote.savedAt);
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
    emitStatus("syncing", "");

    try {
      const remote = await requestModule("POST", { state: snapshot.state });
      lastKnownRevision = Number(remote.revision) || 0;
      lastSerializedState = snapshot.serialized;
      emitStatus("online", remote.savedAt);
    } catch (error) {
      queuedPush = true;
      emitStatus("offline", "");
      console.warn("[life-hub-sync] push failed", error);
    } finally {
      pushInFlight = false;
    }

    if (queuedPush) {
      schedulePush(250);
    }
  }

  function schedulePush(delay) {
    if (applyingRemoteState) {
      return;
    }

    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushLocalState().catch((error) => {
        queuedPush = true;
        emitStatus("offline", "");
        console.warn("[life-hub-sync] delayed push failed", error);
      });
    }, delay || SAVE_DEBOUNCE_MS);
  }

  function handleLocalMutation(key) {
    if (String(key || "") !== STORAGE_KEY || applyingRemoteState) {
      return;
    }

    if (!bootstrapped) {
      queuedPush = true;
      return;
    }

    schedulePush(SAVE_DEBOUNCE_MS);
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
        schedulePush(SAVE_DEBOUNCE_MS);
      }
    };
  }

  async function bootstrapSync() {
    const localSnapshot = collectLocalState();
    emitStatus("checking", "");

    try {
      const remote = await requestModule("GET");
      const remoteRevision = Number(remote.revision) || 0;
      const remoteState = normalizeState(remote.state);
      const remoteSerialized = JSON.stringify(remoteState);
      const remoteHasData = Object.keys(remoteState).length > 0;

      lastKnownRevision = remoteRevision;

      if (remoteHasData) {
        if (remoteSerialized !== localSnapshot.serialized) {
          applyRemoteState(remoteState);
        } else {
          lastSerializedState = remoteSerialized;
        }
        emitStatus("online", remote.savedAt);
      } else if (localSnapshot.hasAnyValue) {
        lastSerializedState = localSnapshot.serialized;
      } else {
        lastSerializedState = remoteSerialized;
        emitStatus("online", remote.savedAt);
      }
    } catch (error) {
      lastSerializedState = localSnapshot.serialized;
      emitStatus("offline", "");
      console.warn("[life-hub-sync] initial sync failed", error);
    }

    bootstrapped = true;

    if (queuedPush || (collectLocalState().hasAnyValue && lastKnownRevision === 0 && lastSerializedState)) {
      schedulePush(200);
    }
  }

  installStorageHooks();

  bootstrapSync().catch((error) => {
    bootstrapped = true;
    emitStatus("offline", "");
    console.warn("[life-hub-sync] bootstrap failed", error);
  });

  window.addEventListener("online", () => {
    schedulePush(200);
    pullRemoteState().catch((error) => {
      emitStatus("offline", "");
      console.warn("[life-hub-sync] online pull failed", error);
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      pullRemoteState().catch((error) => {
        emitStatus("offline", "");
        console.warn("[life-hub-sync] visibility pull failed", error);
      });
    }
  });

  window.addEventListener("focus", () => {
    pullRemoteState().catch((error) => {
      emitStatus("offline", "");
      console.warn("[life-hub-sync] focus pull failed", error);
    });
  });

  setInterval(() => {
    if (!document.hidden) {
      pullRemoteState().catch((error) => {
        emitStatus("offline", "");
        console.warn("[life-hub-sync] polling pull failed", error);
      });
    }
  }, POLL_INTERVAL_MS);
})();
