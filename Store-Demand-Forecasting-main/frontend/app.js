/* =====================================================================
   Store Demand Forecasting — Dashboard Application Logic
   ===================================================================== */

// ── Configuration ──────────────────────────────────────────────────
const API_BASE = window.location.origin;
const STORAGE_KEY = "sdf_api_key";

// Chart.js global defaults
Chart.defaults.color = "#8892b0";
Chart.defaults.borderColor = "rgba(255,255,255,0.04)";
Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.plugins.legend.labels.padding = 16;
Chart.defaults.plugins.tooltip.backgroundColor = "rgba(12, 16, 34, 0.95)";
Chart.defaults.plugins.tooltip.borderColor = "rgba(0, 212, 255, 0.2)";
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 12;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.titleFont = { weight: "600", size: 12 };
Chart.defaults.plugins.tooltip.bodyFont = { size: 11 };
Chart.defaults.elements.point.radius = 0;
Chart.defaults.elements.point.hoverRadius = 5;
Chart.defaults.elements.line.tension = 0.3;

// ── Color Palette ──────────────────────────────────────────────────
const COLORS = {
  cyan:     "#00d4ff",
  purple:   "#7c3aed",
  pink:     "#ec4899",
  green:    "#10b981",
  orange:   "#f59e0b",
  red:      "#ef4444",
  blue:     "#3b82f6",
  teal:     "#14b8a6",
  indigo:   "#6366f1",
  amber:    "#d97706",
};

const CHART_COLORS = [
  COLORS.cyan, COLORS.purple, COLORS.pink, COLORS.green,
  COLORS.orange, COLORS.blue, COLORS.teal, COLORS.indigo,
  COLORS.amber, COLORS.red,
];

function alphaColor(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── State ──────────────────────────────────────────────────────────
let apiKey = localStorage.getItem(STORAGE_KEY) || "";
let charts = {};
let storeList = [];
let itemList = [];

// ── DOM References ─────────────────────────────────────────────────
const $modal      = document.getElementById("api-key-modal");
const $modalInput = document.getElementById("api-key-input");
const $modalError = document.getElementById("modal-error");
const $modalBtn   = document.getElementById("modal-submit");
const $dashboard  = document.getElementById("dashboard");
const $connBadge  = document.getElementById("connection-badge");
const $connText   = document.getElementById("connection-text");
const $btnDisc    = document.getElementById("btn-disconnect");
const $toasts     = document.getElementById("toast-container");

// Filter selects
const $storeFilter   = document.getElementById("filter-store");
const $itemFilter    = document.getElementById("filter-item");

// ── API Client ─────────────────────────────────────────────────────
async function apiFetch(endpoint, params = {}) {
  const url = new URL(API_BASE + endpoint);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });

  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": apiKey },
  });

  if (res.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// ── Toast Notifications ────────────────────────────────────────────
function showToast(message, type = "error") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $toasts.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(30px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── Animated Counter ───────────────────────────────────────────────
function animateValue(element, endVal, duration = 1200, prefix = "", suffix = "", decimals = 0) {
  const startTime = performance.now();
  const startVal = 0;

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = startVal + (endVal - startVal) * eased;

    if (decimals > 0) {
      element.textContent = prefix + current.toFixed(decimals) + suffix;
    } else {
      element.textContent = prefix + Math.round(current).toLocaleString() + suffix;
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// ── Connection Status ──────────────────────────────────────────────
function setConnected(connected) {
  if (connected) {
    $connBadge.classList.remove("disconnected");
    $connText.textContent = "Connected";
  } else {
    $connBadge.classList.add("disconnected");
    $connText.textContent = "Disconnected";
  }
}

// ── Modal Logic ────────────────────────────────────────────────────
$modalBtn.addEventListener("click", handleConnect);
$modalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleConnect();
});

$btnDisc.addEventListener("click", () => {
  apiKey = "";
  localStorage.removeItem(STORAGE_KEY);
  setConnected(false);
  $dashboard.classList.add("hidden");
  $modal.classList.remove("hidden");
  $modalInput.value = "";
  $modalError.textContent = "";
  // Destroy charts
  Object.values(charts).forEach((c) => c.destroy());
  charts = {};
});

async function handleConnect() {
  const key = $modalInput.value.trim();
  if (!key) {
    $modalError.textContent = "Please enter an API key";
    return;
  }

  $modalBtn.disabled = true;
  $modalBtn.textContent = "Connecting...";
  $modalError.textContent = "";

  apiKey = key;

  try {
    await apiFetch("/api/overview");
    // Success!
    localStorage.setItem(STORAGE_KEY, key);
    $modal.classList.add("hidden");
    $dashboard.classList.remove("hidden");
    setConnected(true);
    showToast("Connected to API successfully", "success");
    loadDashboard();
  } catch (err) {
    if (err.message === "UNAUTHORIZED") {
      $modalError.textContent = "Invalid API key. Please check and try again.";
    } else {
      $modalError.textContent = "Connection failed: " + err.message;
    }
    apiKey = "";
  } finally {
    $modalBtn.disabled = false;
    $modalBtn.textContent = "Connect";
  }
}

// ── Auto-connect on page load ──────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  if (apiKey) {
    try {
      await apiFetch("/api/overview");
      $modal.classList.add("hidden");
      $dashboard.classList.remove("hidden");
      setConnected(true);
      loadDashboard();
    } catch {
      // Key expired or invalid – show modal
      apiKey = "";
      localStorage.removeItem(STORAGE_KEY);
    }
  }
});

