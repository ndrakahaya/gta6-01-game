// Civilian traffic: AI cars that drive the road graph.
// They keep to the right-hand lane, slow for corners and for cars ahead, and stop at junctions.
// Traffic cars use the very same Car physics as the player, so a car stolen mid-drive
// immediately feels identical to one the player spawned in.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Car, CAR_KINDS } from './car.js';
import { rngRange, rngInt, pick, chance } from './rng.js';

// Weighted kinds for civilian traffic (sedans dominate a real street mix).
const TRAFFIC_KINDS = ['sedan', 'sedan', 'sedan', 'coupe', 'van', 'taxi', 'muscle'];

// How far right of the centreline a car sits, i.e. which side of the road it drives on.
const LANE_OFFSET = CONFIG.ROAD_W * 0.24;

// Distance at which a car counts as "arrived" at its target junction.
const NODE_RADIUS = 5.5;

// Cars beyond this range of the player are hidden and skipped entirely.
const CULL_DISTANCE = 300;

// Look-ahead used when yielding: scan this far ahead in our lane for a slower vehicle.
const AHEAD_MIN = 0.5;   // ignore anything alongside or behind us
const AHEAD_MAX = 15;    // only look this far ahead
const AHEAD_LANE = 2.4;  // lateral half-width of "our lane" when checking what is ahead
const AHEAD_STOP = 6.5;  // close enough ahead to stop entirely

// Stuck detection: if a car has barely moved while trying to accelerate for this long,
// reverse out and pick a fresh junction.
const STUCK_SPEED = 0.06;
const STUCK_TIME = 2.6;

/**
 * Wrap an angle difference into [-PI, PI].
 * @param {number} a - Angle to normalise
 * @param {number} b - Reference angle
 * @returns {number} - Signed shortest difference
 */
function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Spawns and ticks AI-driven civilian traffic on the city road graph.
 * Reports crashes through onCrash so effects/audio/heat can react.
 */
