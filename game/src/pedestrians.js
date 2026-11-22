// Pedestrians: civilians walking the sidewalks of Puerto Vela. Each body is merged into three
// vertex-coloured meshes (torso, left leg, right leg) so a whole crowd stays cheap, and the legs
// swing from a walk phase. They follow sidewalk routes, turn at corners, step aside for cars and
// flee when the player starts shooting.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { mergeColoredBoxes } from './geo.js';
import { makeRng, rngRange, rngInt, pick, chance } from './rng.js';

const SKINS = ['#c98f6b', '#a9704f', '#e0b48c', '#7d5236', '#d9a679', '#5f3d28'];
const SHIRTS = ['#d9534f', '#3f7cac', '#f0ad4e', '#5cb85c', '#8e6cb0', '#e8e8e8', '#2f3b46', '#c96f9c', '#e07a3f'];
const PANTS = ['#2d3a4a', '#3c3c46', '#5a4632', '#243036', '#4b4b58', '#6b6b6b'];
const HAIRS = ['#1a1a1a', '#3b2416', '#6b4a2a', '#9c7b4a', '#20242c'];

const upperCache = new Map();
const legCache = new Map();

/** Torso + head + arms as one geometry, keyed by palette so identical civilians share it. */
function upperGeo(skin, shirt, hair) {
  const key = `${skin}|${shirt}|${hair}`;
  if (upperCache.has(key)) return upperCache.get(key);
  const g = mergeColoredBoxes([
    { w: 0.52, h: 0.62, d: 0.30, y: 1.24, color: shirt },          // torso
    { w: 0.16, h: 0.08, d: 0.16, y: 1.59, color: skin },           // neck
    { w: 0.29, h: 0.31, d: 0.29, y: 1.78, color: skin },           // head
    { w: 0.31, h: 0.10, d: 0.31, y: 1.94, color: hair },           // hair
    { w: 0.05, h: 0.05, d: 0.02, x: -0.07, y: 1.80, z: 0.15, color: '#20242c' }, // eyes
    { w: 0.05, h: 0.05, d: 0.02, x: 0.07, y: 1.80, z: 0.15, color: '#20242c' },
    { w: 0.14, h: 0.52, d: 0.15, x: -0.33, y: 1.22, color: shirt }, // arms
    { w: 0.14, h: 0.52, d: 0.15, x: 0.33, y: 1.22, color: shirt },
    { w: 0.13, h: 0.14, d: 0.14, x: -0.33, y: 0.92, color: skin },  // hands
    { w: 0.13, h: 0.14, d: 0.14, x: 0.33, y: 0.92, color: skin },
  ]);
  upperCache.set(key, g);
  return g;
}

/** One leg, pivoted at the hip so rotation.x swings it. */
function legGeo(pants) {
  if (legCache.has(pants)) return legCache.get(pants);
  const g = mergeColoredBoxes([
    { w: 0.18, h: 0.44, d: 0.19, y: -0.22, color: pants },
    { w: 0.17, h: 0.40, d: 0.18, y: -0.62, color: pants },
    { w: 0.19, h: 0.10, d: 0.27, y: -0.86, z: 0.04, color: '#1c1f24' },
  ]);
  legCache.set(pants, g);
  return g;
}

const sharedMat = new THREE.MeshLambertMaterial({ vertexColors: true });

export class Pedestrian {
  constructor(scene, rng, route, t) {
    this.rng = rng;
    const skin = pick(rng, SKINS);
    const shirt = pick(rng, SHIRTS);
    const pants = pick(rng, PANTS);
    const hair = pick(rng, HAIRS);

    this.root = new THREE.Group();
    this.upper = new THREE.Mesh(upperGeo(skin, shirt, hair), sharedMat);
    this.legL = new THREE.Mesh(legGeo(pants), sharedMat);
    this.legR = new THREE.Mesh(legGeo(pants), sharedMat);
    this.legL.position.set(-0.14, 0.90, 0);
    this.legR.position.set(0.14, 0.90, 0);
    this.root.add(this.upper, this.legL, this.legR);
    scene.add(this.root);

    this.pos = new THREE.Vector3();
    this.route = route;
    this.t = t;
    this.dir = chance(rng, 0.5) ? 1 : -1;
    this.speed = rngRange(rng, 1.15, 1.95);
    this.baseSpeed = this.speed;
    this.facing = 0;
    this.phase = rng() * 6.28;
    this.health = 40;
    this.dead = false;
    this.fleeing = 0;
    this.fleeDir = new THREE.Vector3();
    this.waitTimer = 0;
    this.kind = 'civilian';
    this.placeOnRoute();
  }

