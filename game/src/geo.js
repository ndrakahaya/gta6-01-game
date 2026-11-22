// Procedural materials and geometry helpers: every texture in the game is painted into an
// offscreen canvas at load time, so the entry ships zero image files and still looks built.

import * as THREE from 'three';

const cache = new Map();

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  return { c, g };
}

function finish(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 4;
  return t;
}

function noise(g, w, h, amount) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
}

/** Asphalt with aggregate speckle; tiles over the whole road network. */
export function texAsphalt() {
  if (cache.has('asphalt')) return cache.get('asphalt');
  const S = 256;
  const { c, g } = canvas2d(S, S);
  g.fillStyle = '#6b6f76';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const v = 88 + Math.random() * 52;
    g.fillStyle = `rgba(${v},${v + 2},${v + 6},${0.28 + Math.random() * 0.5})`;
    const r = Math.random() * 2.2 + 0.4;
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(48,50,56,0.28)';
  g.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.moveTo(Math.random() * S, 0);
    g.bezierCurveTo(Math.random() * S, S * 0.3, Math.random() * S, S * 0.7, Math.random() * S, S);
    g.stroke();
  }
  const t = finish(c);
  cache.set('asphalt', t);
  return t;
}

/** Sidewalk concrete: pale slabs with expansion joints. */
export function texConcrete() {
  if (cache.has('concrete')) return cache.get('concrete');
  const S = 256;
  const { c, g } = canvas2d(S, S);
  g.fillStyle = '#c3beb4';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 1400; i++) {
    const v = 160 + Math.random() * 60;
    g.fillStyle = `rgba(${v},${v - 4},${v - 12},0.35)`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  g.strokeStyle = 'rgba(140,136,128,0.85)';
  g.lineWidth = 2;
  for (let i = 0; i <= 2; i++) {
    const p = (i * S) / 2;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, S);
    g.stroke();
    g.beginPath();
    g.moveTo(0, p);
    g.lineTo(S, p);
    g.stroke();
  }
  const t = finish(c);
  cache.set('concrete', t);
  return t;
}

export function texGrass() {
  if (cache.has('grass')) return cache.get('grass');
  const S = 128;
  const { c, g } = canvas2d(S, S);
  g.fillStyle = '#5c7a45';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2400; i++) {
    const v = 70 + Math.random() * 60;
    g.fillStyle = `rgba(${v * 0.75},${v},${v * 0.5},0.5)`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  const t = finish(c);
  cache.set('grass', t);
  return t;
}

export function texSand() {
  if (cache.has('sand')) return cache.get('sand');
  const S = 128;
  const { c, g } = canvas2d(S, S);
  g.fillStyle = '#d6bf96';
  g.fillRect(0, 0, S, S);
  noise(g, S, S, 34);
  const t = finish(c);
  cache.set('sand', t);
  return t;
}

export function texRoof() {
  if (cache.has('roof')) return cache.get('roof');
  const S = 128;
  const { c, g } = canvas2d(S, S);
  g.fillStyle = '#8b8e93';
  g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(148,152,158,0.6)';
  for (let i = 0; i < 40; i += 4) {
    g.fillRect(0, i, S, 2);
  }
  noise(g, S, S, 22);
  const t = finish(c);
  cache.set('roof', t);
  return t;
}

/**
 * A building facade tile: 3 windows across by 2 floors, drawn so the pattern repeats cleanly.
 */
export function texFacade(key, tone, style) {
  const id = `facade:${key}`;
  if (cache.has(id)) return cache.get(id);
  const W = 192;
  const H = 192;
  const { c, g } = canvas2d(W, H);
  g.fillStyle = tone;
  g.fillRect(0, 0, W, H);
  noise(g, W, H, 16);

  const cols = 3;
  const rows = 2;
  const cellW = W / cols;
  const cellH = H / rows;

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cellW + cellW * 0.18;
      const y = r * cellH + cellH * 0.2;
      const w = cellW * 0.64;
      const h = cellH * (style === 'ribbon' ? 0.5 : 0.58);
      g.fillStyle = 'rgba(60,64,70,0.5)';
      g.fillRect(x - 2, y - 2, w + 4, h + 4);
      const grad = g.createLinearGradient(x, y, x + w, y + h);
      const lit = Math.random() < 0.24;
      if (lit) {
        grad.addColorStop(0, '#f2e3b0');
        grad.addColorStop(1, '#cdbb85');
      } else {
        grad.addColorStop(0, '#a9c2d4');
        grad.addColorStop(0.55, '#6b869b');
        grad.addColorStop(1, '#4a6478');
      }
      g.fillStyle = grad;
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(50,54,60,0.55)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x + w / 2, y);
      g.lineTo(x + w / 2, y + h);
      g.stroke();
      if (style === 'shutter') {
        g.fillStyle = 'rgba(86,92,100,0.5)';
        g.fillRect(x - 6, y, 5, h);
        g.fillRect(x + w + 1, y, 5, h);
      }
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillRect(x - 3, y + h, w + 6, 3);
    }
    g.fillStyle = 'rgba(0,0,0,0.1)';
    g.fillRect(0, (r + 1) * cellH - 5, W, 5);
  }
  if (style === 'brick') {
    g.globalAlpha = 0.12;
    g.strokeStyle = '#2a1d17';
    g.lineWidth = 1;
    for (let y = 0; y < H; y += 8) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  const t = finish(c);
  cache.set(id, t);
  return t;
}

