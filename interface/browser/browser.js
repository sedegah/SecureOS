(() => {
  "use strict";

  function createStandaloneBrowser() {
    let nextId = 1;
    let tabs = [
      { id: nextId++, title: "Surge Start", url: "", loading: false, canBack: false, canForward: false, error: "" }
    ];
    let activeId = 1;
    let downloadCount = 0;
    const subscribers = new Set();
    const notify = () => {
      const state = { tabs: [...tabs], activeId, downloadCount };
      for (const sub of subscribers) sub(state);
      return state;
    };
    return {
      state: async () => ({ tabs: [...tabs], activeId, downloadCount }),
      command: async (action, payload = {}) => {
        if (action === "newTab") {
          const id = nextId++;
          tabs.push({ id, title: payload.url || "New tab", url: payload.url || "", loading: false, canBack: false, canForward: false, error: "" });
          activeId = id;
        } else if (action === "selectTab") {
          activeId = payload.id;
        } else if (action === "closeTab") {
          tabs = tabs.filter(t => t.id !== payload.id);
          if (activeId === payload.id) activeId = tabs[tabs.length - 1]?.id || null;
          if (!tabs.length) {
            const id = nextId++;
            tabs.push({ id, title: "New tab", url: "", loading: false, canBack: false, canForward: false, error: "" });
            activeId = id;
          }
        } else if (action === "navigate") {
          const tab = tabs.find(t => t.id === activeId);
          if (tab) {
            tab.url = payload.url;
            try { tab.title = payload.url ? new URL(payload.url, location.href).hostname : "New tab"; }
            catch { tab.title = payload.url; }
            tab.canBack = true;
          }
        } else if (action === "back") {
          const tab = tabs.find(t => t.id === activeId);
          if (tab) tab.canBack = false;
        } else if (action === "forward") {
          const tab = tabs.find(t => t.id === activeId);
          if (tab) tab.canForward = false;
        } else if (action === "workspace") {
          window.location.href = "/#/home";
        } else if (action === "downloads") {
          window.location.href = "/#/downloads";
        } else if (action === "bookmark") {
          const tab = tabs.find(t => t.id === activeId);
          if (tab && tab.url) {
            try {
              const { addItem } = await import("/modules/bookmarks.js");
              await addItem({ title: tab.title, url: tab.url });
            } catch {}
          }
        }
        return notify();
      },
      subscribe: (callback) => {
        subscribers.add(callback);
        callback({ tabs: [...tabs], activeId, downloadCount });
        return () => subscribers.delete(callback);
      }
    };
  }

  const api = window.surgeBrowser || createStandaloneBrowser();
  const byId = (id) => document.getElementById(id);
  const elements = {
    tabs: byId("tab-list"),
    template: byId("tab-template"),
    newTab: byId("new-tab"),
    back: byId("back"),
    forward: byId("forward"),
    reload: byId("reload-stop"),
    reloadIcon: byId("reload-icon"),
    addressForm: byId("address-form"),
    address: byId("address"),
    go: byId("go"),
    bookmark: byId("bookmark"),
    workspace: byId("workspace"),
    downloads: byId("downloads"),
    downloadCount: byId("download-count"),
    status: byId("status"),
    startPage: byId("start-page"),
    startForm: byId("start-form"),
    startAddress: byId("start-address"),
    startGo: byId("start-go"),
  };
  const connected = Boolean(api && typeof api.command === "function"
    && typeof api.subscribe === "function" && typeof api.state === "function");
  const tabElements = new Map();
  let currentState = { tabs: [], activeId: null, downloadCount: 0 };
  let addressDirty = false;
  let commandError = "";
  let revision = 0;
  let commandSequence = 0;
  let refreshSequence = 0;
  let unsubscribe;

  const activeTab = () => currentState.tabs.find((tab) => tab.id === currentState.activeId);
  const isState = (value) => Boolean(value && Array.isArray(value.tabs));
  const errorText = (error) => {
    if (!error) return "";
    if (typeof error === "string") return error;
    return typeof error.message === "string" ? error.message : "The browser could not complete this action.";
  };

  function renderStatus() {
    const message = commandError || errorText(activeTab()?.error);
    elements.status.textContent = message;
    elements.status.title = message;
  }

  function renderAddress() {
    if (document.activeElement !== elements.address && !addressDirty) {
      elements.address.value = activeTab()?.url || "";
    }
  }

  function renderTabs() {
    const liveIds = new Set(currentState.tabs.map((tab) => tab.id));
    for (const [id, node] of tabElements) {
      if (!liveIds.has(id)) {
        node.remove();
        tabElements.delete(id);
      }
    }
    currentState.tabs.forEach((tab, index) => {
      let node = tabElements.get(tab.id);
      if (!node) {
        node = elements.template.content.firstElementChild.cloneNode(true);
        node.querySelector(".tab-select").addEventListener("click", () => {
          void runCommand("selectTab", { id: tab.id });
        });
        node.querySelector(".tab-close").addEventListener("click", async () => {
          const result = await runCommand("closeTab", { id: tab.id });
          if (result && !result.error && !node.isConnected) {
            tabElements.get(currentState.activeId)?.querySelector(".tab-select").focus();
          }
        });
        tabElements.set(tab.id, node);
      }
      const selected = tab.id === currentState.activeId;
      const title = String(tab.title || tab.url || "New tab");
      const select = node.querySelector(".tab-select");
      const close = node.querySelector(".tab-close");
      node.classList.toggle("active", selected);
      node.classList.toggle("loading", Boolean(tab.loading));
      node.querySelector(".tab-title").textContent = title;
      select.setAttribute("aria-selected", String(selected));
      select.setAttribute("aria-label", tab.loading ? `${title}, loading` : title);
      select.tabIndex = selected ? 0 : -1;
      select.title = tab.url ? `${title}\n${tab.url}` : title;
      close.setAttribute("aria-label", `Close ${title}`);
      close.title = `Close ${title}`;
      if (elements.tabs.children[index] !== node) {
        elements.tabs.insertBefore(node, elements.tabs.children[index] || null);
      }
    });
  }

  function render() {
    const tab = activeTab();
    const hasPage = Boolean(tab && tab.url);
    renderTabs();
    renderAddress();
    elements.newTab.disabled = !connected;
    elements.back.disabled = !connected || !tab?.canBack;
    elements.forward.disabled = !connected || !tab?.canForward;
    elements.reload.disabled = !connected || !(hasPage || tab?.loading);
    const reloadLabel = tab?.loading ? "Stop loading" : "Reload";
    elements.reload.setAttribute("aria-label", reloadLabel);
    elements.reload.title = tab?.loading ? reloadLabel : "Reload (Ctrl+R)";
    elements.reloadIcon.setAttribute("href", tab?.loading ? "#icon-stop" : "#icon-reload");
    elements.address.disabled = !connected || !tab;
    elements.go.disabled = elements.address.disabled;
    elements.bookmark.disabled = !connected || !hasPage;
    elements.workspace.disabled = !connected;
    elements.downloads.disabled = !connected;
    const count = Number.isFinite(currentState.downloadCount)
      ? Math.max(0, Math.floor(currentState.downloadCount)) : 0;
    elements.downloadCount.textContent = String(count);
    elements.downloadCount.hidden = count === 0;
    elements.downloads.setAttribute("aria-label", count ? `Open downloads (${count})` : "Open downloads");
    elements.downloads.title = count ? `Open downloads (${count})` : "Open downloads";
    elements.startPage.hidden = hasPage;
    elements.startAddress.disabled = !connected;
    elements.startGo.disabled = !connected;
    renderStatus();
  }

  function applyState(nextState) {
    if (!isState(nextState)) return;
    const previous = activeTab();
    const previousId = currentState.activeId;
    currentState = nextState;
    revision += 1;
    const tab = activeTab();
    if (previousId !== currentState.activeId || previous?.url !== tab?.url) {
      commandError = "";
    }
    if (previousId !== currentState.activeId) {
      elements.startAddress.value = "";
      if (document.activeElement !== elements.address) addressDirty = false;
    }
    render();
    if (previousId !== currentState.activeId) {
      tabElements.get(currentState.activeId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  async function refreshState() {
    const request = ++refreshSequence;
    const startedAt = revision;
    try {
      const state = await api.state();
      if (request === refreshSequence && startedAt === revision) applyState(state);
    } catch (error) {
      if (request === refreshSequence && startedAt === revision) {
        commandError = errorText(error);
        renderStatus();
      }
    }
  }

  async function runCommand(action, payload = {}) {
    if (!connected) return null;
    const request = ++commandSequence;
    const startedAt = revision;
    commandError = "";
    renderStatus();
    try {
      const result = await api.command(action, payload);
      // Subscription updates can be newer than this command's response.
      if (startedAt === revision && isState(result)) applyState(result);
      if (request === commandSequence && result?.error) {
        commandError = errorText(result.error);
        renderStatus();
      }
      return result;
    } catch (error) {
      if (request === commandSequence) {
        commandError = errorText(error);
        renderStatus();
      }
      return null;
    }
  }

  function focusAddress() {
    if (elements.address.disabled) return;
    elements.address.focus();
    elements.address.select();
  }

  async function newTab() {
    addressDirty = false;
    elements.address.blur();
    await runCommand("newTab", {});
    focusAddress();
  }

  function navigateFrom(input) {
    const url = input.value.trim();
    if (!url || !connected) {
      input.focus();
      return;
    }
    addressDirty = false;
    void runCommand(activeTab() ? "navigate" : "newTab", { url });
  }

  elements.newTab.addEventListener("click", () => { void newTab(); });
  elements.back.addEventListener("click", () => { void runCommand("back"); });
  elements.forward.addEventListener("click", () => { void runCommand("forward"); });
  elements.reload.addEventListener("click", () => {
    void runCommand(activeTab()?.loading ? "stop" : "reload");
  });
  elements.bookmark.addEventListener("click", () => { void runCommand("bookmark"); });
  elements.workspace.addEventListener("click", () => { void runCommand("workspace"); });
  elements.downloads.addEventListener("click", () => { void runCommand("downloads"); });
  elements.addressForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!elements.go.disabled) navigateFrom(elements.address);
  });
  elements.startForm.addEventListener("submit", (event) => {
    event.preventDefault();
    navigateFrom(elements.startAddress);
  });
  elements.address.addEventListener("input", () => { addressDirty = true; });
  elements.address.addEventListener("blur", renderAddress);
  elements.address.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      addressDirty = false;
      elements.address.value = activeTab()?.url || "";
      elements.address.select();
    }
  });
  elements.startAddress.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      elements.startAddress.value = "";
    }
  });

  elements.tabs.addEventListener("keydown", async (event) => {
    if (!event.target.matches(".tab-select") || event.altKey || event.ctrlKey || event.metaKey) return;
    const tabs = currentState.tabs;
    const index = tabs.findIndex((tab) => tab.id === currentState.activeId);
    let target;
    if (event.key === "ArrowLeft") target = tabs[(index - 1 + tabs.length) % tabs.length];
    else if (event.key === "ArrowRight") target = tabs[(index + 1) % tabs.length];
    else if (event.key === "Home") target = tabs[0];
    else if (event.key === "End") target = tabs[tabs.length - 1];
    if (!target) return;
    event.preventDefault();
    await runCommand("selectTab", { id: target.id });
    tabElements.get(currentState.activeId)?.querySelector(".tab-select").focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || !connected) return;
    const key = event.key.toLowerCase();
    const tab = activeTab();
    if (event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      if (!["l", "t", "w", "r"].includes(key)) return;
      event.preventDefault();
      if (key === "l") focusAddress();
      else if (key === "t" && !event.repeat) void newTab();
      else if (key === "w" && tab && !event.repeat) void runCommand("closeTab", { id: tab.id });
      else if (key === "r" && tab?.url) void runCommand("reload");
    } else if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
      if (key !== "arrowleft" && key !== "arrowright") return;
      event.preventDefault();
      if (key === "arrowleft" && tab?.canBack) void runCommand("back");
      if (key === "arrowright" && tab?.canForward) void runCommand("forward");
    }
  });

  render();
  if (connected) {
    try {
      unsubscribe = api.subscribe((state) => {
        if (isState(state)) applyState(state);
        else void refreshState();
      });
    } catch (error) {
      commandError = errorText(error);
      renderStatus();
    }
    void refreshState();
  } else {
    commandError = "Browser controls are unavailable. Open this window through Surge Browser.";
    renderStatus();
  }
  window.addEventListener("beforeunload", () => {
    if (typeof unsubscribe === "function") unsubscribe();
  }, { once: true });
})();
