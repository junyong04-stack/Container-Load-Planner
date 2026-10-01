import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { DEFAULT_RULES, displayImplementName, displayModelName } from "./catalog-core.js";
import { DEFAULT_IMPLEMENTS } from "./implement-data.js";
import { loadDefaultModels } from "./catalog.js";
import { calculateLoading } from "./loading.js";
import { BUFFER_LENGTH, CONTAINER_LENGTH, optimizeContainers } from "./planner.js";
import { buildOrderForm } from "./order-form.js";
import { makeCatalogStore } from "./catalog-store.js";
// Change this before sharing the link with anyone outside the team.
const ADMIN_PASSWORD = "tym-clp-2026";

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const catalogStore = makeCatalogStore(db);

const root = document.getElementById("root");

const unique = (values) => [...new Set(values)].sort();
const makeId = () => (typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : "load-" + Date.now());
const meter = (value) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

const state = {
  catalog: { models: [], implements: DEFAULT_IMPLEMENTS, rules: DEFAULT_RULES },
  category: "Tractor",
  tractorModel: "", ropsType: "", transmissionType: "", tireType: "",
  frontWeight: "Without F/W",
  implementType: "", implementId: "",
  quantity: 1,
  items: [],
  plannedItems: [],
  notice: "",
  catalogOpen: false,
  catalogTab: "Tractor",
  saving: false,
  exportingOrderForm: false,
  modelSearch: "",
  layoutView: "3d",
  newModel: { plant: "Okcheon", tractorModel: "", ropsType: "REAR", transmissionType: "GEAR", tireType: "AGRI", packUnit: "1", packLength: "3", erpCode: "" },
  newImplement: { plant: "Not Specified", implementType: "", modelName: "", packUnit: "1", packLength: "1", erpCode: "" },
  adminState: { authenticated: false, isAdmin: sessionStorage.getItem("clp-admin") === "1" },
};
state.adminState.authenticated = state.adminState.isAdmin;

function withFocusPreserved(fn) {
  const active = document.activeElement;
  const id = active && active.id;
  const hasSelection = active && typeof active.selectionStart === "number";
  const selStart = hasSelection ? active.selectionStart : null;
  const selEnd = hasSelection ? active.selectionEnd : null;
  fn();
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.focus();
  if (selStart != null && typeof el.setSelectionRange === "function") {
    try { el.setSelectionRange(selStart, selEnd); } catch { /* not a text field */ }
  }
}

function computeDerived() {
  const c = state.catalog;
  const tractorModels = unique(c.models.map((model) => model.tractorModel));
  const afterModel = c.models.filter((model) => model.tractorModel === state.tractorModel);
  const ropsTypes = unique(afterModel.map((model) => model.ropsType));
  const afterRops = afterModel.filter((model) => model.ropsType === state.ropsType);
  const transmissionTypes = unique(afterRops.map((model) => model.transmissionType));
  const afterTransmission = afterRops.filter((model) => model.transmissionType === state.transmissionType);
  const tireTypes = unique(afterTransmission.map((model) => model.tireType));
  const selectedTractor = afterTransmission.find((model) => model.tireType === state.tireType);
  const selectedRule = selectedTractor && c.rules.find((rule) => rule.id === selectedTractor.ruleId);
  const implementTypes = unique(c.implements.map((model) => model.implementType));
  const availableImplements = c.implements.filter((model) => model.implementType === state.implementType);
  const selectedImplement = c.implements.find((model) => model.id === state.implementId);
  const selectedProduct = state.category === "Tractor" ? selectedTractor : selectedImplement;
  const selectionComplete = state.category === "Tractor" ? Boolean(selectedTractor && selectedRule) : Boolean(selectedImplement);
  const quantityValid = state.quantity > 0 && Number.isInteger(state.quantity);

  const draftCalculation = calculateLoading(state.items, c);
  const calculation = calculateLoading(state.plannedItems, c);
  const draftLines = draftCalculation.lines;
  const lines = calculation.lines;
  const segments = calculation.segments;
  const containers = optimizeContainers(segments);
  const tractorTotal = calculation.tractorSpace;
  const implementTotal = calculation.implementSpace;
  const tireTotal = calculation.tireSpace;
  const bufferTotal = containers.reduce((sum, container) => sum + container.bufferSpace, 0);
  const usedTotal = tractorTotal + implementTotal + tireTotal + bufferTotal;
  const remainingTotal = Math.max(0, containers.length * CONTAINER_LENGTH - usedTotal);
  const utilization = containers.length ? (usedTotal / (containers.length * CONTAINER_LENGTH)) * 100 : 0;
  const pending = JSON.stringify(state.items) !== JSON.stringify(state.plannedItems);

  return {
    tractorModels, ropsTypes, transmissionTypes, tireTypes, selectedTractor, selectedRule,
    implementTypes, availableImplements, selectedImplement, selectedProduct, selectionComplete,
    quantityValid, draftLines, lines, segments, containers, tractorTotal, implementTotal,
    tireTotal, bufferTotal, usedTotal, remainingTotal, utilization, pending,
  };
}

