import { T3039_CABIN_HST_MODELS } from "./t3039-cabin-hst.js";

export * from "./catalog-core.js";

export async function loadDefaultModels() {
  const response = await fetch("./model-data.json");
  const modelData = await response.json();
  return [...modelData, ...T3039_CABIN_HST_MODELS];
}
