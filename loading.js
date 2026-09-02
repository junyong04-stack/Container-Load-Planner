import { displayImplementName, displayModelName } from "./catalog-core.js";

const normalizedLength = (value) => value.toFixed(6);
const cabinClass = (model) => model.ropsType.toUpperCase() === "CABIN" ? "CABIN" : "ROPS";

export function tireRuleSignature(rule) {
  return [...rule.tiers]
    .sort((a, b) => a.upTo - b.upTo || a.length - b.length)
    .map((tier) => `${tier.upTo}:${normalizedLength(tier.length)}`)
    .join("|");
}

export function tractorCompatibilityKey(model) {
  return [model.tractorModel, model.plant, cabinClass(model), model.packUnit, normalizedLength(model.packLength)].join("::");
}

export function tireCompatibilityKey(model, rule) {
  if (model.tireType.toUpperCase() === "W/O" || !rule.tiers.length) return "";
  return [model.tractorModel, model.plant, tireRuleSignature(rule)].join("::");
}

function allocateComposition(entries, capacity, label) {
  let space = capacity;
  const parts = [];
  let used = 0;
  for (const entry of entries) {
    if (!entry.remaining || !space) continue;
    const assigned = Math.min(entry.remaining, space);
    entry.remaining -= assigned;
    space -= assigned;
    used += assigned;
    parts.push(`${label(entry)} ×${assigned}`);
  }
  return { used, parts };
}

function tireParts(rule, quantity) {
  if (!rule.tiers.length || quantity <= 0) return [];
  const tiers = [...rule.tiers].sort((a, b) => a.upTo - b.upTo);
  const maxTier = tiers.at(-1);
  const parts = [];
  let remaining = quantity;
  while (remaining > 0) {
    if (remaining >= maxTier.upTo) {
      parts.push({ quantity: maxTier.upTo, capacity: maxTier.upTo, length: maxTier.length });
      remaining -= maxTier.upTo;
    } else {
      const tier = tiers.find((entry) => remaining <= entry.upTo) ?? maxTier;
      parts.push({ quantity: remaining, capacity: tier.upTo, length: tier.length });
      remaining = 0;
    }
  }
  return parts;
}