function resetSelections(nextCategory) {
  state.category = nextCategory;
  state.tractorModel = ""; state.ropsType = ""; state.transmissionType = ""; state.tireType = "";
  state.frontWeight = "Without F/W";
  state.implementType = ""; state.implementId = ""; state.quantity = 1;
}

function resetTractorBelow(level) {
  if (level === "model") state.ropsType = "";
  if (level !== "transmission") state.transmissionType = "";
  state.tireType = "";
}

function addItem(derived) {
  if (!derived.selectionComplete || !derived.selectedProduct) { state.notice = "Please select all required options."; return; }
  if (!derived.quantityValid) { state.notice = "Quantity must be a positive whole number."; return; }
  if (!derived.selectedProduct.packLength) { state.notice = "Loading length data is missing for this configuration."; return; }
  if (derived.selectedProduct.packLength > CONTAINER_LENGTH) { state.notice = "This loading item exceeds the 12.0m container limit."; return; }
  const productId = derived.selectedProduct.id;
  const itemFrontWeight = state.category === "Tractor" ? state.frontWeight : undefined;
  const existing = state.items.find((item) => item.category === state.category && item.productId === productId && item.frontWeight === itemFrontWeight);
  if (existing) {
    existing.quantity += state.quantity;
  } else {
    state.items.push({ id: makeId(), category: state.category, productId, quantity: state.quantity, frontWeight: itemFrontWeight });
  }
  const name = state.category === "Tractor" ? displayModelName(derived.selectedProduct) : displayImplementName(derived.selectedProduct);
  state.notice = name + " added to the load list.";
}

function calculatePlan() {
  if (!state.items.length) return;
  state.plannedItems = state.items.map((item) => ({ ...item }));
  state.notice = "Optimal loading has been calculated for the complete load list.";
}

function resetAll() {
  state.items = []; state.plannedItems = []; state.notice = "";
}

async function refreshCatalogFromStore() {
  try {
    state.catalog = await catalogStore.readCatalog();
  } catch (error) {
    console.error("catalog refresh failed", error);
  }
}

async function saveCatalogItem(entity) {
  if (!state.adminState.isAdmin) { state.notice = "Administrator access is required."; return; }
  state.saving = true;
  render();
  try {
    const source = entity === "model" ? state.newModel : state.newImplement;
    const item = { ...source, packUnit: Number(source.packUnit), packLength: Number(source.packLength) };
    state.catalog = entity === "implement" ? await catalogStore.saveImplement(item) : await catalogStore.saveTractor(item);
    state.notice = "The shared product catalog has been updated.";
    if (entity === "implement") state.newImplement = { plant: "Not Specified", implementType: "", modelName: "", packUnit: "1", packLength: "1", erpCode: "" };
    else state.newModel = { plant: "Okcheon", tractorModel: "", ropsType: "REAR", transmissionType: "GEAR", tireType: "AGRI", packUnit: "1", packLength: "3", erpCode: "" };
  } catch (error) {
    state.notice = error instanceof Error ? error.message : "Unable to save this configuration.";
  } finally {
    state.saving = false;
  }
}

async function removeCatalogItem(id) {
  if (!state.adminState.isAdmin) { state.notice = "Administrator access is required."; return; }
  if (!window.confirm("Remove this configuration from the shared catalog?")) return;
  try {
    state.catalog = await catalogStore.removeCatalogItem(id);
    state.items = state.items.filter((item) => item.productId !== id);
    state.plannedItems = state.plannedItems.filter((item) => item.productId !== id);
    state.notice = "The configuration has been removed.";
  } catch (error) {
    state.notice = error instanceof Error ? error.message : "Unable to remove this configuration.";
  }
  render();
}

