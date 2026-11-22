// Vehicle system: low-poly 3D car models with an arcade physics simulation.
// Builds vertex-coloured car meshes, implements throttle/brake/steer/grip/handbrake driving,
// plus damage and explosion. The same class serves the player's stolen cars, parked cars,
// civilian traffic and police cruisers.

import * as THREE from 'three';
import { CONFIG } from './config.js';

// Car configuration constants (shorthand for easier access).
const C = CONFIG.car;

// ===== VEHICLE GEOMETRY CONSTANTS =====

/** Wheel radius. Wheels stick out past the body sides, so the body is narrower than the track. */
export const WHEEL_R = 0.4;
const WHEEL_T = 0.28;          // wheel thickness
const BODY_INSET = 0.24;       // body half-width is this much narrower than the track
const FLOOR = 0.26;            // chassis floor height above the ground

// ===== CAR TYPES =====

/**
 * Vehicle specifications. Each kind defines its footprint, mass, top-speed multiplier and the
 * paint colours it may spawn with.
 */
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

// ===== PAINT PALETTE =====

const GLASS = '#8aa3b8';    // windscreen and side glass
const TRIM = '#22262b';     // bumpers, mirrors, skirts
const HEAD = '#fff3cf';     // headlights
const TAIL = '#c9302a';     // tail lights
const ARCH = '#15171b';     // wheel-arch recess
const SHADOW = '#33383f';   // baked contact shadow
const TYRE_DARK = '#303338';// tyre rubber
const HUB = '#9aa1a8';      // wheel hub

// ===== GEOMETRY BUILDERS =====

/**
 * Merge several boxes into ONE vertex-coloured geometry, so a whole car body is a single draw call.
 * BoxGeometry is indexed, so every part is expanded to a flat triangle list first — concatenating
 * mixed indexed and non-indexed position arrays corrupts the triangles.
 * @param {Array} boxes - { width,height,depth,x,y,z,color,rotationX?,rotationY?,rotationZ? }
 * @returns {THREE.BufferGeometry} - merged geometry with a `color` attribute
 */
