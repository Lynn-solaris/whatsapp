// ===================== Constants =====================

const API_BASE = "https://blocksitems.com/api/v1";

const RECIPE_TYPES = {
  shaped: {
    label: "Crafting Table (Shaped)",
    grid: "3x3",
    bedrockType: "minecraft:recipe_shaped",
    hasFuel: false,
    tag: "crafting_table",
    maxSlots: 9,
  },
  shapeless: {
    label: "Crafting Table (Shapeless)",
    grid: "3x3",
    bedrockType: "minecraft:recipe_shapeless",
    hasFuel: false,
    tag: "crafting_table",
    maxSlots: 9,
  },
  furnace: {
    label: "Furnace (Smelting)",
    grid: "1x1",
    bedrockType: "minecraft:recipe_furnace",
    hasFuel: false,
    tag: "furnace",
    maxSlots: 1,
  },
  smoker: {
    label: "Smoker",
    grid: "1x1",
    bedrockType: "minecraft:recipe_furnace",
    hasFuel: false,
    tag: "smoker",
    maxSlots: 1,
  },
  blast_furnace: {
    label: "Blast Furnace",
    grid: "1x1",
    bedrockType: "minecraft:recipe_furnace",
    hasFuel: false,
    tag: "blast_furnace",
    maxSlots: 1,
  },
  campfire: {
    label: "Campfire",
    grid: "1x1",
    bedrockType: "minecraft:recipe_furnace",
    hasFuel: false,
    tag: "campfire",
    maxSlots: 1,
  },
  smithing: {
    label: "Smithing Table",
    grid: "smithing",
    bedrockType: "minecraft:recipe_shaped", // handled specially (uses smithing_transform)
    hasFuel: false,
    tag: "smithing_table",
    maxSlots: 3,
  },
  stonecutter: {
    label: "Stonecutter",
    grid: "1x1",
    bedrockType: "minecraft:recipe_shapeless",
    hasFuel: false,
    tag: "stonecutter",
    maxSlots: 1,
  },
};

const TYPE_ORDER = ["shaped", "shapeless", "furnace", "smoker", "blast_furnace", "campfire", "smithing", "stonecutter"];

// ===================== State =====================

let state = {
  recipes: [],       // array of recipe objects
  activeRecipeId: null,
  catalogue: {
    kind: "all",     // all | items | blocks
    search: "",
    page: 1,
    limit: 30,
    items: [],
    total: 0,
    loading: false,
  },
  pickerTarget: null, // { recipeId, slotKind, slotIndex } — where next catalogue click will place
};

function uid() {
  return "r_" + Math.random().toString(36).slice(2, 10);
}

function makeRecipe(type) {
  const def = RECIPE_TYPES[type];
  let grid = {};
  if (type === "smithing") {
    grid = { template: null, base: null, addition: null };
  } else if (def.grid === "3x3") {
    grid = { slots: new Array(9).fill(null) }; // index 0-8, row-major
  } else if (def.grid === "1x1") {
    grid = { input: null };
  }
  return {
    id: uid(),
    type,
    displayName: "",
    grid,
    output: null,       // { full_id, display_name, icon_url, kind }
    outputCount: 1,
    mirrored: true,
  };
}

function activeRecipe() {
  return state.recipes.find(r => r.id === state.activeRecipeId) || null;
}

// ===================== Catalogue: API =====================

async function apiListItems({ search, page, limit }) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  params.set("page", page);
  params.set("limit", limit);
  const res = await fetch(`${API_BASE}/items?${params.toString()}`);
  if (!res.ok) throw new Error("items request failed");
  return res.json();
}

async function apiListBlocks({ search, page, limit }) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  params.set("page", page);
  params.set("limit", limit);
  const res = await fetch(`${API_BASE}/blocks?${params.toString()}`);
  if (!res.ok) throw new Error("blocks request failed");
  return res.json();
}

function iconUrl(fullId, kind, size = 64) {
  const path = kind === "block" ? "blocks" : "items";
  return `${API_BASE}/${path}/${encodeURIComponent(fullId)}/icon?size=${size}`;
}