// ── Dashboard Data Loading ─────────────────────────────────────────
async function loadDashboard() {
  try {
    const [overview, stores, items, byStore, trend, dow, topItems, modelInfo] =
      await Promise.all([
        apiFetch("/api/overview"),
        apiFetch("/api/stores"),
        apiFetch("/api/items"),
        apiFetch("/api/sales/by-store"),
        apiFetch("/api/sales/trend"),
        apiFetch("/api/sales/day-of-week"),
        apiFetch("/api/sales/top-items"),
        apiFetch("/api/model/info"),
      ]);

    storeList = stores.stores;
    itemList = items.items;

    populateFilters();
    renderKPIs(overview);
    renderTrendChart(trend);
    renderByStoreChart(byStore);
    renderDowChart(dow);
    renderTopItemsChart(topItems);
    renderModelInfo(modelInfo);

    // Load monthly chart with default
    loadMonthlyChart();
    // Load history chart with default
    loadHistoryChart();
  } catch (err) {
    if (err.message === "UNAUTHORIZED") {
      showToast("Session expired. Please reconnect.", "error");
      $btnDisc.click();
    } else {
      showToast("Failed to load dashboard: " + err.message, "error");
    }
  }
}

// ── Populate Filters ───────────────────────────────────────────────
function populateFilters() {
  // Store filter
  $storeFilter.innerHTML = '<option value="">All Stores</option>';
  storeList.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = `Store ${s}`;
    $storeFilter.appendChild(opt);
  });

  // Item filter
  $itemFilter.innerHTML = '';
  itemList.forEach((i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `Item ${i}`;
    $itemFilter.appendChild(opt);
  });

  // Default selection
  if (!$storeFilter.value && storeList.length > 0) {
    // Keep "All Stores"
  }
  if (itemList.length > 0) {
    $itemFilter.value = itemList[0];
  }

  // Events
  $storeFilter.addEventListener("change", () => {
    loadMonthlyChart();
    loadByItemChart();
  });

  $itemFilter.addEventListener("change", () => {
    loadHistoryChart();
  });
}

// ── Render KPIs ────────────────────────────────────────────────────
function renderKPIs(data) {
  animateValue(document.getElementById("kpi-total-sales"), data.total_sales, 1500);
  animateValue(document.getElementById("kpi-avg-sales"), data.avg_daily_sales, 1200, "", "", 1);
  animateValue(document.getElementById("kpi-stores"), data.total_stores, 800);
  animateValue(document.getElementById("kpi-items"), data.total_items, 900);
  animateValue(document.getElementById("kpi-records"), data.total_records, 1400);
  animateValue(document.getElementById("kpi-forecast"), data.forecast_records, 1000);

  document.getElementById("kpi-date-range").textContent =
    `${data.date_min} → ${data.date_max}`;
  document.getElementById("kpi-forecast-range").textContent =
    `${data.forecast_date_min} → ${data.forecast_date_max}`;
}

