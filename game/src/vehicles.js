// Vehicle registry and player interaction.
// Spawns parked cars and civilian traffic, decides which car the player may steal, moves the
// player in and out of a seat, and ticks every vehicle's physics each frame.
//
// Rendering shape: each car body draws in one call, and ALL wheels in the world go through a
// single InstancedMesh, so 40 cars cost roughly 40 draws instead of ~200.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Car, CAR_KINDS, wheelGeometry } from './car.js';
import { pick, chance } from './rng.js';

// Weighted list of kinds that may appear parked at a kerb (sedans dominate, as in a real city).
const PARKED_KINDS = ['sedan', 'sedan', 'coupe', 'muscle', 'van', 'taxi', 'sedan', 'coupe'];

// Upper bound on simultaneously rendered wheels: 4 per car, far above the ~40 cars we spawn.
const MAX_WHEELS = 400;

// Kerbside spawn tuning.
const MAX_PARKED_CARS = 30;      // cap so a dense grid can't flood the streets
const PARKED_CHANCE = 0.55;      // fraction of candidate spots that actually get a car
const PARKED_MIN_GAP = 6;        // metres, keeps parked cars from overlapping

// A car is hidden (and skipped by the wheel sync) beyond this distance from the player.
const CULL_DISTANCE = 420;

/**
 * Owns every vehicle in the world and the shared wheel batch.
 * Groups are exposed separately (parked/traffic/police) for systems that care about a subset.
 */
export class VehicleManager {
  constructor(scene, city, rng) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;

    this.cars = [];     // every vehicle, in spawn order
    this.parked = [];   // kerbside cars
    this.traffic = [];  // civilian traffic
    this.police = [];   // cruisers

    this.nearCar = null;  // currently highlighted enterable car (set by gameplay code)
    this.onCrash = null;  // (car, damage) callback, wired to effects + audio

    // One instanced mesh draws every wheel of every car in a single call.
    const wheelMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.tyreMesh = new THREE.InstancedMesh(wheelGeometry, wheelMaterial, MAX_WHEELS);
    this.tyreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tyreMesh.frustumCulled = false; // wheels move every frame; culling the batch is wrong
    this.tyreMesh.count = 0;
    scene.add(this.tyreMesh);