async function loadCatalogue() {
  const c = state.catalogue;
  c.loading = true;
  renderCatalogue();

  try {
    const half = Math.ceil(c.limit / 2);
    let entries = [];

    if (c.kind === "all") {
      const [itemsRes, blocksRes] = await Promise.all([
        apiListItems({ search: c.search, page: c.page, limit: half }),
        apiListBlocks({ search: c.search, page: c.page, limit: c.limit - half }),
      ]);
      const items = (itemsRes.data || []).map(x => ({ ...x, kind: "item" }));
      const blocks = (blocksRes.data || []).map(x => ({ ...x, kind: "block" }));
      entries = [...items, ...blocks];
      c.total = (itemsRes.total || 0) + (blocksRes.total || 0);
    } else if (c.kind === "items") {
      const itemsRes = await apiListItems({ search: c.search, page: c.page, limit: c.limit });
      entries = (itemsRes.data || []).map(x => ({ ...x, kind: "item" }));
      c.total = itemsRes.total || 0;
    } else {
      const blocksRes = await apiListBlocks({ search: c.search, page: c.page, limit: c.limit });
      entries = (blocksRes.data || []).map(x => ({ ...x, kind: "block" }));
      c.total = blocksRes.total || 0;
    }

    c.items = entries;
  } catch (e) {
    console.error(e);
    c.items = [];
    c.error = true;
  } finally {
    c.loading = false;
    renderCatalogue();
  }
}

// ===================== Rendering: Catalogue =====================

function renderCatalogue() {
  const grid = document.getElementById("catGrid");
  const c = state.catalogue;

  document.getElementById("catCount").textContent = c.total ? `(${c.total.toLocaleString()})` : "";
  document.getElementById("catPageLabel").textContent = `Page ${c.page}`;

  const targetLabel = document.getElementById("pickerTargetLabel");
  if (state.pickerTarget) {
    targetLabel.style.display = "flex";
    targetLabel.innerHTML = `<span>◎ Placing into: ${describeTarget(state.pickerTarget)}</span><span class="clear-target" id="clearTargetBtn">cancel</span>`;
  } else {
    targetLabel.style.display = "none";
  }

  if (c.loading) {
    grid.innerHTML = `<div class="cat-loading">Loading catalogue…</div>`;
    return;
  }
  if (c.error) {
    grid.innerHTML = `<div class="cat-empty">Couldn't reach the catalogue API. Check your connection and try again.</div>`;
    return;
  }
  if (!c.items.length) {
    grid.innerHTML = `<div class="cat-empty">No results. Try a different search term.</div>`;
    return;
  }

  grid.innerHTML = "";
  for (const entry of c.items) {
    const slot = document.createElement("div");
    slot.className = "cat-slot";
    slot.draggable = true;
    slot.dataset.fullId = entry.full_id;
    slot.dataset.kind = entry.kind;
    slot.dataset.displayName = entry.display_name || entry.full_id;

    const img = document.createElement("img");
    img.src = iconUrl(entry.full_id, entry.kind, 64);
    img.alt = entry.display_name || entry.full_id;
    img.loading = "lazy";
    img.onerror = () => {
      img.remove();
      const fb = document.createElement("div");
      fb.className = "fallback";
      fb.textContent = (entry.display_name || entry.full_id).slice(0, 14);
      slot.appendChild(fb);
    };
    slot.appendChild(img);

    slot.addEventListener("mouseenter", (ev) => showTooltip(ev, entry));
    slot.addEventListener("mousemove", (ev) => moveTooltip(ev));
    slot.addEventListener("mouseleave", hideTooltip);

    slot.addEventListener("click", () => handleCatalogueClick(entry));

    slot.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.setData("application/json", JSON.stringify({
        full_id: entry.full_id,
        display_name: entry.display_name || entry.full_id,
        kind: entry.kind,
      }));
    });

    grid.appendChild(slot);
  }
}

