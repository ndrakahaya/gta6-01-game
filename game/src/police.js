// Wanted level and police response.
// Heat rises with crimes (stealing cars, running people over, shooting, ramming cruisers),
// decays once the player stays out of sight, and spawns cruisers that chase, ram and finally
// bust the player. Police drive the same Car physics as everyone else.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { CAR_KINDS } from './car.js';
import { rngRange, chance } from './rng.js';

const W = CONFIG.wanted;

// ===== TUNING =====

const MAX_HEAT = 5.99;              // just under six stars; floor() keeps it at five
const SPAWN_COOLDOWN = 1.1;         // seconds between cruiser spawn attempts
const SPAWN_MIN_DIST = 70;          // cruisers appear at least this far from the player
const SPAWN_MAX_DIST = 140;         // ...and no further, so they arrive promptly
const SPAWN_TRIES = 24;             // rejection-sampling attempts for a good spawn spot

const ROUTE_DISTANCE = 46;          // beyond this, navigate via the road graph; closer, aim direct
const REPATH_INTERVAL = 0.8;        // seconds between greedy road-graph repaths
const NODE_ARRIVE = 7;              // metres from a target node that counts as reached

const STEER_GAIN = 2.3;             // steering responsiveness toward the desired heading
const CLOSE_SPEED_MUL = 0.72;       // throttle back within 14 m so a ram lands cleanly
const CLOSE_DISTANCE = 14;
const HANDBRAKE_ERR = 2.1;          // heading error that triggers a handbrake turn
const HANDBRAKE_MIN_SPEED = 12;     // ...only above this speed

const COP_STUCK_TIME = 2.2;
const COP_STUCK_SPEED = 0.05;

const RAM_DISTANCE = 4.2;           // contact range for a ram
const RAM_MIN_SPEED = 9;            // minimum closing speed to count as a ram
const RAM_COOLDOWN = 1.2;
const RAM_CAR_DAMAGE = 7;
const RAM_PLAYER_DAMAGE = 3;
const RAM_SHAKE = 0.35;

const BUST_TIME = 2.4;              // seconds a cop must stay close to complete a bust
const BUST_RECOVER = 0.8;           // how fast bust progress bleeds off when they back away
const BUST_MAX_PLAYER_SPEED = 3.2;  // player must be slower than this on foot

const COP_FIRE_MIN_STARS = 3;
const COP_FIRE_RANGE = 34;
const COP_FIRE_DAMAGE_MIN = 4;
const COP_FIRE_DAMAGE_MAX = 9;
const COP_FIRE_INTERVAL_MIN = 0.7;
const COP_FIRE_INTERVAL_MAX = 1.5;

/** Wrap an angle difference into [-PI, PI]. */
function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Tracks the player's wanted level, spawns and drives pursuing cruisers, and resolves the
 * eventual arrest. Crime heat is expressed in star units so the thresholds in CONFIG read
 * directly as "this much heat = N stars".
 */
export class WantedSystem {
  constructor(app) {
    this.app = app;

    this.heat = 0;              // continuous heat, 0 .. MAX_HEAT
    this.stars = 0;             // floor(heat), the displayed star count

    this.quietFor = 0;          // seconds since the last crime
    this.cops = [];             // active cruisers
    this.spawnCooldown = 0;

    this.bustProgress = 0;      // 0..1 toward an arrest
    this.busted = false;
    this.sirenPhase = 0;
    this.nearestCopDist = Infinity; // published each frame; audio reads it for siren volume

    // Callbacks wired by main.js.
    this.onStarChange = null;   // (stars, reason)
    this.onBusted = null;
  }

  /**
   * Add heat for a crime.
   * @param {number} amount - Heat in star units
   * @param {string} reason - Short label for the star-change callback
   */
  add(amount, reason) {
    this.heat = Math.min(MAX_HEAT, this.heat + amount);
    this.quietFor = 0; // any crime resets the cooldown timer

    const before = this.stars;
    this.stars = Math.floor(this.heat);
    if (this.stars !== before) this.onStarChange?.(this.stars, reason);
  }

  /** Drop all heat and despawn every cruiser. */
  clear() {
    this.heat = 0;
    this.stars = 0;
    this.bustProgress = 0;

    for (const cop of this.cops) this.app.vehicles.despawn(cop);
    this.cops.length = 0;
  }

