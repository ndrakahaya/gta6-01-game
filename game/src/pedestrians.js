// Pedestrians: civilians walking the sidewalks of Puerto Vela.
// Each body is merged into three vertex-coloured meshes (upper body, left leg, right leg) so a
// whole crowd stays cheap, and the legs swing from a walk phase. They follow sidewalk routes,
// turn at corners, step aside for cars, and flee when the player starts shooting.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { mergeColoredBoxes } from './geo.js';
import { rngRange, rngInt, pick, chance } from './rng.js';

// ===== PEDESTRIAN PALETTES =====

const SKINS = ['#c98f6b', '#a9704f', '#e0b48c', '#7d5236', '#d9a679', '#5f3d28'];
const SHIRTS = ['#d9534f', '#3f7cac', '#f0ad4e', '#5cb85c', '#8e6cb0', '#e8e8e8', '#2f3b46', '#c96f9c', '#e07a3f'];
const PANTS = ['#2d3a4a', '#3c3c46', '#5a4632', '#243036', '#4b4b58', '#6b6b6b'];
const HAIRS = ['#1a1a1a', '#3b2416', '#6b4a2a', '#9c7b4a', '#20242c'];

// ===== TUNING =====

const FLEE_SPEED = 5.4;        // metres/second while panicking
const DODGE_SPEED_MUL = 1.9;   // speed multiplier when stepping aside for a car
const DODGE_OFFSET = 0.9;      // metres to sidestep off the route line
const DODGE_SCAN_R2 = 64;      // squared radius (8 m) for looking for a car bearing down
const DODGE_MIN_CAR_SPEED = 4; // a car must be moving at least this fast to cause a dodge
const CULL_DISTANCE = 150;     // pedestrians beyond this range are hidden and skipped

// ===== SHARED GEOMETRY CACHES =====

// Keyed by palette so identical civilians share one geometry (and the cache stays small).
const upperCache = new Map();
const legCache = new Map();

/**
 * Torso + head + arms as one geometry, keyed by palette.
 * @param {string} skin - Skin colour
 * @param {string} shirt - Shirt colour
 * @param {string} hair - Hair colour
 * @returns {THREE.BufferGeometry} - Merged upper-body geometry
 */
function upperGeo(skin, shirt, hair) {
  const key = `${skin}|${shirt}|${hair}`;
  if (upperCache.has(key)) return upperCache.get(key);

  const geometry = mergeColoredBoxes([
    { w: 0.52, h: 0.62, d: 0.30, y: 1.24, color: shirt },          // torso
    { w: 0.16, h: 0.08, d: 0.16, y: 1.59, color: skin },           // neck
    { w: 0.29, h: 0.31, d: 0.29, y: 1.78, color: skin },           // head
    { w: 0.31, h: 0.10, d: 0.31, y: 1.94, color: hair },           // hair
    { w: 0.05, h: 0.05, d: 0.02, x: -0.07, y: 1.80, z: 0.15, color: '#20242c' }, // left eye
    { w: 0.05, h: 0.05, d: 0.02, x: 0.07, y: 1.80, z: 0.15, color: '#20242c' },  // right eye
    { w: 0.14, h: 0.52, d: 0.15, x: -0.33, y: 1.22, color: shirt }, // left arm
    { w: 0.14, h: 0.52, d: 0.15, x: 0.33, y: 1.22, color: shirt },  // right arm
    { w: 0.13, h: 0.14, d: 0.14, x: -0.33, y: 0.92, color: skin },  // left hand
    { w: 0.13, h: 0.14, d: 0.14, x: 0.33, y: 0.92, color: skin },   // right hand
  ]);

  upperCache.set(key, geometry);
  return geometry;
}

/**
 * One leg, pivoted at the hip so rotation.x swings it.
 * @param {string} pants - Trouser colour
 * @returns {THREE.BufferGeometry} - Merged leg geometry
 */
function legGeo(pants) {
  if (legCache.has(pants)) return legCache.get(pants);

  const geometry = mergeColoredBoxes([
    { w: 0.18, h: 0.44, d: 0.19, y: -0.22, color: pants },              // thigh
    { w: 0.17, h: 0.40, d: 0.18, y: -0.62, color: pants },              // shin
    { w: 0.19, h: 0.10, d: 0.27, y: -0.86, z: 0.04, color: '#1c1f24' }, // shoe
  ]);

  legCache.set(pants, geometry);
  return geometry;
}

