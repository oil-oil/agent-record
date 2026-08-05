// Agent Record 扩展只负责把网页事件桥接到本地录制服务。
const SERVICE_ORIGIN = "http://127.0.0.1:43127";
const STATUS_URL = `${SERVICE_ORIGIN}/v1/status`;
const EVENTS_URL = `${SERVICE_ORIGIN}/v1/events`;
const TARGET_URL = `${SERVICE_ORIGIN}/v1/target`;
const FAIL_URL = `${SERVICE_ORIGIN}/v1/fail`;
const MAX_PENDING_EVENTS = 20_000;
const BATCH_SIZE = 500;
const FLUSH_DELAY_MS = 32;
const RETRY_DELAY_MS = 250;
const ACTIVE_TAB_CACHE_MS = 250;

const extensionId = chrome.runtime.id;
const extensionOrigin = new URL(chrome.runtime.getURL("")).origin;
const extensionHeaders = {
  "x-agent-record-extension-id": extensionId,
};
const popupUrl = chrome.runtime.getURL("popup.html");
const state = {
  recording: false,
  state: "idle",
  startedAt: 0,
  sessionId: "",
  eventToken: "",
  targetToken: "",
  targetWindowId: null,
  targetTabId: null,
  eventCount: 0,
  droppedEvents: 0,
  error: "",
};

let pendingEvents = [];
let statusPromise = null;
let flushPromise = null;
let flushTimer = null;
let activeTabCheck = { windowId: null, tabId: null, checkedAt: 0, active: false };

function isExtensionSender(sender) {
  return sender?.id === extensionId;
}

function isExtensionPageSender(sender) {
  return isExtensionSender(sender) && sender.url === popupUrl && !sender.tab;
}

function isHttpTabSender(sender) {
  return isExtensionSender(sender) &&
    Number.isInteger(sender.tab?.id) &&
    /^https?:/.test(sender.tab?.url || "");
}

function idleStatus(error = "") {
  return {
    recording: false,
    state: "idle",
    startedAt: 0,
    sessionId: "",
    eventToken: "",
    eventCount: 0,
    droppedEvents: state.droppedEvents,
    ...(error ? { error } : {}),
  };
}

function publicStatus() {
  return {
    recording: state.recording,
    state: state.state,
    startedAt: state.startedAt,
    sessionId: state.sessionId,
    eventToken: state.eventToken,
    eventCount: state.eventCount,
    droppedEvents: state.droppedEvents,
    ...(state.targetToken ? { targetToken: state.targetToken } : {}),
    ...(state.error ? { error: state.error } : {}),
  };
}

function validateServiceResponse(response) {
  if (!response || !response.ok) {
    throw new Error(`本地录制服务响应失败（HTTP ${response?.status || "网络错误"}）`);
  }
  if (response.url && new URL(response.url).origin !== SERVICE_ORIGIN) {
    throw new Error("本地录制服务响应来源无效");
  }
  const allowedOrigin = response.headers.get("x-agent-record-extension-origin");
  if (allowedOrigin !== extensionOrigin) {
    throw new Error("本地录制服务拒绝扩展来源");
  }
}

function normalizeStatus(value) {
  if (!value || typeof value !== "object") throw new Error("本地录制服务返回了无效状态");
  return {
    recording: value.recording === true,
    state: typeof value.state === "string"
      ? value.state
      : value.recording === true ? "recording" : "idle",
    startedAt: Number(value.startedAt) || 0,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : "",
    eventToken: typeof value.eventToken === "string" ? value.eventToken : "",
    targetToken: typeof value.targetToken === "string" ? value.targetToken : "",
    eventCount: Math.max(0, Number(value.eventCount) || 0),
    droppedEvents: Math.max(0, Number(value.droppedEvents) || 0),
    ...(typeof value.error === "string" && value.error ? { error: value.error } : {}),
  };
}

function applyStatus(value) {
  const next = normalizeStatus(value);
  const sessionChanged = next.sessionId !== state.sessionId;
  Object.assign(state, next, { error: next.error || "" });
  if (sessionChanged) {
    state.targetWindowId = null;
    state.targetTabId = null;
  }
  if (!state.recording || sessionChanged) {
    if (pendingEvents.length) {
      state.droppedEvents += pendingEvents.length;
      pendingEvents = [];
    }
  }
  return publicStatus();
}

async function fetchStatus() {
  const response = await fetch(STATUS_URL, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    headers: extensionHeaders,
  });
  validateServiceResponse(response);
  return applyStatus(await response.json());
}

function refreshStatus() {
  if (!statusPromise) {
    statusPromise = fetchStatus()
      .catch((error) => {
        Object.assign(state, idleStatus(error?.message || "本地录制服务不可用"));
        return publicStatus();
      })
      .finally(() => {
        statusPromise = null;
      });
  }
  return statusPromise;
}

async function isFocusedActiveTab(sender) {
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) return false;
  const focusedWindow = await chrome.windows.getLastFocused();
  if (focusedWindow?.id !== windowId) return false;
  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  return activeTab?.id === tabId;
}

function normalizePagePayload(message) {
  const page = message?.page && typeof message.page === "object" ? message.page : {};
  const viewport = page.viewport && typeof page.viewport === "object" ? page.viewport : {};
  return {
    url: typeof page.url === "string" ? page.url : "",
    title: typeof page.title === "string" ? page.title.slice(0, 160) : "",
    viewport: {
      width: Math.max(1, Number(viewport.width) || 1),
      height: Math.max(1, Number(viewport.height) || 1),
      devicePixelRatio: Math.max(0.1, Number(viewport.devicePixelRatio) || 1),
    },
    screen: {
      x: Number(page.screen?.x) || 0,
      y: Number(page.screen?.y) || 0,
      outerWidth: Math.max(1, Number(page.screen?.outerWidth) || 1),
      outerHeight: Math.max(1, Number(page.screen?.outerHeight) || 1),
      innerWidth: Math.max(1, Number(page.screen?.innerWidth) || Number(viewport.width) || 1),
      innerHeight: Math.max(1, Number(page.screen?.innerHeight) || Number(viewport.height) || 1),
    },
  };
}