/** A shopfront strip used for the ground floor of commercial blocks. */
export function texShopfront() {
  if (cache.has('shop')) return cache.get('shop');
  const W = 256;
  const H = 128;
  const { c, g } = canvas2d(W, H);
  g.fillStyle = '#8a8b8f';
  g.fillRect(0, 0, W, H);
  const signColors = ['#c0392b', '#1f6f8b', '#d4a017', '#2e8b57', '#7a4ea8', '#d4642a'];
  for (let i = 0; i < 4; i++) {
    const x = i * (W / 4);
    g.fillStyle = '#6f7075';
    g.fillRect(x, 0, 5, H);
    g.fillStyle = signColors[i % signColors.length];
    g.fillRect(x + 9, 6, W / 4 - 18, 20);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.fillRect(x + 18, 13, W / 4 - 46, 6);
    const grad = g.createLinearGradient(x, 32, x, H);
    grad.addColorStop(0, '#c3d8e6');
    grad.addColorStop(0.55, '#8a939c');
    grad.addColorStop(1, '#59636b');
    g.fillStyle = grad;
    g.fillRect(x + 11, 32, W / 4 - 22, H - 44);
    g.strokeStyle = 'rgba(30,32,36,0.85)';
    g.lineWidth = 3;
    g.strokeRect(x + 11, 32, W / 4 - 22, H - 44);
    g.beginPath();
    g.moveTo(x + W / 8, 32);
    g.lineTo(x + W / 8, H - 12);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(x + 11, H - 14, W / 4 - 22, 3);
  }
  const t = finish(c);
  cache.set('shop', t);
  return t;
}

/** A face for the front of a head box: brows, eyes, nose shadow, mouth. */
export function texFace(key, skin, hair) {
  const id = `face:${key}`;
  if (cache.has(id)) return cache.get(id);
  const S = 128;
  const { c, g } = canvas2d(S, S);
  g.fillStyle = skin;
  g.fillRect(0, 0, S, S);
  g.fillStyle = hair;
  g.fillRect(0, 0, S, 22);
  g.beginPath();
  g.moveTo(0, 22);
  g.quadraticCurveTo(S * 0.5, 34, S, 22);
  g.lineTo(S, 0);
  g.lineTo(0, 0);
  g.fill();
  const eyeY = 56;
  g.fillStyle = '#f4f1ea';
  g.fillRect(26, eyeY, 26, 13);
  g.fillRect(76, eyeY, 26, 13);
  g.fillStyle = '#3a2b20';
  g.fillRect(35, eyeY + 3, 9, 8);
  g.fillRect(85, eyeY + 3, 9, 8);
  g.fillStyle = '#111';
  g.fillRect(38, eyeY + 5, 4, 4);
  g.fillRect(88, eyeY + 5, 4, 4);
  g.fillStyle = hair;
  g.fillRect(22, eyeY - 10, 32, 5);
  g.fillRect(74, eyeY - 10, 32, 5);
  g.fillStyle = 'rgba(0,0,0,0.16)';
  g.fillRect(58, eyeY + 16, 10, 20);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(54, eyeY + 34, 18, 4);
  g.fillStyle = 'rgba(90,40,40,0.85)';
  g.fillRect(46, 104, 36, 5);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(46, 109, 36, 3);
  g.fillStyle = 'rgba(0,0,0,0.07)';
  g.fillRect(0, 118, S, 10);
  const t = finish(c, false);
  cache.set(id, t);
  return t;
}

/** Merge a list of {geometry, matrix} into one non-indexed BufferGeometry (position/normal/uv). */
export function mergeGeoms(parts) {
  let total = 0;
  const prepared = parts.map(({ geometry, matrix }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    total += g.attributes.position.count;
    return g;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of prepared) {
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

/**
 * Merge coloured boxes into ONE vertex-coloured geometry, so a whole prop or actor body costs
 * a single draw call. Each box: {w,h,d,x,y,z,color,rx?,ry?,rz?}.
 */
export function mergeColoredBoxes(boxes) {
  const geoms = boxes.map((b) => {
    let g = new THREE.BoxGeometry(b.w, b.h, b.d);
    if (b.rx) g.rotateX(b.rx);
    if (b.ry) g.rotateY(b.ry);
    if (b.rz) g.rotateZ(b.rz);
    g.translate(b.x ?? 0, b.y ?? 0, b.z ?? 0);
    // BoxGeometry is indexed: expand first, or concatenating position arrays corrupts triangles.
    g = g.toNonIndexed();
    const col = new THREE.Color(b.color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = col.r;
      arr[i * 3 + 1] = col.g;
      arr[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  });
  let total = 0;
  for (const g of geoms) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/** A box whose UVs are scaled to world size, so a shared facade texture keeps window scale. */
export function buildingGeo(w, h, d, tileW = 7.5, tileH = 7.0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const faces = [
    [d / tileW, h / tileH],
    [d / tileW, h / tileH],
    [w / tileW, d / tileW],
    [w / tileW, d / tileW],
    [w / tileW, h / tileH],
    [w / tileW, h / tileH],
  ];
  for (let f = 0; f < 6; f++) {
    const [ru, rv] = faces[f];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * ru, uv.getY(idx) * rv);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

export function disposeCache() {
  for (const t of cache.values()) t.dispose?.();
  cache.clear();
}