// Every pedestrian mesh shares this material; colour comes from the vertex attributes.
const sharedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

// ===== PEDESTRIAN =====

/**
 * A single civilian: patrols a sidewalk route, dodges cars, and can be panicked or killed.
 */
export class Pedestrian {
  /**
   * @param {THREE.Scene} scene - Scene to add the pedestrian to
   * @param {Function} rng - Seeded random generator
   * @param {Object} route - Sidewalk route descriptor from the city
   * @param {number} t - Position along the route (in metres on the fixed axis)
   */
  constructor(scene, rng, route, t) {
    this.rng = rng;

    const skin = pick(rng, SKINS);
    const shirt = pick(rng, SHIRTS);
    const pants = pick(rng, PANTS);
    const hair = pick(rng, HAIRS);

    this.root = new THREE.Group();
    this.upper = new THREE.Mesh(upperGeo(skin, shirt, hair), sharedMaterial);
    this.legL = new THREE.Mesh(legGeo(pants), sharedMaterial);
    this.legR = new THREE.Mesh(legGeo(pants), sharedMaterial);
    // Legs hang from the hip: their local origin is the pivot, so rotation swings them.
    this.legL.position.set(-0.14, 0.90, 0);
    this.legR.position.set(0.14, 0.90, 0);
    this.root.add(this.upper, this.legL, this.legR);
    scene.add(this.root);

    this.pos = new THREE.Vector3();
    this.route = route;
    this.t = t;
    this.dir = chance(rng, 0.5) ? 1 : -1;      // +1 or -1 along the route
    this.speed = rngRange(rng, 1.15, 1.95);
    this.baseSpeed = this.speed;
    this.facing = 0;
    this.phase = rng() * 6.28;                  // random walk-cycle offset so the crowd desyncs
    this.health = 40;
    this.dead = false;
    this.fleeing = 0;                           // seconds of panic remaining
    this.fleeDir = new THREE.Vector3();
    this.waitTimer = 0;
    this.kind = 'civilian';
    this.placeOnRoute();
  }

  /** Snap the body to its current route position and facing. */
  placeOnRoute() {
    const route = this.route;
    if (route.axis === 'z') this.pos.set(route.fixed, 0, this.t);
    else this.pos.set(this.t, 0, route.fixed);

    this.facing = route.axis === 'z'
      ? (this.dir > 0 ? 0 : Math.PI)
      : (this.dir > 0 ? Math.PI / 2 : -Math.PI / 2);

    this.sync();
  }

  /** Copy the logical position and facing onto the Three.js group. */
  sync() {
    this.root.position.set(this.pos.x, this.pos.y ?? 0, this.pos.z);
    this.root.rotation.y = this.facing;
  }

  /**
   * Panic: run directly away from a threat point for a while.
   * @param {number} fromX - Threat X
   * @param {number} fromZ - Threat Z
   * @param {number} seconds - How long to keep fleeing
   */
  flee(fromX, fromZ, seconds = 6) {
    if (this.dead) return;
    this.fleeing = Math.max(this.fleeing, seconds);

    const dx = this.pos.x - fromX;
    const dz = this.pos.z - fromZ;
    const length = Math.hypot(dx, dz) || 1;
    this.fleeDir.set(dx / length, 0, dz / length);
  }

  /**
   * Take damage.
   * @param {number} damage - Damage amount
   * @param {number} fromX - Source X (used to set the flee direction)
   * @param {number} fromZ - Source Z
   * @returns {boolean} - True when this hit was fatal
   */
  hit(damage, fromX, fromZ) {
    if (this.dead) return false;

    this.health -= damage;
    this.flee(fromX, fromZ, 8);

    if (this.health <= 0) {
      this.dead = true;
      // Fall over: lie on the ground, tilted on the side.
      this.root.rotation.z = -Math.PI / 2;
      this.root.position.y = 0.28;
      return true;
    }
    return false;
  }

