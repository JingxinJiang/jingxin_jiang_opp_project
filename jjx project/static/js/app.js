//Basic data and functions

const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

let meta = { bureaus: [], statuses: [], priorities: [] };
let charts = { status: null, bureau: null, priority: null };
let searchTimer = null;

function ql(sel) {
  return document.querySelector(sel);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
//API Wrapper
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || "Invalid response" };
  }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText || "Request failed");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}
//Filter/Input Population/selection
function fillSelect(sel, values, includeAll = true) {
  const cur = sel.value;
  sel.innerHTML = "";
  if (includeAll) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "All";
    sel.appendChild(o);
  }
  for (const v of values) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
//Filter/Input Population/datalist
function fillDatalist(id, values) {
  const dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = "";
  for (const v of values) {
    const o = document.createElement("option");
    o.value = v;
    dl.appendChild(o);
  }
}

function parseISODate(s) {
  if (!s) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function chartDefaults() {
  return {
    color: "#c9d6ee",
    borderColor: "#273143",
    gridColor: "rgba(255,255,255,0.06)",
  };
}

function destroyChart(c) {
  if (c) {
    c.destroy();
  }
  return null;
}
//Rendering Visualizations Charts
function renderCharts(stats) {
  const c = chartDefaults();
  const commonLegend = {
    labels: { color: c.color, boxWidth: 12, font: { size: 11 } },
  };

  const byStatusLabels = Object.keys(stats.by_status || {});
  const byStatusData = byStatusLabels.map((k) => stats.by_status[k]);

  destroyChart(charts.status);
  charts.status = new Chart(ql("#chart-status"), {
    type: "doughnut",
    data: {
      labels: byStatusLabels,
      datasets: [
        {
          data: byStatusData,
          backgroundColor: [
            "#5b8cff",
            "#3ecf8e",
            "#ffb86b",
            "#c678ff",
            "#56b6c2",
            "#e06c75",
          ],
          borderWidth: 0,
        },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom", ...commonLegend } },
      cutout: "58%",
    },
  });

  const bureauEntries = Object.entries(stats.by_bureau || {}).sort(
    (a, b) => b[1] - a[1],
  );
  const bureauLabels = bureauEntries.map(([k]) => k);
  const bureauData = bureauEntries.map(([, v]) => v);

  destroyChart(charts.bureau);
  charts.bureau = new Chart(ql("#chart-bureau"), {
    type: "bar",
    data: {
      labels: bureauLabels,
      datasets: [
        {
          label: "Projects",
          data: bureauData,
          backgroundColor: "rgba(91, 255, 244, 0.55)",
          borderRadius: 0,
        },
      ],
    },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: c.color },
          grid: { color: c.gridColor },
        },
        y: {
          ticks: { color: c.color },
          grid: { display: false },
        },
      },
    },
  });

  const priLabels = Object.keys(stats.by_priority || {});
  const priData = priLabels.map((k) => stats.by_priority[k]);

  destroyChart(charts.priority);
  charts.priority = new Chart(ql("#chart-priority"), {
    type: "pie",
    data: {
      labels: priLabels,
      datasets: [
        {
          data: priData,
          backgroundColor: ["#ff6b6b", "#ffb86b", "#5b8cff", "#3ecf8e"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom", ...commonLegend } },
    },
  });
}
//Rendering statistics Cards
function renderStats(stats) {
  const root = ql("#stats-root");
  const topStatuses = Object.entries(stats.by_status || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");

  const budgetLine =
    stats.budget.projects_with_budget > 0
      ? `${money.format(stats.budget.total)} total · ${money.format(stats.budget.average)} avg (where set)`
      : "Set budgets on projects to see totals";

  root.innerHTML = `
    <article class="stat-card">
      <div class="stat-label">Total projects</div>
      <div class="stat-value">${stats.total_projects}</div>
      <div class="stat-sub">Across all bureaus</div>
    </article>
    <article class="stat-card">
      <div class="stat-label">Status mix</div>
      <div class="stat-value">${Object.keys(stats.by_status || {}).length}</div>
      <div class="stat-sub">${escapeHtml(topStatuses || "—")}</div>
    </article>
    <article class="stat-card">
      <div class="stat-label">Bureaus</div>
      <div class="stat-value">${Object.keys(stats.by_bureau || {}).length}</div>
      <div class="stat-sub">Distinct bureau values</div>
    </article>
    <article class="stat-card">
      <div class="stat-label">Budget</div>
      <div class="stat-value">${stats.budget.projects_with_budget}</div>
      <div class="stat-sub">${escapeHtml(budgetLine)}</div>
    </article>
  `;
}
//Rendering Timeline
function renderTimeline(projects) {
  const root = ql("#timeline-root");
  if (!projects.length) {
    root.innerHTML = `<p class="muted">No projects to plot.</p>`;
    return;
  }

  const dates = [];
  for (const p of projects) {
    const s = parseISODate(p.start_date);
    if (s) dates.push(s.getTime());
    const end = p.end_date ? parseISODate(p.end_date) : new Date();
    if (end) dates.push(end.getTime());
  }
  if (!dates.length) {
    root.innerHTML = `<p class="muted">No valid dates on projects.</p>`;
    return;
  }
  const min = Math.min(...dates);
  const max = Math.max(...dates);
  const span = Math.max(max - min, 1);

  const rows = [...projects]
    .filter((p) => parseISODate(p.start_date))
    .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
    .map((p) => {
      const s = parseISODate(p.start_date).getTime();
      const eRaw = p.end_date ? parseISODate(p.end_date) : new Date();
      const e = (eRaw || new Date()).getTime();
      const left = ((s - min) / span) * 100;
      const width = Math.max(((e - s) / span) * 100, 1.2);
      const endLabel = p.end_date || "ongoing";
      return `
        <div class="timeline-row">
          <div class="timeline-meta">
            <div class="timeline-name" title="${escapeHtml(p.project_name)}">${escapeHtml(p.project_name)}</div>
            <div class="timeline-dates">${escapeHtml(p.start_date)} → ${escapeHtml(endLabel)}</div>
          </div>
          <div class="timeline-track" aria-hidden="true">
            <div class="timeline-bar" style="left:${left.toFixed(2)}%; width:${width.toFixed(2)}%"></div>
          </div>
        </div>`;
    });

  root.innerHTML = rows.join("");
}
//Rendering project Table list + Row Actions
function renderTable(projects) {
  const tbody = ql("#projects-tbody");
  const empty = ql("#projects-empty");
  tbody.innerHTML = "";
  if (!projects.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const p of projects) {
    const tr = document.createElement("tr");
    const budget =
      p.budget != null && p.budget !== ""
        ? money.format(Number(p.budget))
        : "—";
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.project_name)}</strong></td>
      <td>${escapeHtml(p.bureau)}</td>
      <td><span class="pill">${escapeHtml(p.status)}</span></td>
      <td>${escapeHtml(p.priority)}</td>
      <td>${escapeHtml(p.start_date || "")}</td>
      <td>${escapeHtml(p.end_date || "—")}</td>
      <td>${escapeHtml(budget)}</td>
      <td>
        <button type="button" class="btn small ghost btn-edit" data-id="${p.id}">Edit</button>
        <button type="button" class="btn small danger btn-delete" data-id="${p.id}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => openModal(Number(btn.dataset.id)));
  });
  tbody.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteProject(Number(btn.dataset.id)));
  });
}

