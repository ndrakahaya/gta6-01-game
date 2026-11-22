// Wanted level and police response. Heat rises with crimes (stealing cars, running people over,
// shooting, ramming cops), decays when the player stays out of sight, and spawns cruisers that
// chase, ram and finally bust the player. Police drive the same Car physics as everyone else.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { CAR_KINDS } from './car.js';
import { rngRange, pick, chance } from './rng.js';

const W = CONFIG.wanted;

function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class WantedSystem {
  constructor(app) {
    this.app = app;
    this.heat = 0;
    this.stars = 0;
    this.quietFor = 0;
    this.cops = [];
    this.bustProgress = 0;
    this.busted = false;
    this.spawnCooldown = 0;
    this.onStarChange = null;
    this.onBusted = null;
    this.sirenPhase = 0;
  }

  /** Add heat for a crime. `amount` is in star units. */
  add(amount, reason) {
    this.heat = Math.min(5.99, this.heat + amount);
    this.quietFor = 0;
    const before = this.stars;
    this.stars = Math.floor(this.heat);
    if (this.stars !== before) this.onStarChange?.(this.stars, reason);
  }

  clear() {
    this.heat = 0;
    this.stars = 0;
    this.bustProgress = 0;
    for (const cop of this.cops) this.app.vehicles.despawn(cop);
    this.cops.length = 0;
  }

  /** Spawn cruisers around the player, just outside view, on real roads. */
  maintainCops(dt) {
    const want = W.copCount[Math.min(5, this.stars)];
    this.spawnCooldown -= dt;

    // drop excess cops when heat falls
    while (this.cops.length > want) {
      const cop = this.cops.pop();
      this.app.vehicles.despawn(cop);
    }
    if (this.cops.length >= want || this.spawnCooldown > 0) return;
    this.spawnCooldown = 1.1;

    const p = this.app.player.pos;
    const city = this.app.city;
    // pick a road point 70-130m away so they arrive rather than pop in next to the player
    let spot = null;
    for (let tries = 0; tries < 24; tries++) {
      const cand = city.randomRoadPoint(this.app.rng);
      const d = Math.hypot(cand.x - p.x, cand.z - p.z);
      if (d > 70 && d < 140) { spot = cand; break; }
    }
    if (!spot) return;

    const cop = this.app.vehicles.spawnPolice(spot.x, spot.z, spot.rot);
    cop.vel = 12;
    cop.ai = {
      mode: 'chase',
      repath: 0,
      target: city.nearestNode(p.x, p.z),
      stuck: 0,
      lastPos: new THREE.Vector2(spot.x, spot.z),
      ramCooldown: 0,
    };
    this.cops.push(cop);
  }

  update(dt) {
    const app = this.app;
    const player = app.player;

    // heat decays only after a quiet window
    this.quietFor += dt;
    if (this.quietFor > W.decayAfterQuiet && this.heat > 0) {
      this.heat = Math.max(0, this.heat - W.decayPerSec * dt);
      const s = Math.floor(this.heat);
      if (s !== this.stars) {
        this.stars = s;
        this.onStarChange?.(s, 'cooldown');
      }
    }

    this.maintainCops(dt);
    this.sirenPhase += dt * 6;

    const target = player.inCar ? player.inCar.pos : player.pos;
    let nearestCopDist = Infinity;

    for (const cop of this.cops) {
      if (cop.exploded) continue;
      const ai = cop.ai;
      const dx = target.x - cop.pos.x;
      const dz = target.z - cop.pos.z;
      const dist = Math.hypot(dx, dz);
      nearestCopDist = Math.min(nearestCopDist, dist);

      // Route via the road graph when far, aim straight at the player when close.
      let aimX = target.x;
      let aimZ = target.z;
      if (dist > 46) {
        ai.repath -= dt;
        const node = app.city.nodes[ai.target];
        const nd = Math.hypot(node.x - cop.pos.x, node.z - cop.pos.z);
        if (nd < 7 || ai.repath <= 0) {
          ai.repath = 0.8;
          // greedy step toward the player's junction
          const here = app.city.nearestNode(cop.pos.x, cop.pos.z);
          const goal = app.city.nearestNode(target.x, target.z);
          const gn = app.city.nodes[goal];
          let best = here;
          let bestD = Infinity;
          for (const n of app.city.neighbours[here]) {
            const cn = app.city.nodes[n];
            const d = Math.hypot(cn.x - gn.x, cn.z - gn.z);
            if (d < bestD) { bestD = d; best = n; }
          }
          ai.target = best;
        }
        const tn = app.city.nodes[ai.target];
        aimX = tn.x;
        aimZ = tn.z;
      }

      const desired = Math.atan2(aimX - cop.pos.x, aimZ - cop.pos.z);
      const err = angleDelta(desired, cop.heading);
      cop.steer += (Math.max(-1, Math.min(1, err * 2.3)) - cop.steer) * Math.min(1, dt * 8);

      const chaseSpeed = cop.maxSpeed * W.copSpeedMul * (dist < 14 ? 0.72 : 1);
      if (cop.vel < chaseSpeed) {
        cop.throttle = 1;
        cop.brake = 0;
      } else {
        cop.throttle = 0;
        cop.brake = 0.4;
      }
      // handbrake turn when the target is behind them
      cop.handbrake = Math.abs(err) > 2.1 && cop.vel > 12;

      // unstick
      const moved = Math.hypot(cop.pos.x - ai.lastPos.x, cop.pos.z - ai.lastPos.y);
      ai.lastPos.set(cop.pos.x, cop.pos.z);
      if (moved < 0.05 && cop.throttle > 0.5) ai.stuck += dt;
      else ai.stuck = Math.max(0, ai.stuck - dt);
      if (ai.stuck > 2.2) {
        ai.stuck = 0;
        cop.vel = -6;
        cop.heading += rngRange(app.rng, -1.0, 1.0);
      }

      cop.update(dt, { colliders: app.city.colliders });

      // ramming the player's car hurts it
      if (player.inCar && dist < 4.2 && Math.abs(cop.vel) > 9) {
        ai.ramCooldown -= dt;
        if (ai.ramCooldown <= 0) {
          ai.ramCooldown = 1.2;
          player.inCar.damage(7);
          player.damage(3);
          app.rig.addShake(0.35);
          app.effects?.impact(cop.pos.x, 1.0, cop.pos.z);
        }
      }

      // flashing light bar
      const flash = Math.sin(this.sirenPhase) > 0;
      if (cop.lightBar) cop.lightBar.visible = true;
      cop.sirenOn = true;
      cop.flash = flash;
    }

    // ---- bust: a cop has to stay close while the player is on foot and slow ----
    const onFoot = !player.inCar;
    const slow = Math.hypot(player.vel.x, player.vel.z) < 3.2;
    if (this.stars > 0 && onFoot && slow && nearestCopDist < W.bustRange && !player.dead) {
      this.bustProgress += dt / 2.4;
      if (this.bustProgress >= 1) {
        this.bustProgress = 0;
        this.busted = true;
        this.onBusted?.();
      }
    } else {
      this.bustProgress = Math.max(0, this.bustProgress - dt * 0.8);
    }

    // cops shoot at an armed, visible player at higher stars
    if (this.stars >= 3 && onFoot) {
      this.copFireTimer = (this.copFireTimer ?? 0) - dt;
      if (this.copFireTimer <= 0 && nearestCopDist < 34) {
        this.copFireTimer = rngRange(app.rng, 0.7, 1.5);
        const shooter = this.cops.find((c) => !c.exploded);
        if (shooter) {
          const dmg = rngRange(app.rng, 4, 9);
          player.damage(dmg);
          app.effects?.muzzle(shooter.pos.x, 1.2, shooter.pos.z);
          app.audio?.shot(0.5);
        }
      }
    }
  }

  /** Called after a bust or death: lose the heat and pay the fine. */
  resolveBust() {
    const fine = Math.min(this.app.player.cash, 150 + this.stars * 90);
    this.app.player.cash -= fine;
    this.clear();
    this.busted = false;
    return fine;
  }
}