  /**
   * Advance the pedestrian. ctx supplies world queries: { blocked(x,z,r), pickTurn(ped), cars }.
   * @param {number} dt - Delta time in seconds
   * @param {Object} ctx - Callbacks and nearby cars
   */
  update(dt, ctx) {
    if (this.dead) return;

    if (this.fleeing > 0) {
      this.updateFleeing(dt, ctx);
      return;
    }

    // Step aside when a moving car is bearing down on us.
    const dodge = this.findDodge(ctx.cars);

    if (this.waitTimer > 0) {
      this.waitTimer -= dt;
      this.animate(0);
      this.sync();
      return;
    }

    this.advanceAlongRoute(dt, ctx, dodge);
    this.phase += this.speed * dt * 2.4;
    this.animate(dodge ? 1.2 : 0.62);
    this.sync();
  }

  /** Panic movement: sprint away from the threat, sliding off obstacles rather than stopping. */
  updateFleeing(dt, ctx) {
    this.fleeing -= dt;

    const nx = this.pos.x + this.fleeDir.x * FLEE_SPEED * dt;
    const nz = this.pos.z + this.fleeDir.z * FLEE_SPEED * dt;

    if (!ctx.blocked(nx, nz, 0.4)) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else if (!ctx.blocked(nx, this.pos.z, 0.4)) {
      // Slide along X.
      this.pos.x = nx;
    } else if (!ctx.blocked(this.pos.x, nz, 0.4)) {
      // Slide along Z.
      this.pos.z = nz;
    } else {
      // Boxed in: turn the flee direction 90 degrees and try again next frame.
      this.fleeDir.set(-this.fleeDir.z, 0, this.fleeDir.x);
    }

    this.facing = Math.atan2(this.fleeDir.x, this.fleeDir.z);
    this.phase += FLEE_SPEED * dt * 2.3;
    this.animate(1.3);
    this.sync();
  }

  /**
   * Return +1 / -1 when a car is approaching from one side and we should step that way,
   * or 0 when the path is clear.
   */
  findDodge(cars) {
    for (const car of cars) {
      if (!car.mesh.visible || Math.abs(car.vel) < DODGE_MIN_CAR_SPEED) continue;

      const dx = this.pos.x - car.pos.x;
      const dz = this.pos.z - car.pos.z;
      if (dx * dx + dz * dz >= DODGE_SCAN_R2) continue;

      const forwardX = Math.sin(car.heading);
      const forwardZ = Math.cos(car.heading);
      const ahead = dx * forwardX + dz * forwardZ;
      if (ahead <= 0) continue; // car is behind or beside us, no threat

      // Which side of the car's path are we on? Step the other way.
      const side = dx * Math.cos(car.heading) - dz * Math.sin(car.heading);
      return side >= 0 ? 1 : -1;
    }
    return 0;
  }

