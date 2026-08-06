(() => {
  if (window.__aiDemoRecorderInjected) return;
  window.__aiDemoRecorderInjected = true;

  const state = {
    recording: false,
    lastInputAt: 0,
    lastMoveAt: 0,
    lastScrollAt: 0,
    lastPageUrl: "",
    stableStartedAt: 0,
    stableTimer: null,
    lastPointer: {
      x: Math.round(window.innerWidth / 2),
      y: Math.round(window.innerHeight / 2),
    },
  };

  const FRAME_RELAY_TYPE = "GLIDETAKE_FRAME_EVENT";
  const isTopFrame = window === window.top;

  const hasExtensionRuntime =
    typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

  function publishExtensionState(recording = state.recording) {
    if (!hasExtensionRuntime || !document.documentElement) return;
    document.documentElement.dataset.aiDemoRecorder = "ready";
    document.documentElement.dataset.aiDemoRecorderRecording = String(recording);
    document.documentElement.dataset.aiDemoRecorderVersion =
      chrome.runtime.getManifest().version;
  }

  if (document.documentElement) {
    publishExtensionState();
  } else {
    document.addEventListener("readystatechange", () => publishExtensionState(), {
      once: true,
    });
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function targetRect(target) {
    if (!(target instanceof Element)) return undefined;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return undefined;
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function describeTarget(target) {
    if (!(target instanceof Element)) return "unknown";
    const role = target.getAttribute("role");
    const isSensitiveControl =
      target.matches("input,textarea,select,[contenteditable='true']");
    const label = isSensitiveControl
      ? undefined
      : target.getAttribute("aria-label") || target.id;
    return [target.tagName.toLowerCase(), role, label]
      .filter(Boolean)
      .join(":")
      .slice(0, 100);
  }

  function editableTarget(target) {
    if (!(target instanceof Element)) return null;
    if (target.matches("input,textarea,select,[contenteditable='true']")) {
      return target;
    }
    return target.closest("input,textarea,select,[contenteditable='true']");
  }

  function safePageUrl() {
    try {
      const url = new URL(location.href);
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return location.origin + location.pathname;
    }
  }

  function pointFor(event) {
    if (
      event &&
      Number.isFinite(event.clientX) &&
      Number.isFinite(event.clientY) &&
      (event.clientX !== 0 || event.clientY !== 0)
    ) {
      return {
        x: clamp(Math.round(event.clientX), 0, window.innerWidth),
        y: clamp(Math.round(event.clientY), 0, window.innerHeight),
      };
    }

    const rect = event?.target?.getBoundingClientRect?.();
    if (rect?.width && rect?.height) {
      return {
        x: clamp(Math.round(rect.left + rect.width / 2), 0, window.innerWidth),
        y: clamp(Math.round(rect.top + rect.height / 2), 0, window.innerHeight),
      };
    }

    return { ...state.lastPointer };
  }

  function dispatchDetail(detail) {
    if (!isTopFrame) {
      window.parent.postMessage(
        {
          type: FRAME_RELAY_TYPE,
          detail,
        },
        "*",
      );
      return;
    }

    if (!hasExtensionRuntime) return;
    chrome.runtime
      .sendMessage({
        type: "DEMO_EVENT",
        event: detail,
      })
      .then((response) => {
        if (response?.ok === false && document.documentElement) {
          document.documentElement.dataset.aiDemoRecorderLastError =
            response.error || "事件发送失败";
        }
      })
      .catch((error) => {
        if (document.documentElement) {
          document.documentElement.dataset.aiDemoRecorderLastError =
            error?.message || "本地录制服务不可用";
        }
      });
  }

  function emit(kind, event, extra = {}) {
    if (!state.recording) return;
    const target = extra.targetElement || event?.target;
    const eventForPoint = target && target !== event?.target
      ? { target }
      : event;
    const point = pointFor(eventForPoint);
    state.lastPointer = point;

    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const { targetElement: _targetElement, ...safeExtra } = extra;
    const detail = {
      kind,
      timestamp: Date.now(),
      x: point.x,
      y: point.y,
      nx: Number((point.x / viewportWidth).toFixed(6)),
      ny: Number((point.y / viewportHeight).toFixed(6)),
      viewportWidth,
      viewportHeight,
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      topFrame: isTopFrame,
      frameDepth: 0,
      frameUrl: safePageUrl(),
      target:
        target && kind !== "move" ? describeTarget(target) : undefined,
      targetRect:
        target && kind !== "move" ? targetRect(target) : undefined,
      ...safeExtra,
    };

    dispatchDetail(detail);
  }

  function emitPageState(kind = "page") {
    state.lastPageUrl = safePageUrl();
    emit(kind, null, {
      title: document.title.slice(0, 160),
      url: state.lastPageUrl,
      devicePixelRatio: window.devicePixelRatio,
    });
  }

  function finishStablePeriod() {
    if (!state.recording || !state.stableStartedAt) return;
    state.stableStartedAt = 0;
    state.stableTimer = null;
    emitPageState("page-stable");
  }

  function scheduleStablePeriod() {
    if (!state.recording) return;
    const now = performance.now();
    state.stableStartedAt ||= now;
    clearTimeout(state.stableTimer);
    const elapsed = now - state.stableStartedAt;
    state.stableTimer = setTimeout(
      finishStablePeriod,
      elapsed >= 4_000 ? 0 : 700,
    );
  }

  function handleFrameRelay(event) {
    const message = event.data;
    if (
      !state.recording ||
      !message ||
      message.type !== FRAME_RELAY_TYPE ||
      !message.detail ||
      typeof message.detail !== "object"
    ) {
      return;
    }
    const frame = [...document.querySelectorAll("iframe,frame")]
      .find((candidate) => candidate.contentWindow === event.source);
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const detail = {
      ...message.detail,
      x: Math.round(Number(message.detail.x || 0) + rect.left),
      y: Math.round(Number(message.detail.y || 0) + rect.top),
      viewportWidth: Math.max(1, window.innerWidth),
      viewportHeight: Math.max(1, window.innerHeight),
      frameDepth: Math.max(1, Number(message.detail.frameDepth) + 1 || 1),
    };
    if (message.detail.targetRect) {
      detail.targetRect = {
        ...message.detail.targetRect,
        x: Math.round(Number(message.detail.targetRect.x || 0) + rect.left),
        y: Math.round(Number(message.detail.targetRect.y || 0) + rect.top),
      };
    }
    detail.nx = Number((detail.x / detail.viewportWidth).toFixed(6));
    detail.ny = Number((detail.y / detail.viewportHeight).toFixed(6));
    dispatchDetail(detail);
  }

  function handlePointerMove(event) {
    if (!state.recording) return;
    const now = performance.now();
    if (now - state.lastMoveAt < 50) return;
    state.lastMoveAt = now;
    emit("move", event, {
      buttons: event.buttons,
      pointerType: event.pointerType || "mouse",
    });
  }

  function handleClick(event) {
    emit("click", event, {
      button: event.button,
    });
    scheduleStablePeriod();
  }

  function handleFocus(event) {
    const target = editableTarget(event.target);
    if (!target) return;
    emit("focus", event, { targetElement: target });
  }

  function emitInputActivity(event, phase) {
    const target = editableTarget(event.target);
    if (!target) return;
    const now = performance.now();
    if (now - state.lastInputAt < 180) return;
    state.lastInputAt = now;
    emit("input", event, {
      targetElement: target,
      inputType: typeof event.inputType === "string" ? event.inputType : undefined,
      phase,
    });
  }

  function handleInput(event) {
    emitInputActivity(event, event.type);
  }

  function handleEditableKeydown(event) {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      !editableTarget(event.target)
    ) {
      return;
    }
    const changesValue =
      event.key.length === 1 ||
      ["Backspace", "Delete", "Enter"].includes(event.key);
    if (changesValue) emitInputActivity(event, "keydown");
  }

  function handleInputEnd(event) {
    const target = editableTarget(event.target);
    if (!target) return;
    emit("input-end", event, { targetElement: target });
    scheduleStablePeriod();
  }

  function handleScroll() {
    if (!state.recording) return;
    const now = performance.now();
    if (now - state.lastScrollAt < 100) return;
    state.lastScrollAt = now;
    emit("scroll", null);
  }

  function handleResize() {
    emitPageState("viewport");
  }

  function detectRouteChange() {
    if (!state.recording) return;
    const nextUrl = safePageUrl();
    if (nextUrl === state.lastPageUrl) return;
    emitPageState("page");
    scheduleStablePeriod();
  }

  function setRecording(message) {
    const shouldRecord = message.recording === true;
    if (document.documentElement) {
      document.documentElement.dataset.aiDemoRecorderLastError =
        typeof message.error === "string" ? message.error : "";
    }
    if (state.recording === shouldRecord) return;
    state.recording = shouldRecord;
    publishExtensionState(shouldRecord);
    if (shouldRecord) {
      emitPageState("page");
      scheduleStablePeriod();
    } else {
      clearTimeout(state.stableTimer);
      state.stableStartedAt = 0;
    }
  }

  function localStatusPayload() {
    const viewport = {
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
      devicePixelRatio: Math.max(0.1, Number(window.devicePixelRatio) || 1),
    };
    return {
      type: "LOCAL_STATUS",
      page: {
        url: safePageUrl(),
        title: document.title.slice(0, 160),
        viewport,
        screen: {
          x: Number(window.screenX) || 0,
          y: Number(window.screenY) || 0,
          outerWidth: Math.max(1, Number(window.outerWidth) || viewport.width),
          outerHeight: Math.max(1, Number(window.outerHeight) || viewport.height),
          innerWidth: viewport.width,
          innerHeight: viewport.height,
        },
      },
    };
  }

  window.addEventListener("message", handleFrameRelay);
  document.addEventListener("pointermove", handlePointerMove, {
    capture: true,
    passive: true,
  });
  document.addEventListener("click", handleClick, true);
  document.addEventListener("focusin", handleFocus, true);
  document.addEventListener("beforeinput", handleInput, true);
  document.addEventListener("input", handleInput, true);
  document.addEventListener("compositionstart", handleInput, true);
  document.addEventListener("compositionupdate", handleInput, true);
  document.addEventListener("compositionend", handleInput, true);
  document.addEventListener("change", handleInputEnd, true);
  document.addEventListener("focusout", handleInputEnd, true);
  document.addEventListener("keydown", handleEditableKeydown, true);
  window.addEventListener("scroll", handleScroll, { passive: true });
  window.addEventListener("resize", handleResize, { passive: true });
  window.addEventListener("popstate", detectRouteChange);
  window.addEventListener("hashchange", detectRouteChange);
  setInterval(detectRouteChange, 250);
  new MutationObserver(() => {
    if (state.stableStartedAt) scheduleStablePeriod();
  }).observe(document, { childList: true, subtree: true });
  if (hasExtensionRuntime && isTopFrame) {
    const requestLocalStatus = () => {
      chrome.runtime
        .sendMessage(localStatusPayload())
        .then((status) => setRecording(status || { recording: false }))
        .catch(() => setRecording({ recording: false, error: "本地录制服务不可用" }));
    };
    requestLocalStatus();
    setInterval(requestLocalStatus, 1_000);
  }
})();
