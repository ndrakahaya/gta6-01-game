// Vehicle registry and player interaction: spawns parked cars and civilian traffic, decides
// which car the player may steal, moves the player in/out of a seat, and drives the AI tick.
//
// Rendering shape: each car draws its body in one call, and ALL wheels in the world go through
// a single InstancedMesh, so 40 cars cost ~40 draws instead of ~200.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Car, CAR_KINDS, wheelGeometry } from './car.js';
import { pick, rngRange, rngInt, chance } from './rng.js';

const PARKED_KINDS = ['sedan', 'sedan', 'coupe', 'muscle', 'van', 'taxi', 'sedan', 'coupe'];
const MAX_WHEELS = 400;

export class VehicleManager {
  constructor(scene, city, rng) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.cars = [];
    this.parked = [];
    this.traffic = [];
    this.police = [];
    this.nearCar = null;
    this.onCrash = null;

    const wheelMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.tyreMesh = new THREE.InstancedMesh(wheelGeometry, wheelMat, MAX_WHEELS);
    this.tyreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tyreMesh.frustumCulled = false;
    this.tyreMesh.count = 0;
    scene.add(this.tyreMesh);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);

    this.spawnParked();
  }

  spawnParked() {
    const rng = this.rng;
    const spots = this.city.parkedSpots;
    const used = [];
    for (const spot of spots) {
      if (used.length >= 30) break;
      if (!chance(rng, 0.55)) continue;
      let clash = false;
      for (const u of used) {
        if (Math.hypot(u.x - spot.x, u.z - spot.z) < 6) { clash = true; break; }
      }
      if (clash) continue;
      const kind = pick(rng, PARKED_KINDS);
      const spec = CAR_KINDS[kind];
      const car = new Car(this.scene, { kind, color: pick(rng, spec.colors) });
      car.placeAt(spot.x, spot.z, spot.rot);
      car.worldSpan = this.city.span + 40;
      car.onCrash = (d) => this.onCrash?.(car, d);
      car.parked = true;
      this.cars.push(car);
      this.parked.push(car);
      used.push(spot);
    }
  }

  spawnPolice(x, z, heading) {
    const car = new Car(this.scene, { kind: 'police', color: 0x16202e });
    car.placeAt(x, z, heading);
    car.worldSpan = this.city.span + 40;
    car.driver = 'police';
    car.onCrash = (d) => this.onCrash?.(car, d);
    this.cars.push(car);
    this.police.push(car);
    return car;
  }

  despawn(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    const j = this.police.indexOf(car);
    if (j >= 0) this.police.splice(j, 1);
    const k = this.traffic.indexOf(car);
    if (k >= 0) this.traffic.splice(k, 1);
    car.dispose(this.scene);
  }

  findNearestEnterable(pos, range) {
    let best = null;
    let bestD = range;
    for (const car of this.cars) {
      if (car.exploded) continue;
      const d = Math.hypot(car.pos.x - pos.x, car.pos.z - pos.z);
      if (d < bestD) { best = car; bestD = d; }
    }
    return best;
  }

  enterCar(car, player) {
    if (!car || car.exploded) return false;
    car.occupiedByPlayer = true;
    if (car.parked) { car.stolen = true; car.parked = false; }
    if (car.driver === 'ai' || car.driver === 'police') car.stolen = true;
    car.driver = 'player';
    player.inCar = car;
    player.mesh.visible = false;
    player.shadow.visible = false;
    player.vel.set(0, 0, 0);
    car.throttle = 0;
    car.brake = 1;
    car.steer = 0;
    this.nearCar = null;
    return true;
  }

  exitCar(player) {
    const car = player.inCar;
    if (!car) return false;
    const door = car.doorPoint(new THREE.Vector3());
    player.pos.set(door.x, 0, door.z);
    player.vel.set(0, 0, 0);
    player.mesh.visible = true;
    player.shadow.visible = true;
    player.mesh.position.set(door.x, 0, door.z);
    player.facing = car.heading + Math.PI / 2;
    car.occupiedByPlayer = false;
    car.throttle = 0;
    car.brake = 1;
    car.driver = null;
    player.inCar = null;
    return true;
  }

  update(dt) {
    for (const car of this.cars) car.update(dt, { colliders: this.city.colliders });
    this.syncWheels();
  }

  /** Push every visible car's four wheels into the shared instanced mesh. */
  syncWheels() {
    let n = 0;
    const m = this._m;
    const q = this._q;
    const e = this._e;
    const p = this._p;
    for (const car of this.cars) {
      if (!car.mesh.visible) continue;
      const ch = Math.cos(car.heading);
      const sh = Math.sin(car.heading);
      for (let i = 0; i < car.wheels.length; i++) {
        if (n >= MAX_WHEELS) break;
        const w = car.wheels[i];
        const wx = car.pos.x + w.x * ch + w.z * sh;
        const wz = car.pos.z - w.x * sh + w.z * ch;
        e.set(car.wheelSpin, car.heading + (w.front ? car.steer * 0.45 : 0), 0, 'YXZ');
        q.setFromEuler(e);
        p.set(wx, w.y, wz);
        m.compose(p, q, this._s);
        this.tyreMesh.setMatrixAt(n, m);
        n++;
      }
    }
    this.tyreMesh.count = n;
    this.tyreMesh.instanceMatrix.needsUpdate = true;
  }

  cullFar(playerPos) {
    for (const car of this.cars) {
      const far = Math.hypot(car.pos.x - playerPos.x, car.pos.z - playerPos.z) > 420;
      car.mesh.visible = !far;
    }
  }
}