  /** Walk along the current route, turning a corner (or reversing) at the block end. */
  advanceAlongRoute(dt, ctx, dodge) {
    const route = this.route;
    const step = this.speed * dt * (dodge ? DODGE_SPEED_MUL : 1);
    this.t += this.dir * step;

    if (this.t < route.from || this.t > route.to) {
      // Clamp, then either turn onto a crossing sidewalk or reverse back the way we came.
      this.t = Math.max(route.from, Math.min(route.to, this.t));
      const next = ctx.pickTurn(this);
      if (next) {
        this.route = next.route;
        this.t = next.t;
        this.dir = next.dir;
      } else {
        this.dir *= -1;
      }
      this.placeOnRoute();
      return;
    }

    if (route.axis === 'z') {
      this.pos.set(route.fixed + dodge * DODGE_OFFSET, 0, this.t);
      this.facing = this.dir > 0 ? 0 : Math.PI;
    } else {
      this.pos.set(this.t, 0, route.fixed + dodge * DODGE_OFFSET);
      this.facing = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  /**
   * Swing the legs from the walk phase.
   * @param {number} amp - Animation amplitude (0 = standing still)
   */
  animate(amp) {
    const swing = Math.sin(this.phase) * amp;
    this.legL.rotation.x = swing * 0.72;
    this.legR.rotation.x = -swing * 0.72;
    this.upper.position.y = Math.abs(Math.sin(this.phase)) * 0.035 * amp;
    this.upper.rotation.x = Math.min(0.2, amp * 0.12);
  }

  /** Remove this pedestrian's group from the scene. */
  dispose(scene) {
    scene.remove(this.root);
  }
}

// ===== PEDESTRIAN MANAGER =====

/**
 * Owns and ticks every pedestrian: spawning, culling, route turning, panic and melee queries.
 */
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

  /** Populate the streets with pedestrians distributed across the sidewalk routes. */
  spawn() {
    const rng = this.rng;
    const count = CONFIG.pedCount;

    for (let i = 0; i < count; i++) {
      const route = pick(rng, this.routes);
      // Keep a 4 m margin from the route ends so nobody spawns mid-turn.
      const t = rngRange(rng, route.from + 4, route.to - 4);
      const ped = new Pedestrian(this.scene, rng, route, t);
      this.peds.push(ped);
    }
  }

  /**
   * Find a sidewalk route crossing this one near the end it has reached, so pedestrians turn
   * corners instead of bouncing back and forth.
   * @param {Pedestrian} ped - The pedestrian looking for a turn
   * @returns {Object|null} - { route, t, dir } or null when no crossing exists
   */
  pickTurn(ped) {
    const route = ped.route;
    const endT = ped.dir > 0 ? route.to : route.from;
    const crossAxis = route.axis === 'z' ? 'x' : 'z';

    const options = [];
    for (const candidate of this.routes) {
      if (candidate.axis !== crossAxis) continue;
      // The crossing route's fixed coordinate must line up with the end we reached.
      if (Math.abs(candidate.fixed - endT) > CONFIG.SIDEWALK * 1.6) continue;
      // And our own fixed coordinate must fall inside the crossing route's span.
      if (route.fixed < candidate.from || route.fixed > candidate.to) continue;
      options.push(candidate);
    }

    if (!options.length) return null;

    const chosen = pick(this.rng, options);
    return {
      route: chosen,
      t: route.fixed,
      dir: chance(this.rng, 0.5) ? 1 : -1,
    };
  }

  /**
   * Is a circle of radius r at (x,z) overlapping any solid collider?
   * Colliders shorter than ankle height are ignored so pedestrians can step onto kerbs.
   */
  blocked(x, z, r) {
    const colliders = this.city.colliders;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.h !== undefined && c.h < 0.35) continue;
      if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  /**
   * Tick every pedestrian, culling anything far from the player.
   * @param {number} dt - Delta time in seconds
   * @param {THREE.Vector3} playerPos - Player position
   * @param {Array} cars - Vehicles currently in the world (for dodging)
   */
  update(dt, playerPos, cars) {
    const ctx = {
      cars,
      blocked: (x, z, r) => this.blocked(x, z, r),
      pickTurn: (ped) => this.pickTurn(ped),
    };

    for (const ped of this.peds) {
      const far = Math.hypot(ped.pos.x - playerPos.x, ped.pos.z - playerPos.z) > CULL_DISTANCE;
      ped.root.visible = !far;
      if (far) continue;
      ped.update(dt, ctx);
    }
  }

  /**
   * Nearest living pedestrian within a radius — used by melee and bullets.
   * @param {THREE.Vector3} pos - Query origin
   * @param {number} range - Maximum distance
   * @returns {Pedestrian|null} - Nearest living pedestrian, or null
   */
  nearest(pos, range) {
    let best = null;
    let bestDistance = range;

    for (const ped of this.peds) {
      if (ped.dead) continue;
      const distance = Math.hypot(ped.pos.x - pos.x, ped.pos.z - pos.z);
      if (distance < bestDistance) {
        best = ped;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * Panic everyone near a point (gunfire, explosions, a car mounting the kerb).
   * @param {number} x - Event X
   * @param {number} z - Event Z
   * @param {number} radius - Effect radius in metres
   */
  panic(x, z, radius = 26) {
    for (const ped of this.peds) {
      if (ped.dead) continue;
      if (Math.hypot(ped.pos.x - x, ped.pos.z - z) < radius) ped.flee(x, z, 6);
    }
  }
}