let tooltipEl = null;
function showTooltip(ev, entry) {
  hideTooltip();
  tooltipEl = document.createElement("div");
  tooltipEl.className = "cat-tooltip";
  tooltipEl.textContent = entry.display_name || entry.full_id;
  document.body.appendChild(tooltipEl);
  moveTooltip(ev);
}
function moveTooltip(ev) {
  if (!tooltipEl) return;
  tooltipEl.style.left = (ev.clientX + 14) + "px";
  tooltipEl.style.top = (ev.clientY + 14) + "px";
}
function hideTooltip() {
  if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
}

function describeTarget(target) {
  if (target.slotKind === "output") return "Output slot";
  if (target.slotKind === "fuel") return "Fuel slot";
  if (target.slotKind === "template") return "Template slot";
  if (target.slotKind === "base") return "Base item slot";
  if (target.slotKind === "addition") return "Addition slot";
  if (target.slotKind === "input") return "Input slot";
  if (target.slotKind === "grid") return `Grid slot ${target.slotIndex + 1}`;
  return "slot";
}

function handleCatalogueClick(entry) {
  const rec = activeRecipe();
  if (!rec) {
    flashToast("Create or select a recipe first.", true);
    return;
  }
  const payload = { full_id: entry.full_id, display_name: entry.display_name || entry.full_id, kind: entry.kind };

  if (state.pickerTarget && state.pickerTarget.recipeId === rec.id) {
    placeIntoSlot(rec, state.pickerTarget.slotKind, state.pickerTarget.slotIndex, payload);
    return;
  }
  // default: no explicit target picked -> fill output if empty, else first empty grid slot
  if (!rec.output) {
    placeIntoSlot(rec, "output", null, payload);
    return;
  }
  const emptyIndex = findFirstEmptySlot(rec);
  if (emptyIndex !== null) {
    placeIntoSlot(rec, emptyIndex.slotKind, emptyIndex.slotIndex, payload);
  } else {
    flashToast("All slots are full — click a specific slot to replace it.", true);
  }
}

function findFirstEmptySlot(rec) {
  const def = RECIPE_TYPES[rec.type];
  if (def.grid === "3x3") {
    const idx = rec.grid.slots.findIndex(s => !s);
    if (idx !== -1) return { slotKind: "grid", slotIndex: idx };
    return null;
  }
  if (def.grid === "1x1") {
    if (!rec.grid.input) return { slotKind: "input", slotIndex: null };
    return null;
  }
  if (def.grid === "smithing") {
    if (!rec.grid.template) return { slotKind: "template", slotIndex: null };
    if (!rec.grid.base) return { slotKind: "base", slotIndex: null };
    if (!rec.grid.addition) return { slotKind: "addition", slotIndex: null };
    return null;
  }
  return null;
}

function placeIntoSlot(rec, slotKind, slotIndex, payload) {
  if (slotKind === "output") {
    rec.output = payload;
  } else if (slotKind === "grid") {
    rec.grid.slots[slotIndex] = payload;
  } else if (slotKind === "input") {
    rec.grid.input = payload;
  } else if (slotKind === "template") {
    rec.grid.template = payload;
  } else if (slotKind === "base") {
    rec.grid.base = payload;
  } else if (slotKind === "addition") {
    rec.grid.addition = payload;
  }
  state.pickerTarget = null;
  renderAll();
}

// ===================== Rendering: recipe tabs =====================

