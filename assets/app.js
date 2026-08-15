const grid = document.getElementById("grid");
const toolbar = document.getElementById("toolbar");
const generated = document.getElementById("generated");
const countEl = document.getElementById("count");

let projects = [];
let active = "All";

function fmtWhen(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function hostLabel(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function categories(list) {
  return ["All", ...new Set(list.map((p) => p.category).filter(Boolean))];
}

function renderFilters() {
  toolbar.innerHTML = "";
  for (const cat of categories(projects)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter sans";
    btn.textContent = cat;
    btn.setAttribute("aria-pressed", String(cat === active));
    btn.addEventListener("click", () => {
      active = cat;
      renderFilters();
      renderGrid();
    });
    toolbar.appendChild(btn);
  }
}

function renderGrid() {
  const list =
    active === "All"
      ? projects
      : projects.filter((p) => p.category === active);

  grid.innerHTML = "";
  if (list.length === 0) {
    grid.innerHTML = `<p class="empty">No projects in this group yet.</p>`;
    return;
  }

  for (const p of list) {
    const a = document.createElement("a");
    a.className = "card";
    a.href = p.url;
    a.innerHTML = `
      <div>
        <div class="cat sans">${escapeHtml(p.category || "Projects")}</div>
        <h2>${escapeHtml(p.name)}</h2>
        <p>${escapeHtml(p.tagline || "")}</p>
      </div>
      <div class="card-foot sans">
        <span>${escapeHtml(hostLabel(p.url))}</span>
        <span class="go">Open →</span>
      </div>
    `;
    grid.appendChild(a);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function load() {
  try {
    const res = await fetch("./data/catalog.json", { cache: "no-store" });
    if (!res.ok) throw new Error(res.statusText);
    const catalog = await res.json();
    projects = catalog.projects || [];
    generated.textContent = catalog.generatedAt
      ? `Updated ${fmtWhen(catalog.generatedAt)}`
      : "";
    countEl.textContent = `${projects.length} live project${projects.length === 1 ? "" : "s"}`;
    renderFilters();
    renderGrid();
  } catch (err) {
    grid.innerHTML = `<p class="empty">Could not load the project list (${escapeHtml(err.message)}).</p>`;
  }
}

load();
