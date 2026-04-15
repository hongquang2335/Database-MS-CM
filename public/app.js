const state = {
  filters: {},
  charts: {},
  reportRows: [],
  chatbotOpen: false,
  currentUser: null,
};

const chartPalette = ["#0f766e", "#c76d2d", "#355070", "#6d597a", "#588157", "#bc4749", "#457b9d", "#7f5539", "#2a9d8f", "#e76f51"];

const formatNumber = (value) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value || 0));

const formatCurrency = (value) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

function setStatus(text, isError = false) {
  const el = document.getElementById("connection-status");
  if (!el) return;
  el.textContent = text;
  el.style.background = isError ? "rgba(159, 58, 47, 0.12)" : "rgba(15, 118, 110, 0.12)";
  el.style.color = isError ? "#9f3a2f" : "#0f766e";
}

function setAuthError(text = "") {
  const el = document.getElementById("auth-error");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("hidden", !text);
}

function toggleAdminModal(show) {
  document.getElementById("admin-modal").classList.toggle("hidden", !show);
  if (!show) setAuthError("");
}

async function fetchJson(url, options = {}) {
  const headers = options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : { ...(options.headers || {}) };
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || "Request failed");
  }
  return response.json();
}

function buildQuery(extra = {}) {
  const params = new URLSearchParams();
  const source = { ...state.filters, ...extra };
  Object.entries(source).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

function buildMetrics(summary) {
  const metrics = [
    { label: "Doanh số", value: formatCurrency(summary.revenue) },
    { label: "Đơn hàng", value: formatNumber(summary.orders) },
    { label: "Khách hàng", value: formatNumber(summary.customers) },
    { label: "Mặt hàng", value: formatNumber(summary.products) },
    { label: "TB / đơn", value: formatCurrency(summary.avgOrderValue) },
  ];

  document.getElementById("metrics").innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric-card">
          <p>${metric.label}</p>
          <strong>${metric.value}</strong>
        </article>
      `
    )
    .join("");
}

function destroyChart(key) {
  if (state.charts[key]) {
    state.charts[key].destroy();
    delete state.charts[key];
  }
}

function renderChart(key, elementId, options) {
  destroyChart(key);
  const element = document.getElementById(elementId);
  if (!element || typeof ApexCharts === "undefined") return;
  const chart = new ApexCharts(element, options);
  state.charts[key] = chart;
  chart.render();
}

function renderPivot(rows) {
  const table = document.getElementById("pivot-table");
  if (!rows.length) {
    table.innerHTML = "<tr><td>Không có dữ liệu pivot trong bộ lọc hiện tại.</td></tr>";
    return;
  }

  const columns = [...new Set(rows.map((row) => row.columnLabel))];
  const grouped = rows.reduce((acc, row) => {
    if (!acc[row.rowLabel]) acc[row.rowLabel] = {};
    acc[row.rowLabel][row.columnLabel] = row.total;
    return acc;
  }, {});

  const head = `
    <thead>
      <tr>
        <th>Chiều dòng</th>
        ${columns.map((column) => `<th>${column}</th>`).join("")}
        <th>Tổng</th>
      </tr>
    </thead>
  `;

  const body = Object.entries(grouped)
    .map(([rowLabel, values]) => {
      const total = columns.reduce((sum, column) => sum + Number(values[column] || 0), 0);
      return `
        <tr>
          <td>${rowLabel}</td>
          ${columns.map((column) => `<td>${formatCurrency(values[column] || 0)}</td>`).join("")}
          <td>${formatCurrency(total)}</td>
        </tr>
      `;
    })
    .join("");

  table.innerHTML = `${head}<tbody>${body}</tbody>`;
}

function renderReport(rows) {
  state.reportRows = rows;
  const table = document.getElementById("report-table");
  if (!rows.length) {
    table.innerHTML = "<tr><td>Không có dòng dữ liệu phù hợp.</td></tr>";
    return;
  }

  const headers = Object.keys(rows[0]);
  const head = `<thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>`;
  const body = rows
    .map(
      (row) => `
        <tr>
          ${headers
            .map((header) => {
              const value = header === "lineTotal" || header === "priceEach" ? formatCurrency(row[header]) : row[header];
              return `<td>${value}</td>`;
            })
            .join("")}
        </tr>
      `
    )
    .join("");

  table.innerHTML = `${head}<tbody>${body}</tbody>`;
}

function exportCsv() {
  if (!state.reportRows.length) return;
  const headers = Object.keys(state.reportRows[0]);
  const lines = [
    headers.join(","),
    ...state.reportRows.map((row) =>
      headers.map((header) => `"${String(row[header] ?? "").replaceAll('"', '""')}"`).join(",")
    ),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "classicmodels-report.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function addChatMessage(role, text) {
  const messages = document.getElementById("chatbot-messages");
  const item = document.createElement("div");
  item.className = `chat-message ${role}`;
  item.textContent = text;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

function toggleChatbot(forceOpen) {
  const panel = document.getElementById("chatbot-panel");
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !state.chatbotOpen;
  state.chatbotOpen = shouldOpen;
  panel.classList.toggle("hidden", !shouldOpen);
}

function activateTab(tabName) {
  document.querySelectorAll(".tab-button").forEach((item) => {
    item.classList.toggle("active", item.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === tabName);
  });
}

function getChatbotReply(message) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return "Bạn có thể hỏi như: mở tab biểu đồ, mở tab báo cáo, hướng dẫn tìm khách hàng, hoặc cách dùng pivot.";
  if (normalized.includes("biểu đồ") || normalized.includes("chart")) {
    activateTab("charts");
    return "Đã mở tab Biểu đồ. Bạn có thể lọc thời gian hoặc mặt hàng ở sidebar rồi xem doanh số và top khách hàng.";
  }
  if (normalized.includes("pivot")) {
    activateTab("pivot");
    return "Đã mở tab Pivot. Bạn có thể đổi chiều dòng giữa khách hàng và dòng sản phẩm ngay trong hộp chọn của tab này.";
  }
  if (normalized.includes("báo cáo") || normalized.includes("report")) {
    activateTab("report");
    return "Đã mở tab Báo cáo. Bạn có thể chọn số dòng và xuất CSV từ bảng chi tiết đơn hàng.";
  }
  if (normalized.includes("tổng quan") || normalized.includes("dashboard")) {
    activateTab("overview");
    return "Đã mở tab Tổng quan. Đây là nơi xem KPI và doanh số theo tháng hoặc dòng sản phẩm.";
  }
  if (normalized.includes("khách hàng") || normalized.includes("tìm kh")) {
    return "Để tìm khách hàng, dùng ô 'Tìm khách hàng' hoặc chọn trực tiếp trong danh sách 'Khách hàng', rồi bấm Áp dụng.";
  }
  if (normalized.includes("mặt hàng") || normalized.includes("sản phẩm") || normalized.includes("product")) {
    return "Để lọc mặt hàng, dùng ô 'Tìm mặt hàng', chọn 'Mặt hàng' hoặc 'Dòng sản phẩm', rồi bấm Áp dụng.";
  }
  if (normalized.includes("thời gian") || normalized.includes("ngày") || normalized.includes("date")) {
    return "Bạn có thể lọc theo khoảng thời gian bằng hai trường 'Từ ngày' và 'Đến ngày' trong sidebar.";
  }
  if (normalized.includes("xuất") || normalized.includes("csv")) {
    activateTab("report");
    return "Tôi đã chuyển sang tab Báo cáo. Nút 'Xuất CSV' nằm phía trên bảng chi tiết đơn hàng.";
  }
  return "Tôi hỗ trợ các thao tác cơ bản như mở tab, hướng dẫn lọc theo thời gian, khách hàng, mặt hàng, pivot và xuất CSV.";
}