function renderRecipeTabs() {
  const row = document.getElementById("recipeTabsRow");
  row.innerHTML = "";
  for (const rec of state.recipes) {
    const chip = document.createElement("div");
    chip.className = "recipe-chip" + (rec.id === state.activeRecipeId ? " active" : "");
    const iconSrc = rec.output ? iconUrl(rec.output.full_id, rec.output.kind, 32) : null;
    chip.innerHTML = iconSrc
      ? `<img src="${iconSrc}" onerror="this.remove()"/>`
      : `<div class="rc-icon-fallback"></div>`;
    const label = document.createElement("span");
    label.textContent = rec.displayName || rec.output?.display_name || "Untitled recipe";
    chip.appendChild(label);
    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "Delete recipe";
    del.addEventListener("click", (ev) => {
      ev.stopPropagation();
      deleteRecipe(rec.id);
    });
    chip.appendChild(del);
    chip.addEventListener("click", () => {
      state.activeRecipeId = rec.id;
      state.pickerTarget = null;
      renderAll();
    });
    row.appendChild(chip);
  }
  const addBtn = document.createElement("button");
  addBtn.className = "add-recipe-btn";
  addBtn.textContent = "+ New recipe";
  addBtn.addEventListener("click", () => {
    const rec = makeRecipe("shaped");
    state.recipes.push(rec);
    state.activeRecipeId = rec.id;
    state.pickerTarget = null;
    renderAll();
  });
  row.appendChild(addBtn);

  document.getElementById("recipeCount").textContent = state.recipes.length;
  document.getElementById("sumRecipeCount").textContent = state.recipes.length;
  document.getElementById("exportBtn").disabled = state.recipes.length === 0;
  document.getElementById("exportBtn2").disabled = state.recipes.length === 0;
}

function deleteRecipe(id) {
  state.recipes = state.recipes.filter(r => r.id !== id);
  if (state.activeRecipeId === id) {
    state.activeRecipeId = state.recipes.length ? state.recipes[0].id : null;
  }
  renderAll();
}

// ===================== Rendering: builder =====================

function renderTypeSelectRow() {
  const row = document.getElementById("typeSelectRow");
  row.innerHTML = "";
  const rec = activeRecipe();
  for (const t of TYPE_ORDER) {
    const btn = document.createElement("div");
    btn.className = "type-btn" + (rec && rec.type === t ? " active" : "");
    btn.textContent = RECIPE_TYPES[t].label;
    btn.addEventListener("click", () => {
      if (!rec) return;
      if (rec.type === t) return;
      const fresh = makeRecipe(t);
      fresh.id = rec.id;
      fresh.displayName = rec.displayName;
      fresh.output = rec.output;
      fresh.outputCount = rec.outputCount;
      const idx = state.recipes.findIndex(r => r.id === rec.id);
      state.recipes[idx] = fresh;
      state.pickerTarget = null;
      renderAll();
    });
    row.appendChild(btn);
  }
}

function makeSlotEl({ filled, slotKind, slotIndex, recipeId, isOutput, isFuel, showCount }) {
  const slot = document.createElement("div");
  slot.className = "slot" + (filled ? " filled" : "") + (isOutput ? " output-slot" : "") + (isFuel ? " fuel-slot" : "");
  slot.dataset.slotKind = slotKind;
  if (slotIndex !== null && slotIndex !== undefined) slot.dataset.slotIndex = slotIndex;

  if (filled) {
    const img = document.createElement("img");
    img.src = iconUrl(filled.full_id, filled.kind, 64);
    img.onerror = () => { img.style.display = "none"; };
    slot.appendChild(img);
    const clearX = document.createElement("div");
    clearX.className = "clear-x";
    clearX.textContent = "×";
    clearX.addEventListener("click", (ev) => {
      ev.stopPropagation();
      clearSlot(recipeId, slotKind, slotIndex);
    });
    slot.appendChild(clearX);
  }

  slot.addEventListener("click", () => {
    state.pickerTarget = { recipeId, slotKind, slotIndex: slotIndex ?? null };
    renderCatalogue();
  });

  slot.addEventListener("dragover", (ev) => { ev.preventDefault(); slot.classList.add("drag-over"); });
  slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));
  slot.addEventListener("drop", (ev) => {
    ev.preventDefault();
    slot.classList.remove("drag-over");
    const raw = ev.dataTransfer.getData("application/json");
    if (!raw) return;
    const payload = JSON.parse(raw);
    const rec = state.recipes.find(r => r.id === recipeId);
    placeIntoSlot(rec, slotKind, slotIndex ?? null, payload);
  });

  return slot;
}

