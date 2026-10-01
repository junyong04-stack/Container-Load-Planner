import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CONTAINER_LENGTH } from "./planner.js";

// 40FT HQ inner dimensions (m). Loading length stays CONTAINER_LENGTH; width/height are schematic.
const CT = { L: 12.032, W: 2.352, H: 2.698 };
const TYPE_COLOR = { tractor: "#e31937", implement: "#1d4f82", tire: "#e08a0b", buffer: "#f7dc6f" };
const PLANT_COLOR = { Iksan: "#2a7de1", Okcheon: "#16a37a", "Not Specified": "#8f99a8", Mixed: "#a45bd6" };
const TYPE_LABEL = { tractor: "Tractor", implement: "Implement", tire: "Tire Pallet", buffer: "Buffer Space" };
const TIRE = "#23272d", RIM = "#c9ced6", STEEL = "#6b7684", GLASS = "#a9cdea";
const WOOD = "#9c7449", DARK = "#2c343e", CHROME = "#d7dbe0";
const FONT = "Arial, Helvetica, sans-serif";

const meter = (value) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const gap = () => CT.W + 2.2;
const oz = (ci) => ci * gap();
const segHeight = (s) => s.type === "buffer" ? 1.2 : s.type === "tire" ? 1.35 : s.type === "implement" ? 1.8 : s.cabin === "CABIN" ? 2.45 : 2.2;

const unitGeo = new THREE.BoxGeometry(1, 1, 1);
const edgeGeo = new THREE.EdgesGeometry(unitGeo);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 20);
const sharedGeos = new Set([unitGeo, edgeGeo, cylGeo]);
const matCache = new Map();
const mat = (color, opacity) => {
  const key = color + "|" + (opacity || 1);
  if (!matCache.has(key)) {
    matCache.set(key, opacity
      ? new THREE.MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: false })
      : new THREE.MeshLambertMaterial({ color }));
  }
  return matCache.get(key);
};
const shade = (hex, k) => "#" + new THREE.Color(hex).multiplyScalar(k).getHexString();

function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function plateTexture(lines, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d");
  g.fillStyle = "rgba(255,255,255,0.92)"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#102033"; g.textAlign = "center"; g.textBaseline = "middle";
  lines.forEach((text, i) => {
    g.font = `bold ${Math.round(h * (i === 0 ? 0.22 : 0.15))}px ${FONT}`;
    g.fillText(text, w / 2, h * (lines.length === 1 ? 0.5 : 0.34 + i * 0.3), w * 0.94);
  });
  return canvasTexture(canvas);
}