export function calculateLoading(items, catalog) {
  const lines = items.flatMap((item) => {
    if (item.category === "Implement") {
      const model = catalog.implements.find((entry) => entry.id === item.productId);
      if (!model) return [];
      const packageCount = Math.ceil(item.quantity / model.packUnit);
      return [{
        ...item,
        displayName: displayImplementName(model),
        plant: model.plant,
        packUnit: model.packUnit,
        packLength: model.packLength,
        packageCount,
        loadingQuantity: packageCount * model.packUnit,
        tractorSpace: 0,
        implementSpace: packageCount * model.packLength,
        tireSpace: 0,
      }];
    }
    const model = catalog.models.find((entry) => entry.id === item.productId);
    if (!model) return [];
    return [{
      ...item,
      displayName: displayModelName(model),
      plant: model.plant,
      packUnit: model.packUnit,
      packLength: model.packLength,
      packageCount: 0,
      loadingQuantity: item.quantity,
      tractorSpace: 0,
      implementSpace: 0,
      tireSpace: 0,
    }];
  });

  const segments = [];
  const tractorGroups = new Map();
  const tireGroups = new Map();

  for (const line of lines) {
    if (line.category !== "Tractor") continue;
    const model = catalog.models.find((entry) => entry.id === line.productId);
    const rule = model && catalog.rules.find((entry) => entry.id === model.ruleId);
    if (!model || !rule) continue;
    const tractorKey = tractorCompatibilityKey(model);
    const tractorEntries = tractorGroups.get(tractorKey) ?? [];
    tractorEntries.push({ item: line, model, line, remaining: line.quantity });
    tractorGroups.set(tractorKey, tractorEntries);
    const tireKey = tireCompatibilityKey(model, rule);
    if (tireKey) {
      const tireEntries = tireGroups.get(tireKey) ?? [];
      tireEntries.push({ item: line, model, rule, line, remaining: line.quantity });
      tireGroups.set(tireKey, tireEntries);
    }
  }

  for (const [groupKey, sourceEntries] of tractorGroups) {
    const entries = sourceEntries.map((entry) => ({ ...entry }));
    const first = entries[0];
    const total = entries.reduce((sum, entry) => sum + entry.item.quantity, 0);
    const blockCount = Math.ceil(total / first.model.packUnit);
    const groupName = `${first.model.tractorModel} ${cabinClass(first.model)} Group`;
    sourceEntries.forEach((entry) => {
      entry.line.tractorGroup = groupName;
      entry.line.bundleUsage = `${total}/${blockCount * first.model.packUnit}`;
      entry.line.unusedBundleCapacity = blockCount * first.model.packUnit - total;
      entry.line.packageCount = blockCount;
    });
    for (let index = 0; index < blockCount; index += 1) {
      const allocation = allocateComposition(
        entries,
        first.model.packUnit,
        (entry) => [entry.model.transmissionType, entry.model.tireType, entry.item.frontWeight].filter(Boolean).join(" / "),
      );
      const mixed = sourceEntries.length > 1;
      segments.push({
        id: `tractor-group-${groupKey}-${index}`,
        type: "tractor",
        displayName: mixed ? `${first.model.tractorModel} ${cabinClass(first.model)} MIXED` : displayModelName(first.model),
        plant: first.model.plant,
        orderedQuantity: allocation.used,
        loadingQuantity: allocation.used,
        capacity: first.model.packUnit,
        composition: allocation.parts.join(" · "),
        length: first.model.packLength,
      });
    }
  }

  for (const [groupKey, sourceEntries] of tireGroups) {
    const entries = sourceEntries.map((entry) => ({ ...entry }));
    const first = entries[0];
    const total = entries.reduce((sum, entry) => sum + entry.item.quantity, 0);
    const parts = tireParts(first.rule, total);
    const groupName = `${first.model.tractorModel} Tire Group ${tireRuleSignature(first.rule)}`;
    sourceEntries.forEach((entry) => {
      entry.line.tireGroup = groupName;
      entry.line.tireSpace = parts.reduce((sum, part) => sum + part.length, 0);
    });
    parts.forEach((part, index) => {
      const allocation = allocateComposition(entries, part.quantity, (entry) => entry.model.tireType);
      segments.push({
        id: `tire-group-${groupKey}-${index}`,
        type: "tire",
        displayName: sourceEntries.length > 1 ? `${first.model.tractorModel} MIXED TIRE PALLET` : `${displayModelName(first.model)} TIRE PALLET`,
        plant: first.model.plant,
        orderedQuantity: allocation.used,
        loadingQuantity: allocation.used,
        capacity: part.capacity,
        composition: allocation.parts.join(" · "),
        length: part.length,
      });
    });
  }

  for (const line of lines) {
    if (line.category !== "Implement") continue;
    let remainingOrdered = line.quantity;
    for (let index = 0; index < line.packageCount; index += 1) {
      const orderedQuantity = Math.min(line.packUnit, remainingOrdered);
      remainingOrdered -= orderedQuantity;
      segments.push({
        id: `${line.id}-implement-${index}`,
        type: "implement",
        displayName: line.displayName,
        plant: line.plant,
        orderedQuantity,
        loadingQuantity: line.packUnit,
        capacity: line.packUnit,
        length: line.packLength,
      });
    }
  }

  const tractorSpace = segments.filter((segment) => segment.type === "tractor").reduce((sum, segment) => sum + segment.length, 0);
  const implementSpace = segments.filter((segment) => segment.type === "implement").reduce((sum, segment) => sum + segment.length, 0);
  const tireSpace = segments.filter((segment) => segment.type === "tire").reduce((sum, segment) => sum + segment.length, 0);
  return { lines, segments, tractorSpace, implementSpace, tireSpace };
}