function mergedColored(boxes) {
  const geometries = boxes.map((box) => {
    let geometry = new THREE.BoxGeometry(box.width, box.height, box.depth);
    if (box.rotationX) geometry.rotateX(box.rotationX);
    if (box.rotationY) geometry.rotateY(box.rotationY);
    if (box.rotationZ) geometry.rotateZ(box.rotationZ);
    geometry.translate(box.x, box.y, box.z);
    geometry = geometry.toNonIndexed();

    const color = new THREE.Color(box.color);
    const vertexCount = geometry.attributes.position.count;
    const colorArray = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      colorArray[i * 3] = color.r;
      colorArray[i * 3 + 1] = color.g;
      colorArray[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    return geometry;
  });

  let total = 0;
  for (const geometry of geometries) total += geometry.attributes.position.count;

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);

  let offset = 0;
  for (const geometry of geometries) {
    position.set(geometry.attributes.position.array, offset * 3);
    normal.set(geometry.attributes.normal.array, offset * 3);
    color.set(geometry.attributes.color.array, offset * 3);
    offset += geometry.attributes.position.count;
    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Lay out one car body as a list of coloured boxes.
 *
 * Height plan, in metres above the road:
 *   0.00 ground · 0.26 chassis floor · ~0.62 beltline · beltline..height roof
 * Wheel centres sit at y = WHEEL_R and stick out sideways past the body.
 *
 * @param {string} kind - Key into CAR_KINDS
 * @param {string} color - Primary body paint
 * @returns {Object} - { boxes, ... } body metrics reused by the wheel placement
 */
function carBoxes(kind, color) {
  const spec = CAR_KINDS[kind];
  const length = spec.length;
  const width = spec.width - BODY_INSET * 2;  // body narrower than the track, so the tyres show
  const height = spec.height;
  const boxes = [];

  const isVan = kind === 'van';
  const lowerTop = isVan ? height * 0.52 : height * 0.44;   // top of the main body mass
  const lowerHeight = lowerTop - FLOOR;
  const lowerY = FLOOR + lowerHeight / 2;

  // Main body: hood, trunk, door mass.
  boxes.push({ width, height: lowerHeight, depth: length, x: 0, y: lowerY, z: 0, color });

  // Thin skirt under the body so no gap shows through to the far side.
  boxes.push({
    width: width * 0.94, height: 0.1, depth: length * 0.86,
    x: 0, y: FLOOR, z: 0, color: TRIM,
  });

  // Cabin, sitting on top of the body.
  const cabinHeight = height - lowerTop;
  const cabinLength = isVan ? length * 0.74 : length * 0.44;
  const cabinWidth = width * 0.93;
  const cabinZ = isVan ? -length * 0.04 : -length * 0.07;
  const cabinY = lowerTop + cabinHeight / 2;

  boxes.push({
    width: cabinWidth, height: cabinHeight, depth: cabinLength,
    x: 0, y: cabinY, z: cabinZ, color,
  });
  // Roof lip, so the cabin edge reads as a panel rather than a raw box.
  boxes.push({
    width: cabinWidth * 0.97, height: 0.06, depth: cabinLength * 1.01,
    x: 0, y: lowerTop + cabinHeight + 0.02, z: cabinZ, color,
  });

  // Glass: inset into the cabin so nothing pokes through the paint.
  const glassHeight = cabinHeight * 0.62;
  const glassY = cabinY + cabinHeight * 0.06;

  boxes.push({
    width: cabinWidth * 0.84, height: glassHeight, depth: 0.05,
    x: 0, y: glassY, z: cabinZ + cabinLength / 2 - 0.012, color: GLASS,
  });
  boxes.push({
    width: cabinWidth * 0.8, height: glassHeight * 0.92, depth: 0.05,
    x: 0, y: glassY, z: cabinZ - cabinLength / 2 + 0.012, color: GLASS,
  });
  for (const side of [-1, 1]) {
    boxes.push({
      width: 0.05, height: glassHeight * 0.94, depth: cabinLength * 0.62,
      x: side * (cabinWidth / 2 - 0.014), y: glassY, z: cabinZ, color: GLASS,
    });
  }

  // Bumpers, front and rear.
  boxes.push({
    width: width * 1.0, height: 0.3, depth: 0.34,
    x: 0, y: FLOOR + 0.2, z: length / 2 - 0.08, color: TRIM,
  });
  boxes.push({
    width: width * 1.0, height: 0.3, depth: 0.34,
    x: 0, y: FLOOR + 0.2, z: -length / 2 + 0.08, color: TRIM,
  });

  // Head and tail lights, proud of the body faces.
  const lightY = FLOOR + lowerHeight * 0.62;
  for (const side of [-1, 1]) {
    boxes.push({
      width: 0.44, height: 0.2, depth: 0.07,
      x: side * width * 0.31, y: lightY, z: length / 2 + 0.005, color: HEAD,
    });
    boxes.push({
      width: 0.42, height: 0.18, depth: 0.07,
      x: side * width * 0.31, y: lightY, z: -length / 2 - 0.005, color: TAIL,
    });
  }
  // Grille.
  boxes.push({
    width: width * 0.42, height: 0.16, depth: 0.02,
    x: 0, y: lightY - 0.01, z: length / 2 + 0.02, color: '#14171b',
  });

  // Wheel arches: a dark recess on the lower flank, sitting ABOVE the wheel centre only, so the
  // tyre stays visible below it instead of being covered.
  for (const side of [-1, 1]) {
    for (const depth of [-1, 1]) {
      boxes.push({
        width: 0.05, height: WHEEL_R * 0.8, depth: WHEEL_R * 2.1,
        x: side * (width / 2 + 0.004), y: FLOOR + WHEEL_R * 0.5,
        z: depth * (length / 2 - 0.94), color: ARCH,
      });
    }
  }

  // Side mirrors.
  for (const side of [-1, 1]) {
    boxes.push({
      width: 0.13, height: 0.1, depth: 0.19,
      x: side * (cabinWidth / 2 + 0.08), y: lowerTop + 0.04,
      z: cabinZ + cabinLength * 0.3, color: TRIM,
    });
  }

  // Baked contact shadow: a flat slab tight to the chassis, costing no extra draw call.
  boxes.push({
    width: spec.width * 1.02, height: 0.015, depth: length * 1.0,
    x: 0, y: 0.02, z: 0, color: SHADOW,
  });
  // Rocker/side skirt bridging the gap between the wheels, sitting above them.
  boxes.push({
    width: width * 1.005, height: 0.12, depth: length * 0.5,
    x: 0, y: FLOOR - 0.02, z: 0, color: TRIM,
  });

  // ---- kind-specific details ----
  if (kind === 'taxi') {
    boxes.push({
      width: 0.52, height: 0.15, depth: 0.26,
      x: 0, y: height + 0.1, z: cabinZ, color: '#f7e04a',
    });
  }

  if (kind === 'police') {
    // Roof light bar.
    boxes.push({
      width: 0.28, height: 0.12, depth: 0.24,
      x: -0.21, y: height + 0.08, z: cabinZ + 0.12, color: '#ff2f24',
    });
    boxes.push({
      width: 0.28, height: 0.12, depth: 0.24,
      x: 0.21, y: height + 0.08, z: cabinZ + 0.12, color: '#2f6bff',
    });
    // Livery so the cruiser reads as police from any angle, not just by the roof bar: a white
    // door stripe down each flank plus a dark push bar on the nose.
    for (const side of [-1, 1]) {
      boxes.push({
        width: 0.03, height: 0.30, depth: length * 0.62,
        x: side * (width / 2 + 0.012), y: FLOOR + 0.36, z: 0, color: '#eef3f8',
      });
      boxes.push({
        width: 0.03, height: 0.16, depth: length * 0.42,
        x: side * (width / 2 + 0.014), y: FLOOR + 0.10, z: 0, color: '#1b2534',
      });
    }
    boxes.push({
      width: width * 0.78, height: 0.34, depth: 0.09,
      x: 0, y: FLOOR + 0.22, z: length / 2 + 0.06, color: '#20262e',
    });
  }

  return { boxes, L: length, W: width, H: height };
}

/**
 * Build the shared wheel geometry: a tyre with a hub face, axis along local X.
 * @returns {THREE.BufferGeometry} - wheel geometry with a `color` attribute
 */
function buildWheelGeo() {
  const parts = [
    { geometry: new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_T, 12).rotateZ(Math.PI / 2), color: TYRE_DARK },
    { geometry: new THREE.CylinderGeometry(WHEEL_R * 0.52, WHEEL_R * 0.52, WHEEL_T * 1.06, 8).rotateZ(Math.PI / 2), color: HUB },
  ];

  let total = 0;
  const flat = parts.map((part) => {
    const geometry = part.geometry.toNonIndexed();
    total += geometry.attributes.position.count;
    return geometry;
  });

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);

  let offset = 0;
  flat.forEach((geometry, index) => {
    position.set(geometry.attributes.position.array, offset * 3);
    normal.set(geometry.attributes.normal.array, offset * 3);

    const partColor = new THREE.Color(parts[index].color);
    for (let vertex = 0; vertex < geometry.attributes.position.count; vertex++) {
      color[(offset + vertex) * 3] = partColor.r;
      color[(offset + vertex) * 3 + 1] = partColor.g;
      color[(offset + vertex) * 3 + 2] = partColor.b;
    }

    offset += geometry.attributes.position.count;
    geometry.dispose();
  });

  const wheel = new THREE.BufferGeometry();
  wheel.setAttribute('position', new THREE.BufferAttribute(position, 3));
  wheel.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  wheel.setAttribute('color', new THREE.BufferAttribute(color, 3));
  wheel.computeBoundingSphere();
  return wheel;
}