export class TrafficManager {
  constructor(scene, city, rng, vehicles) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.vehicles = vehicles;   // shared VehicleManager registry
    this.cars = [];             // traffic cars only (subset of vehicles.cars)
    this.onCrash = null;
    this.spawn();
  }

  /** Spawn the configured number of traffic cars, each on a random road segment. */
  spawn() {
    const rng = this.rng;
    const gridSize = this.city.grid;

    for (let i = 0; i < CONFIG.trafficCount; i++) {
      const kind = pick(rng, TRAFFIC_KINDS);
      const spec = CAR_KINDS[kind];
      const car = new Car(this.scene, { kind, color: pick(rng, spec.colors) });
      car.worldSpan = this.city.span + 40;
      car.driver = 'ai';
      car.onCrash = (damage) => this.onCrash?.(car, damage);

      // Pick a random road line and a point part-way along one of its segments.
      const vertical = chance(rng, 0.5);
      const line = rngInt(rng, 0, gridSize);
      const segment = rngInt(rng, 0, gridSize - 1);
      const along = (segment + rngRange(rng, 0.2, 0.8)) * this.city.cell;
      const directionSign = chance(rng, 0.5) ? 1 : -1;

      let x;
      let z;
      let heading;
      if (vertical) {
        // Driving along a north-south road.
        heading = directionSign > 0 ? 0 : Math.PI;
        x = line * this.city.cell + (directionSign > 0 ? LANE_OFFSET : -LANE_OFFSET);
        z = along;
      } else {
        // Driving along an east-west road.
        heading = directionSign > 0 ? Math.PI / 2 : -Math.PI / 2;
        x = along;
        z = line * this.city.cell + (directionSign > 0 ? -LANE_OFFSET : LANE_OFFSET);
      }

      car.placeAt(x, z, heading);
      car.vel = rngRange(rng, 6, 13);

      car.ai = {
        target: this.pickNextNode(car, null),
        cruise: rngRange(rng, 11, 17),        // preferred speed on a clear road
        patience: rngRange(rng, 0.6, 1.4),    // reserved for future junction yielding
        stuck: 0,                             // seconds spent failing to make progress
        lastPos: new THREE.Vector2(x, z),
      };

      this.cars.push(car);
      this.vehicles.cars.push(car);
      this.vehicles.traffic.push(car);
    }
  }

  /**
   * Choose the next junction, preferring to continue straight.
   * @param {Car} car - The car choosing
   * @param {number|null} fromNode - Node the car just left (excluded, so it never U-turns instantly)
   * @returns {number} - Node index to drive toward
   */
  pickNextNode(car, fromNode) {
    const city = this.city;
    const here = city.nearestNode(car.pos.x, car.pos.z);
    const options = city.neighbours[here].filter((n) => n !== fromNode);
    if (!options.length) return here;

    const node = city.nodes[here];
    const forwardX = Math.sin(car.heading);
    const forwardZ = Math.cos(car.heading);

    let best = options[0];
    let bestScore = -Infinity;

    for (const candidate of options) {
      const target = city.nodes[candidate];
      const dx = target.x - node.x;
      const dz = target.z - node.z;
      const length = Math.hypot(dx, dz) || 1;
      // How aligned the candidate is with our current heading.
      const straightness = (dx / length) * forwardX + (dz / length) * forwardZ;
      // Bias strongly toward going straight, with a little randomness for variety.
      const score = straightness * 2 + this.rng() * 0.9;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  /**
   * World aim point for a junction: the node, offset into this car's lane on approach.
   * @param {Car} car - The car being steered
   * @param {number} nodeIdx - Target node index
   * @param {THREE.Vector3} out - Vector to write the aim point into
   * @returns {THREE.Vector3} - out
   */
  aimPoint(car, nodeIdx, out) {
    const node = this.city.nodes[nodeIdx];
    // Right-hand side of the travel direction.
    const rightX = Math.cos(car.heading);
    const rightZ = -Math.sin(car.heading);
    return out.set(node.x + rightX * LANE_OFFSET, 0, node.z + rightZ * LANE_OFFSET);
  }

  /**
   * Update every traffic car's AI and physics.
   * @param {number} dt - Delta time in seconds
   * @param {THREE.Vector3} playerPos - Player world position (for culling and yielding)
   * @param {Car|null} playerCar - Car the player is driving, or null when on foot
   */
  update(dt, playerPos, playerCar) {
    const aim = new THREE.Vector3();

    for (const car of this.cars) {
      if (car.exploded || car.occupiedByPlayer) continue;

      // Cull far cars: hidden cars skip the whole AI tick.
      const far = Math.hypot(car.pos.x - playerPos.x, car.pos.z - playerPos.z) > CULL_DISTANCE;
      car.mesh.visible = !far;
      if (far) continue;

      const ai = car.ai;
      this.aimPoint(car, ai.target, aim);
      const dx = aim.x - car.pos.x;
      const dz = aim.z - car.pos.z;
      const distance = Math.hypot(dx, dz);

      // Reached the junction: choose the next one.
      if (distance < NODE_RADIUS) {
        ai.target = this.pickNextNode(car, ai.target);
      }

      // Steer toward the aim point, easing so the wheel doesn't snap.
      const desiredHeading = Math.atan2(dx, dz);
      const headingError = angleDelta(desiredHeading, car.heading);
      const steerCommand = Math.max(-1, Math.min(1, headingError * 1.9));
      car.steer += (steerCommand - car.steer) * Math.min(1, dt * 6);

      // Slow for a sharp turn.
      const turnPenalty = Math.min(1, Math.abs(headingError) / 0.9);
      let targetSpeed = ai.cruise * (1 - turnPenalty * 0.62);

      const forwardX = Math.sin(car.heading);
      const forwardZ = Math.cos(car.heading);
      const rightX = Math.cos(car.heading);
      const rightZ = -Math.sin(car.heading);

      // Yield to any visible vehicle directly ahead in the same lane.
      for (const other of this.vehicles.cars) {
        if (other === car || !other.mesh.visible) continue;

        const ox = other.pos.x - car.pos.x;
        const oz = other.pos.z - car.pos.z;
        const ahead = ox * forwardX + oz * forwardZ;
        if (ahead < AHEAD_MIN || ahead > AHEAD_MAX) continue;

        const side = Math.abs(ox * rightX + oz * rightZ);
        if (side < AHEAD_LANE) {
          targetSpeed = Math.min(targetSpeed, Math.max(0, other.vel * 0.85 - 1));
          if (ahead < AHEAD_STOP) targetSpeed = 0;
        }
      }

      // Stop for the player standing in the road ahead (they are not in a car).
      if (!playerCar) {
        const ox = playerPos.x - car.pos.x;
        const oz = playerPos.z - car.pos.z;
        const ahead = ox * forwardX + oz * forwardZ;
        const side = Math.abs(ox * rightX + oz * rightZ);
        if (ahead > 0 && ahead < 12 && side < 2.6) targetSpeed = 0;
      }

      // Throttle/brake toward the target speed with a small dead band.
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

      // Unstick: if we have barely moved while trying to accelerate, back out and re-route.
      const moved = Math.hypot(car.pos.x - ai.lastPos.x, car.pos.z - ai.lastPos.y);
      ai.lastPos.set(car.pos.x, car.pos.z);
      if (moved < STUCK_SPEED && car.throttle > 0.3) ai.stuck += dt;
      else ai.stuck = Math.max(0, ai.stuck - dt * 0.5);

      if (ai.stuck > STUCK_TIME) {
        ai.stuck = 0;
        car.vel = -4;                                        // reverse out
        car.heading += rngRange(this.rng, -0.7, 0.7);        // nudge to a clear heading
        ai.target = this.pickNextNode(car, null);
      }

      car.update(dt, { colliders: this.city.colliders });
    }
  }
}
