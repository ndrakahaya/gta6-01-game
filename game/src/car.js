// Vehicles: low-poly car bodies merged into ONE vertex-coloured mesh per car (body, glass,
// bumpers, lights and grille all baked in), four rolling wheels, arcade driving physics
// (throttle/brake/steer/grip/handbrake), damage and explosion. The same class serves the
// player's stolen cars, parked cars, civilian traffic and police cruisers.

import * as THREE from 'three';
import { CONFIG } from './config.js';

const C = CONFIG.car;

/** Wheels stick out past the body sides, so the body is narrower than the track. */
export const WHEEL_R = 0.4;
const WHEEL_T = 0.28;
const BODY_INSET = 0.24;   // body half-width is this much narrower than the track, so wheels show
const FLOOR = 0.26;        // chassis floor above the ground, so wheels read under the rocker

export const CAR_KINDS = {
  sedan: {
    label: 'Ferrano Vento', length: 4.5, width: 1.9, height: 1.46, mass: 1.0,
    topSpeed: 1.0, colors: ['#b23a2e', '#2f4f7a', '#d8d2c4', '#3f6b4a', '#22262b', '#8f8f96'],
  },
  coupe: {
    label: 'Vela GT', length: 4.3, width: 1.94, height: 1.26, mass: 0.9,
    topSpeed: 1.22, colors: ['#d1471f', '#f2c230', '#15181d', '#e8e8ec', '#2f6f9f'],
  },
  muscle: {
    label: 'Corsa Rey', length: 4.8, width: 2.0, height: 1.36, mass: 1.15,
    topSpeed: 1.12, colors: ['#7a2018', '#1d2a44', '#c9a227', '#2b2b2b', '#5f7a3f'],
  },
  van: {
    label: 'Carga 240', length: 5.2, width: 2.1, height: 2.1, mass: 1.5,
    topSpeed: 0.82, colors: ['#e6e2d6', '#4a5b6b', '#8a6a3a', '#2f6f4f'],
  },
  taxi: {
    label: 'Vela Cab', length: 4.5, width: 1.9, height: 1.48, mass: 1.0,
    topSpeed: 0.98, colors: ['#f0c020'],
  },
  police: {
    label: 'PVPD Interceptor', length: 4.7, width: 1.95, height: 1.44, mass: 1.05,
    topSpeed: 1.3, colors: ['#16202e'],
  },
};

/**
 * Vertex-coloured merge: several boxes, each with its own colour, end up in a single geometry
 * so a whole car body is one draw call.
 */