async function submitTarget(sender, message, targetToken) {
  if (!(await isFocusedActiveTab(sender))) {
    throw new Error("只能由目标窗口当前活动标签页注册录制目标");
  }
  const windowInfo = await chrome.windows.get(sender.tab.windowId);
  const response = await fetch(TARGET_URL, {
    method: "POST",
    mode: "cors",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    headers: {
      ...extensionHeaders,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      targetToken,
      window: {
        x: Number(windowInfo?.left) || 0,
        y: Number(windowInfo?.top) || 0,
        width: Math.max(1, Number(windowInfo?.width) || 1),
        height: Math.max(1, Number(windowInfo?.height) || 1),
      },
      tab: {
        id: sender.tab.id,
        windowId: sender.tab.windowId,
      },
      page: normalizePagePayload(message),
    }),
  });
  validateServiceResponse(response);
  state.targetWindowId = sender.tab.windowId;
  state.targetTabId = sender.tab.id;
  return true;
}

async function postEvents(events, eventToken) {
  const response = await fetch(EVENTS_URL, {
    method: "POST",
    mode: "cors",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    headers: {
      ...extensionHeaders,
      "content-type": "application/json",
      "x-agent-record-session-token": eventToken,
    },
    body: JSON.stringify({ events }),
  });
  validateServiceResponse(response);
  return response;
}

async function failRecording(code, message) {
  if (!state.eventToken) return;
  try {
    const response = await fetch(FAIL_URL, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: {
        ...extensionHeaders,
        "content-type": "application/json",
        "x-agent-record-session-token": state.eventToken,
      },
      body: JSON.stringify({ code, message }),
    });
    validateServiceResponse(response);
  } catch {
    // 本地服务可能已经退出，保留扩展侧错误供状态页读取。
  }
}

function scheduleFlush(delay = FLUSH_DELAY_MS) {
  if (flushTimer || flushPromise || !pendingEvents.length) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushEvents().catch(() => {
      scheduleFlush(RETRY_DELAY_MS);
    });
  }, delay);
}

async function flushEvents() {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    while (pendingEvents.length && state.recording && state.eventToken) {
      const batch = pendingEvents.splice(0, BATCH_SIZE);
      try {
        await postEvents(batch, state.eventToken);
      } catch (error) {
        pendingEvents.unshift(...batch);
        state.error = error?.message || "事件发送失败";
        throw error;
      }
    }
    return true;
  })().finally(() => {
    flushPromise = null;
    if (pendingEvents.length && state.recording && state.eventToken) {
      scheduleFlush();
    }
  });
  return flushPromise;
}

async function isActiveTarget(sender) {
  const now = Date.now();
  const sameTarget =
    activeTabCheck.windowId === sender.tab.windowId &&
    activeTabCheck.tabId === sender.tab.id;
  if (sameTarget && now - activeTabCheck.checkedAt < ACTIVE_TAB_CACHE_MS) {
    return activeTabCheck.active;
  }
  const active = await isFocusedActiveTab(sender);
  activeTabCheck = {
    windowId: sender.tab.windowId,
    tabId: sender.tab.id,
    checkedAt: now,
    active,
  };
  return active;
}

async function acceptEvent(event, sender) {
  const status = state.recording ? publicStatus() : await refreshStatus();
  if (!status.recording || !status.eventToken || state.targetWindowId === null) {
    throw new Error(status.error || "当前没有正在进行的录制");
  }
  if (
    sender.tab.windowId !== state.targetWindowId ||
    sender.tab.id !== state.targetTabId ||
    !(await isActiveTarget(sender))
  ) {
    throw new Error("只能接收目标窗口当前活动标签页的事件");
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("事件格式无效");
  }
  if (pendingEvents.length >= MAX_PENDING_EVENTS) {
    state.droppedEvents += 1;
    state.error = "事件队列已满，录制已经终止";
    void failRecording("EVENT_BACKPRESSURE", state.error);
    throw new Error(state.error);
  }
  pendingEvents.push(event);
  scheduleFlush(pendingEvents.length >= BATCH_SIZE ? 0 : FLUSH_DELAY_MS);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_STATUS") {
    if (!isExtensionPageSender(sender)) {
      sendResponse({ error: "未授权的状态请求" });
      return false;
    }
    refreshStatus().then(sendResponse);
    return true;
  }

  if (message?.type === "LOCAL_STATUS") {
    if (!isHttpTabSender(sender)) {
      sendResponse(idleStatus("未授权的页面状态请求"));
      return false;
    }
    refreshStatus()
      .then(async (status) => {
        if (status.state !== "awaiting-target" || !status.targetToken) return status;
        if (
          state.targetWindowId === sender.tab.windowId &&
          state.targetTabId === sender.tab.id &&
          state.targetToken === status.targetToken
        ) {
          return status;
        }
        try {
          await submitTarget(sender, message, status.targetToken);
          return refreshStatus();
        } catch (error) {
          return { ...status, recording: false, error: error?.message || "目标窗口注册失败" };
        }
      })
      .then(sendResponse);
    return true;
  }

  if (message?.type === "DEMO_EVENT") {
    if (!isHttpTabSender(sender)) {
      sendResponse({ ok: false, error: "未授权的页面事件" });
      return false;
    }
    acceptEvent(message.event, sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "事件发送失败" }));
    return true;
  }

  return false;
});
