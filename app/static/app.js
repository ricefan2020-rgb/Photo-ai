const form = document.querySelector("#study");
const results = document.querySelector("#results");
const pending = document.querySelector("#pending");
const resultBody = document.querySelector("#result-body");
const errorEl = document.querySelector("#error");
const symbolInput = document.querySelector("#symbol");
const startInput = document.querySelector("#start");
const endInput = document.querySelector("#end");
const chartHost = document.querySelector("#chart");
const readout = document.querySelector("#readout");

const state = { last: null, requestId: 0 };

const METRICS = [
  ["total_return", "總報酬", "signed"],
  ["cagr", "年化報酬", "signed"],
  ["max_drawdown", "最大回撤", "signed"],
  ["win_rate", "勝率", "rate"],
  ["trades", "交易次數", "count"],
  ["trading_days", "交易日", "count"],
];

function iso(day) {
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

function longDate(value) {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatPct(ratio, digits = 1) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  const value = ratio * 100;
  const body = Math.abs(value).toLocaleString("zh-HK", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (value > 0) return `+${body}%`;
  if (value < 0) return `−${body}%`;
  return `${body}%`;
}

function formatCount(value) {
  return Number(value).toLocaleString("zh-HK");
}

function formatPrice(value) {
  const digits = Math.abs(value) >= 1 ? 2 : 4;
  return `US$${value.toLocaleString("zh-HK", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function tone(value) {
  if (!Number.isFinite(value) || value === 0) return "";
  return value > 0 ? "rise" : "fall";
}

function setYears(years) {
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - years);
  startInput.value = iso(start);
  endInput.value = iso(end);
  document.querySelectorAll("[data-years]").forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.years) === years));
  });
}

function selectedStrategy() {
  return form.querySelector('input[name="strategy"]:checked').value;
}

function showParams(strategy) {
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== strategy;
  });
}

function showError(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function payload() {
  const strategy = selectedStrategy();
  const body = {
    symbol: symbolInput.value.trim(),
    start: startInput.value,
    end: endInput.value,
    strategy,
    cost_bps: document.querySelector("#cost").value === "" ? 0 : Number(document.querySelector("#cost").value),
  };
  if (!body.symbol) return { error: "請輸入代號。" };
  if (!body.start || !body.end) return { error: "請選擇開始日和結束日。" };
  if (body.start >= body.end) return { error: "開始日必須早於結束日。" };
  if (!Number.isFinite(body.cost_bps)) return { error: "單邊成本必須是數字。" };

  if (strategy === "sma") {
    body.fast = Number(document.querySelector("#fast").value);
    body.slow = Number(document.querySelector("#slow").value);
    if (!Number.isInteger(body.fast) || !Number.isInteger(body.slow)) return { error: "均線日數必須是整數。" };
  }
  if (strategy === "momentum") {
    body.lookback = Number(document.querySelector("#lookback").value);
    body.threshold_pct = Number(document.querySelector("#threshold").value);
    if (!Number.isInteger(body.lookback)) return { error: "回看日數必須是整數。" };
    if (!Number.isFinite(body.threshold_pct)) return { error: "門檻必須是數字。" };
  }
  return { body };
}

function render(data) {
  state.last = data;
  resultBody.hidden = false;
  pending.hidden = true;

  document.querySelector("#result-title").textContent = data.symbol;
  const bits = [data.name, data.currency_label, data.instrument_label, data.price_basis].filter(Boolean);
  document.querySelector("#result-sub").textContent = bits.join(" · ");
  document.querySelector("#result-meta").textContent =
    `${longDate(data.actual_start)} 至 ${longDate(data.actual_end)} · ${data.label}`;

  const metrics = document.querySelector("#metrics");
  metrics.replaceChildren();
  const view = { ...data.metrics, trading_days: data.trading_days };
  for (const [key, label, kind] of METRICS) {
    const card = document.createElement("article");
    card.className = "metric";
    const name = document.createElement("p");
    name.className = "k";
    name.textContent = label;
    const value = document.createElement("p");
    value.className = "v";
    const raw = view[key];
    if (kind === "count") {
      value.textContent = formatCount(raw);
    } else if (kind === "rate") {
      value.textContent = raw === null ? "—" : formatPct(raw).replace("+", "");
    } else {
      value.textContent = formatPct(raw);
      value.classList.add(tone(raw));
    }
    card.append(name, value);
    metrics.append(card);
  }

  const bench = document.querySelector("#benchmark-line");
  const benchKey = document.querySelector("#bench-key");
  if (data.strategy === "buyhold") {
    bench.textContent = "目前策略就是買入並持有，曲線只畫這一條。";
    benchKey.hidden = true;
  } else {
    const b = data.benchmark;
    bench.textContent =
      `同一區間的買入並持有：總報酬 ${formatPct(b.total_return)}，年化 ${formatPct(b.cagr)}，最大回撤 ${formatPct(b.max_drawdown)}。`;
    benchKey.hidden = false;
  }

  const notes = document.querySelector("#notes");
  notes.replaceChildren();
  notes.hidden = data.notes.length === 0;
  for (const note of data.notes) {
    const item = document.createElement("li");
    item.textContent = note;
    notes.append(item);
  }

  renderTrades(data);
  drawChart();
}

function renderTrades(data) {
  const empty = document.querySelector("#trades-empty");
  const wrap = document.querySelector("#table-wrap");
  document.querySelector("#trades-title").textContent = `交易紀錄 · ${formatCount(data.trades.length)}`;
  if (data.trades.length === 0) {
    empty.hidden = false;
    wrap.hidden = true;
    return;
  }
  empty.hidden = true;
  wrap.hidden = false;
  const body = document.querySelector("#trades");
  body.replaceChildren();
  for (const trade of data.trades) {
    const row = document.createElement("tr");
    const cells = [
      trade.entry_date,
      trade.exit_date,
      formatPrice(trade.entry_price),
      formatPrice(trade.exit_price),
      formatCount(trade.holding_days),
    ];
    for (const text of cells) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    const ret = document.createElement("td");
    ret.textContent = formatPct(trade.return);
    ret.className = tone(trade.return);
    row.append(ret);
    const why = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = trade.exit_reason === "sample_end" ? "區間結束結算" : "訊號出場";
    why.append(pill);
    row.append(why);
    body.append(row);
  }
}

function drawChart() {
  const data = state.last;
  if (!data) return;
  const width = Math.max(chartHost.clientWidth || 320, 280);
  const height = width < 640 ? 220 : 268;
  const margin = { top: 16, right: 14, bottom: 28, left: 52 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const series = data.curve;
  const showBench = data.strategy !== "buyhold";

  let min = Infinity;
  let max = -Infinity;
  for (const point of series) {
    min = Math.min(min, point.strategy, showBench ? point.benchmark : point.strategy);
    max = Math.max(max, point.strategy, showBench ? point.benchmark : point.strategy);
  }
  if (!Number.isFinite(min) || min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;

  const x = (index) => margin.left + (series.length === 1 ? plotW / 2 : (plotW * index) / (series.length - 1));
  const y = (value) => margin.top + ((max - value) / (max - min)) * plotH;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  const last = series[series.length - 1];
  svg.setAttribute(
    "aria-label",
    `資產曲線，起始 100，期末策略 ${last.strategy.toFixed(1)}`,
  );

  const grid = document.createElementNS(svg.namespaceURI, "g");
  for (let tick = 0; tick < 4; tick += 1) {
    const value = min + ((max - min) * tick) / 3;
    const yPos = y(value);
    const line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute("x1", margin.left);
    line.setAttribute("x2", width - margin.right);
    line.setAttribute("y1", yPos);
    line.setAttribute("y2", yPos);
    line.setAttribute("stroke", "#eadfce");
    grid.append(line);
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", margin.left - 8);
    label.setAttribute("y", yPos + 4);
    label.setAttribute("text-anchor", "end");
    label.textContent = value.toLocaleString("zh-HK", { maximumFractionDigits: value >= 1000 ? 0 : 1 });
    grid.append(label);
  }
  svg.append(grid);

  if (min < 100 && max > 100) {
    const base = document.createElementNS(svg.namespaceURI, "line");
    base.setAttribute("x1", margin.left);
    base.setAttribute("x2", width - margin.right);
    base.setAttribute("y1", y(100));
    base.setAttribute("y2", y(100));
    base.setAttribute("stroke", "#c4b8a8");
    base.setAttribute("stroke-dasharray", "2 4");
    svg.append(base);
  }

  const pathOf = (key) => series.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point[key]).toFixed(2)}`).join(" ");

  const area = document.createElementNS(svg.namespaceURI, "path");
  const areaPath = `${pathOf("strategy")} L${x(series.length - 1).toFixed(2)},${y(min).toFixed(2)} L${x(0).toFixed(2)},${y(min).toFixed(2)} Z`;
  area.setAttribute("d", areaPath);
  area.setAttribute("fill", "#1c1916");
  area.setAttribute("opacity", "0.06");
  svg.append(area);

  if (showBench) {
    const bench = document.createElementNS(svg.namespaceURI, "path");
    bench.setAttribute("d", pathOf("benchmark"));
    bench.setAttribute("fill", "none");
    bench.setAttribute("stroke", "#8a8175");
    bench.setAttribute("stroke-width", "1.5");
    bench.setAttribute("stroke-dasharray", "4 4");
    svg.append(bench);
  }

  const strategy = document.createElementNS(svg.namespaceURI, "path");
  strategy.setAttribute("d", pathOf("strategy"));
  strategy.setAttribute("fill", "none");
  strategy.setAttribute("stroke", "#1c1916");
  strategy.setAttribute("stroke-width", "2");
  svg.append(strategy);

  const xLabels = [0, Math.floor((series.length - 1) / 2), series.length - 1];
  const seen = new Set();
  for (const index of xLabels) {
    if (seen.has(index)) continue;
    seen.add(index);
    const label = document.createElementNS(svg.namespaceURI, "text");
    const anchor = index === 0 ? "start" : index === series.length - 1 ? "end" : "middle";
    label.setAttribute("x", x(index));
    label.setAttribute("y", height - 8);
    label.setAttribute("text-anchor", anchor);
    label.textContent = series[index].date.slice(0, 7);
    svg.append(label);
  }

  const hover = document.createElementNS(svg.namespaceURI, "g");
  hover.setAttribute("visibility", "hidden");
  const guide = document.createElementNS(svg.namespaceURI, "line");
  guide.setAttribute("stroke", "#8f2d2a");
  guide.setAttribute("stroke-width", "1");
  const dot = document.createElementNS(svg.namespaceURI, "circle");
  dot.setAttribute("r", "3.5");
  dot.setAttribute("fill", "#1c1916");
  hover.append(guide, dot);
  const benchDot = document.createElementNS(svg.namespaceURI, "circle");
  if (showBench) {
    benchDot.setAttribute("r", "3");
    benchDot.setAttribute("fill", "#8a8175");
    hover.append(benchDot);
  }
  svg.append(hover);

  const describe = (point) => {
    const benchText = showBench ? `　買入並持有 ${point.benchmark.toFixed(1)}` : "";
    return `${point.date}　策略 ${point.strategy.toFixed(1)}${benchText}`;
  };
  readout.textContent = describe(last);

  svg.addEventListener("pointermove", (event) => {
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    let index = Math.round(((px - margin.left) / plotW) * (series.length - 1));
    index = Math.max(0, Math.min(series.length - 1, index));
    const point = series[index];
    hover.setAttribute("visibility", "visible");
    guide.setAttribute("x1", x(index));
    guide.setAttribute("x2", x(index));
    guide.setAttribute("y1", margin.top);
    guide.setAttribute("y2", margin.top + plotH);
    dot.setAttribute("cx", x(index));
    dot.setAttribute("cy", y(point.strategy));
    if (showBench) {
      benchDot.setAttribute("cx", x(index));
      benchDot.setAttribute("cy", y(point.benchmark));
    }
    readout.textContent = describe(point);
  });
  svg.addEventListener("pointerleave", () => {
    hover.setAttribute("visibility", "hidden");
    readout.textContent = describe(last);
  });

  chartHost.replaceChildren(svg);
}

async function runStudy() {
  const built = payload();
  if (built.error) {
    showError(built.error);
    return;
  }
  const id = ++state.requestId;
  clearError();
  const button = form.querySelector(".run");
  button.disabled = true;
  button.textContent = "計算中…";
  results.classList.add("is-loading");
  results.setAttribute("aria-busy", "true");
  try {
    const response = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(built.body),
    });
    const data = await response.json().catch(() => ({}));
    if (id !== state.requestId) return;
    if (!response.ok) {
      showError(data.error || "回測失敗，請稍後再試。");
      if (!state.last) pending.textContent = "這次沒有可顯示的結果。";
      return;
    }
    render(data);
  } catch {
    if (id !== state.requestId) return;
    showError("連不上本機伺服器。");
    if (!state.last) pending.textContent = "這次沒有可顯示的結果。";
  } finally {
    if (id === state.requestId) {
      button.disabled = false;
      button.textContent = "執行回測";
      results.classList.remove("is-loading");
      results.removeAttribute("aria-busy");
    }
  }
}

document.querySelectorAll("[data-symbol]").forEach((button) => {
  button.addEventListener("click", () => {
    symbolInput.value = button.dataset.symbol;
    document.querySelectorAll("[data-symbol]").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip === button));
    });
    symbolInput.focus();
  });
});

document.querySelectorAll("[data-years]").forEach((button) => {
  button.addEventListener("click", () => setYears(Number(button.dataset.years)));
});

form.querySelectorAll('input[name="strategy"]').forEach((input) => {
  input.addEventListener("change", () => showParams(selectedStrategy()));
});

symbolInput.addEventListener("input", () => {
  const value = symbolInput.value.trim().toUpperCase();
  document.querySelectorAll("[data-symbol]").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.dataset.symbol === value));
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runStudy();
});

window.addEventListener("resize", () => {
  if (state.last) drawChart();
});

setYears(5);
showParams("sma");
runStudy();