//Query Building for Filters/sort
function queryString() {
  const params = new URLSearchParams();
  const search = ql("#filter-search").value.trim();
  const status = ql("#filter-status").value;
  const bureau = ql("#filter-bureau").value;
  const priority = ql("#filter-priority").value;
  const sort = ql("#sort-field").value;
  const order = ql("#sort-order").value;
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  if (bureau) params.set("bureau", bureau);
  if (priority) params.set("priority", priority);
  params.set("sort", sort);
  params.set("order", order);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
//Data Refresh/stats whole projects table (stat cards + Charts) / projects with filtered and sorted (Table + timeline)
async function refreshAll() {
  const [stats, projects] = await Promise.all([
    api("/api/stats"),
    api(`/api/projects${queryString()}`),
  ]);
  renderStats(stats);
  renderCharts(stats);
  renderTimeline(projects);
  renderTable(projects);
}
//Keep UI in sync with database (Dropdown of select and datalist by order from the whole table)
async function loadMeta() {
  meta = await api("/api/meta");
  fillSelect(ql("#filter-status"), meta.statuses, true);
  fillSelect(ql("#filter-bureau"), meta.bureaus, true);
  fillSelect(ql("#filter-priority"), meta.priorities, true);
  fillDatalist("dl-bureau", meta.bureaus);
  fillDatalist("dl-status", meta.statuses);
  fillDatalist("dl-priority", meta.priorities);
}

function clearFieldErrors() {
  document.querySelectorAll(".error[data-err-for]").forEach((el) => {
    el.textContent = "";
    el.classList.add("hidden");
  });
  ql("#form-api-error").classList.add("hidden");
  ql("#form-api-error").textContent = "";
}

function showFieldError(field, message) {
  const el = document.querySelector(`[data-err-for="${field}"]`);
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
}
//Checks: required fields/max lengths/end date not before start date/budget is non-negative number
function validateForm() {
  clearFieldErrors();
  let ok = true;
  const project_name = ql("#field-project_name").value.trim();
  const bureau = ql("#field-bureau").value.trim();
  const status = ql("#field-status").value.trim();
  const priority = ql("#field-priority").value.trim();
  const start_date = ql("#field-start_date").value;
  const end_date = ql("#field-end_date").value;
  const budgetRaw = ql("#field-budget").value.trim();
  const description = ql("#field-description").value;

  if (!project_name) {
    showFieldError("project_name", "Enter a project name.");
    ok = false;
  } else if (project_name.length > 500) {
    showFieldError("project_name", "Max 500 characters.");
    ok = false;
  }

  if (!bureau) {
    showFieldError("bureau", "Enter a bureau.");
    ok = false;
  }
  if (!status) {
    showFieldError("status", "Enter a status.");
    ok = false;
  }
  if (!priority) {
    showFieldError("priority", "Enter a priority.");
    ok = false;
  }
  if (!start_date) {
    showFieldError("start_date", "Pick a start date.");
    ok = false;
  }

  if (end_date && start_date && end_date < start_date) {
    showFieldError("end_date", "End date cannot be before start date.");
    ok = false;
  }

  if (budgetRaw) {
    const n = Number(budgetRaw);
    if (Number.isNaN(n) || n < 0) {
      showFieldError("budget", "Budget must be a non-negative number.");
      ok = false;
    }
  }

  if (description.length > 5000) {
    showFieldError("description", "Max 5000 characters.");
    ok = false;
  }

  return ok;
}
//Edit button open Edit project modal/ new project post in app.py
function openModal(id = null) {
  const modal = ql("#modal");
  const backdrop = ql("#modal-backdrop");
  ql("#modal-title").textContent = id ? "Edit project" : "New project";
  ql("#field-id").value = id || "";
  clearFieldErrors();

  if (!id) {
    ql("#project-form").reset();
    ql("#field-id").value = "";
    ql("#field-budget").value = "";
    modal.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    return;
  }

  api(`/api/projects/${id}`)
    .then((p) => {
      ql("#field-project_name").value = p.project_name || "";
      ql("#field-bureau").value = p.bureau || "";
      ql("#field-status").value = p.status || "";
      ql("#field-priority").value = p.priority || "";
      ql("#field-start_date").value = p.start_date || "";
      ql("#field-end_date").value = p.end_date || "";
      ql("#field-description").value = p.description || "";
      ql("#field-budget").value = p.budget != null ? String(p.budget) : "";
      modal.classList.remove("hidden");
      backdrop.classList.remove("hidden");
    })
    .catch((e) => {
      alert(e.message || "Could not load project");
    });
}

function closeModal() {
  ql("#modal").classList.add("hidden");
  ql("#modal-backdrop").classList.add("hidden");
}

async function saveProject(ev) {
  ev.preventDefault();
  if (!validateForm()) return;

  const id = ql("#field-id").value;
  const payload = {
    project_name: ql("#field-project_name").value.trim(),
    bureau: ql("#field-bureau").value.trim(),
    status: ql("#field-status").value.trim(),
    priority: ql("#field-priority").value.trim(),
    start_date: ql("#field-start_date").value,
    end_date: ql("#field-end_date").value || null,
    description: ql("#field-description").value.trim() || null,
  };
  const b = ql("#field-budget").value.trim();
  payload.budget = b === "" ? null : Number(b);

  try {
    if (id) {
      await api(`/api/projects/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await api("/api/projects", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    closeModal();
    await loadMeta();
    await refreshAll();
  } catch (e) {
    const msg = e.body?.error || e.message || "Save failed";
    const box = ql("#form-api-error");
    box.textContent = msg;
    box.classList.remove("hidden");
  }
}

async function deleteProject(id) {
  if (!confirm("Delete this project? This cannot be undone.")) return;
  try {
    await api(`/api/projects/${id}`, { method: "DELETE" });
    await loadMeta();
    await refreshAll();
  } catch (e) {
    alert(e.body?.error || e.message || "Delete failed");
  }
}
//Wait 220ms after user stops typing, then refreshes/Prevents multiple API calls
function scheduleRefresh() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    refreshAll().catch((e) => console.error(e));
  }, 220);
}

function resetFilters() {
  ql("#filter-search").value = "";
  ql("#filter-status").value = "";
  ql("#filter-bureau").value = "";
  ql("#filter-priority").value = "";
  ql("#sort-field").value = "start_date";
  ql("#sort-order").value = "desc";
  refreshAll().catch((e) => console.error(e));
}
//All button/form/filter listeners
async function boot() {
  await loadMeta();
  await refreshAll();

  ql("#btn-new-project").addEventListener("click", () => openModal(null));
  ql("#modal-close").addEventListener("click", closeModal);
  ql("#btn-cancel").addEventListener("click", closeModal);
  ql("#modal-backdrop").addEventListener("click", closeModal);
  ql("#project-form").addEventListener("submit", saveProject);

  ql("#filter-search").addEventListener("input", scheduleRefresh);
  ql("#filter-status").addEventListener("change", () =>
    refreshAll().catch(console.error),
  );
  ql("#filter-bureau").addEventListener("change", () =>
    refreshAll().catch(console.error),
  );
  ql("#filter-priority").addEventListener("change", () =>
    refreshAll().catch(console.error),
  );
  ql("#sort-field").addEventListener("change", () =>
    refreshAll().catch(console.error),
  );
  ql("#sort-order").addEventListener("change", () =>
    refreshAll().catch(console.error),
  );
  ql("#btn-reset-filters").addEventListener("click", resetFilters);

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeModal();
  });
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<p style="padding:16px;color:#ffb4b4">Failed to start: ${escapeHtml(e.message)}</p>`,
  );
});