// ── Trend Chart ────────────────────────────────────────────────────
function renderTrendChart(data) {
  const ctx = document.getElementById("chart-trend").getContext("2d");
  if (charts.trend) charts.trend.destroy();

  const labels = data.data.map((d) => d.date);
  const values = data.data.map((d) => d.sales);

  const gradient = ctx.createLinearGradient(0, 0, 0, 350);
  gradient.addColorStop(0, alphaColor(COLORS.cyan, 0.2));
  gradient.addColorStop(1, alphaColor(COLORS.cyan, 0));

  charts.trend = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Weekly Total Sales",
        data: values,
        borderColor: COLORS.cyan,
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        pointBackgroundColor: COLORS.cyan,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 12, maxRotation: 0 },
        },
        y: {
          grid: { color: "rgba(255,255,255,0.03)" },
          ticks: {
            callback: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v),
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Sales: ${ctx.parsed.y.toLocaleString()}`,
          },
        },
      },
    },
  });
}

// ── Sales by Store Chart ───────────────────────────────────────────
function renderByStoreChart(data) {
  const ctx = document.getElementById("chart-by-store").getContext("2d");
  if (charts.byStore) charts.byStore.destroy();

  const labels = data.data.map((d) => `Store ${d.store}`);
  const values = data.data.map((d) => d.total_sales);
  const bgColors = data.data.map((_, i) => alphaColor(CHART_COLORS[i % CHART_COLORS.length], 0.7));
  const borderColors = data.data.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  charts.byStore = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Total Sales",
        data: values,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 6,
        barPercentage: 0.7,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.03)" },
          ticks: {
            callback: (v) => (v >= 1000000 ? (v / 1000000).toFixed(1) + "M" : (v / 1000).toFixed(0) + "k"),
          },
        },
        y: {
          grid: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Total: ${ctx.parsed.x.toLocaleString()}`,
          },
        },
      },
    },
  });
}

// ── Day of Week Chart ──────────────────────────────────────────────
function renderDowChart(data) {
  const ctx = document.getElementById("chart-dow").getContext("2d");
  if (charts.dow) charts.dow.destroy();

  const labels = data.data.map((d) => d.day_of_week.slice(0, 3));
  const values = data.data.map((d) => d.avg_sales);

  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, alphaColor(COLORS.purple, 0.4));
  gradient.addColorStop(1, alphaColor(COLORS.purple, 0.05));

  charts.dow = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Avg Sales",
        data: values,
        backgroundColor: gradient,
        borderColor: COLORS.purple,
        borderWidth: 1,
        borderRadius: 8,
        barPercentage: 0.6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: {
          grid: { color: "rgba(255,255,255,0.03)" },
          beginAtZero: false,
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Avg: ${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
    },
  });
}