    // Reusable transforms, allocated once to avoid per-frame garbage.
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);

    this.spawnParked();
  }

  /**
   * Scatter parked cars along the kerbside spots the city generated.
   * Spots are filtered by a probability roll and a minimum-gap check so kerbs look organic
   * rather than uniformly filled.
   */
  spawnParked() {
    const rng = this.rng;
    const used = [];

    for (const spot of this.city.parkedSpots) {
      if (used.length >= MAX_PARKED_CARS) break;
      if (!chance(rng, PARKED_CHANCE)) continue;

      // Reject spots that would overlap a car we already placed.
      let clash = false;
      for (const taken of used) {
        if (Math.hypot(taken.x - spot.x, taken.z - spot.z) < PARKED_MIN_GAP) {
          clash = true;
          break;
        }
      }
      if (clash) continue;

      const kind = pick(rng, PARKED_KINDS);
      const spec = CAR_KINDS[kind];
      const car = this.makeCar({ kind, color: pick(rng, spec.colors) }, spot);
      car.parked = true;
      this.parked.push(car);
      used.push(spot);
    }
  }

  /**
   * Spawn a police cruiser and register it in the police group.
   * @param {number} x - Spawn X
   * @param {number} z - Spawn Z
   * @param {number} heading - Facing angle in radians
   * @returns {Car} - The new cruiser
   */
  spawnPolice(x, z, heading) {
    const car = this.makeCar({ kind: 'police', color: 0x16202e }, { x, z, rot: heading });
    car.driver = 'police';
    this.police.push(car);
    return car;
  }

  /**
   * Create a car, position it, wire its crash callback and add it to the registry.
   * Shared by every spawn path so world bounds and crash wiring can never be forgotten.
   * @param {Object} spec - { kind, color }
   * @param {Object} placement - { x, z, rot }
   * @returns {Car} - The created car
   */
  makeCar(spec, placement) {
    const car = new Car(this.scene, spec);
    car.placeAt(placement.x, placement.z, placement.rot);
    // Cars may leave the city grid a little before the boundary wall stops them.
    car.worldSpan = this.city.span + 40;
    car.onCrash = (damage) => this.onCrash?.(car, damage);
    this.cars.push(car);
    return car;
  }

  /**
   * Remove a car from the world and every group it belongs to.
   * @param {Car} car - Car to remove
   */
  despawn(car) {
    const remove = (list) => {
      const i = list.indexOf(car);
      if (i >= 0) list.splice(i, 1);
    };
    remove(this.cars);
    remove(this.police);
    remove(this.traffic);
    car.dispose(this.scene);
  }

  /**
   * Find the nearest enterable (not exploded) car within range of a point.
   * @param {THREE.Vector3} pos - Origin position
   * @param {number} range - Maximum search distance
   * @returns {Car|null} - Nearest candidate, or null
   */
  findNearestEnterable(pos, range) {
    let best = null;
    let bestDistance = range;

    for (const car of this.cars) {
      if (car.exploded) continue;
      const distance = Math.hypot(car.pos.x - pos.x, car.pos.z - pos.z);
      if (distance < bestDistance) {
        best = car;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * Seat the player in a car.
   * Stealing a parked or occupied car flags it as stolen so the owner's AI won't re-enter it.
   * @param {Car} car - Target car
   * @param {Object} player - Player instance
   * @returns {boolean} - True when the player was seated
   */
  enterCar(car, player) {
    if (!car || car.exploded) return false;

    car.occupiedByPlayer = true;
    if (car.parked) {
      car.stolen = true;
      car.parked = false;
    }
    if (car.driver === 'ai' || car.driver === 'police') car.stolen = true;
    car.driver = 'player';

    player.inCar = car;
    player.mesh.visible = false;
    player.shadow.visible = false;
    player.vel.set(0, 0, 0);

    // Park the car on entry: zero throttle with the brake held so it doesn't roll away.
    car.throttle = 0;
    car.brake = 1;
    car.steer = 0;

    this.nearCar = null;
    return true;
  }

  /**
   * Move the player out of the car, placing them beside the driver's door.
   * @param {Object} player - Player instance
   * @returns {boolean} - True when the player exited
   */
  exitCar(player) {
    const car = player.inCar;
    if (!car) return false;

    const door = car.doorPoint(new THREE.Vector3());
    player.pos.set(door.x, 0, door.z);
    player.vel.set(0, 0, 0);
    player.mesh.visible = true;
    player.shadow.visible = true;
    player.mesh.position.set(door.x, 0, door.z);
    // Face away from the car, toward the kerb.
    player.facing = car.heading + Math.PI / 2;

    // Hand the car back to the world, stopped and empty.
    car.occupiedByPlayer = false;
    car.throttle = 0;
    car.brake = 1;
    car.driver = null;
    player.inCar = null;
    return true;
  }

  /**
   * Tick every car's physics, then refresh the shared wheel batch.
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    for (const car of this.cars) {
      car.update(dt, { colliders: this.city.colliders });
    }
    this.syncWheels();
  }

  /**
   * Push every visible car's four wheels into the shared instanced mesh.
   * Wheel local offsets are rotated into world space by the car's heading, and the front
   * pair also takes a fraction of the steer angle so they visibly turn.
   */
  syncWheels() {
    let count = 0;
    const { _m: m, _q: q, _e: e, _p: p, _s: s } = this;

    for (const car of this.cars) {
      if (!car.mesh.visible) continue;

      const cosH = Math.cos(car.heading);
      const sinH = Math.sin(car.heading);

      for (let i = 0; i < car.wheels.length; i++) {
        if (count >= MAX_WHEELS) break;
        const wheel = car.wheels[i];

        // Rotate the local offset by the heading to get the world position.
        const wheelX = car.pos.x + wheel.x * cosH + wheel.z * sinH;
        const wheelZ = car.pos.z - wheel.x * sinH + wheel.z * cosH;

        e.set(
          car.wheelSpin,
          car.heading + (wheel.front ? car.steer * 0.45 : 0),
          0,
          'YXZ',
        );
        q.setFromEuler(e);
        p.set(wheelX, wheel.y, wheelZ);
        m.compose(p, q, s);
        this.tyreMesh.setMatrixAt(count, m);
        count++;
      }
    }

    this.tyreMesh.count = count;
    this.tyreMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Hide cars that are far from the player. Hidden cars are also skipped by syncWheels,
   * so this trims both draw calls and per-frame work.
   * @param {THREE.Vector3} playerPos - Player position
   */
  cullFar(playerPos) {
    for (const car of this.cars) {
      const far = Math.hypot(car.pos.x - playerPos.x, car.pos.z - playerPos.z) > CULL_DISTANCE;
      car.mesh.visible = !far;
    }
  }
}