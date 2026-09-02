export const CONTAINER_LENGTH = 12;
export const BUFFER_LENGTH = 0.3;
const EPSILON = 0.000001;

const unique = (values) => [...new Set(values)].sort();
const isTractorGroup = (segment) => segment.type === "tractor" || segment.type === "tire";

export function binPlant(segments) {
  const plants = unique(segments.map((segment) => segment.plant).filter((plant) => plant !== "Not Specified"));
  if (!plants.length) return "Not Specified";
  return plants.length === 1 ? plants[0] : "Mixed";
}

export function bufferCount(segments) {
  const implementGroups = new Set(segments.filter((segment) => segment.type === "implement").map((segment) => segment.displayName)).size;
  const tractorGroup = segments.some(isTractorGroup);
  if (!implementGroups) return 0;
  return Math.max(0, implementGroups - 1 + (tractorGroup ? 1 : 0));
}

export function binUsed(segments) {
  return segments.reduce((sum, segment) => sum + segment.length, 0) + bufferCount(segments) * BUFFER_LENGTH;
}

function orderAndBuffer(segments) {
  const tractorGroup = segments
    .filter(isTractorGroup)
    .sort((a, b) => Number(a.type === "tire") - Number(b.type === "tire") || a.displayName.localeCompare(b.displayName));
  const implementGroups = new Map();
  segments.filter((segment) => segment.type === "implement").forEach((segment) => {
    const group = implementGroups.get(segment.displayName) ?? [];
    group.push(segment);
    implementGroups.set(segment.displayName, group);
  });
  const orderedGroups = [...implementGroups.entries()].sort(([nameA], [nameB]) => nameA.localeCompare(nameB));
  const result = [...tractorGroup];
  let previousName = tractorGroup.length ? tractorGroup.at(-1).displayName : "";
  for (const [displayName, group] of orderedGroups) {
    if (result.length) {
      result.push({
        id: `buffer-${result.length}-${previousName}-${displayName}`,
        type: "buffer",
        displayName: "Buffer Space",
        plant: "Not Specified",
        orderedQuantity: 0,
        loadingQuantity: 0,
        length: BUFFER_LENGTH,
        bufferFrom: previousName,
        bufferTo: displayName,
      });
    }
    result.push(...group);
    previousName = displayName;
  }
  return result;
}

function mixedCount(bins) {
  return bins.filter((bin) => binPlant(bin.segments) === "Mixed").length;
}

function totalBufferCount(bins) {
  return bins.reduce((sum, bin) => sum + bufferCount(bin.segments), 0);
}

function totalRemaining(bins) {
  return bins.length * CONTAINER_LENGTH - bins.reduce((sum, bin) => sum + binUsed(bin.segments), 0);
}

function isBetter(candidate, best) {
  if (candidate.length !== best.length) return candidate.length < best.length;
  const candidateRemaining = totalRemaining(candidate);
  const bestRemaining = totalRemaining(best);
  if (Math.abs(candidateRemaining - bestRemaining) > EPSILON) return candidateRemaining < bestRemaining;
  const candidateBuffers = totalBufferCount(candidate);
  const bestBuffers = totalBufferCount(best);
  if (candidateBuffers !== bestBuffers) return candidateBuffers < bestBuffers;
  return mixedCount(candidate) < mixedCount(best);
}

export function optimizeContainers(segments) {
  const sorted = [...segments].sort((a, b) => {
    const groupOrder = Number(a.type === "implement") - Number(b.type === "implement");
    return groupOrder || a.displayName.localeCompare(b.displayName) || b.length - a.length;
  });
  const bins = [];
  for (const segment of sorted) {
    const candidates = bins.map((bin, index) => {
      const nextSegments = [...bin.segments, segment];
      return {
        index,
        remainder: CONTAINER_LENGTH - binUsed(nextSegments),
        sameImplement: segment.type === "implement" && bin.segments.some((entry) => entry.type === "implement" && entry.displayName === segment.displayName),
        samePlant: segment.plant !== "Not Specified" && binPlant(bin.segments) === segment.plant,
      };
    }).filter((candidate) => candidate.remainder >= -EPSILON)
      .sort((a, b) => a.remainder - b.remainder || Number(b.sameImplement) - Number(a.sameImplement) || Number(b.samePlant) - Number(a.samePlant));
    if (!candidates.length) bins.push({ segments: [segment] });
    else bins[candidates[0].index].segments.push(segment);
  }

  let best = bins.map((bin) => ({ segments: [...bin.segments] }));
  if (sorted.length <= 32) {
    const started = Date.now();
    const working = [];
    const search = (index) => {
      if (Date.now() - started > 400 || working.length > best.length) return;
      if (index === sorted.length) {
        if (isBetter(working, best)) best = working.map((bin) => ({ segments: [...bin.segments] }));
        return;
      }
      const segment = sorted[index];
      const candidates = working.map((bin, binIndex) => ({
        binIndex,
        remainder: CONTAINER_LENGTH - binUsed([...bin.segments, segment]),
        sameImplement: segment.type === "implement" && bin.segments.some((entry) => entry.type === "implement" && entry.displayName === segment.displayName),
        samePlant: segment.plant !== "Not Specified" && binPlant(bin.segments) === segment.plant,
      })).filter((candidate) => candidate.remainder >= -EPSILON)
        .sort((a, b) => a.remainder - b.remainder || Number(b.sameImplement) - Number(a.sameImplement) || Number(b.samePlant) - Number(a.samePlant));
      const tried = new Set();
      for (const candidate of candidates) {
        const bin = working[candidate.binIndex];
        const signature = `${binUsed(bin.segments).toFixed(3)}-${bufferCount(bin.segments)}-${binPlant(bin.segments)}`;
        if (tried.has(signature)) continue;
        tried.add(signature);
        bin.segments.push(segment);
        search(index + 1);
        bin.segments.pop();
      }
      if (working.length < best.length) {
        working.push({ segments: [segment] });
        search(index + 1);
        working.pop();
      }
    };
    search(0);
  }

  return best.sort((a, b) => binUsed(b.segments) - binUsed(a.segments)).map((bin) => {
    const productSpace = bin.segments.reduce((sum, segment) => sum + segment.length, 0);
    const bufferSpace = bufferCount(bin.segments) * BUFFER_LENGTH;
    const used = productSpace + bufferSpace;
    return {
      segments: orderAndBuffer(bin.segments),
      used,
      productSpace,
      bufferSpace,
      remaining: Math.max(0, CONTAINER_LENGTH - used),
      plant: binPlant(bin.segments),
    };
  });
}