// ── Top Items Chart ────────────────────────────────────────────────
function renderTopItemsChart(data) {
  const ctx = document.getElementById("chart-top-items").getContext("2d");
  if (charts.topItems) charts.topItems.destroy();

  const labels = data.data.map((d) => `Item ${d.item}`);
  const values = data.data.map((d) => d.total_sales);

  charts.topItems = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: CHART_COLORS.map((c) => alphaColor(c, 0.7)),
        borderColor: CHART_COLORS,
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: {
          position: "right",
          labels: {
            padding: 10,
            font: { size: 10 },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return `${ctx.label}: ${ctx.parsed.toLocaleString()} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

// ── Monthly Chart (dynamic) ────────────────────────────────────────
async function loadMonthlyChart() {
  const store = $storeFilter.value || undefined;
  try {
    const data = await apiFetch("/api/sales/monthly", { store });
    renderMonthlyChart(data);
  } catch (err) {
    showToast("Failed to load monthly data", "error");
  }
}

function renderMonthlyChart(data) {
  const ctx = document.getElementById("chart-monthly").getContext("2d");
  if (charts.monthly) charts.monthly.destroy();

  const labels = data.data.map((d) => d.year_month);
  const values = data.data.map((d) => d.total_sales);

  const gradient = ctx.createLinearGradient(0, 0, 0, 350);
  gradient.addColorStop(0, alphaColor(COLORS.green, 0.25));
  gradient.addColorStop(1, alphaColor(COLORS.green, 0));

  charts.monthly = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: data.store === "all" ? "All Stores" : `Store ${data.store}`,
        data: values,
        borderColor: COLORS.green,
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        pointBackgroundColor: COLORS.green,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 15, maxRotation: 45 },
        },
        y: {
          grid: { color: "rgba(255,255,255,0.03)" },
          ticks: {
            callback: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v),
          },
        },
      },
      plugins: {
        legend: { display: true, position: "top" },
        tooltip: {
          callbacks: {
            label: (ctx) => `Sales: ${ctx.parsed.y.toLocaleString()}`,
          },
        },
      },
    },
  });
}

// ── By Item Chart (dynamic) ────────────────────────────────────────
async function loadByItemChart() {
  const store = $storeFilter.value || undefined;
  try {
    const data = await apiFetch("/api/sales/by-item", { store });
    // Already have top items chart, no separate render needed
  } catch (err) {
    // silent
  }
}

// ── History Chart (dynamic) ────────────────────────────────────────
async function loadHistoryChart() {
  const store = $storeFilter.value || (storeList.length > 0 ? storeList[0] : 1);
  const item = $itemFilter.value || (itemList.length > 0 ? itemList[0] : 1);

  try {
    const data = await apiFetch("/api/sales/history", { store, item });
    renderHistoryChart(data);
  } catch (err) {
    showToast("Failed to load history data", "error");
  }
}

function renderHistoryChart(data) {
  const ctx = document.getElementById("chart-history").getContext("2d");
  if (charts.history) charts.history.destroy();

  const labels = data.data.map((d) => d.date);
  const values = data.data.map((d) => d.sales);

  const gradient = ctx.createLinearGradient(0, 0, 0, 380);
  gradient.addColorStop(0, alphaColor(COLORS.orange, 0.2));
  gradient.addColorStop(1, alphaColor(COLORS.orange, 0));

  charts.history = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: `Store ${data.store} · Item ${data.item}`,
        data: values,
        borderColor: COLORS.orange,
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        pointBackgroundColor: COLORS.orange,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 12, maxRotation: 0 },
        },
        y: {
          grid: { color: "rgba(255,255,255,0.03)" },
        },
      },
      plugins: {
        legend: { display: true, position: "top" },
        tooltip: {
          callbacks: {
            label: (ctx) => `Sales: ${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
    },
  });
}

// ── Model Info ─────────────────────────────────────────────────────
function renderModelInfo(info) {
  // SMAPE
  const smapeEl = document.getElementById("smape-value");
  animateValue(smapeEl, info.validation_smape, 1500, "", "%", 2);

  // Parameters
  const paramList = document.getElementById("model-params");
  paramList.innerHTML = "";
  Object.entries(info.parameters).forEach(([key, val]) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="param-label">${key}</span><span class="param-value">${val}</span>`;
    paramList.appendChild(li);
  });

  // Add model type & best iteration
  const metaItems = [
    ["Model Type", info.model_type],
    ["Evaluation Metric", info.metric],
    ["Best Iteration", info.best_iteration],
  ];
  metaItems.forEach(([label, val]) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="param-label">${label}</span><span class="param-value">${val}</span>`;
    paramList.appendChild(li);
  });

  // Features
  const featList = document.getElementById("model-features");
  featList.innerHTML = "";
  info.features.forEach((f) => {
    const li = document.createElement("li");
    li.textContent = f;
    featList.appendChild(li);
  });
}