  /**
   * Spawn or despawn cruisers so the count matches the current star level.
   * Spawns are placed on real roads, out of view, so they arrive rather than pop in.
   */
  maintainCops(dt) {
    const want = W.copCount[Math.min(5, this.stars)];
    this.spawnCooldown -= dt;

    // Heat fell: retire the surplus cruisers immediately.
    while (this.cops.length > want) {
      const cop = this.cops.pop();
      this.app.vehicles.despawn(cop);
    }

    if (this.cops.length >= want || this.spawnCooldown > 0) return;
    this.spawnCooldown = SPAWN_COOLDOWN;

    const playerPos = this.app.player.pos;
    const city = this.app.city;

    // Rejection-sample a road point in the 70-140 m band around the player.
    let spot = null;
    for (let tries = 0; tries < SPAWN_TRIES; tries++) {
      const candidate = city.randomRoadPoint(this.app.rng);
      const distance = Math.hypot(candidate.x - playerPos.x, candidate.z - playerPos.z);
      if (distance > SPAWN_MIN_DIST && distance < SPAWN_MAX_DIST) {
        spot = candidate;
        break;
      }
    }
    if (!spot) return;

    const cop = this.app.vehicles.spawnPolice(spot.x, spot.z, spot.rot);
    cop.vel = 12;
    cop.ai = {
      mode: 'chase',
      repath: 0,
      target: city.nearestNode(playerPos.x, playerPos.z),
      stuck: 0,
      lastPos: new THREE.Vector2(spot.x, spot.z),
      ramCooldown: 0,
    };
    this.cops.push(cop);
  }

  /**
   * Per-frame update: heat decay, cruiser AI, ramming, arrest progress and return fire.
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    const app = this.app;
    const player = app.player;

    this.heatDecay(dt);
    this.maintainCops(dt);
    this.sirenPhase += dt * 6;

    const target = player.inCar ? player.inCar.pos : player.pos;
    let nearestCopDist = Infinity;

    for (const cop of this.cops) {
      if (cop.exploded) continue;

      const { dx, dz, dist } = this.copToTarget(cop, target);
      nearestCopDist = Math.min(nearestCopDist, dist);

      this.driveCop(dt, cop, target, dist);
      cop.update(dt, { colliders: app.city.colliders });

      this.tryRam(dt, cop, dist);
      this.updateLights(cop);
    }

    // Publish the proximity so audio.update() can drive the siren volume from it.
    this.nearestCopDist = nearestCopDist;

    this.updateBust(dt, nearestCopDist);
    this.updateReturnFire(dt, nearestCopDist);
  }

  /** Bleed heat down once the player has stayed quiet for the configured window. */
  heatDecay(dt) {
    this.quietFor += dt;
    if (this.quietFor <= W.decayAfterQuiet || this.heat <= 0) return;

    this.heat = Math.max(0, this.heat - W.decayPerSec * dt);

    const stars = Math.floor(this.heat);
    if (stars !== this.stars) {
      this.stars = stars;
      this.onStarChange?.(stars, 'cooldown');
    }
  }

  /** Vector from a cruiser to the chase target, plus the distance. */
  copToTarget(cop, target) {
    const dx = target.x - cop.pos.x;
    const dz = target.z - cop.pos.z;
    return { dx, dz, dist: Math.hypot(dx, dz) };
  }

  /**
   * Steer one cruiser toward the target: road-graph navigation when far, direct pursuit when
   * close, with an unstick fallback.
   */
  driveCop(dt, cop, target, dist) {
    const app = this.app;
    const ai = cop.ai;

    // Pick an aim point: the next road-graph node when far, the player when near.
    let aimX = target.x;
    let aimZ = target.z;

    if (dist > ROUTE_DISTANCE) {
      ai.repath -= dt;
      const node = app.city.nodes[ai.target];
      const nodeDist = Math.hypot(node.x - cop.pos.x, node.z - cop.pos.z);

      if (nodeDist < NODE_ARRIVE || ai.repath <= 0) {
        ai.repath = REPATH_INTERVAL;
        ai.target = this.greedyStepToward(app, cop.pos, target);
      }

      const targetNode = app.city.nodes[ai.target];
      aimX = targetNode.x;
      aimZ = targetNode.z;
    }

    // Steer toward the aim point.
    const desired = Math.atan2(aimX - cop.pos.x, aimZ - cop.pos.z);
    const err = angleDelta(desired, cop.heading);
    const steerCommand = Math.max(-1, Math.min(1, err * STEER_GAIN));
    cop.steer += (steerCommand - cop.steer) * Math.min(1, dt * 8);

    // Throttle: full speed, easing off when right on top of the player so the ram lands.
    const chaseSpeed = cop.maxSpeed * W.copSpeedMul * (dist < CLOSE_DISTANCE ? CLOSE_SPEED_MUL : 1);
    if (cop.vel < chaseSpeed) {
      cop.throttle = 1;
      cop.brake = 0;
    } else {
      cop.throttle = 0;
      cop.brake = 0.4;
    }

    // Handbrake turn when the target has swung behind us at speed.
    cop.handbrake = Math.abs(err) > HANDBRAKE_ERR && cop.vel > HANDBRAKE_MIN_SPEED;

    // Unstick: reverse and re-aim if we have been pinned while trying to accelerate.
    const moved = Math.hypot(cop.pos.x - ai.lastPos.x, cop.pos.z - ai.lastPos.y);
    ai.lastPos.set(cop.pos.x, cop.pos.z);
    if (moved < COP_STUCK_SPEED && cop.throttle > 0.5) ai.stuck += dt;
    else ai.stuck = Math.max(0, ai.stuck - dt);

    if (ai.stuck > COP_STUCK_TIME) {
      ai.stuck = 0;
      cop.vel = -6;
      cop.heading += rngRange(app.rng, -1.0, 1.0);
    }
  }