async function exportOrderForm(derived) {
  if (!derived.lines.length || derived.pending) return;
  const company = window.prompt("Company (optional)", "") ?? "";
  state.exportingOrderForm = true;
  render();
  try {
    const orderLines = derived.lines.map((line) => {
      if (line.category === "Implement") {
        const model = state.catalog.implements.find((entry) => entry.id === line.productId);
        if (!model) throw new Error("This product configuration is not available.");
        const details = [
          "1. Product Category: IMPLEMENT",
          `2. Implement Type: ${model.implementType.toUpperCase()}`,
          `3. Packaging Unit: ${model.packUnit}`,
        ];
        if (line.loadingQuantity !== line.quantity) details.push(`4. Loading Quantity: ${line.loadingQuantity}`);
        return { category: line.category, model: line.displayName, quantity: line.quantity, remark: details.join("\n") };
      }
      const model = state.catalog.models.find((entry) => entry.id === line.productId);
      if (!model) throw new Error("This product configuration is not available.");
      return {
        category: line.category,
        model: model.tractorModel.slice(0, 5).toUpperCase(),
        quantity: line.quantity,
        remark: [
          `1. ROPS Type: ${model.ropsType.toUpperCase()}`,
          `2. Tire Type: ${model.tireType.toUpperCase()}`,
          `3. Transmission Type: ${model.transmissionType.toUpperCase()}`,
          `4. Front Weight: ${line.frontWeight ?? "Without F/W"}`,
        ].join("\n"),
      };
    });
    const response = await fetch("./TYM_Order_Request_Template.xlsx");
    if (!response.ok) throw new Error("Unable to load the Order Form template.");
    const now = new Date();
    const workbook = await buildOrderForm({ template: await response.arrayBuffer(), company, orderDate: now, containerQuantity: derived.containers.length, lines: orderLines });
    const blob = new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    link.href = url; link.download = `TYM_Order_Form_${date}.xlsx`; link.click(); URL.revokeObjectURL(url);
    state.notice = "The Order Form has been downloaded.";
  } catch (error) {
    state.notice = error instanceof Error ? error.message : "Unable to create the Order Form.";
  } finally {
    state.exportingOrderForm = false;
  }
  render();
}

function adminLogin() {
  const password = window.prompt("Administrator password");
  if (password === null) return;
  if (password === ADMIN_PASSWORD) {
    state.adminState = { authenticated: true, isAdmin: true };
    sessionStorage.setItem("clp-admin", "1");
    state.notice = "Signed in as administrator.";
  } else {
    state.notice = "Incorrect password.";
  }
}

function adminLogout() {
  state.adminState = { authenticated: false, isAdmin: false };
  sessionStorage.removeItem("clp-admin");
  state.catalogOpen = false;
}

