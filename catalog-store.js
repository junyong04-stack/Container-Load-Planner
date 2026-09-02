import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { DEFAULT_RULES, displayImplementName, displayModelName } from "./catalog-core.js";
import { DEFAULT_IMPLEMENTS } from "./implement-data.js";
import { loadDefaultModels } from "./catalog.js";

const TRACTOR_PREFIX = "custom-v2-";
const IMPLEMENT_PREFIX = "custom-implement-v1-";

export function makeCatalogStore(db) {
  const tractorCol = collection(db, "customTractorModels");
  const implementCol = collection(db, "customImplements");

  async function customTractors() {
    const snapshot = await getDocs(tractorCol);
    return snapshot.docs
      .map((entry) => ({ id: entry.id, ruleId: "rule-3", ...entry.data() }))
      .sort((a, b) => displayModelName(a).localeCompare(displayModelName(b)));
  }

  async function customImplementsList() {
    const snapshot = await getDocs(implementCol);
    return snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .sort((a, b) => displayImplementName(a).localeCompare(displayImplementName(b)));
  }

  async function readCatalog() {
    const [defaultModels, tractors, customImplementModels] = await Promise.all([
      loadDefaultModels(),
      customTractors(),
      customImplementsList(),
    ]);
    const tractorNames = new Set(tractors.map(displayModelName));
    const implementNames = new Set(customImplementModels.map(displayImplementName));
    return {
      rules: DEFAULT_RULES,
      models: [
        ...defaultModels.filter((model) => !tractorNames.has(displayModelName(model))),
        ...tractors,
      ].sort((a, b) => displayModelName(a).localeCompare(displayModelName(b))),
      implements: [
        ...DEFAULT_IMPLEMENTS.filter((model) => !implementNames.has(displayImplementName(model))),
        ...customImplementModels,
      ].sort((a, b) => displayImplementName(a).localeCompare(displayImplementName(b))),
    };
  }

  async function saveTractor(item) {
    const plant = String(item?.plant ?? "");
    const tractorModel = String(item?.tractorModel ?? "").trim().toUpperCase();
    const ropsType = String(item?.ropsType ?? "").trim().toUpperCase();
    const transmissionType = String(item?.transmissionType ?? "").trim().toUpperCase();
    const tireType = String(item?.tireType ?? "").trim().toUpperCase();
    const erpCode = String(item?.erpCode ?? "").trim().toUpperCase();
    const packLength = Number(item?.packLength);
    const packUnit = Number(item?.packUnit);
    if (!["Okcheon", "Iksan"].includes(plant) || !tractorModel || !ropsType || !transmissionType || !tireType) {
      throw new Error("Please select all required options.");
    }
    if (!Number.isFinite(packLength) || packLength <= 0) {
      throw new Error("Loading length data is missing for this configuration.");
    }
    if (!Number.isInteger(packUnit) || packUnit <= 0) {
      throw new Error("Packaging unit must be a positive whole number.");
    }
    const details = { plant, tractorModel, ropsType, transmissionType, tireType, erpCode };
    const candidate = { id: "", ...details, packLength, packUnit, ruleId: "rule-3" };
    const current = await readCatalog();
    if (current.models.some((model) => displayModelName(model) === displayModelName(candidate))) {
      throw new Error("This model configuration is already registered.");
    }
    const id = TRACTOR_PREFIX + crypto.randomUUID();
    await setDoc(doc(tractorCol, id), { ...details, packLength, packUnit, ruleId: "rule-3", createdAt: serverTimestamp() });
    return readCatalog();
  }

  async function saveImplement(item) {
    const plant = String(item?.plant ?? "Not Specified");
    const implementType = String(item?.implementType ?? "").trim();
    const modelName = String(item?.modelName ?? "").trim().toUpperCase();
    const erpCode = String(item?.erpCode ?? "").trim().toUpperCase();
    const packLength = Number(item?.packLength);
    const packUnit = Number(item?.packUnit);
    if (!implementType || !modelName) {
      throw new Error("Please select all required options.");
    }
    if (!Number.isInteger(packUnit) || packUnit <= 0) {
      throw new Error("Packaging unit must be a positive whole number.");
    }
    if (!Number.isFinite(packLength) || packLength <= 0) {
      throw new Error("Packaging length must be greater than zero.");
    }
    if (packLength > 12) {
      throw new Error("This loading item exceeds the 12.0m container limit.");
    }
    const details = { plant, implementType, modelName, erpCode };
    const candidate = { id: "", ...details, packLength, packUnit };
    const current = await readCatalog();
    if (current.implements.some((model) => displayImplementName(model) === displayImplementName(candidate))) {
      throw new Error("This implement configuration is already registered.");
    }
    const id = IMPLEMENT_PREFIX + crypto.randomUUID();
    await setDoc(doc(implementCol, id), { ...details, packLength, packUnit, createdAt: serverTimestamp() });
    return readCatalog();
  }

  async function removeCatalogItem(id) {
    if (id.startsWith(TRACTOR_PREFIX)) {
      await deleteDoc(doc(tractorCol, id));
    } else if (id.startsWith(IMPLEMENT_PREFIX)) {
      await deleteDoc(doc(implementCol, id));
    } else {
      throw new Error("Built-in configurations cannot be removed.");
    }
    return readCatalog();
  }

  return { readCatalog, saveTractor, saveImplement, removeCatalogItem };
}