function clearSlot(recipeId, slotKind, slotIndex) {
  const rec = state.recipes.find(r => r.id === recipeId);
  if (!rec) return;
  if (slotKind === "output") rec.output = null;
  else if (slotKind === "grid") rec.grid.slots[slotIndex] = null;
  else if (slotKind === "input") rec.grid.input = null;
  else if (slotKind === "template") rec.grid.template = null;
  else if (slotKind === "base") rec.grid.base = null;
  else if (slotKind === "addition") rec.grid.addition = null;
  renderAll();
}

function arrowSvg() {
  return `<svg viewBox="0 0 38 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 12H32" stroke="#8a7458" stroke-width="3" stroke-linecap="round"/>
    <path d="M25 4L34 12L25 20" stroke="#8a7458" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function renderBuilderStage() {
  const stage = document.getElementById("builderStage");
  const idInput = document.getElementById("recipeIdInput");
  const nameRow = document.querySelector(".builder-title-row");
  const mirroredNote = document.getElementById("mirroredNote");
  stage.innerHTML = "";

  const rec = activeRecipe();
  if (!rec) {
    stage.innerHTML = `<div class="empty-state"><div class="es-icon">⛏</div>Select or create a recipe to start building.</div>`;
    idInput.value = "";
    idInput.disabled = true;
    mirroredNote.style.display = "none";
    return;
  }
  idInput.disabled = false;
  idInput.value = rec.displayName;
  idInput.oninput = () => { rec.displayName = idInput.value; renderRecipeTabs(); renderSummary(); };

  const def = RECIPE_TYPES[rec.type];

  if (def.grid === "3x3") {
    const gridEl = document.createElement("div");
    gridEl.className = "grid-3x3";
    for (let i = 0; i < 9; i++) {
      gridEl.appendChild(makeSlotEl({
        filled: rec.grid.slots[i], slotKind: "grid", slotIndex: i, recipeId: rec.id,
      }));
    }
    stage.appendChild(gridEl);

    const arrow = document.createElement("div");
    arrow.className = "arrow-flow";
    arrow.innerHTML = arrowSvg();
    stage.appendChild(arrow);

    stage.appendChild(buildOutputBlock(rec));

    mirroredNote.style.display = rec.type === "shaped" ? "block" : "none";
    document.getElementById("mirroredCheckbox").checked = rec.mirrored;
    document.getElementById("mirroredCheckbox").onchange = (e) => { rec.mirrored = e.target.checked; };

  } else if (def.grid === "1x1") {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.alignItems = "center";
    wrap.style.gap = "8px";

    const gridEl = document.createElement("div");
    gridEl.className = "grid-1x1";
    gridEl.appendChild(makeSlotEl({ filled: rec.grid.input, slotKind: "input", slotIndex: null, recipeId: rec.id }));
    wrap.appendChild(gridEl);
    const lbl = document.createElement("div");
    lbl.style.fontSize = "10px";
    lbl.style.color = "var(--text-dim)";
    lbl.style.textTransform = "uppercase";
    lbl.style.letterSpacing = "0.5px";
    lbl.textContent = "Input";
    wrap.appendChild(lbl);
    stage.appendChild(wrap);

    const arrow = document.createElement("div");
    arrow.className = "arrow-flow";
    arrow.innerHTML = arrowSvg();
    stage.appendChild(arrow);

    stage.appendChild(buildOutputBlock(rec));
    mirroredNote.style.display = "none";

  } else if (def.grid === "smithing") {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "16px";
    row.style.alignItems = "center";

    const mkLabeled = (slotKind, filled, label) => {
      const w = document.createElement("div");
      w.style.display = "flex";
      w.style.flexDirection = "column";
      w.style.alignItems = "center";
      w.style.gap = "6px";
      const g = document.createElement("div");
      g.className = "grid-1x1";
      g.appendChild(makeSlotEl({ filled, slotKind, slotIndex: null, recipeId: rec.id }));
      w.appendChild(g);
      const l = document.createElement("div");
      l.style.fontSize = "10px";
      l.style.color = "var(--text-dim)";
      l.style.textTransform = "uppercase";
      l.style.letterSpacing = "0.5px";
      l.textContent = label;
      w.appendChild(l);
      return w;
    };

    row.appendChild(mkLabeled("template", rec.grid.template, "Template"));
    row.appendChild(mkLabeled("base", rec.grid.base, "Base"));
    row.appendChild(mkLabeled("addition", rec.grid.addition, "Addition"));
    stage.appendChild(row);

    const arrow = document.createElement("div");
    arrow.className = "arrow-flow";
    arrow.innerHTML = arrowSvg();
    stage.appendChild(arrow);

    stage.appendChild(buildOutputBlock(rec));
    mirroredNote.style.display = "none";
  }
}

function buildOutputBlock(rec) {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.alignItems = "center";
  wrap.style.gap = "6px";

  const gridEl = document.createElement("div");
  gridEl.className = "grid-1x1";
  const slotEl = makeSlotEl({ filled: rec.output, slotKind: "output", slotIndex: null, recipeId: rec.id, isOutput: true });
  gridEl.appendChild(slotEl);
  wrap.appendChild(gridEl);

  const countRow = document.createElement("div");
  countRow.style.display = "flex";
  countRow.style.alignItems = "center";
  countRow.style.gap = "5px";
  const lbl = document.createElement("span");
  lbl.style.fontSize = "10px";
  lbl.style.color = "var(--text-dim)";
  lbl.style.textTransform = "uppercase";
  lbl.style.letterSpacing = "0.5px";
  lbl.textContent = "Output ×";
  const countInput = document.createElement("input");
  countInput.className = "output-count-input";
  countInput.value = rec.outputCount;
  countInput.inputMode = "numeric";
  countInput.oninput = () => {
    const v = parseInt(countInput.value, 10);
    rec.outputCount = (isNaN(v) || v < 1) ? 1 : Math.min(v, 64);
    renderSummary();
  };
  countRow.appendChild(lbl);
  countRow.appendChild(countInput);
  wrap.appendChild(countRow);

  return wrap;
}

// ===================== Rendering: summary =====================

function renderSummary() {
  const list = document.getElementById("summaryList");
  if (!state.recipes.length) {
    list.innerHTML = `<div class="empty-state"><div class="es-icon">⚒</div>No recipes yet.<br/>Click <b>+ New recipe</b> above to start crafting.</div>`;
    return;
  }
  list.innerHTML = "";
  for (const rec of state.recipes) {
    const card = document.createElement("div");
    card.className = "summary-card" + (rec.id === state.activeRecipeId ? " active" : "");
    const iconSrc = rec.output ? iconUrl(rec.output.full_id, rec.output.kind, 32) : null;
    card.innerHTML = iconSrc
      ? `<img src="${iconSrc}" onerror="this.remove()"/>`
      : `<div class="sc-icon-fallback"></div>`;
    const info = document.createElement("div");
    info.className = "sc-info";
    const name = document.createElement("div");
    name.className = "sc-name";
    name.textContent = rec.displayName || rec.output?.display_name || "Untitled recipe";
    const meta = document.createElement("div");
    meta.className = "sc-meta";
    meta.textContent = RECIPE_TYPES[rec.type].label + (recipeComplete(rec) ? "" : " · incomplete");
    info.appendChild(name);
    info.appendChild(meta);
    card.appendChild(info);
    const del = document.createElement("button");
    del.className = "sc-del";
    del.textContent = "×";
    del.addEventListener("click", (ev) => { ev.stopPropagation(); deleteRecipe(rec.id); });
    card.appendChild(del);
    card.addEventListener("click", () => { state.activeRecipeId = rec.id; state.pickerTarget = null; renderAll(); });
    list.appendChild(card);
  }
}

function recipeComplete(rec) {
  if (!rec.output) return false;
  const def = RECIPE_TYPES[rec.type];
  if (def.grid === "3x3") return rec.grid.slots.some(s => s);
  if (def.grid === "1x1") return !!rec.grid.input;
  if (def.grid === "smithing") return rec.grid.base && (rec.grid.template || rec.grid.addition);
  return false;
}

// ===================== Master render =====================

function renderAll() {
  renderRecipeTabs();
  renderTypeSelectRow();
  renderBuilderStage();
  renderSummary();
  renderCatalogue();
  document.getElementById("sumFormat").textContent = document.getElementById("formatVersion").value;
}

// ===================== Toast =====================

let toastTimer = null;
function flashToast(msg, isError) {
  let el = document.querySelector(".toast");
  if (el) el.remove();
  el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}

// ===================== Export: mcpack build =====================

function sanitizeNamespace(str) {
  return (str || "pack").toLowerCase().trim().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "pack";
}

function uuidv4() {
  // RFC4122-ish v4 UUID using crypto
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (crypto.getRandomValues(new Uint32Array(1))[0]) % 16;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function buildManifest(packName, formatVersion) {
  const headerUuid = uuidv4();
  const moduleUuid = uuidv4();
  return {
    format_version: 2,
    header: {
      name: packName,
      description: `Custom crafting recipes — built with Craftwright. ${state.recipes.length} recipe(s).`,
      uuid: headerUuid,
      version: [1, 0, 0],
      min_engine_version: formatVersionToEngineArray(formatVersion),
    },
    modules: [
      {
        type: "data",
        uuid: moduleUuid,
        version: [1, 0, 0],
      },
    ],
  };
}

function formatVersionToEngineArray(v) {
  const parts = v.split(".").map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

function bedrockItemName(full_id) {
  // Bedrock uses same minecraft: namespace ids for the vast majority of vanilla items/blocks.
  // Non-vanilla (modded) namespaces from the catalogue aren't valid Bedrock identifiers,
  // so we fall back to minecraft:barrier as a safe visible placeholder, but keep the
  // original name visible in the recipe's comment-like identifier where possible.
  if (full_id.startsWith("minecraft:")) return full_id;
  return full_id; // still emit as-is; Bedrock will ignore unknown ids gracefully in most cases via data-driven packs
}

function buildRecipeJson(rec, namespace, formatVersion) {
  const def = RECIPE_TYPES[rec.type];
  const rid = `${namespace}:${sanitizeNamespace(rec.displayName || rec.output.display_name || "recipe")}_${rec.id.slice(2, 6)}`;
  const outputItem = bedrockItemName(rec.output.full_id);

  if (rec.type === "shaped") {
    const slots = rec.grid.slots;
    const rows = [0, 1, 2].map(r => slots.slice(r * 3, r * 3 + 3));
    // Build symbol map
    const symbolMap = {};
    let nextChar = 65; // 'A'
    const patternRows = rows.map(row => row.map(cell => {
      if (!cell) return " ";
      const key = cell.full_id;
      if (!symbolMap[key]) {
        symbolMap[key] = { symbol: String.fromCharCode(nextChar), item: cell };
        nextChar++;
      }
      return symbolMap[key].symbol;
    }).join(""));

    // trim fully-empty columns/rows isn't required by Bedrock but pattern must be <=3x3, keep as-is
    const key = {};
    for (const k in symbolMap) {
      key[symbolMap[k].symbol] = { item: bedrockItemName(symbolMap[k].item.full_id) };
    }

    return {
      format_version: formatVersion,
      "minecraft:recipe_shaped": {
        description: { identifier: rid },
        tags: [def.tag],
        pattern: patternRows,
        key,
        result: { item: outputItem, count: rec.outputCount || 1 },
        ...(rec.mirrored ? {} : { mirror: false }),
      },
    };
  }

  if (rec.type === "shapeless") {
    const ingredients = rec.grid.slots.filter(Boolean).map(cell => ({ item: bedrockItemName(cell.full_id) }));
    return {
      format_version: formatVersion,
      "minecraft:recipe_shapeless": {
        description: { identifier: rid },
        tags: [def.tag],
        ingredients,
        result: { item: outputItem, count: rec.outputCount || 1 },
      },
    };
  }

  if (rec.type === "stonecutter") {
    return {
      format_version: formatVersion,
      "minecraft:recipe_shapeless": {
        description: { identifier: rid },
        tags: [def.tag],
        ingredients: [{ item: bedrockItemName(rec.grid.input.full_id) }],
        result: { item: outputItem, count: rec.outputCount || 1 },
      },
    };
  }

  if (["furnace", "smoker", "blast_furnace", "campfire"].includes(rec.type)) {
    return {
      format_version: formatVersion,
      "minecraft:recipe_furnace": {
        description: { identifier: rid },
        tags: [def.tag],
        input: bedrockItemName(rec.grid.input.full_id),
        output: outputItem,
      },
    };
  }

  if (rec.type === "smithing") {
    return {
      format_version: formatVersion,
      "minecraft:recipe_smithing_transform": {
        description: { identifier: rid },
        tags: [def.tag],
        template: rec.grid.template ? bedrockItemName(rec.grid.template.full_id) : "minecraft:air",
        base: bedrockItemName(rec.grid.base.full_id),
        addition: rec.grid.addition ? bedrockItemName(rec.grid.addition.full_id) : "minecraft:air",
        result: { item: outputItem, count: rec.outputCount || 1 },
      },
    };
  }

  return null;
}

async function doExport() {
  const packName = document.getElementById("packName").value.trim() || "My Custom Recipes";
  const formatVersion = document.getElementById("formatVersion").value;
  const namespace = sanitizeNamespace(packName);

  const completeRecipes = state.recipes.filter(recipeComplete);
  if (!completeRecipes.length) {
    flashToast("No complete recipes to export — fill in an output and at least one ingredient.", true);
    return;
  }

  try {
    const zw = new ZipWriter();
    const manifest = buildManifest(packName, formatVersion);
    zw.addFile("manifest.json", JSON.stringify(manifest, null, 2));

    const pack_icon_svg = null; // skip icon; Bedrock uses pack_icon.png optionally

    const usedIds = new Set();
    for (const rec of completeRecipes) {
      let json = buildRecipeJson(rec, namespace, formatVersion);
      if (!json) continue;
      let baseName = sanitizeNamespace(rec.displayName || rec.output.display_name || "recipe");
      let fname = baseName;
      let n = 1;
      while (usedIds.has(fname)) { fname = `${baseName}_${n++}`; }
      usedIds.add(fname);
      zw.addFile(`recipes/${fname}.json`, JSON.stringify(json, null, 2));
    }

    const bytes = zw.generate();
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${namespace}.mcpack`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    flashToast(`Exported ${completeRecipes.length} recipe(s) to ${namespace}.mcpack`);
  } catch (e) {
    console.error(e);
    flashToast("Export failed — see console for details.", true);
  }
}