function mergedColored(boxes) {
  const geoms = boxes.map((b) => {
    let g = new THREE.BoxGeometry(b.w, b.h, b.d);
    if (b.rx) g.rotateX(b.rx);
    if (b.ry) g.rotateY(b.ry);
    if (b.rz) g.rotateZ(b.rz);
    g.translate(b.x, b.y, b.z);
    // BoxGeometry is indexed; expand to a flat triangle list so the merge can concatenate
    // position arrays directly (mixing indexed and non-indexed data corrupts the triangles).
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

const GLASS = '#8aa3b8';
const TRIM = '#22262b';
const HEAD = '#fff3cf';
const TAIL = '#c9302a';
const SHADOW = '#33383f';
const TYRE_DARK = '#303338';

/**
 * Body layout, in metres above the road:
 *   0.00 ground · 0.14 chassis floor · 0.62 beltline · beltline..H roof
 * Wheels sit at y = WHEEL_R and stick out sideways past the body.
 */
function carBoxes(kind, color) {
  const k = CAR_KINDS[kind];
  const L = k.length;
  const W = k.width - BODY_INSET * 2;   // body is narrower than the track
  const H = k.height;
  const boxes = [];

  const isVan = kind === 'van';
  const lowerTop = isVan ? H * 0.52 : H * 0.44;      // top of the main body
  const lowerH = lowerTop - FLOOR;
  const lowerY = FLOOR + lowerH / 2;

  // main body (hood/trunk/door mass)
  boxes.push({ w: W, h: lowerH, d: L, x: 0, y: lowerY, z: 0, color });
  // a thin skirt under the body so no gap shows through to the other side
  boxes.push({ w: W * 0.94, h: 0.1, d: L * 0.86, x: 0, y: FLOOR, z: 0, color: TRIM });

  // cabin sits on top of the body
  const cabH = H - lowerTop;
  const cabL = isVan ? L * 0.74 : L * 0.44;
  const cabW = W * 0.93;
  const cabZ = isVan ? -L * 0.04 : -L * 0.07;
  const cabY = lowerTop + cabH / 2;
  boxes.push({ w: cabW, h: cabH, d: cabL, x: 0, y: cabY, z: cabZ, color });
  boxes.push({ w: cabW * 0.97, h: 0.06, d: cabL * 1.01, x: 0, y: lowerTop + cabH + 0.02, z: cabZ, color });

  // glass: inset into the cabin so nothing pokes through the paint
  const gH = cabH * 0.62;
  const gY = cabY + cabH * 0.06;
  boxes.push({ w: cabW * 0.84, h: gH, d: 0.05, x: 0, y: gY, z: cabZ + cabL / 2 - 0.012, color: GLASS });
  boxes.push({ w: cabW * 0.8, h: gH * 0.92, d: 0.05, x: 0, y: gY, z: cabZ - cabL / 2 + 0.012, color: GLASS });
  for (const s of [-1, 1]) {
    boxes.push({
      w: 0.05, h: gH * 0.94, d: cabL * 0.62,
      x: s * (cabW / 2 - 0.014), y: gY, z: cabZ, color: GLASS,
    });
  }

  // bumpers
  boxes.push({ w: W * 1.0, h: 0.3, d: 0.34, x: 0, y: FLOOR + 0.2, z: L / 2 - 0.08, color: TRIM });
  boxes.push({ w: W * 1.0, h: 0.3, d: 0.34, x: 0, y: FLOOR + 0.2, z: -L / 2 + 0.08, color: TRIM });

  // headlights / taillights / grille, proud of the body faces
  const lightY = FLOOR + lowerH * 0.62;
  for (const s of [-1, 1]) {
    boxes.push({ w: 0.44, h: 0.2, d: 0.07, x: s * W * 0.31, y: lightY, z: L / 2 + 0.005, color: HEAD });
    boxes.push({ w: 0.42, h: 0.18, d: 0.07, x: s * W * 0.31, y: lightY, z: -L / 2 - 0.005, color: TAIL });
  }
  boxes.push({ w: W * 0.42, h: 0.16, d: 0.02, x: 0, y: lightY - 0.01, z: L / 2 + 0.02, color: '#14171b' });

    // wheel arches: a dark recess strip on the lower flank, above the wheel centre only, so the
    // tyre stays visible below it instead of being covered
    for (const s of [-1, 1]) {
      for (const sz of [-1, 1]) {
        boxes.push({
          w: 0.05, h: WHEEL_R * 0.8, d: WHEEL_R * 2.1,
          x: s * (W / 2 + 0.004), y: FLOOR + WHEEL_R * 0.5, z: sz * (L / 2 - 0.94), color: '#15171b',
        });
      }
    }

  // side mirrors
  for (const s of [-1, 1]) {
    boxes.push({
      w: 0.13, h: 0.1, d: 0.19,
      x: s * (cabW / 2 + 0.08), y: lowerTop + 0.04, z: cabZ + cabL * 0.3, color: TRIM,
    });
  }

  // baked contact shadow: a flat slab tight to the chassis, no extra draw call
  boxes.push({ w: k.width * 1.02, h: 0.015, d: L * 1.0, x: 0, y: 0.02, z: 0, color: SHADOW });
  // rocker/side skirt bridging the gap between the wheels, sitting above them
  boxes.push({ w: W * 1.005, h: 0.12, d: L * 0.5, x: 0, y: FLOOR - 0.02, z: 0, color: TRIM });
  if (kind === 'taxi') {
    boxes.push({ w: 0.52, h: 0.15, d: 0.26, x: 0, y: H + 0.1, z: cabZ, color: '#f7e04a' });
  }
  if (kind === 'police') {
    // light bar
    boxes.push({ w: 0.28, h: 0.12, d: 0.24, x: -0.21, y: H + 0.08, z: cabZ + 0.12, color: '#ff2f24' });
    boxes.push({ w: 0.28, h: 0.12, d: 0.24, x: 0.21, y: H + 0.08, z: cabZ + 0.12, color: '#2f6bff' });
    // livery so the cruiser reads as police from any angle, not just by the roof bar:
    // a white door stripe down each flank plus a dark push bar on the nose
    for (const s of [-1, 1]) {
      boxes.push({
        w: 0.03, h: 0.30, d: L * 0.62,
        x: s * (W / 2 + 0.012), y: FLOOR + 0.36, z: 0, color: '#eef3f8',
      });
      boxes.push({
        w: 0.03, h: 0.16, d: L * 0.42,
        x: s * (W / 2 + 0.014), y: FLOOR + 0.10, z: 0, color: '#1b2534',
      });
    }
    boxes.push({ w: W * 0.78, h: 0.34, d: 0.09, x: 0, y: FLOOR + 0.22, z: L / 2 + 0.06, color: '#20262e' });
  }

  return { boxes, lowerTop, lowerH, cabY, cabH, cabL, cabZ, L, W, H, lightY };
}

/** The wheel geometry: a tyre with a hub face, axis along local X. */
function buildWheelGeo() {
  const parts = [];
  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_T, 12).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(WHEEL_R * 0.52, WHEEL_R * 0.52, WHEEL_T * 1.06, 8).rotateZ(Math.PI / 2);
  parts.push({ geo: tyre, color: TYRE_DARK });
  parts.push({ geo: hub, color: '#9aa1a8' });
  let total = 0;
  const ns = parts.map((p) => { const g = p.geo.toNonIndexed(); total += g.attributes.position.count; return g; });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  ns.forEach((g, i) => {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    const c = new THREE.Color(parts[i].color);
    for (let v = 0; v < g.attributes.position.count; v++) {
      col[(o + v) * 3] = c.r;
      col[(o + v) * 3 + 1] = c.g;
      col[(o + v) * 3 + 2] = c.b;
    }
    o += g.attributes.position.count;
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

export const wheelGeometry = buildWheelGeo();
const geomCache = new Map();

export class Car {
  constructor(scene, opts = {}) {
    this.kind = opts.kind ?? 'sedan';
    this.spec = CAR_KINDS[this.kind];
    this.color = opts.color ?? this.spec.colors[0];
    const made = carBoxes(this.kind, this.color);
    this.bodyInfo = made;

    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const cacheKey = `${this.kind}:${this.color}`;
    if (!geomCache.has(cacheKey)) geomCache.set(cacheKey, mergedColored(made.boxes));
    this.bodyGeo = geomCache.get(cacheKey);
    this.ownsGeo = false;

    this.mesh = new THREE.Group();
    const bodyMesh = new THREE.Mesh(this.bodyGeo, this.material);
    bodyMesh.frustumCulled = true;
    this.mesh.add(bodyMesh);
    this.bodyMesh = bodyMesh;
    scene.add(this.mesh);

    // wheels are drawn by one shared InstancedMesh (see VehicleManager); keep only offsets here
    this.wheels = [];
    const halfL = this.spec.length / 2 - 0.94;
    const track = this.spec.width / 2 - WHEEL_T / 2 - 0.01;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.wheels.push({ x: sx * track, y: WHEEL_R, z: sz * halfL, front: sz > 0 });
      }
    }

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = 0;
    this.lateral = 0;
    this.heading = 0;
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.health = CONFIG.car.maxHealth;
    this.exploded = false;
    this.driver = null;
    this.ai = null;
    this.braking = false;
    this.wheelSpin = 0;
    this.occupiedByPlayer = false;
    this.stolen = false;
    this.parked = false;
    this.hornTimer = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.worldSpan = 640;
    this.onCrash = null;
  }

  get speed() { return this.vel; }
  get maxSpeed() { return C.maxSpeed * this.spec.topSpeed; }

  placeAt(x, z, heading = 0) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.vel = 0;
    this.lateral = 0;
    this.syncMesh();
  }

  damage(amount) {
    if (this.exploded) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.exploded = true;
      return true;
    }
    return false;
  }

  update(dt, opts = {}) {
    const colliders = opts.colliders ?? [];
    if (this.exploded) {
      this.syncMesh();
      return;
    }

    const maxFwd = this.maxSpeed;
    const maxRev = C.reverseSpeed;

    const engine = this.throttle * C.engineForce * this.spec.mass;
    const braking = this.brake * C.brakeForce;
    const drag = this.vel * Math.abs(this.vel) * 0.019 + this.vel * C.drag;

    if (this.throttle > 0) {
      this.vel += engine * dt;
    } else if (this.throttle < 0) {
      if (this.vel > 0.4) this.vel -= engine * dt * 0.55;
      else this.vel += engine * dt * 0.75;
    }
    this.vel -= drag * dt;
    if (this.brake > 0) {
      const s = Math.sign(this.vel);
      this.vel -= s * braking * dt;
      if (Math.abs(this.vel) < braking * dt) this.vel = 0;
    }
    if (this.handbrake) {
      this.vel -= Math.sign(this.vel) * 16 * dt;
    }
    if (this.throttle === 0 && this.brake === 0) {
      this.vel -= Math.sign(this.vel) * Math.min(Math.abs(this.vel), C.rollingResist * dt * 2.4);
    }
    this.vel = Math.max(-maxRev, Math.min(maxFwd, this.vel));
    this.braking = this.brake > 0.1 || (this.throttle < 0 && this.vel > 0.4);

    const speed01 = Math.min(1, Math.abs(this.vel) / maxFwd);
    const steerAuthority = C.steerRate * (1 - speed01 * 0.55) * Math.sign(this.vel || 1);
    this.heading += this.steer * steerAuthority * dt * Math.min(1, Math.abs(this.vel) / 3.2);

    const grip = this.handbrake ? C.handbrakeGrip : (opts.drifting ? C.driftGrip : C.grip);
    this.lateral *= Math.max(0, 1 - grip * dt);

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const rx = Math.cos(this.heading);
    const rz = -Math.sin(this.heading);

    let nx = this.pos.x + (fx * this.vel + rx * this.lateral) * dt;
    let nz = this.pos.z + (fz * this.vel + rz * this.lateral) * dt;

    if (this.collidesAt(nx, nz, colliders)) {
      const dmg = Math.min(30, Math.abs(this.vel) * 1.1);
      if (Math.abs(this.vel) > 5) this.onCrash?.(dmg, this);
      this.vel *= -0.22;
      this.lateral *= -0.2;
      nx = this.pos.x;
      nz = this.pos.z;
    }
    this.pos.x = nx;
    this.pos.z = nz;
    this.pos.x = Math.max(-40, Math.min(this.worldSpan, this.pos.x));
    this.pos.z = Math.max(-40, Math.min(this.worldSpan, this.pos.z));

    this.wheelSpin += (this.vel / WHEEL_R) * dt;

    const accel = this.throttle > 0 ? 1 : (this.brake > 0 ? -1 : 0);
    this.bodyRoll += ((-this.steer * speed01 * 0.1) - this.bodyRoll) * Math.min(1, dt * 8);
    this.bodyPitch += ((accel * 0.03) - this.bodyPitch) * Math.min(1, dt * 6);
    this.bodyMesh.rotation.z = this.bodyRoll;
    this.bodyMesh.rotation.x = this.bodyPitch;

    if (this.hornTimer > 0) this.hornTimer -= dt;
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.set(this.pos.x, this.exploded ? 0.1 : 0, this.pos.z);
    this.mesh.rotation.y = this.heading;
    if (this.exploded) this.bodyMesh.rotation.z = 0.1;
  }

  collidesAt(x, z, colliders) {
    const r = 0.95;
    const halfL = this.spec.length * 0.42;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    for (const t of [-1, 0, 1]) {
      const px = x + fx * halfL * t;
      const pz = z + fz * halfL * t;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        if (c.h !== undefined && c.h < 0.4) continue;
        if (px + r > c.minX && px - r < c.maxX && pz + r > c.minZ && pz - r < c.maxZ) return true;
      }
    }
    return false;
  }

  doorPoint(out) {
    const rx = Math.cos(this.heading);
    const rz = -Math.sin(this.heading);
    return out.set(this.pos.x + rx * (this.spec.width / 2 + 1.0), 0, this.pos.z + rz * (this.spec.width / 2 + 1.0));
  }

  dispose(scene) {
    scene.remove(this.mesh);
    if (this.ownsGeo) this.bodyGeo.dispose();
    this.material.dispose();
  }
}