  placeOnRoute() {
    const r = this.route;
    if (r.axis === 'z') this.pos.set(r.fixed, 0, this.t);
    else this.pos.set(this.t, 0, r.fixed);
    this.facing = r.axis === 'z' ? (this.dir > 0 ? 0 : Math.PI) : (this.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    this.sync();
  }

  sync() {
    this.root.position.set(this.pos.x, this.pos.y ?? 0, this.pos.z);
    this.root.rotation.y = this.facing;
  }

  /** Panic: run away from a threat point for a while. */
  flee(fromX, fromZ, seconds = 6) {
    if (this.dead) return;
    this.fleeing = Math.max(this.fleeing, seconds);
    const dx = this.pos.x - fromX;
    const dz = this.pos.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    this.fleeDir.set(dx / len, 0, dz / len);
  }

  hit(damage, fromX, fromZ) {
    if (this.dead) return false;
    this.health -= damage;
    this.flee(fromX, fromZ, 8);
    if (this.health <= 0) {
      this.dead = true;
      this.root.rotation.z = -Math.PI / 2;
      this.root.position.y = 0.28;
      return true;
    }
    return false;
  }

  update(dt, ctx) {
    if (this.dead) return;

    if (this.fleeing > 0) {
      this.fleeing -= dt;
      const sp = 5.4;
      const nx = this.pos.x + this.fleeDir.x * sp * dt;
      const nz = this.pos.z + this.fleeDir.z * sp * dt;
      if (!ctx.blocked(nx, nz, 0.4)) {
        this.pos.x = nx;
        this.pos.z = nz;
      } else {
        // slide along the obstacle instead of freezing against it
        if (!ctx.blocked(nx, this.pos.z, 0.4)) this.pos.x = nx;
        else if (!ctx.blocked(this.pos.x, nz, 0.4)) this.pos.z = nz;
        else this.fleeDir.set(-this.fleeDir.z, 0, this.fleeDir.x);
      }
      this.facing = Math.atan2(this.fleeDir.x, this.fleeDir.z);
      this.phase += sp * dt * 2.3;
      this.animate(1.3);
      this.sync();
      return;
    }

    // step aside when a car is bearing down on this pedestrian
    let dodge = 0;
    for (const car of ctx.cars) {
      if (!car.mesh.visible || Math.abs(car.vel) < 4) continue;
      const dx = this.pos.x - car.pos.x;
      const dz = this.pos.z - car.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 64) {
        const fx = Math.sin(car.heading);
        const fz = Math.cos(car.heading);
        const ahead = dx * fx + dz * fz;
        if (ahead > 0) {
          const side = dx * Math.cos(car.heading) - dz * Math.sin(car.heading);
          dodge = side >= 0 ? 1 : -1;
          break;
        }
      }
    }

    if (this.waitTimer > 0) {
      this.waitTimer -= dt;
      this.animate(0);
      this.sync();
      return;
    }

    const r = this.route;
    const step = this.speed * dt * (dodge ? 1.9 : 1);
    this.t += this.dir * step;

    // at the end of a block, turn onto a crossing sidewalk or reverse
    if (this.t < r.from || this.t > r.to) {
      this.t = Math.max(r.from, Math.min(r.to, this.t));
      const next = ctx.pickTurn(this);
      if (next) {
        this.route = next.route;
        this.t = next.t;
        this.dir = next.dir;
      } else {
        this.dir *= -1;
      }
      this.placeOnRoute();
    } else if (r.axis === 'z') {
      this.pos.set(r.fixed + dodge * 0.9, 0, this.t);
      this.facing = this.dir > 0 ? 0 : Math.PI;
    } else {
      this.pos.set(this.t, 0, r.fixed + dodge * 0.9);
      this.facing = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }

    this.phase += this.speed * dt * 2.4;
    this.animate(dodge ? 1.2 : 0.62);
    this.sync();
  }

  animate(amp) {
    const s = Math.sin(this.phase) * amp;
    this.legL.rotation.x = s * 0.72;
    this.legR.rotation.x = -s * 0.72;
    this.upper.position.y = Math.abs(Math.sin(this.phase)) * 0.035 * amp;
    this.upper.rotation.x = Math.min(0.2, amp * 0.12);
  }

  dispose(scene) {
    scene.remove(this.root);
  }
}

export class PedestrianManager {
  constructor(scene, city, rng) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.peds = [];
    this.routes = city.pedRoutes;
    this.onKill = null;
    this.spawn();
  }

  spawn() {
    const rng = this.rng;
    const count = CONFIG.pedCount;
    for (let i = 0; i < count; i++) {
      const route = pick(rng, this.routes);
      const t = rngRange(rng, route.from + 4, route.to - 4);
      const ped = new Pedestrian(this.scene, rng, route, t);
      this.peds.push(ped);
    }
  }

  /** Sidewalk route crossing this one near its end, so pedestrians turn corners. */
  pickTurn(ped) {
    const r = ped.route;
    const endT = ped.dir > 0 ? r.to : r.from;
    const crossAxis = r.axis === 'z' ? 'x' : 'z';
    const options = [];
    for (const cand of this.routes) {
      if (cand.axis !== crossAxis) continue;
      // the crossing route's fixed coordinate must be near the end we reached
      if (Math.abs(cand.fixed - endT) > CONFIG.SIDEWALK * 1.6) continue;
      const newT = r.fixed;
      if (newT < cand.from || newT > cand.to) continue;
      options.push(cand);
    }
    if (!options.length) return null;
    const route = pick(this.rng, options);
    return { route, t: r.fixed, dir: chance(this.rng, 0.5) ? 1 : -1 };
  }

  blocked(x, z, r) {
    const cs = this.city.colliders;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.h !== undefined && c.h < 0.35) continue;
      if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  update(dt, playerPos, cars) {
    const ctx = {
      cars,
      blocked: (x, z, r) => this.blocked(x, z, r),
      pickTurn: (p) => this.pickTurn(p),
    };
    for (const ped of this.peds) {
      const far = Math.hypot(ped.pos.x - playerPos.x, ped.pos.z - playerPos.z) > 150;
      ped.root.visible = !far;
      if (far) continue;
      ped.update(dt, ctx);
    }
  }

  /** Nearest living pedestrian within a radius — used by melee and bullets. */
  nearest(pos, range) {
    let best = null;
    let bestD = range;
    for (const p of this.peds) {
      if (p.dead) continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  /** Panic everyone near a point (gunfire, explosions, a car mounting the curb). */
  panic(x, z, radius = 26) {
    for (const p of this.peds) {
      if (p.dead) continue;
      if (Math.hypot(p.pos.x - x, p.pos.z - z) < radius) p.flee(x, z, 6);
    }
  }
}