function makeLabel(text, height, color = "#102033") {
  const font = `bold 60px ${FONT}`;
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(256, Math.ceil(measure.measureText(text).width) + 40);
  canvas.height = 128;
  const g = canvas.getContext("2d");
  g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = 10; g.strokeStyle = "rgba(255,255,255,.95)"; g.strokeText(text, canvas.width / 2, 64);
  g.fillStyle = color; g.fillText(text, canvas.width / 2, 64);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(canvas), transparent: true, depthTest: false }));
  sprite.scale.set(height * canvas.width / 128, height, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/* ---- Tractor / tire shapes (schematic). Front faces -x (toward the front wall); l, w, h are the slot size ---- */
function makeTractor(l, w, h, color, ropsType, seg) {
  const t = new THREE.Group();
  const box = (x0, x1, y0, y1, zw, c, o, zc = 0) => {
    const m = new THREE.Mesh(unitGeo, mat(c, o));
    m.position.set((x0 + x1) / 2 * l - l / 2, (y0 + y1) / 2 * h, zc * w);
    m.scale.set((x1 - x0) * l, (y1 - y0) * h, zw * w);
    m.userData.seg = seg; t.add(m); return m;
  };
  const wheel = (xc, r, tw, zc) => {
    const tyre = new THREE.Mesh(cylGeo, mat(TIRE)); tyre.rotation.x = Math.PI / 2; tyre.position.set(xc * l - l / 2, r, zc); tyre.scale.set(r, tw, r); tyre.userData.seg = seg; t.add(tyre);
    const rim = new THREE.Mesh(cylGeo, mat(RIM)); rim.rotation.x = Math.PI / 2; rim.position.copy(tyre.position); rim.scale.set(r * 0.55, tw * 1.04, r * 0.55); rim.userData.seg = seg; t.add(rim);
  };
  const rr = Math.min(0.34 * h, 0.2 * l, 0.3 * w), fr = rr * 0.62, tw = Math.min(0.2 * w, 0.3);
  const zr = w / 2 - tw / 2 - 0.01;
  wheel(0.74, rr, tw, zr); wheel(0.74, rr, tw, -zr);
  wheel(0.2, fr, tw * 0.8, zr * 0.9); wheel(0.2, fr, tw * 0.8, -zr * 0.9);
  const ry = rr / h, fy = fr / h;
  box(0.1, 0.8, fy * 0.6, fy * 1.55, 0.34, STEEL); // frame
  box(0.02, 0.52, fy * 1.2, Math.min(0.6, ry * 1.75), 0.42, color); // bonnet
  box(0.02, 0.05, fy * 1.3, Math.min(0.56, ry * 1.6), 0.36, "#2b2f36"); // grille
  box(0.5, 0.92, ry * 0.9, ry * 1.45, 0.52, color); // body under the seat
  box(0.58, 0.9, ry * 1.45, ry * 2.05, (w - 2 * tw) / w * 0.9, color); // fenders
  box(0.6, 0.72, ry * 1.45, ry * 1.95, 0.22, "#1c1f24"); // seat
  const ex = new THREE.Mesh(cylGeo, mat("#3a3f47"));
  ex.position.set(0.44 * l - l / 2, Math.min(0.78, ry * 2.2) * h, -0.16 * w);
  ex.scale.set(0.02 * Math.min(l, 1.5), 0.3 * h, 0.02 * Math.min(l, 1.5));
  ex.userData.seg = seg; t.add(ex);
  const top = 0.97, rops = String(ropsType).toUpperCase();
  if (rops === "CABIN") {
    box(0.5, 0.94, ry * 2.0, top - 0.05, 0.86, GLASS, 0.45); // glass
    box(0.47, 0.97, top - 0.05, top, 0.92, color); // roof
    [[0.5, 0.43], [0.5, -0.43], [0.94, 0.43], [0.94, -0.43]].forEach(([x, z]) => box(x - 0.015, x + 0.015, ry * 2.0, top - 0.05, 0.03, "#1c1f24", 0, z));
  } else {
    const rx = rops === "FRONT" ? 0.52 : 0.94; // front / rear ROPS
    [0.4, -0.4].forEach((z) => box(rx - 0.02, rx + 0.02, ry * 1.5, top, 0.05, "#1c1f24", 0, z));
    box(rx - 0.025, rx + 0.025, top - 0.04, top, 0.86, "#1c1f24");
  }
  return t;
}

function makeTirePallet(l, w, h, sets, color, seg) {
  const t = new THREE.Group();
  const base = new THREE.Mesh(unitGeo, mat(color)); base.position.set(0, 0.06, 0); base.scale.set(l, 0.12, w); base.userData.seg = seg; t.add(base);
  const n = Math.max(1, sets), rows = n >= 2 ? 2 : 1, cols = Math.ceil(n / rows);
  const r = Math.min(l / cols, w / rows) / 2 * 0.9, th = Math.min(0.26, (h - 0.14) / 4);
  for (let k = 0; k < n; k += 1) {
    const c = Math.floor(k / rows), ro = k % rows;
    const x = -l / 2 + (l / cols) * (c + 0.5), z = -w / 2 + (w / rows) * (ro + 0.5);
    for (let j = 0; j < 4; j += 1) { // one tractor set = 4 tires
      const tr = new THREE.Mesh(cylGeo, mat(TIRE)); tr.position.set(x, 0.12 + th * (j + 0.5), z); tr.scale.set(r, th * 0.94, r); tr.userData.seg = seg; t.add(tr);
      const rim = new THREE.Mesh(cylGeo, mat(RIM)); rim.position.copy(tr.position); rim.scale.set(r * 0.5, th * 0.97, r * 0.5); rim.userData.seg = seg; t.add(rim);
    }
  }
  return t;
}

/* ---- Implement shapes (loader / mower / backhoe, schematic) ---- */
function implementKit(l, w, h, seg) {
  const t = new THREE.Group();
  const box = (x0, x1, y0, y1, z0, z1, c, o) => {
    const m = new THREE.Mesh(unitGeo, mat(c, o));
    m.position.set((x0 + x1) / 2 * l - l / 2, (y0 + y1) / 2 * h, ((z0 + z1) / 2 - 0.5) * w);
    m.scale.set(Math.max(0.005, (x1 - x0) * l), Math.max(0.005, (y1 - y0) * h), Math.max(0.005, (z1 - z0) * w));
    m.userData.seg = seg; t.add(m); return m;
  };
  const rod = (x0, y0, x1, y1, tw, th, zc, c) => { // bar joining two points on the xy plane
    const ax = x0 * l - l / 2, ay = y0 * h, bx = x1 * l - l / 2, by = y1 * h;
    const m = new THREE.Mesh(unitGeo, mat(c));
    m.position.set((ax + bx) / 2, (ay + by) / 2, (zc - 0.5) * w);
    m.rotation.z = Math.atan2(by - ay, bx - ax);
    m.scale.set(Math.hypot(bx - ax, by - ay), th * h, tw * w);
    m.userData.seg = seg; t.add(m); return m;
  };
  const cyl = (x, y, z, r, len, axis, c) => {
    const m = new THREE.Mesh(cylGeo, mat(c));
    m.position.set(x * l - l / 2, y * h, (z - 0.5) * w);
    if (axis === "z") m.rotation.x = Math.PI / 2;
    if (axis === "x") m.rotation.z = Math.PI / 2;
    m.scale.set(r, len, r); m.userData.seg = seg; t.add(m); return m;
  };
  const skid = () => {
    box(0.02, 0.98, 0, 0.07, 0.05, 0.2, WOOD);
    box(0.02, 0.98, 0, 0.07, 0.8, 0.95, WOOD);
    box(0.02, 0.98, 0.07, 0.1, 0.03, 0.97, WOOD);
  };
  return { t, box, rod, cyl, skid };
}

function makeLoader(l, w, h, color, seg) {
  const k = implementKit(l, w, h, seg), steel = shade(color, 0.7);
  k.skid();
  [0.2, 0.8].forEach((z) => {
    k.rod(0.22, 0.2, 0.9, 0.46, 0.07, 0.13, z, color); // boom arm
    k.box(0.84, 0.97, 0.1, 0.62, z - 0.05, z + 0.05, color); // mounting bracket
    k.rod(0.3, 0.33, 0.86, 0.56, 0.03, 0.05, z, CHROME); // hydraulic cylinder
  });
  k.cyl(0.42, 0.3, 0.5, Math.min(0.035 * l, 0.05), 0.62 * w, "z", color); // cross tube
  k.box(0.03, 0.07, 0.1, 0.82, 0.03, 0.97, steel); // bucket back
  k.box(0.03, 0.24, 0.1, 0.15, 0.03, 0.97, steel); // bucket floor
  k.box(0.2, 0.26, 0.1, 0.2, 0.03, 0.97, CHROME); // cutting edge
  [0.03, 0.94].forEach((z) => k.box(0.03, 0.22, 0.1, 0.7, z, z + 0.03, steel)); // side plates
  k.box(0.06, 0.2, 0.8, 0.86, 0.03, 0.97, steel); // top lip
  return k.t;
}

function makeMower(l, w, h, color, seg) {
  const k = implementKit(l, w, h, seg);
  k.skid();
  k.box(0.08, 0.92, 0.12, 0.52, 0.06, 0.94, color); // deck
  const r = Math.min(0.16 * l, 0.14 * w);
  [0.22, 0.5, 0.78].forEach((z) => k.cyl(0.5, 0.56, z, r, 0.1 * h, "y", shade(color, 0.8))); // blade housings
  k.box(0.42, 0.58, 0.6, 0.78, 0.42, 0.58, DARK); // gearbox
  k.cyl(0.26, 0.69, 0.5, Math.min(0.02 * l, 0.03), 0.34 * l, "x", CHROME); // drive shaft
  k.box(0.9, 0.97, 0.12, 0.4, 0.15, 0.85, DARK); // guard
  [[0.12, 0.1], [0.12, 0.9], [0.88, 0.1], [0.88, 0.9]].forEach(([x, z]) => k.cyl(x, 0.14, z, Math.min(0.05 * l, 0.05), 0.06 * w, "z", "#1c1f24")); // gauge wheels
  return k.t;
}

function makeBackhoe(l, w, h, color, seg) {
  const k = implementKit(l, w, h, seg), steel = shade(color, 0.72);
  k.skid();
  k.box(0.6, 0.96, 0.1, 0.42, 0.2, 0.8, color); // subframe
  k.box(0.7, 0.86, 0.42, 0.52, 0.35, 0.65, "#1c1f24"); // seat
  [0.4, 0.6].forEach((z) => k.rod(0.78, 0.52, 0.78, 0.76, 0.02, 0.03, z, DARK)); // control levers
  [0.12, 0.88].forEach((z) => k.rod(0.92, 0.4, 0.99, 0.12, 0.08, 0.08, z, steel)); // outriggers
  k.rod(0.64, 0.4, 0.32, 0.9, 0.12, 0.13, 0.5, color); // boom
  k.rod(0.32, 0.9, 0.14, 0.32, 0.1, 0.11, 0.5, color); // dipper arm
  k.rod(0.58, 0.5, 0.36, 0.84, 0.04, 0.05, 0.36, CHROME); // boom cylinder
  k.box(0.04, 0.2, 0.12, 0.34, 0.36, 0.64, steel); // bucket
  [0.4, 0.5, 0.6].forEach((z) => k.box(0.02, 0.05, 0.1, 0.16, z - 0.02, z + 0.02, CHROME)); // teeth
  return k.t;
}

function makeImplement(type, l, w, h, color, seg) {
  const kind = String(type).toUpperCase();
  if (kind === "MOWER") return makeMower(l, w, h, color, seg);
  if (kind === "BACKHOE") return makeBackhoe(l, w, h, color, seg);
  return makeLoader(l, w, h, color, seg);
}

function disposeObject(object) {
  const shared = new Set(matCache.values());
  object.traverse((child) => {
    if (child.geometry && !sharedGeos.has(child.geometry)) child.geometry.dispose();
    if (!child.material) return;
    (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => {
      if (shared.has(material)) return;
      if (material.map) material.map.dispose();
      material.dispose();
    });
  });
}

const VIEWER_HTML = `
  <div class="v3dToolbar">
    <div class="v3dSeg" role="group" aria-label="Color by"><button type="button" data-v3d-mode="type" class="on">By Type</button><button type="button" data-v3d-mode="plant">By Plant</button></div>
    <div class="v3dTools">
      <button type="button" data-v3d="zoom-in" title="Zoom in" aria-label="Zoom in">＋</button>
      <button type="button" data-v3d="zoom-out" title="Zoom out" aria-label="Zoom out">－</button>
      <button type="button" data-v3d="rotate">Auto Rotate</button>
      <button type="button" data-v3d="door">Door View</button>
      <button type="button" data-v3d="top">Top View</button>
      <button type="button" data-v3d="home">Reset View</button>
    </div>
  </div>
  <div class="v3dStage">
    <div class="v3dTip"></div>
    <div class="v3dTabs"></div>
    <div class="v3dLegend"></div>
    <div class="v3dInfo" hidden></div>
    <div class="v3dEmpty">Complete the Load List and select “Calculate Optimal Loading” to see the 3D layout.</div>
  </div>
  <div class="v3dPlayer">
    <button type="button" data-v3d="play">▶ Play Loading</button>
    <input type="range" min="0" max="0" value="0" aria-label="Loading sequence" />
    <span></span>
  </div>`;

export function createContainer3D() {
  const element = document.createElement("div");
  element.className = "viewer3d";
  element.innerHTML = VIEWER_HTML;
  const $ = (selector) => element.querySelector(selector);
  const stage = $(".v3dStage"), tip = $(".v3dTip"), info = $(".v3dInfo"), tabs = $(".v3dTabs"), legend = $(".v3dLegend");
  const playButton = $('[data-v3d="play"]'), stepInput = $(".v3dPlayer input"), stepText = $(".v3dPlayer span");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e4e9ef");
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.prepend(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 1.5; controls.maxDistance = 150;
  controls.screenSpacePanning = true; controls.autoRotateSpeed = 1.0;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8892a0, 2.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9); sun.position.set(-10, 20, 14); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: "#cfd6df" }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.005; scene.add(ground);

  const selEdge = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x102a43 }));
  const selFill = new THREE.Mesh(unitGeo, new THREE.MeshBasicMaterial({ color: 0x2a7de1, transparent: true, opacity: 0.08, depthWrite: false }));
  selEdge.visible = selFill.visible = false; scene.add(selEdge, selFill);

  let plans = [], signature = "", objs = [], segs = [];
  let mode = "type", step = 0, curCont = -1, selected = null;
  let tween = null, playing = false, playTimer = null, slides = [];

  const colorOf = (s) => mode === "plant" && s.type !== "buffer" ? PLANT_COLOR[s.plant] || "#8f99a8" : TYPE_COLOR[s.type];
  const implementColor = (s, color) => {
    const kind = String(s.implementType).toUpperCase();
    return mode === "type" && (kind === "LOADER" || kind === "BACKHOE") ? "#e31937" : color;
  };
  const add = (object) => { scene.add(object); objs.push(object); return object; };

  function segGroup(s) {
    const g = new THREE.Group();
    const L = Math.max(0.05, s.length - 0.03), W = 2.22;
    const color = "#" + new THREE.Color(colorOf(s)).getHexString();
    if (s.type === "buffer") {
      const floor = new THREE.Mesh(unitGeo, new THREE.MeshBasicMaterial({ color: TYPE_COLOR.buffer, transparent: true, opacity: 0.55 }));
      floor.position.set(s.length / 2, 0.02, 0); floor.scale.set(s.length, 0.04, CT.W * 0.98); floor.userData.seg = s; g.add(floor);
      const wall = new THREE.Mesh(unitGeo, new THREE.MeshBasicMaterial({ color: TYPE_COLOR.buffer, transparent: true, opacity: 0.18, depthWrite: false }));
      wall.position.set(s.length / 2, 0.6, 0); wall.scale.set(s.length * 0.9, 1.2, CT.W * 0.96); wall.userData.seg = s; g.add(wall);
      return g;
    }
    const capacity = Math.max(1, s.capacity || 1);
    const H = segHeight(s);
    let cols = 1, rows = 1, filled = 1;
    if (s.type === "tractor") { cols = Math.min(2, capacity); rows = Math.ceil(capacity / cols); filled = s.loadingQuantity; }
    else if (s.type === "implement") { cols = capacity > 3 ? 2 : 1; rows = Math.ceil(capacity / cols); filled = s.orderedQuantity; }
    const cw = W / cols, rh = H / rows, cx = L / 2 + 0.015;
    if (s.type === "tire") {
      const pallet = makeTirePallet(L, W, H, s.orderedQuantity, color, s); pallet.position.set(cx, 0, 0); g.add(pallet);
    } else {
      for (let k = 0; k < cols * rows; k += 1) {
        const c = k % cols, r = Math.floor(k / cols), z = -W / 2 + cw * (c + 0.5);
        if (k < filled) {
          const unit = s.type === "tractor"
            ? makeTractor(L * 0.96, cw * 0.94, rh * 0.96, color, s.cabin === "CABIN" ? "CABIN" : s.ropsType, s)
            : makeImplement(s.implementType, L * 0.96, cw * 0.94, rh * 0.94, implementColor(s, color), s);
          unit.position.set(cx, rh * r, z); g.add(unit);
        } else if (k < capacity) { // unused packaging space
          const ghost = new THREE.Mesh(unitGeo, new THREE.MeshBasicMaterial({ color: 0x9aa4b2, transparent: true, opacity: 0.12, depthWrite: false }));
          ghost.position.set(cx, rh * (r + 0.5), z); ghost.scale.set(L, rh * 0.97, cw * 0.97); ghost.userData.seg = s; g.add(ghost);
          const dashed = new THREE.LineSegments(edgeGeo, new THREE.LineDashedMaterial({ color: 0x6b7684, dashSize: 0.08, gapSize: 0.06 }));
          dashed.position.copy(ghost.position); dashed.scale.copy(ghost.scale); dashed.computeLineDistances(); g.add(dashed);
        }
      }
      // packaging block frame + deck between tiers
      const frame = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x4b5563 }));
      frame.position.set(cx, H / 2, 0); frame.scale.set(L, H, W); g.add(frame);
      for (let r = 1; r < rows; r += 1) {
        const deck = new THREE.Mesh(unitGeo, mat(STEEL, 0.55)); deck.position.set(cx, rh * r, 0); deck.scale.set(L, 0.03, W); deck.userData.seg = s; g.add(deck);
      }
    }
    // name plate on the door-facing side
    const tag = s.type === "tire" ? [s.displayName.replace(" TIRE PALLET", ""), `Tires ${s.orderedQuantity}/${s.capacity}`]
      : s.type === "tractor" ? [s.displayName, `${s.loadingQuantity}/${s.capacity} units`]
        : [s.displayName.replace(/^[A-Z]+_/, ""), `${s.orderedQuantity}/${s.capacity}`];
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(L * 0.95, 2.2), Math.min(0.46, H * 0.3)),
      new THREE.MeshBasicMaterial({ map: plateTexture(tag, 512, 160), transparent: true }),
    );
    plate.position.set(L / 2, H + 0.3, W / 2 - 0.05); plate.userData.seg = s; g.add(plate);
    return g;
  }

  function clearScene() {
    objs.forEach((object) => { scene.remove(object); disposeObject(object); });
    objs = []; segs = [];
  }

  function buildScene() {
    clearScene();
    let gi = 0;
    plans.forEach((p, ci) => {
      const z0 = oz(ci), before = objs.length;
      const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(CT.L, CT.W), new THREE.MeshLambertMaterial({ color: 0x8a939f })));
      floor.rotation.x = -Math.PI / 2; floor.position.set(CT.L / 2, 0.003, z0);
      const shell = add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CT.L, CT.H, CT.W)), new THREE.LineBasicMaterial({ color: 0x5b6573 })));
      shell.position.set(CT.L / 2, CT.H / 2, z0);
      const wallMat = new THREE.MeshBasicMaterial({ color: 0x9aa4b2, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
      const nose = add(new THREE.Mesh(new THREE.PlaneGeometry(CT.W, CT.H), wallMat)); nose.rotation.y = Math.PI / 2; nose.position.set(0, CT.H / 2, z0);
      const side = add(new THREE.Mesh(new THREE.PlaneGeometry(CT.L, CT.H), wallMat.clone())); side.position.set(CT.L / 2, CT.H / 2, z0 - CT.W / 2);
      // 12.0m loading limit
      const limit = add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(CONTAINER_LENGTH, 0.01, z0 - CT.W / 2), new THREE.Vector3(CONTAINER_LENGTH, 0.01, z0 + CT.W / 2), new THREE.Vector3(CONTAINER_LENGTH, CT.H, z0 + CT.W / 2)]),
        new THREE.LineDashedMaterial({ color: 0xc80f2b, dashSize: 0.12, gapSize: 0.08 }),
      ));
      limit.computeLineDistances();
      for (let t = 0; t <= 12; t += 2) { const tick = add(makeLabel(`${t}m`, 0.22, "#66788a")); tick.position.set(t, 0.05, z0 + CT.W / 2 + 0.35); }
      const head = add(makeLabel(`Container ${ci + 1} · ${p.plant} · ${meter(p.used)} m`, 0.42)); head.position.set(CT.L / 2, CT.H + 0.45, z0);
      const door = add(makeLabel("Door", 0.4, "#c80f2b")); door.position.set(CT.L + 0.55, 0.5, z0);
      const front = add(makeLabel("Front", 0.36)); front.position.set(-0.55, 0.5, z0);
      objs.slice(before).forEach((object) => { object.userData.ci = ci; });
      let x = 0;
      p.segments.forEach((s, si) => {
        const g = add(segGroup(s));
        g.position.set(x, 0, z0);
        segs.push({ s, g, ci, seq: si + 1, gi: gi++, from: x, to: x + s.length, tx: x });
        x += s.length;
      });
    });
    applyStep();
  }

  function applyStep() {
    objs.forEach((object) => { if (object.userData.ci !== undefined) object.visible = curCont < 0 || object.userData.ci === curCont; });
    segs.forEach((o) => { o.g.visible = o.gi < step && (curCont < 0 || o.ci === curCont); });
    stepInput.max = segs.length; stepInput.value = step;
    const last = segs[step - 1];
    stepText.textContent = last
      ? `${step} / ${segs.length} · Container ${last.ci + 1} #${last.seq} · ${last.s.displayName} · ${meter(last.from)}–${meter(last.to)} m`
      : `0 / ${segs.length}`;
    if (selected && !selected.g.visible) select(null);
  }

  function select(o) {
    selected = o;
    if (!o) { selEdge.visible = selFill.visible = false; info.hidden = true; return; }
    const h = segHeight(o.s);
    [selEdge, selFill].forEach((m) => { m.position.set(o.from + o.s.length / 2, h / 2 + 0.01, oz(o.ci)); m.scale.set(o.s.length + 0.04, h + 0.06, CT.W - 0.04); m.visible = true; });
    const s = o.s;
    const rows = [
      ["Type", TYPE_LABEL[s.type]],
      ["Container", `${o.ci + 1} · sequence ${o.seq}`],
      ["Position", `${meter(o.from)} – ${meter(o.to)} m from front wall`],
      ["Length", `${meter(s.length)} m`],
      s.type !== "buffer" ? ["Plant", s.plant] : null,
      s.capacity ? ["Units", `${s.orderedQuantity} / ${s.capacity}`] : null,
      s.composition ? ["Composition", s.composition] : null,
      s.type === "buffer" ? ["Between", `${s.bufferFrom} → ${s.bufferTo}`] : null,
    ].filter(Boolean);
    info.innerHTML = `<div class="v3dInfoHead"><strong>${esc(s.displayName)}</strong><button type="button" data-v3d="close-info" aria-label="Close">✕</button></div>
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
    info.hidden = false;
  }

  /* camera */
  function flyTo(pos, target, ms = 700) {
    tween = { t0: performance.now(), ms, p0: camera.position.clone(), p1: pos.clone(), q0: controls.target.clone(), q1: target.clone() };
  }
  function viewSpan() {
    const n = Math.max(1, plans.length);
    if (curCont >= 0) return { cx: CT.L / 2, cz: oz(curCont), span: CT.L };
    return { cx: CT.L / 2, cz: oz(n - 1) / 2, span: Math.max(CT.L, oz(n - 1) + CT.W) };
  }
  function home(instant) {
    const v = viewSpan();
    const pos = new THREE.Vector3(v.cx + v.span * 0.28, CT.H + v.span * 0.62, v.cz + v.span * 1.18);
    const target = new THREE.Vector3(v.cx, CT.H * 0.35, v.cz);
    if (instant) { camera.position.copy(pos); controls.target.copy(target); tween = null; } else flyTo(pos, target);
  }
  function zoom(factor) {
    const d = camera.position.clone().sub(controls.target).multiplyScalar(factor);
    d.setLength(THREE.MathUtils.clamp(d.length(), controls.minDistance, controls.maxDistance));
    flyTo(controls.target.clone().add(d), controls.target.clone(), 300);
  }

  function renderLegend() {
    const item = (color, label) => `<span><i style="background:${color}"></i>${label}</span>`;
    legend.innerHTML = mode === "type"
      ? item(TYPE_COLOR.tractor, "Tractor") + item("#e31937", "Loader / Backhoe") + item(TYPE_COLOR.implement, "Mower") + item(TYPE_COLOR.tire, "Tire Pallet") + item(TYPE_COLOR.buffer, "Buffer")
      : ["Iksan", "Okcheon", "Not Specified"].map((k) => item(PLANT_COLOR[k], k)).join("") + item(TYPE_COLOR.buffer, "Buffer");
  }
  function renderTabs() {
    tabs.innerHTML = plans.length < 2 ? "" : [-1, ...plans.map((_, i) => i)]
      .map((i) => `<button type="button" data-v3d-cont="${i}" class="${i === curCont ? "on" : ""}">${i < 0 ? "All" : `Container ${i + 1}`}</button>`).join("");
  }

  /* playback: slide each block in through the door */
  function stopPlay() {
    playing = false; clearInterval(playTimer);
    playButton.textContent = "▶ Play Loading";
    slides.forEach((slide) => { slide.o.g.position.x = slide.o.tx; });
    slides = [];
  }
  function togglePlay() {
    if (!segs.length) return;
    if (playing) { stopPlay(); return; }
    if (step >= segs.length) step = 0;
    playing = true; playButton.textContent = "❚❚ Pause"; select(null); applyStep();
    const interval = Math.max(260, Math.min(900, 9000 / segs.length));
    const next = () => {
      if (step >= segs.length) { stopPlay(); return; }
      const o = segs[step]; step += 1;
      if (curCont < 0 || o.ci === curCont) { o.g.position.x = CT.L + 3; slides.push({ o, t0: performance.now(), ms: interval * 0.8 }); }
      applyStep();
    };
    next(); playTimer = setInterval(next, interval);
  }

  element.addEventListener("click", (event) => {
    const contButton = event.target.closest("[data-v3d-cont]");
    if (contButton) { curCont = Number(contButton.dataset.v3dCont); renderTabs(); applyStep(); home(); return; }
    const modeButton = event.target.closest("[data-v3d-mode]");
    if (modeButton) {
      mode = modeButton.dataset.v3dMode;
      element.querySelectorAll("[data-v3d-mode]").forEach((b) => b.classList.toggle("on", b === modeButton));
      const selectedId = selected?.s.id;
      stopPlay(); buildScene(); renderLegend();
      if (selectedId) select(segs.find((o) => o.s.id === selectedId) || null);
      return;
    }
    const button = event.target.closest("[data-v3d]");
    if (!button) return;
    const v = viewSpan();
    switch (button.dataset.v3d) {
      case "zoom-in": zoom(0.65); break;
      case "zoom-out": zoom(1.5); break;
      case "rotate": controls.autoRotate = !controls.autoRotate; button.classList.toggle("on", controls.autoRotate); break;
      case "door": flyTo(new THREE.Vector3(CT.L + 6, CT.H * 1.3, v.cz + 1.6), new THREE.Vector3(CT.L * 0.55, CT.H * 0.4, v.cz)); break;
      case "top": flyTo(new THREE.Vector3(v.cx, v.span * 1.3, v.cz + 0.01), new THREE.Vector3(v.cx, 0, v.cz)); break;
      case "home": home(); break;
      case "play": togglePlay(); break;
      case "close-info": select(null); break;
    }
  });
  stepInput.addEventListener("input", () => { stopPlay(); step = Number(stepInput.value); applyStep(); });

  /* hover / click picking */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function hit(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const meshes = [];
    segs.forEach((o) => { if (o.g.visible) o.g.traverse((c) => { if (c.isMesh && c.userData.seg) meshes.push(c); }); });
    const hits = ray.intersectObjects(meshes, false);
    // prefer real blocks behind the translucent buffer walls
    const h = hits.find((x) => x.object.userData.seg.type !== "buffer") || hits[0];
    return h ? segs.find((o) => o.s === h.object.userData.seg) : null;
  }
  let down = null, hoverQueued = false, lastMove = null;
  renderer.domElement.addEventListener("pointerdown", (event) => { down = { x: event.clientX, y: event.clientY }; });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    down = null;
    if (moved < 6 && event.button === 0) select(hit(event));
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    lastMove = event;
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (down) { tip.style.display = "none"; return; }
      const o = hit(lastMove), rect = stage.getBoundingClientRect();
      if (!o) { tip.style.display = "none"; renderer.domElement.style.cursor = ""; return; }
      tip.style.display = "block";
      tip.innerHTML = `<b>${esc(o.s.displayName)}</b> · C${o.ci + 1} #${o.seq} · ${meter(o.from)}–${meter(o.to)} m${o.s.type !== "buffer" && o.s.capacity ? ` · ${o.s.orderedQuantity}/${o.s.capacity}` : ""}`;
      let x = lastMove.clientX - rect.left + 14;
      if (x + tip.offsetWidth > rect.width) x -= tip.offsetWidth + 28;
      tip.style.left = x + "px"; tip.style.top = (lastMove.clientY - rect.top + 14) + "px";
      renderer.domElement.style.cursor = "pointer";
    });
  });
  renderer.domElement.addEventListener("pointerleave", () => { tip.style.display = "none"; });

  /* sizing + render loop (skips frames while detached, e.g. in 2D mode) */
  let lastW = 0, lastH = 0;
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h || (w === lastW && h === lastH)) return;
    lastW = w; lastH = h;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(() => requestAnimationFrame(resize)).observe(stage);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!element.isConnected || !stage.clientWidth) return;
    resize();
    if (tween) {
      const k = reduceMotion ? 1 : Math.min(1, (now - tween.t0) / tween.ms);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.q0, tween.q1, e);
      if (k >= 1) tween = null;
    }
    slides = slides.filter((slide) => {
      const k = reduceMotion ? 1 : Math.min(1, (now - slide.t0) / slide.ms);
      const e = 1 - Math.pow(1 - k, 3);
      slide.o.g.position.x = (CT.L + 3) + (slide.o.tx - CT.L - 3) * e;
      return k < 1;
    });
    controls.update();
    renderer.render(scene, camera);
  }

  renderLegend();
  home(true);
  requestAnimationFrame(loop);

  function update(containers) {
    const next = JSON.stringify(containers.map((c) => c.segments.map((s) => [s.id, s.length, s.orderedQuantity])));
    if (next === signature) return;
    signature = next;
    stopPlay(); select(null);
    plans = containers;
    if (curCont >= plans.length) curCont = -1;
    buildScene();
    step = segs.length; applyStep();
    renderTabs();
    $(".v3dEmpty").hidden = plans.length > 0;
    home(true);
  }

  return { element, update };
}