  /**
   * One greedy step toward the player's current junction: pick whichever neighbour of our
   * current node is closest to the goal.
   */
  greedyStepToward(app, fromPos, target) {
    const here = app.city.nearestNode(fromPos.x, fromPos.z);
    const goalNode = app.city.nodes[app.city.nearestNode(target.x, target.z)];

    let best = here;
    let bestDistance = Infinity;

    for (const neighbour of app.city.neighbours[here]) {
      const node = app.city.nodes[neighbour];
      const distance = Math.hypot(node.x - goalNode.x, node.z - goalNode.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = neighbour;
      }
    }
    return best;
  }

  /** A fast cruiser hitting the player's car damages both and shakes the camera. */
  tryRam(dt, cop, dist) {
    const app = this.app;
    const player = app.player;
    const ai = cop.ai;

    if (!player.inCar || dist >= RAM_DISTANCE || Math.abs(cop.vel) <= RAM_MIN_SPEED) return;

    ai.ramCooldown -= dt;
    if (ai.ramCooldown > 0) return;

    ai.ramCooldown = RAM_COOLDOWN;
    player.inCar.damage(RAM_CAR_DAMAGE);
    player.damage(RAM_PLAYER_DAMAGE);
    app.rig.addShake(RAM_SHAKE);
    app.effects?.impact(cop.pos.x, 1.0, cop.pos.z);
  }

  /** Drive the cruiser's flashing light bar. */
  updateLights(cop) {
    if (cop.lightBar) cop.lightBar.visible = true;
    cop.sirenOn = true;
    cop.flash = Math.sin(this.sirenPhase) > 0;
  }

  /**
   * Arrest progress: a cruiser must stay close while the player is on foot and moving slowly.
   * Progress bleeds off whenever that condition lapses.
   */
  updateBust(dt, nearestCopDist) {
    const player = this.app.player;
    const onFoot = !player.inCar;
    const slow = Math.hypot(player.vel.x, player.vel.z) < BUST_MAX_PLAYER_SPEED;

    const canBust =
      this.stars > 0 && onFoot && slow && nearestCopDist < W.bustRange && !player.dead;

    if (!canBust) {
      this.bustProgress = Math.max(0, this.bustProgress - dt * BUST_RECOVER);
      return;
    }

    this.bustProgress += dt / BUST_TIME;
    if (this.bustProgress >= 1) {
      this.bustProgress = 0;
      this.busted = true;
      this.onBusted?.();
    }
  }

  /** At three stars or more, cruisers shoot at an on-foot player who stays within range. */
  updateReturnFire(dt, nearestCopDist) {
    const app = this.app;
    const player = app.player;

    if (this.stars < COP_FIRE_MIN_STARS || player.inCar) return;

    this.copFireTimer = (this.copFireTimer ?? 0) - dt;
    if (this.copFireTimer > 0 || nearestCopDist >= COP_FIRE_RANGE) return;

    this.copFireTimer = rngRange(app.rng, COP_FIRE_INTERVAL_MIN, COP_FIRE_INTERVAL_MAX);
    const shooter = this.cops.find((c) => !c.exploded);
    if (!shooter) return;

    player.damage(rngRange(app.rng, COP_FIRE_DAMAGE_MIN, COP_FIRE_DAMAGE_MAX));
    app.effects?.muzzle(shooter.pos.x, 1.2, shooter.pos.z);
    app.audio?.shot(0.5);
  }

  /**
   * Called after a bust or death: fine the player and wipe the heat.
   * @returns {number} - The fine that was deducted
   */
  resolveBust() {
    const fine = Math.min(this.app.player.cash, 150 + this.stars * 90);
    this.app.player.cash -= fine;
    this.clear();
    this.busted = false;
    return fine;
  }
}