async function loadFilters() {
  const data = await fetchJson("/api/filters");

  const fillOptions = (name, rows, valueKey, labelKey) => {
    const select = document.querySelector(`[name="${name}"]`);
    const firstOption = select.querySelector("option")?.outerHTML || "";
    select.innerHTML = firstOption + rows.map((row) => `<option value="${row[valueKey]}">${row[labelKey]}</option>`).join("");
  };

  fillOptions("status", data.statuses, "status", "status");
  fillOptions("customerNumber", data.customers, "customerNumber", "customerName");
  fillOptions("productLine", data.productLines, "productLine", "productLine");
  fillOptions(
    "productCode",
    data.products.map((product) => ({
      productCode: product.productCode,
      productName: `${product.productName} (${product.productLine})`,
    })),
    "productCode",
    "productName"
  );

  if (data.dateRange?.minOrderDate) {
    document.querySelector('[name="startDate"]').value = data.dateRange.minOrderDate;
    document.querySelector('[name="endDate"]').value = data.dateRange.maxOrderDate;
    state.filters.startDate = data.dateRange.minOrderDate;
    state.filters.endDate = data.dateRange.maxOrderDate;
  }
}

async function loadHealth() {
  try {
    await fetchJson("/api/health");
    setStatus("Đã kết nối MySQL classicmodels");
  } catch (error) {
    setStatus(`Chưa kết nối DB: ${error.message}`, true);
  }
}