function optionsHtml(values, selected, placeholder) {
  const opts = values.map((value) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(value)}</option>`).join("");
  return `<option value="">${esc(placeholder)}</option>${opts}`;
}

function renderAddedItem(line) {
  return `<article class="addedItem ${line.category === "Implement" ? "implementItem" : ""}" data-line-id="${esc(line.id)}">
    <div>
      <strong>${esc(line.displayName)}</strong>
      <span>${esc(line.category)} · ${esc(line.plant)} · ${line.quantity} units · Packaging Unit ${line.packUnit}</span>
      ${line.category === "Tractor" ? `
        <span>${esc(line.frontWeight ?? "Without F/W")}</span>
        <span>${esc(line.tractorGroup ?? "")} · Bundle usage ${esc(line.bundleUsage ?? "")}${line.unusedBundleCapacity ? ` · ${line.unusedBundleCapacity} unused` : ""}</span>
        ${line.tireGroup ? `<span>${esc(line.tireGroup)}</span>` : ""}
      ` : ""}
      ${line.category === "Implement" ? `<span>${line.packageCount} packages · space for ${line.loadingQuantity} units · ${meter(line.implementSpace)} m</span>` : ""}
    </div>
    <button type="button" data-action="remove-item" data-id="${esc(line.id)}" aria-label="Remove ${esc(line.displayName)}">×</button>
  </article>`;
}

function renderSegment(segment) {
  const cls = segment.type === "tractor" ? "red" : segment.type === "implement" ? "navy" : segment.type === "tire" ? "orange" : "buffer";
  const title = segment.type === "buffer"
    ? `Buffer Space · ${BUFFER_LENGTH.toFixed(2)}m · ${segment.bufferFrom} → ${segment.bufferTo}`
    : [segment.displayName, segment.composition, segment.capacity ? `${segment.orderedQuantity}/${segment.capacity} units` : "", `${segment.length.toFixed(2)}m`].filter(Boolean).join(" · ");
  const icon = segment.type === "tractor" ? "▣" : segment.type === "implement" ? "◆" : "◉";
  const typeLabel = segment.type === "tractor" ? "Tractor" : segment.type === "implement" ? "Implement" : segment.type === "tire" ? "Tire Pallet" : "Buffer Space";
  return `<div class="segment ${cls}" style="width:${segment.length / CONTAINER_LENGTH * 100}%" title="${esc(title)}">
    ${segment.type !== "buffer" ? `<span class="segmentIcon" aria-hidden="true">${icon}</span>` : ""}
    <strong>${segment.type === "buffer" ? "Buffer" : esc(segment.displayName)}</strong>
    <span>${typeLabel}</span>
    ${segment.composition ? `<span>${esc(segment.composition)}</span>` : ""}
    ${segment.type !== "buffer" && segment.capacity ? `<span>${segment.orderedQuantity}/${segment.capacity} units</span>` : ""}
    ${segment.type === "implement" ? `<span>${segment.orderedQuantity} ordered / space for ${segment.loadingQuantity}</span>` : ""}
    <b>${segment.length.toFixed(2)}m</b>
  </div>`;
}

function renderContainer(container, index) {
  const loaded = new Map();
  container.segments.filter((s) => s.type !== "tire" && s.type !== "buffer").forEach((s) => loaded.set(s.displayName, (loaded.get(s.displayName) || 0) + s.orderedQuantity));
  return `<section class="containerUnit">
    <div class="containerUnitHeader">
      <div><strong>Container ${index + 1} · ${esc(container.plant)}</strong><span>Used ${meter(container.used)} m · Remaining ${meter(container.remaining)} m</span></div>
      <b>${(container.used / CONTAINER_LENGTH * 100).toFixed(1)}%</b>
    </div>
    <div class="loadedModels">${[...loaded].map(([name, qty]) => `<span>${esc(name)} × ${qty}</span>`).join("")}</div>
    <div class="scale" aria-hidden="true">${[0, 2, 4, 6, 8, 10, 12].map((tick) => `<span>${tick}m</span>`).join("")}</div>
    <div class="containerViewport"><div class="containerTrack">
      ${container.segments.map(renderSegment).join("")}
      ${container.remaining > 0 ? `<div class="segment remaining" style="width:${container.remaining / CONTAINER_LENGTH * 100}%"><strong>Remaining Space</strong><b>${container.remaining.toFixed(2)}m</b></div>` : ""}
    </div></div>
  </section>`;
}

function renderCatalogModal(derived) {
  if (!state.catalogOpen || !state.adminState.isAdmin) return "";
  const filteredTractors = state.catalog.models.filter((m) => (displayModelName(m) + " " + m.plant).toLowerCase().includes(state.modelSearch.toLowerCase()));
  const filteredImplements = state.catalog.implements.filter((m) => (displayImplementName(m) + " " + m.plant).toLowerCase().includes(state.modelSearch.toLowerCase()));
  const nm = state.newModel;
  const ni = state.newImplement;
  const tractorTab = `<div class="catalogGrid">
    <form class="catalogForm" data-action="save-tractor">
      <h3>Add Tractor Configuration</h3>
      <div class="formColumns">
        <label>Production Plant<select id="nm-plant" data-model-field="plant"><option${nm.plant === "Okcheon" ? " selected" : ""}>Okcheon</option><option${nm.plant === "Iksan" ? " selected" : ""}>Iksan</option></select></label>
        <label>Tractor Model<input id="nm-tractorModel" required data-model-field="tractorModel" value="${esc(nm.tractorModel)}" /></label>
      </div>
      <div class="formColumns">
        <label>ROPS Type<select id="nm-ropsType" data-model-field="ropsType">${["REAR", "FRONT", "CABIN"].map((v) => `<option${nm.ropsType === v ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>Transmission Type<input id="nm-transmissionType" required data-model-field="transmissionType" value="${esc(nm.transmissionType)}" /></label>
      </div>
      <div class="formColumns">
        <label>Tire Type<input id="nm-tireType" required data-model-field="tireType" value="${esc(nm.tireType)}" /></label>
        <label>Packaging Unit<input id="nm-packUnit" required min="1" type="number" data-model-field="packUnit" value="${esc(nm.packUnit)}" /></label>
      </div>
      <div class="formColumns">
        <label>Packaging Length (m)<input id="nm-packLength" required min="0.01" step="0.01" type="number" data-model-field="packLength" value="${esc(nm.packLength)}" /></label>
        <label>ERP Model Code<input id="nm-erpCode" data-model-field="erpCode" value="${esc(nm.erpCode)}" /></label>
      </div>
      <button class="primaryButton" ${state.saving ? "disabled" : ""}>${state.saving ? "Saving…" : "Add to Shared Catalog"}</button>
    </form>
    <div class="catalogList">
      <div class="listToolbar"><h3>${state.catalog.models.length} Tractor Configurations</h3><input id="model-search" placeholder="Search tractors" value="${esc(state.modelSearch)}" data-field="model-search" /></div>
      <div class="catalogRows">${filteredTractors.map((m) => `<article><div><strong>${esc(displayModelName(m))}</strong><span>${esc(m.plant)} · Unit ${m.packUnit} / ${m.packLength.toFixed(2)} m</span></div>${m.id.startsWith("custom-v2-") ? `<button type="button" data-action="remove-catalog-item" data-id="${esc(m.id)}">Remove</button>` : ""}</article>`).join("")}</div>
    </div>
  </div>`;
  const implementTab = `<div class="catalogGrid">
    <form class="catalogForm" data-action="save-implement">
      <h3>Add Implement Configuration</h3>
      <div class="formColumns">
        <label>Production Plant<select id="ni-plant" data-implement-field="plant">${["Not Specified", "Okcheon", "Iksan"].map((v) => `<option${ni.plant === v ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>Implement Type<input id="ni-implementType" required placeholder="e.g. Loader" data-implement-field="implementType" value="${esc(ni.implementType)}" /></label>
      </div>
      <div class="formColumns">
        <label>Model Name<input id="ni-modelName" required placeholder="e.g. L2026-SEJ-EU" data-implement-field="modelName" value="${esc(ni.modelName)}" /></label>
        <label>Packaging Unit<input id="ni-packUnit" required min="1" type="number" data-implement-field="packUnit" value="${esc(ni.packUnit)}" /></label>
      </div>
      <div class="formColumns">
        <label>Packaging Length (m)<input id="ni-packLength" required min="0.01" max="12" step="0.01" type="number" data-implement-field="packLength" value="${esc(ni.packLength)}" /></label>
        <label>ERP Model Code<input id="ni-erpCode" data-implement-field="erpCode" value="${esc(ni.erpCode)}" /></label>
      </div>
      <button class="primaryButton" ${state.saving ? "disabled" : ""}>${state.saving ? "Saving…" : "Add to Shared Catalog"}</button>
      <p class="formHelp">Implement quantities are rounded up to complete packaging blocks for loading-space calculation.</p>
    </form>
    <div class="catalogList">
      <div class="listToolbar"><h3>${state.catalog.implements.length} Implement Configurations</h3><input id="model-search" placeholder="Search implements" value="${esc(state.modelSearch)}" data-field="model-search" /></div>
      <div class="catalogRows">${filteredImplements.map((m) => `<article><div><strong>${esc(displayImplementName(m))}</strong><span>${esc(m.plant)} · Unit ${m.packUnit} / ${m.packLength.toFixed(2)} m</span></div>${m.id.startsWith("custom-implement-v1-") ? `<button type="button" data-action="remove-catalog-item" data-id="${esc(m.id)}">Remove</button>` : ""}</article>`).join("")}</div>
    </div>
  </div>`;
  return `<div class="modalBackdrop" role="presentation">
    <section class="modal" role="dialog" aria-modal="true">
      <header>
        <div><p class="eyebrow">ADMIN AREA</p><h2>Model Management</h2><p>Maintain tractor and implement configurations used by the shared planner.</p></div>
        <button class="modalClose" aria-label="Close" data-action="close-catalog">×</button>
      </header>
      <div class="tabs">
        <button type="button" class="${state.catalogTab === "Tractor" ? "active" : ""}" data-action="catalog-tab" data-tab="Tractor">Tractor Management</button>
        <button type="button" class="${state.catalogTab === "Implement" ? "active" : ""}" data-action="catalog-tab" data-tab="Implement">Implement Management</button>
      </div>
      ${state.catalogTab === "Tractor" ? tractorTab : implementTab}
    </section>
  </div>`;
}

function render() {
  const derived = computeDerived();

  const headerActions = state.adminState.isAdmin
    ? `<span class="adminStatus">Administrator</span><button class="catalogButton adminLink" data-action="open-catalog">Model Management</button><a class="adminSessionLink" href="#" data-action="admin-logout">Sign Out</a>`
    : state.adminState.authenticated
      ? `<span class="adminDenied">No management access</span><a class="adminSessionLink" href="#" data-action="admin-logout">Sign Out</a>`
      : `<a class="adminSessionLink" href="#" data-action="admin-login">Admin Login</a>`;

  const categoryFields = state.category === "Tractor" ? `
    <label>Tractor Model<select data-field="tractorModel">${optionsHtml(derived.tractorModels, state.tractorModel, "Select tractor model")}</select></label>
    <label>ROPS Type<select data-field="ropsType" ${state.tractorModel ? "" : "disabled"}>${optionsHtml(derived.ropsTypes, state.ropsType, "Select ROPS type")}</select></label>
    <label>Transmission Type<select data-field="transmissionType" ${state.ropsType ? "" : "disabled"}>${optionsHtml(derived.transmissionTypes, state.transmissionType, "Select transmission type")}</select></label>
    <label>Tire Type<select data-field="tireType" ${state.transmissionType ? "" : "disabled"}>${optionsHtml(derived.tireTypes, state.tireType, "Select tire type")}</select></label>
    <label>Front Weight<select data-field="frontWeight"><option${state.frontWeight === "Without F/W" ? " selected" : ""}>Without F/W</option><option${state.frontWeight === "With F/W" ? " selected" : ""}>With F/W</option></select></label>
  ` : `
    <label>Implement Type<select data-field="implementType">${optionsHtml(derived.implementTypes, state.implementType, "Select implement type")}</select></label>
    <label>Model Name<select data-field="implementId" ${state.implementType ? "" : "disabled"}><option value="">Select model name</option>${derived.availableImplements.map((m) => `<option value="${esc(m.id)}"${m.id === state.implementId ? " selected" : ""}>${esc(m.modelName)}</option>`).join("")}</select></label>
  `;

  const modelMeta = derived.selectedProduct ? `<div class="modelMeta"><span>${esc(derived.selectedProduct.plant)}</span><span>Packaging Unit ${derived.selectedProduct.packUnit}</span><span>${derived.selectedProduct.packLength.toFixed(2)} m per package</span></div>` : "";
  const implementCalc = state.category === "Implement" && derived.selectedImplement
    ? `<p class="implementCalculation">${state.quantity} ordered · ${Math.ceil(state.quantity / derived.selectedImplement.packUnit)} packages · space for ${Math.ceil(state.quantity / derived.selectedImplement.packUnit) * derived.selectedImplement.packUnit} units · ${meter(Math.ceil(state.quantity / derived.selectedImplement.packUnit) * derived.selectedImplement.packLength)} m</p>`
    : "";
  const tractorCalc = state.category === "Tractor" && derived.selectedTractor
    ? `<p class="implementCalculation">${state.quantity} ordered · partial bundles allowed · compatible options are combined up to ${derived.selectedTractor.packUnit} units per block</p>`
    : "";

  root.innerHTML = `
    <header class="appHeader">
      <div class="brand"><img class="brandLogo" src="./tym-logo.png" width="54" height="54" alt="TYM" /><div><h1>40FT Container Load Planner</h1><p>Tractor and implement loading by packaging-unit length</p></div></div>
      <div class="headerActions">${headerActions}<div class="containerBadge"><span aria-hidden="true">▥</span> Container <strong>12.0 m</strong></div></div>
    </header>
    <section class="workspace">
      <aside class="inputPanel card">
        <div class="sectionHeading"><div><p class="eyebrow">LOAD INPUT</p><h2>Select Configuration</h2></div><span>${state.catalog.models.length + state.catalog.implements.length} products</span></div>
        <label>Product Category<select data-field="category"><option${state.category === "Tractor" ? " selected" : ""}>Tractor</option><option${state.category === "Implement" ? " selected" : ""}>Implement</option></select></label>
        ${categoryFields}
        <label>Quantity<div class="stepper">
          <button type="button" aria-label="Decrease quantity" data-action="qty-dec">−</button>
          <input id="quantity-input" type="number" min="1" step="1" data-field="quantity" value="${state.quantity}" />
          <span>units</span>
          <button type="button" aria-label="Increase quantity" data-action="qty-inc">+</button>
        </div></label>
        ${modelMeta}
        ${implementCalc}
        ${tractorCalc}
        <button class="primaryButton" data-action="add-item" ${!derived.selectionComplete || !derived.quantityValid ? "disabled" : ""}>Add to List</button>
        <div class="addedHeader"><h3>Load List</h3>${state.items.length > 0 ? `<button type="button" data-action="reset-all">Reset</button>` : ""}</div>
        <div class="addedList">${!derived.draftLines.length ? `<div class="emptyState">Add tractors and implements before calculating the layout.</div>` : derived.draftLines.map(renderAddedItem).join("")}</div>
        <button class="optimizeButton ${derived.pending ? "isReady" : ""}" data-action="calculate-plan" ${!state.items.length || !derived.pending ? "disabled" : ""}>${state.plannedItems.length && !derived.pending ? "Optimal Loading Calculated" : "Calculate Optimal Loading"}</button>
        <p class="optimizeHelp">Compatible tractor options and tire pallets are grouped before container count, loading efficiency, and plant preference are optimized.</p>
      </aside>
      <section class="results">
        <article class="summaryCard card">
          <div class="resultHeading"><div><p class="eyebrow">LOAD RESULT</p><h2>Optimal Loading Result</h2></div><span class="status ${derived.containers.length ? "fit" : "pending"}">${derived.containers.length ? derived.containers.length + " × 40FT Containers" : "Awaiting Load List"}</span></div>
          <div class="metrics">
            <div class="containerMetric"><span>Required Containers</span><strong>${derived.containers.length}<small>units</small></strong></div>
            <div><span>Tractor Space</span><strong>${meter(derived.tractorTotal)}<small>m</small></strong></div>
            <div><span>Implement Space</span><strong>${meter(derived.implementTotal)}<small>m</small></strong></div>
            <div><span>Tire Pallet</span><strong>${meter(derived.tireTotal)}<small>m</small></strong></div>
            <div><span>Buffer Space</span><strong>${meter(derived.bufferTotal)}<small>m</small></strong></div>
            <div class="mainMetric"><span>Used Space</span><strong>${meter(derived.usedTotal)}<small>m</small></strong></div>
            <div><span>Remaining Space</span><strong>${meter(derived.remainingTotal)}<small>m</small></strong></div>
          </div>
          <div class="utilization"><div><span>Utilization Rate</span><strong>${derived.utilization.toFixed(1)}%</strong></div><div class="progress"><i style="width:${Math.min(derived.utilization, 100)}%"></i></div></div>
        </article>
        <article class="visualCard card">
          <div class="visualTitle"><div><p class="eyebrow">CONTAINER MAP</p><h2>Optimized Container Layout</h2></div>
            <div class="visualTools">
              <div class="viewToggle" role="group" aria-label="Layout view"><button type="button" data-action="layout-view" data-view="3d" class="${state.layoutView === "3d" ? "on" : ""}">3D</button><button type="button" data-action="layout-view" data-view="2d" class="${state.layoutView === "2d" ? "on" : ""}">2D</button></div>
              ${state.layoutView === "2d" ? `<div class="legend"><span><i class="legendRed"></i>Tractor</span><span><i class="legendBlue"></i>Implement</span><span><i class="legendOrange"></i>Tire Pallet</span><span><i class="legendYellow"></i>Buffer Space</span><span><i class="legendGray"></i>Remaining Space</span></div>` : ""}
            </div>
          </div>
          ${state.layoutView === "3d"
            ? `<div class="viewer3dSlot"></div>`
            : `<div class="containerPlanList">${derived.containers.map(renderContainer).join("") || `<div class="planEmpty">Complete the Load List and select “Calculate Optimal Loading”.</div>`}</div>`}
          <div class="formulaRow">
            <div class="formula"><span aria-hidden="true">i</span>Compatible tractor options share packaging blocks. Tires share pallets only when their rule signature and packaging specification match. A 0.30m buffer separates tractors from implements and different implement models.</div>
            <div class="resultActions"><button type="button" class="secondaryButton" data-action="reset-all">Reset</button><button type="button" class="exportButton" data-action="export-order-form" ${!derived.lines.length || derived.pending || state.exportingOrderForm ? "disabled" : ""}>${state.exportingOrderForm ? "Creating…" : "Order Form"}</button></div>
          </div>
        </article>
      </section>
    </section>
    ${state.notice ? `<button type="button" class="toast" data-action="dismiss-notice">${esc(state.notice)}</button>` : ""}
    ${renderCatalogModal(derived)}
  `;

  mountViewer3D(derived.containers);
  return derived;
}

// The 3D viewer keeps one WebGL canvas alive across re-renders; it is re-attached to the fresh slot each time.
// three.js is loaded on demand so the planner still works if the CDN or WebGL is unavailable.
let viewer3d = null;
let viewer3dLoad = null;
function mountViewer3D(containers) {
  const slot = root.querySelector(".viewer3dSlot");
  if (!slot) return;
  if (viewer3d) {
    slot.appendChild(viewer3d.element);
    viewer3d.update(containers);
    return;
  }
  slot.innerHTML = `<div class="planEmpty">Loading 3D view…</div>`;
  viewer3dLoad ??= import("./container-3d.js").then(({ createContainer3D }) => { viewer3d = createContainer3D(); });
  viewer3dLoad.then(
    () => { if (state.layoutView === "3d") rerender(); },
    (error) => {
      console.error("3D viewer unavailable", error);
      const current = root.querySelector(".viewer3dSlot");
      if (current) current.innerHTML = `<div class="planEmpty">3D view could not be loaded in this browser. Switch to 2D.</div>`;
    },
  );
}

let latestDerived = null;

function rerender() {
  withFocusPreserved(() => { latestDerived = render(); });
}

root.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "admin-login" || action === "admin-logout" || action === "dismiss-notice" || action === "close-catalog" || action === "catalog-tab") {
    event.preventDefault();
  }
  switch (action) {
    case "qty-dec": state.quantity = Math.max(1, state.quantity - 1); break;
    case "qty-inc": state.quantity += 1; break;
    case "add-item": addItem(latestDerived); break;
    case "remove-item": {
      const id = target.dataset.id;
      state.items = state.items.filter((item) => item.id !== id);
      break;
    }
    case "reset-all": resetAll(); break;
    case "calculate-plan": calculatePlan(); break;
    case "dismiss-notice": state.notice = ""; break;
    case "admin-login": adminLogin(); break;
    case "admin-logout": adminLogout(); break;
    case "open-catalog": state.catalogOpen = true; break;
    case "close-catalog": state.catalogOpen = false; break;
    case "catalog-tab": state.catalogTab = target.dataset.tab; state.modelSearch = ""; break;
    case "layout-view": state.layoutView = target.dataset.view; break;
    case "remove-catalog-item": removeCatalogItem(target.dataset.id); return;
    case "export-order-form": exportOrderForm(latestDerived); return;
  }
  rerender();
});

root.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-action]");
  if (!form) return;
  event.preventDefault();
  if (form.dataset.action === "save-tractor") saveCatalogItem("model").then(rerender);
  if (form.dataset.action === "save-implement") saveCatalogItem("implement").then(rerender);
});

root.addEventListener("change", (event) => {
  const field = event.target.dataset.field;
  if (field === "category") { resetSelections(event.target.value); rerender(); return; }
  if (field === "tractorModel") { state.tractorModel = event.target.value; resetTractorBelow("model"); rerender(); return; }
  if (field === "ropsType") { state.ropsType = event.target.value; resetTractorBelow("rops"); rerender(); return; }
  if (field === "transmissionType") { state.transmissionType = event.target.value; resetTractorBelow("transmission"); rerender(); return; }
  if (field === "tireType") { state.tireType = event.target.value; rerender(); return; }
  if (field === "frontWeight") { state.frontWeight = event.target.value; rerender(); return; }
  if (field === "implementType") { state.implementType = event.target.value; state.implementId = ""; rerender(); return; }
  if (field === "implementId") { state.implementId = event.target.value; rerender(); return; }
  const modelField = event.target.dataset.modelField;
  if (modelField) { state.newModel[modelField] = event.target.value; return; }
  const implementField = event.target.dataset.implementField;
  if (implementField) { state.newImplement[implementField] = event.target.value; return; }
});

root.addEventListener("input", (event) => {
  const field = event.target.dataset.field;
  if (field === "quantity") { state.quantity = Math.max(1, Math.floor(Number(event.target.value) || 1)); rerender(); return; }
  if (field === "model-search") { state.modelSearch = event.target.value; rerender(); return; }
  const modelField = event.target.dataset.modelField;
  if (modelField) { state.newModel[modelField] = modelField === "tractorModel" || modelField === "erpCode" ? event.target.value.toUpperCase() : event.target.value; return; }
  const implementField = event.target.dataset.implementField;
  if (implementField) { state.newImplement[implementField] = implementField === "modelName" || implementField === "erpCode" ? event.target.value.toUpperCase() : event.target.value; return; }
});

async function boot() {
  try {
    await signInAnonymously(auth);
  } catch (error) {
    console.error("anonymous sign-in failed", error);
  }
  try {
    const defaultModels = await loadDefaultModels();
    state.catalog = { models: defaultModels, implements: DEFAULT_IMPLEMENTS, rules: DEFAULT_RULES };
    latestDerived = render();
    await refreshCatalogFromStore();
  } catch (error) {
    console.error("catalog load failed", error);
    state.notice = "Using the built-in product catalog.";
  }
  rerender();
}

boot();
