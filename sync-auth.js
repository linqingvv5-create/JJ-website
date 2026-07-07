(function () {
  const tokenStorageKey = "linqing-cloud-sync-token";
  const originalFetch = window.fetch.bind(window);

  function isApiRequest(input) {
    try {
      const rawUrl = typeof input === "string" ? input : input && typeof input.url === "string" ? input.url : "";
      const url = new URL(rawUrl, window.location.origin);
      return url.origin === window.location.origin && url.pathname.startsWith("/api/");
    } catch (error) {
      return false;
    }
  }

  function readStoredToken() {
    try {
      return String(window.localStorage.getItem(tokenStorageKey) || "").trim();
    } catch (error) {
      return "";
    }
  }

  function saveToken(token) {
    try {
      if (!token) {
        window.localStorage.removeItem(tokenStorageKey);
        return;
      }

      window.localStorage.setItem(tokenStorageKey, token);
    } catch (error) {
      // Ignore storage failures and fall back to in-memory fetch only.
    }
  }

  function attachToken(init, token) {
    const headers = new Headers((init && init.headers) || {});
    if (token) {
      headers.set("x-app-sync-token", token);
    }

    return {
      ...(init || {}),
      headers,
    };
  }

  async function retryWithPrompt(input, init) {
    const nextToken = window.prompt("请输入你的同步密码，用来连接云端保存。");
    if (!nextToken) {
      return null;
    }

    saveToken(nextToken.trim());
    return originalFetch(input, attachToken(init, nextToken.trim()));
  }

  window.fetch = async function patchedFetch(input, init) {
    if (!isApiRequest(input)) {
      return originalFetch(input, init);
    }

    const storedToken = readStoredToken();
    let response = await originalFetch(input, attachToken(init, storedToken));

    if (response.status !== 401) {
      return response;
    }

    const retriedResponse = await retryWithPrompt(input, init);
    if (!retriedResponse) {
      return response;
    }

    response = retriedResponse;
    if (response.status !== 401) {
      return response;
    }

    saveToken("");
    window.alert("同步密码不正确，请稍后再试。");
    return response;
  };
})();