function baseChartOptions() {
  return {
    chart: {
      height: "100%",
      toolbar: { show: false },
      foreColor: "#617064",
      fontFamily: "IBM Plex Sans, sans-serif",
      animations: { easing: "easeinout", speed: 450 },
    },
    colors: chartPalette,
    dataLabels: { enabled: false },
    grid: { borderColor: "rgba(31, 42, 31, 0.08)", strokeDashArray: 4 },
    legend: { position: "bottom", fontSize: "13px" },
    stroke: { curve: "smooth", width: 3 },
    tooltip: {
      theme: "light",
      y: { formatter: (value) => formatCurrency(value) },
    },
    noData: { text: "Không có dữ liệu" },
  };
}

function renderDashboardCharts(dashboard) {
  const base = baseChartOptions();

  renderChart("monthlySales", "monthly-sales-chart", {
    ...base,
    chart: { ...base.chart, type: "area" },
    series: [{ name: "Doanh số", data: dashboard.monthlySales.map((row) => Number(row.revenue || 0)) }],
    xaxis: { categories: dashboard.monthlySales.map((row) => row.period) },
    fill: { type: "gradient", gradient: { shadeIntensity: 1, opacityFrom: 0.28, opacityTo: 0.06, stops: [0, 100] } },
    yaxis: { labels: { formatter: (value) => formatNumber(value) } },
  });

  renderChart("productLine", "product-line-chart", {
    ...base,
    chart: { ...base.chart, type: "bar" },
    series: [{ name: "Doanh số", data: dashboard.productLineSales.map((row) => Number(row.revenue || 0)) }],
    xaxis: { categories: dashboard.productLineSales.map((row) => row.productLine) },
    plotOptions: { bar: { horizontal: true, borderRadius: 6, barHeight: "55%" } },
    yaxis: { labels: { formatter: (value) => formatNumber(value) } },
  });

  renderChart("topCustomers", "top-customers-chart", {
    ...base,
    chart: { ...base.chart, type: "donut" },
    series: dashboard.topCustomers.map((row) => Number(row.revenue || 0)),
    labels: dashboard.topCustomers.map((row) => row.customerName),
    stroke: { width: 0 },
  });

  renderChart("monthlySalesAlt", "monthly-sales-chart-alt", {
    ...base,
    chart: { ...base.chart, type: "bar" },
    colors: ["#c76d2d"],
    series: [{ name: "Doanh số", data: dashboard.monthlySales.map((row) => Number(row.revenue || 0)) }],
    xaxis: { categories: dashboard.monthlySales.map((row) => row.period) },
    plotOptions: { bar: { borderRadius: 6, columnWidth: "45%" } },
    yaxis: { labels: { formatter: (value) => formatNumber(value) } },
  });

  renderChart("productLineAlt", "product-line-chart-alt", {
    ...base,
    chart: { ...base.chart, type: "radialBar" },
    series: dashboard.productLineSales.slice(0, 5).map((row) => Number(row.revenue || 0)),
    labels: dashboard.productLineSales.slice(0, 5).map((row) => row.productLine),
    plotOptions: {
      radialBar: {
        dataLabels: {
          name: { fontSize: "12px" },
          value: { formatter: (value) => formatNumber(value) },
          total: {
            show: true,
            label: "Tổng",
            formatter: () =>
              formatNumber(
                dashboard.productLineSales.slice(0, 5).reduce((sum, row) => sum + Number(row.revenue || 0), 0)
              ),
          },
        },
      },
    },
  });
}

