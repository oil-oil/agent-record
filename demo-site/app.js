const prompt = document.querySelector("#prompt");
const generateButton = document.querySelector("#generate");
const quickPrompts = document.querySelectorAll("[data-prompt]");
const progressCard = document.querySelector("#progressCard");
const progressTitle = document.querySelector("#progressTitle");
const progressDetail = document.querySelector("#progressDetail");
const progressBar = document.querySelector("#progressBar");
const progressPercent = document.querySelector("#progressPercent");
const result = document.querySelector("#result");
const emptyState = document.querySelector("#emptyState");
const copyButton = document.querySelector("#copyButton");
const toast = document.querySelector("#toast");

const stages = [
  [18, "正在理解品牌语境…", "提取产品定位与目标受众"],
  [39, "正在寻找创意切口…", "连接慢生活、自然风味与夏季情绪"],
  [63, "正在构建视觉方向…", "生成主色、材质与画面关键词"],
  [84, "正在打磨传播表达…", "让概念更清晰，也更容易被记住"],
  [96, "正在整理完整方案…", "组合核心概念、视觉与传播语"],
];

function applyStage([percent, title, detail]) {
  progressPercent.textContent = `${percent}%`;
  progressBar.style.width = `${percent}%`;
  progressTitle.textContent = title;
  progressDetail.textContent = detail;
}

async function generate() {
  if (!prompt.value.trim()) {
    prompt.focus();
    prompt.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(5px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 360 },
    );
    return;
  }

  generateButton.disabled = true;
  generateButton.innerHTML = '<span class="button-spark">✦</span> 正在生成…';
  result.hidden = true;
  emptyState.hidden = true;
  progressCard.hidden = false;
  applyStage(stages[0]);

  for (let index = 1; index < stages.length; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1250));
    applyStage(stages[index]);
  }

  await new Promise((resolve) => setTimeout(resolve, 1050));
  progressCard.hidden = true;
  result.hidden = false;
  generateButton.disabled = false;
  generateButton.innerHTML =
    '<span class="button-spark">✦</span> 重新生成 <span class="shortcut">⌘↵</span>';
  result.scrollIntoView({ behavior: "smooth", block: "start" });
}

quickPrompts.forEach((button) => {
  button.addEventListener("click", () => {
    prompt.value = button.dataset.prompt;
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
    prompt.focus();
  });
});

generateButton.addEventListener("click", generate);
prompt.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    generate();
  }
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText("今天不赶时间，只赶一场夏天。");
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 1300);
});