// ===== SHARED ASSETS =====

/** One wheel geometry for every car in the world (drawn through a single InstancedMesh). */
export const wheelGeometry = buildWheelGeo();

/** Car body geometries are cached by `kind:color`, so fifty sedans share one buffer. */
const geomCache = new Map();

// ===== CAR =====

/**
 * A vehicle: 3D body plus the arcade physics state that drives it.
 *
 * Ownership note — the body geometry may be shared with other cars of the same kind and colour,
 * so `ownsGeo` is only true for a geometry this instance created; only then may it be disposed.
 */
export class Car {
  /**
   * @param {THREE.Scene} scene - Scene to add the car to
   * @param {Object} opts - { kind, color }
   */
  constructor(scene, opts = {}) {
    this.kind = opts.kind ?? 'sedan';
    this.spec = CAR_KINDS[this.kind];
    this.color = opts.color ?? this.spec.colors[0];

    this.bodyInfo = carBoxes(this.kind, this.color);

    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const cacheKey = `${this.kind}:${this.color}`;
    if (!geomCache.has(cacheKey)) geomCache.set(cacheKey, mergedColored(this.bodyInfo.boxes));
    this.bodyGeo = geomCache.get(cacheKey);
    this.ownsGeo = false;

    // Scene graph: a group holding the body mesh, so the body can roll and pitch independently.
    this.mesh = new THREE.Group();
    const bodyMesh = new THREE.Mesh(this.bodyGeo, this.material);
    bodyMesh.frustumCulled = true;
    this.mesh.add(bodyMesh);
    this.bodyMesh = bodyMesh;
    scene.add(this.mesh);

    // Wheel offsets only — the actual wheel meshes are drawn by VehicleManager's shared
    // InstancedMesh, so each car stores just where its four wheels sit.
    this.wheels = [];
    const halfLength = this.spec.length / 2 - 0.94;
    const track = this.spec.width / 2 - WHEEL_T / 2 - 0.01;
    for (const sideX of [-1, 1]) {
      for (const depthZ of [-1, 1]) {
        this.wheels.push({
          x: sideX * track,
          y: WHEEL_R,
          z: depthZ * halfLength,
          front: depthZ > 0,
        });
      }
    }

    // ---- physics state ----
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = 0;                  // forward speed (negative = reversing)
    this.lateral = 0;              // sideways slip, bled off by grip
    this.heading = 0;              // facing angle in radians
    this.steer = 0;                // smoothed steering input, -1..1
    this.throttle = 0;             // -1..1
    this.brake = 0;                // 0..1
    this.handbrake = false;
    this.health = CONFIG.car.maxHealth;
    this.exploded = false;

    // ---- ownership / role ----
    this.driver = null;            // null | 'player' | 'ai' | 'police'
    this.ai = null;                // AI scratch state, owned by the driver system
    this.braking = false;
    this.wheelSpin = 0;            // accumulated wheel rotation, for the instanced wheels
    this.occupiedByPlayer = false;
    this.stolen = false;
    this.parked = false;
    this.hornTimer = 0;

    // ---- presentation ----
    this.bodyRoll = 0;             // lean into corners
    this.bodyPitch = 0;            // squat under acceleration, dive under braking

    // Soft world bound: cars drift a little past the grid before the wall stops them.
    this.worldSpan = 640;
    this.onCrash = null;           // (damage, car) callback
  }