async function loadDashboard() {
  const query = buildQuery();
  const [dashboard, pivot, report] = await Promise.all([
    fetchJson(`/api/dashboard?${query}`),
    fetchJson(`/api/pivot/sales?${buildQuery({ rowDimension: document.getElementById("pivot-dimension").value })}`),
    fetchJson(`/api/reports/orders?${buildQuery({ limit: document.getElementById("report-limit").value })}`),
  ]);

  buildMetrics(dashboard.summary);
  renderDashboardCharts(dashboard);
  renderPivot(pivot.rows);
  renderReport(report.rows);
  setStatus("Đã tải báo cáo thành công");
}

function updateAdminUi() {
  const badge = document.getElementById("user-badge");
  const loginButton = document.getElementById("admin-login-button");
  const logoutButton = document.getElementById("logout-button");

  if (state.currentUser?.role === "admin") {
    badge.textContent = `Admin: ${state.currentUser.username}`;
    badge.classList.remove("hidden");
    logoutButton.classList.remove("hidden");
    loginButton.classList.add("hidden");
    return;
  }

  badge.classList.add("hidden");
  logoutButton.classList.add("hidden");
  loginButton.classList.remove("hidden");
}

async function checkAuth() {
  try {
    const response = await fetchJson("/api/auth/me");
    state.currentUser = response.authenticated ? response.user : null;
  } catch (_error) {
    state.currentUser = null;
  }
  updateAdminUi();
}

async function handleAdminLogin(payload) {
  const response = await fetchJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.currentUser = response.user;
  updateAdminUi();
  toggleAdminModal(false);
}

async function logout() {
  await fetchJson("/api/auth/logout", { method: "POST" });
  state.currentUser = null;
  updateAdminUi();
}

function bindEvents() {
  document.getElementById("admin-login-button").addEventListener("click", () => toggleAdminModal(true));
  document.getElementById("admin-close").addEventListener("click", () => toggleAdminModal(false));
  document.getElementById("admin-modal-backdrop").addEventListener("click", () => toggleAdminModal(false));

  document.getElementById("admin-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      await handleAdminLogin(Object.fromEntries(formData.entries()));
    } catch (error) {
      setAuthError(error.message);
    }
  });

  document.getElementById("logout-button").addEventListener("click", async () => {
    await logout().catch((error) => setStatus(error.message, true));
  });

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab));
  });

  document.getElementById("filter-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    state.filters = Object.fromEntries(formData.entries());
    await loadDashboard().catch((error) => setStatus(error.message, true));
  });

  document.getElementById("reset-filters").addEventListener("click", async () => {
    document.getElementById("filter-form").reset();
    state.filters = {};
    await loadFilters();
    await loadDashboard().catch((error) => setStatus(error.message, true));
  });

  document.getElementById("pivot-dimension").addEventListener("change", async () => {
    await loadDashboard().catch((error) => setStatus(error.message, true));
  });

  document.getElementById("report-limit").addEventListener("change", async () => {
    await loadDashboard().catch((error) => setStatus(error.message, true));
  });

  document.getElementById("export-csv").addEventListener("click", exportCsv);
  document.getElementById("chatbot-toggle").addEventListener("click", () => toggleChatbot());
  document.getElementById("chatbot-close").addEventListener("click", () => toggleChatbot(false));

  document.querySelectorAll(".quick-action").forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = button.dataset.prompt || "";
      addChatMessage("user", prompt);
      addChatMessage("bot", getChatbotReply(prompt));
      toggleChatbot(true);
    });
  });

  document.getElementById("chatbot-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("chatbot-input");
    const message = input.value.trim();
    if (!message) return;
    addChatMessage("user", message);
    addChatMessage("bot", getChatbotReply(message));
    input.value = "";
    toggleChatbot(true);
  });
}

async function init() {
  bindEvents();
  addChatMessage("bot", "Xin chào. Tôi có thể giúp bạn mở tab, hướng dẫn lọc dữ liệu và chỉ chỗ xuất báo cáo.");
  await checkAuth();
  await loadHealth();
  await loadFilters();
  await loadDashboard().catch((error) => setStatus(error.message, true));
}

init();