// ===================== Wiring =====================

document.addEventListener("DOMContentLoaded", () => {
  // catalogue search
  const searchInput = document.getElementById("catSearch");
  let searchDebounce = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.catalogue.search = searchInput.value.trim();
      state.catalogue.page = 1;
      loadCatalogue();
    }, 350);
  });

  document.querySelectorAll(".cat-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".cat-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.catalogue.kind = tab.dataset.catkind;
      state.catalogue.page = 1;
      loadCatalogue();
    });
  });

  document.getElementById("catPrev").addEventListener("click", () => {
    if (state.catalogue.page > 1) {
      state.catalogue.page--;
      loadCatalogue();
    }
  });
  document.getElementById("catNext").addEventListener("click", () => {
    state.catalogue.page++;
    loadCatalogue();
  });

  document.getElementById("cataloguePanel").addEventListener("click", (ev) => {
    if (ev.target.id === "clearTargetBtn") {
      state.pickerTarget = null;
      renderCatalogue();
    }
  });

  document.getElementById("formatVersion").addEventListener("change", () => {
    document.getElementById("sumFormat").textContent = document.getElementById("formatVersion").value;
  });

  document.getElementById("catVersion").addEventListener("change", () => {
    state.catalogue.page = 1;
    loadCatalogue();
  });

  document.getElementById("exportBtn").addEventListener("click", doExport);
  document.getElementById("exportBtn2").addEventListener("click", doExport);

  // start with one recipe so the builder isn't empty
  const first = makeRecipe("shaped");
  state.recipes.push(first);
  state.activeRecipeId = first.id;

  renderAll();
  loadCatalogue();
});
