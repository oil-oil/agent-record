const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const timer = document.querySelector("#timer");

let timerHandle;
let statusHandle;

function formatTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function renderStatus(status) {
  clearInterval(timerHandle);
  const isRecording = status?.recording === true;
  statusDot.classList.toggle("recording", isRecording);
  statusText.textContent = isRecording ? "录制中" : "待命";

  if (isRecording) {
    const refreshTimer = () => {
      timer.textContent = formatTime(Date.now() - status.startedAt);
    };
    refreshTimer();
    timerHandle = setInterval(refreshTimer, 500);
  } else {
    timer.textContent = "00:00";
  }
}

async function refreshStatus() {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    renderStatus({ recording: false });
    return;
  }

  try {
    renderStatus(await chrome.runtime.sendMessage({ type: "GET_STATUS" }));
  } catch {
    renderStatus({ recording: false });
  }
}

void refreshStatus();
statusHandle = setInterval(refreshStatus, 1000);

window.addEventListener("unload", () => {
  clearInterval(timerHandle);
  clearInterval(statusHandle);
});
