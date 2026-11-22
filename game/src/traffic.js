// Civilian traffic: AI cars that drive the road graph, keep to the right-hand lane, slow for
// corners and for cars ahead, and stop at junctions. They use the same Car physics as the
// player, so a traffic car can be stolen mid-drive and immediately feels identical.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Car, CAR_KINDS } from './car.js';
import { makeRng, rngRange, rngInt, pick, chance } from './rng.js';

const TRAFFIC_KINDS = ['sedan', 'sedan', 'sedan', 'coupe', 'van', 'taxi', 'muscle'];
const LANE_OFFSET = CONFIG.ROAD_W * 0.24;   // how far right of the centreline a car sits
const NODE_RADIUS = 5.5;                    // "arrived at junction" tolerance

/** Wrap an angle difference into [-PI, PI]. */
function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class TrafficManager {
  constructor(scene, city, rng, vehicles) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.vehicles = vehicles;
    this.cars = [];
    this.onCrash = null;
    this.spawn();
  }

  spawn() {
    const rng = this.rng;
    const N = this.city.grid;
    for (let i = 0; i < CONFIG.trafficCount; i++) {
      const kind = pick(rng, TRAFFIC_KINDS);
      const spec = CAR_KINDS[kind];
      const car = new Car(this.scene, { kind, color: pick(rng, spec.colors) });
      car.worldSpan = this.city.span + 40;
      car.driver = 'ai';
      car.onCrash = (d) => this.onCrash?.(car, d);

      // start on a random road segment, heading along it
      const vertical = chance(rng, 0.5);
      const line = rngInt(rng, 0, N);
      const seg = rngInt(rng, 0, N - 1);
      const along = (seg + rngRange(rng, 0.2, 0.8)) * this.city.cell;
      const dirSign = chance(rng, 0.5) ? 1 : -1;

      let x;
      let z;
      let heading;
      if (vertical) {
        heading = dirSign > 0 ? 0 : Math.PI;
        x = line * this.city.cell + (dirSign > 0 ? LANE_OFFSET : -LANE_OFFSET);
        z = along;
      } else {
        heading = dirSign > 0 ? Math.PI / 2 : -Math.PI / 2;
        x = along;
        z = line * this.city.cell + (dirSign > 0 ? -LANE_OFFSET : LANE_OFFSET);
      }
      car.placeAt(x, z, heading);
      car.vel = rngRange(rng, 6, 13);

      car.ai = {
        target: this.pickNextNode(car, null),
        cruise: rngRange(rng, 11, 17),
        patience: rngRange(rng, 0.6, 1.4),
        stuck: 0,
        lastPos: new THREE.Vector2(x, z),
      };
      this.cars.push(car);
      this.vehicles.cars.push(car);
      this.vehicles.traffic.push(car);
    }
  }

  /** Choose the next junction, preferring to continue straight and never instantly U-turn. */
  pickNextNode(car, fromNode) {
    const city = this.city;
    const here = city.nearestNode(car.pos.x, car.pos.z);
    const options = city.neighbours[here].filter((n) => n !== fromNode);
    if (!options.length) return here;

    const node = city.nodes[here];
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    let best = options[0];
    let bestScore = -Infinity;
    for (const n of options) {
      const t = city.nodes[n];
      const dx = t.x - node.x;
      const dz = t.z - node.z;
      const len = Math.hypot(dx, dz) || 1;
      const straight = (dx / len) * fx + (dz / len) * fz;
      const score = straight * 2 + this.rng() * 0.9;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  /** World aim point: the junction, offset into this car's lane on approach. */
  aimPoint(car, nodeIdx, out) {
    const n = this.city.nodes[nodeIdx];
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    // right-hand side of the travel direction
    const rx = Math.cos(car.heading);
    const rz = -Math.sin(car.heading);
    return out.set(n.x + rx * LANE_OFFSET, 0, n.z + rz * LANE_OFFSET);
  }

  update(dt, playerPos, playerCar) {
    const aim = new THREE.Vector3();
    for (const car of this.cars) {
      if (car.exploded || car.occupiedByPlayer) continue;
      const far = Math.hypot(car.pos.x - playerPos.x, car.pos.z - playerPos.z) > 300;
      car.mesh.visible = !far;
      if (far) continue;

      const ai = car.ai;
      this.aimPoint(car, ai.target, aim);
      const dx = aim.x - car.pos.x;
      const dz = aim.z - car.pos.z;
      const dist = Math.hypot(dx, dz);

      if (dist < NODE_RADIUS) {
        const prev = ai.target;
        ai.target = this.pickNextNode(car, prev);
      }

      // steer toward the aim point
      const desired = Math.atan2(dx, dz);
      const err = angleDelta(desired, car.heading);
      car.steer += (Math.max(-1, Math.min(1, err * 1.9)) - car.steer) * Math.min(1, dt * 6);

      // slow down for a sharp turn
      const turnPenalty = Math.min(1, Math.abs(err) / 0.9);
      let targetSpeed = ai.cruise * (1 - turnPenalty * 0.62);

      // yield to a car directly ahead in the same lane
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      for (const other of this.vehicles.cars) {
        if (other === car || !other.mesh.visible) continue;
        const ox = other.pos.x - car.pos.x;
        const oz = other.pos.z - car.pos.z;
        const ahead = ox * fx + oz * fz;
        if (ahead < 0.5 || ahead > 15) continue;
        const side = Math.abs(ox * Math.cos(car.heading) - oz * Math.sin(car.heading));
        if (side < 2.4) {
          targetSpeed = Math.min(targetSpeed, Math.max(0, other.vel * 0.85 - 1));
          if (ahead < 6.5) targetSpeed = 0;
        }
      }

      // stop for the player when they are standing in the road ahead
      if (!playerCar) {
        const ox = playerPos.x - car.pos.x;
        const oz = playerPos.z - car.pos.z;
        const ahead = ox * fx + oz * fz;
        const side = Math.abs(ox * Math.cos(car.heading) - oz * Math.sin(car.heading));
        if (ahead > 0 && ahead < 12 && side < 2.6) targetSpeed = 0;
      }

      if (car.vel < targetSpeed - 0.4) {
        car.throttle = 0.75;
        car.brake = 0;
      } else if (car.vel > targetSpeed + 0.6) {
        car.throttle = 0;
        car.brake = Math.min(1, (car.vel - targetSpeed) * 0.22);
      } else {
        car.throttle = 0.18;
        car.brake = 0;
      }
      car.handbrake = false;

      // unstick: if it has barely moved for a while, reverse out and pick a new junction
      const moved = Math.hypot(car.pos.x - ai.lastPos.x, car.pos.z - ai.lastPos.y);
      ai.lastPos.set(car.pos.x, car.pos.z);
      if (moved < 0.06 && car.throttle > 0.3) ai.stuck += dt;
      else ai.stuck = Math.max(0, ai.stuck - dt * 0.5);
      if (ai.stuck > 2.6) {
        ai.stuck = 0;
        car.vel = -4;
        car.heading += rngRange(this.rng, -0.7, 0.7);
        ai.target = this.pickNextNode(car, null);
      }

      car.update(dt, { colliders: this.city.colliders });
    }
  }
}
