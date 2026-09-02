export const DEFAULT_RULES = [
  { id: "rule-1", tiers: [{ upTo: 4, length: 1.5 }, { upTo: 8, length: 2.3 }, { upTo: 12, length: 4.3 }] },
  { id: "rule-2", tiers: [{ upTo: 2, length: 1.5 }, { upTo: 4, length: 1.5 }, { upTo: 6, length: 2.3 }] },
  { id: "rule-3", tiers: [] },
  { id: "rule-4", tiers: [{ upTo: 4, length: 1 }, { upTo: 8, length: 2 }, { upTo: 12, length: 3 }] },
  { id: "rule-5", tiers: [{ upTo: 2, length: 1 }, { upTo: 4, length: 1 }, { upTo: 6, length: 1.5 }, { upTo: 8, length: 1.5 }, { upTo: 10, length: 2 }, { upTo: 12, length: 2 }, { upTo: 14, length: 2 }, { upTo: 16, length: 3 }, { upTo: 18, length: 3 }] },
  { id: "rule-6", tiers: [{ upTo: 2, length: 1 }, { upTo: 4, length: 1 }, { upTo: 6, length: 1 }, { upTo: 8, length: 1 }, { upTo: 10, length: 2 }, { upTo: 12, length: 2 }, { upTo: 14, length: 2 }, { upTo: 16, length: 2 }, { upTo: 18, length: 2 }, { upTo: 20, length: 2 }] },
  { id: "rule-7", tiers: [{ upTo: 2, length: 1.3 }, { upTo: 4, length: 2 }, { upTo: 6, length: 3 }] },
  { id: "rule-8", tiers: [{ upTo: 1, length: 2 }, { upTo: 2, length: 4 }] },
];

export function displayModelName(model) {
  return [model.tractorModel, model.ropsType, model.transmissionType, model.tireType].join("_");
}

const normalizeDisplayPart = (value) => value.trim().toUpperCase().replace(/\s+/g, "_");

export function displayImplementName(model) {
  return [normalizeDisplayPart(model.implementType), normalizeDisplayPart(model.modelName)].join("_");
}

export function tirePartLengths(rule, quantity) {
  if (!rule.tiers.length || quantity <= 0) return [];
  const tiers = [...rule.tiers].sort((a, b) => a.upTo - b.upTo);
  const maxTier = tiers[tiers.length - 1];
  const parts = [];
  let remaining = quantity;
  while (remaining > 0) {
    if (remaining >= maxTier.upTo) {
      parts.push(maxTier.length);
      remaining -= maxTier.upTo;
    } else {
      parts.push((tiers.find((tier) => remaining <= tier.upTo) ?? maxTier).length);
      remaining = 0;
    }
  }
  return parts.filter((length) => length > 0);
}

export function tireLengthForQuantity(rule, quantity) {
  return tirePartLengths(rule, quantity).reduce((sum, length) => sum + length, 0);
}