  /** Current speed in units/second (negative when reversing). */
  get speed() { return this.vel; }

  /** Top speed for this car: the shared base times the kind's multiplier. */
  get maxSpeed() { return C.maxSpeed * this.spec.topSpeed; }

  /**
   * Teleport the car and clear its momentum.
   * @param {number} x - X
   * @param {number} z - Z
   * @param {number} heading - Facing angle in radians
   */
  placeAt(x, z, heading = 0) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.vel = 0;
    this.lateral = 0;
    this.syncMesh();
  }

  /**
   * Apply damage.
   * @param {number} amount - Damage amount
   * @returns {boolean} - True when this hit destroyed the car
   */
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

  /**
   * Advance the car physics by one step.
   * @param {number} dt - Delta time in seconds
   * @param {Object} opts - { colliders, drifting }
   */
  update(dt, opts = {}) {
    const colliders = opts.colliders ?? [];

    // A wreck is inert; just keep its transform in sync.
    if (this.exploded) {
      this.syncMesh();
      return;
    }

    const maxForward = this.maxSpeed;
    const maxReverse = C.reverseSpeed;

    // ---- longitudinal forces ----
    const engine = this.throttle * C.engineForce * this.spec.mass;
    const braking = this.brake * C.brakeForce;
    // Quadratic term gives a natural top-speed asymptote; linear term is rolling drag.
    const drag = this.vel * Math.abs(this.vel) * 0.019 + this.vel * C.drag;

    if (this.throttle > 0) {
      this.vel += engine * dt;
    } else if (this.throttle < 0) {
      // Reversing from a standstill is weaker than braking, so S while moving is a brake.
      if (this.vel > 0.4) this.vel -= engine * dt * 0.55;
      else this.vel += engine * dt * 0.75;
    }

    this.vel -= drag * dt;

    if (this.brake > 0) {
      const direction = Math.sign(this.vel);
      this.vel -= direction * braking * dt;
      // Clamp through zero so braking never reverses the car.
      if (Math.abs(this.vel) < braking * dt) this.vel = 0;
    }

    if (this.handbrake) {
      this.vel -= Math.sign(this.vel) * 16 * dt;
    }

    // Coasting: bleed speed at the rolling-resistance rate, but never past zero.
    if (this.throttle === 0 && this.brake === 0) {
      this.vel -= Math.sign(this.vel) * Math.min(Math.abs(this.vel), C.rollingResist * dt * 2.4);
    }

    this.vel = Math.max(-maxReverse, Math.min(maxForward, this.vel));
    this.braking = this.brake > 0.1 || (this.throttle < 0 && this.vel > 0.4);

    // ---- steering ----
    const speed01 = Math.min(1, Math.abs(this.vel) / maxForward);
    // Steering authority fades with speed and reverses with the direction of travel.
    const steerAuthority = C.steerRate * (1 - speed01 * 0.55) * Math.sign(this.vel || 1);
    // Below ~3 m/s the wheel barely bites, which keeps slow manoeuvring stable.
    this.heading += this.steer * steerAuthority * dt * Math.min(1, Math.abs(this.vel) / 3.2);

    // ---- lateral grip ----
    const grip = this.handbrake ? C.handbrakeGrip : (opts.drifting ? C.driftGrip : C.grip);
    this.lateral *= Math.max(0, 1 - grip * dt);

    // ---- integrate ----
    const forwardX = Math.sin(this.heading);
    const forwardZ = Math.cos(this.heading);
    const rightX = Math.cos(this.heading);
    const rightZ = -Math.sin(this.heading);

    let nextX = this.pos.x + (forwardX * this.vel + rightX * this.lateral) * dt;
    let nextZ = this.pos.z + (forwardZ * this.vel + rightZ * this.lateral) * dt;

    if (this.collidesAt(nextX, nextZ, colliders)) {
      const damage = Math.min(30, Math.abs(this.vel) * 1.1);
      if (Math.abs(this.vel) > 5) this.onCrash?.(damage, this);
      // Bounce back a little rather than stopping dead.
      this.vel *= -0.22;
      this.lateral *= -0.2;
      nextX = this.pos.x;
      nextZ = this.pos.z;
    }

    this.pos.x = Math.max(-40, Math.min(this.worldSpan, nextX));
    this.pos.z = Math.max(-40, Math.min(this.worldSpan, nextZ));

    // ---- presentation ----
    this.wheelSpin += (this.vel / WHEEL_R) * dt;

    const accelerating = this.throttle > 0 ? 1 : (this.brake > 0 ? -1 : 0);
    this.bodyRoll += ((-this.steer * speed01 * 0.1) - this.bodyRoll) * Math.min(1, dt * 8);
    this.bodyPitch += ((accelerating * 0.03) - this.bodyPitch) * Math.min(1, dt * 6);
    this.bodyMesh.rotation.z = this.bodyRoll;
    this.bodyMesh.rotation.x = this.bodyPitch;

    if (this.hornTimer > 0) this.hornTimer -= dt;
    this.syncMesh();
  }

  /** Copy the logical transform onto the Three.js objects. */
  syncMesh() {
    // An exploded car sits slightly proud of the road with a permanent list to one side.
    this.mesh.position.set(this.pos.x, this.exploded ? 0.1 : 0, this.pos.z);
    this.mesh.rotation.y = this.heading;
    if (this.exploded) this.bodyMesh.rotation.z = 0.1;
  }

  /**
   * Would the car overlap any collider at (x, z)?
   * Sampled at three points along the length so long vehicles can't nose into a wall.
   * @param {number} x - Candidate X
   * @param {number} z - Candidate Z
   * @param {Array} colliders - Box colliders with minX/maxX/minZ/maxZ and an optional height
   * @returns {boolean} - True on collision
   */
  collidesAt(x, z, colliders) {
    const radius = 0.95;
    const halfLength = this.spec.length * 0.42;
    const forwardX = Math.sin(this.heading);
    const forwardZ = Math.cos(this.heading);

    for (const along of [-1, 0, 1]) {
      const checkX = x + forwardX * halfLength * along;
      const checkZ = z + forwardZ * halfLength * along;

      for (let i = 0; i < colliders.length; i++) {
        const collider = colliders[i];
        // Ignore anything shorter than a wheel, e.g. the kerb.
        if (collider.h !== undefined && collider.h < 0.4) continue;

        if (checkX + radius > collider.minX && checkX - radius < collider.maxX &&
            checkZ + radius > collider.minZ && checkZ - radius < collider.maxZ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * World position of the driver's door, i.e. where the player steps out.
   * @param {THREE.Vector3} out - Vector to write into
   * @returns {THREE.Vector3} - out
   */
  doorPoint(out) {
    const rightX = Math.cos(this.heading);
    const rightZ = -Math.sin(this.heading);
    return out.set(
      this.pos.x + rightX * (this.spec.width / 2 + 1.0),
      0,
      this.pos.z + rightZ * (this.spec.width / 2 + 1.0),
    );
  }

  /**
   * Remove the car from the scene and release its material.
   * The body geometry is usually shared via geomCache, so it is only disposed when this
   * instance owns it.
   * @param {THREE.Scene} scene - Scene to remove the car from
   */
  dispose(scene) {
    scene.remove(this.mesh);
    if (this.ownsGeo) this.bodyGeo.dispose();
    this.material.dispose();
  }
}
