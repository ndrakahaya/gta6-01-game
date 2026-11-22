// Player on foot: camera-relative WASD movement, gravity, jumping, cylinder-vs-box collision
// against the city, and the state combat needs (health, aiming, punch cooldown, weapons).

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildCharacter, animateCharacter, buildPistol, buildBlobShadow } from './character.js';

const P = CONFIG.player;

// ===== TUNING =====

const MAG_SIZE = { pistol: 12, smg: 30 };   // rounds granted when reloading from reserve
const MELEE_RANGE = 2.6;
const MELEE_DAMAGE = 18;
const GUN_RANGE = 32;
const PISTOL_DAMAGE = 34;
const SMG_DAMAGE = 20;
const AIM_WALK_SPEED = 3.6;                 // speed cap while aiming
const SPRINT_STAMINA_DRAIN = 0.24;          // per second while sprinting
const STAMINA_REGEN = 0.3;                  // per second while not sprinting
const STAMINA_MIN_TO_SPRINT = 0.05;
const AIR_CONTROL_FLOOR = 0.001;            // tiny residual accel so a stopped player doesn't drift
const FACING_TURN_RATE = 14;                // how fast the body turns toward movement
const FOOTSTEP_INTERVAL_RUN = 1.9;          // metres between footsteps at a jog
const FOOTSTEP_INTERVAL_SPRINT = 1.5;
const WALL_BOUNCE = -0.12;                  // velocity retained after hitting a wall
const DEFAULT_LIMIT = 640;                  // soft map bound in metres
const SHADOW_MIN_SCALE = 0.55;

// Wanted heat added per crime, in star units.
const HEAT_ASSAULT = 0.5;
const HEAT_PISTOL = 0.9;
const HEAT_SMG = 1.3;

/**
 * The player character on foot.
 * Owns movement, collision, stamina, health regen and the shoot/punch input handling.
 * The driving case lives in DrivingController; `inCar` is the hand-off between the two.
 */
export class Player {
  constructor(scene, rng) {
    // Fixed palette: the player must read as one consistent person across screenshots.
    const { root, parts } = buildCharacter(rng, {
      shirt: '#1d2b3a', pants: '#2a2f38', skin: '#c98f6b', hair: '#171a1f', build: 1.0,
    });
    this.mesh = root;
    this.parts = parts;
    this.mesh.traverse((o) => {
      if (o.isMesh) o.frustumCulled = true;
    });
    scene.add(this.mesh);

    // Cheap blob shadow instead of a shadow map.
    this.shadow = buildBlobShadow(0.62, 0.36);
    scene.add(this.shadow);

    // Pistol prop, parented to the right forearm and shown only while armed.
    this.pistol = buildPistol();
    this.pistol.visible = false;
    this.parts.rightElbow.add(this.pistol);

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3(0, 0, 0);
    this.facing = 0;
    this.yaw = 0;
    this.pitch = -0.12;

    this.health = P.maxHealth;
    this.maxHealth = P.maxHealth;
    this.armor = 0;
    this.cash = CONFIG.cashStart;

    this.weapon = 'fists';   // 'fists' | 'pistol' | 'smg'
    this.ammo = { pistol: 12, smg: 0 };
    this.reserve = { pistol: 36, smg: 0 };

    this.aiming = false;
    this.grounded = true;
    this.phase = 0;
    this.speed01 = 0;
    this.punchT = 0;          // punch animation progress, counts down from 1
    this.inCar = null;
    this.dead = false;

    this.hurtTimer = 0;
    this.lastDamageAt = -999; // wall-clock seconds; drives the regen delay
    this.regenAccum = 0;
    this.stamina = 1;
    this.footstepAccum = 0;

    this.onFootstep = null;
    this.onLand = null;
  }

  /** Height of the eye/camera focus above the feet. */
  get eyeY() { return 1.68; }

  /** main.js hands the app object over so combat can reach pedestrians, effects and audio. */
  bindApp(app) {
    this.app = app;
  }

  /** Teleport the player and cancel any residual velocity. */
  setPos(x, z) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
  }

  /**
   * Switch weapon and show/hide the pistol prop.
   * @param {string} kind - 'fists' | 'pistol' | 'smg'
   */
  setWeapon(kind) {
    this.weapon = kind;
    this.pistol.visible = kind === 'pistol' || kind === 'smg';
  }

  /**
   * Rounds available for a weapon; fists are always "loaded".
   * @param {string} kind - Weapon id
   * @returns {number} - Rounds, or Infinity for fists
   */
  ammoFor(kind) {
    if (kind === 'fists') return Infinity;
    return this.ammo[kind] ?? 0;
  }

  /**
   * Facing direction on the ground plane, with a small spread so repeated shots don't trace
   * the exact same line. Used for bullet paths and muzzle placement.
   * @returns {THREE.Vector3} - Normalised direction
   */
  aimDir() {
    const facing = this.facing;
    const dir = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    const spread = 0.04;
    dir.x += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    return dir.normalize();
  }

  /**
   * Spend one round, auto-reloading from reserve when the magazine empties.
   * @returns {boolean} - True when a shot is actually available to fire
   */
  consumeAmmo() {
    if (this.weapon === 'fists') return true;

    if ((this.ammo[this.weapon] ?? 0) <= 0) {
      const available = this.reserve[this.weapon] ?? 0;
      if (available <= 0) return false;

      // Reload the magazine (a partial magazine if the reserve is nearly out).
      const magazine = MAG_SIZE[this.weapon] ?? 12;
      const taken = Math.min(magazine, available);
      this.ammo[this.weapon] = taken;
      this.reserve[this.weapon] = available - taken;
    }

    this.ammo[this.weapon] -= 1;
    return true;
  }

  /**
   * Apply damage, soaking a share of it with armor first.
   * @param {number} amount - Incoming damage
   */
  damage(amount) {
    if (this.dead) return;

    this.lastDamageAt = performance.now() / 1000;

    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.6);
      this.armor -= absorbed;
      amount -= absorbed;
    }

    this.health -= amount;
    this.hurtTimer = 0.55;

    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
  }

  /** Restore health, capped at the maximum. */
  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /**
   * Movement, collisions and combat for one frame.
   * @param {number} dt - Delta time in seconds
   * @param {Object} input - Input manager
   * @param {number} cameraYaw - Camera yaw so WASD is camera-relative
   * @param {Array} colliders - City collision boxes
   * @param {Object} opts - { speedMul, limit }
   */
  update(dt, input, cameraYaw, colliders, opts = {}) {
    if (this.dead) {
      this.updateDead();
      return;
    }
    this.mesh.rotation.z = 0;

    if (this.hurtTimer > 0) this.hurtTimer -= dt;

    // Right mouse aims: the body follows the camera, movement slows, and the armed pose plays.
    this.aiming = input.mouse(2);

    this.updateRegen(dt);
    this.handleCombat(input);

    const sprinting = this.updateStaminaAndSpeed(dt, input);
    const speed = this.currentSpeed(sprinting, input, opts);

    const move = this.desiredDirection(input, cameraYaw);
    this.applyAcceleration(dt, move, speed);
    this.applyGravityAndJump(dt, input);
    this.integrateWithCollision(dt, colliders, opts);

    this.updateFacing(dt, cameraYaw);
    this.updateAnimation(dt, sprinting);
    this.updateMeshAndShadow();
    this.updateFootsteps(dt, sprinting);
  }

  /** Dead pose: lie flat on the ground, no input, no animation. */
  updateDead() {
    animateCharacter(this.parts, 0, 0, { crouch: true });
    this.mesh.rotation.z = -Math.PI / 2;
    this.mesh.position.set(this.pos.x, 0.3, this.pos.z);
    this.shadow.position.set(this.pos.x, 0.03, this.pos.z);
  }

  /** Regenerate health in whole points once the post-damage delay has elapsed. */
  updateRegen(dt) {
    const now = performance.now() / 1000;
    if (now - this.lastDamageAt <= P.regenDelay || this.health >= this.maxHealth) return;

    this.regenAccum += dt * P.regenRate;
    if (this.regenAccum >= 1) {
      const whole = Math.floor(this.regenAccum);
      this.health = Math.min(this.maxHealth, this.health + whole);
      this.regenAccum -= whole;
    }
  }

  /** Melee or ranged attack on the fire input, with heat and feedback effects. */
  handleCombat(input) {
    const app = this.app;
    if (!app || !input.hit('Mouse0')) return;

    if (this.weapon === 'fists') {
      this.punch(app);
      return;
    }

    if (this.consumeAmmo()) {
      this.shoot(app);
    } else {
      // Dry click so an empty weapon still gives feedback.
      app.audio?.blip(180, 0.06, 'square', 0.08);
    }
  }

  /** Punch the nearest pedestrian in range. */
  punch(app) {
    this.punchT = 0.3;
    app.audio?.punch();

    const target = app.pedestrians?.nearest(this.pos, MELEE_RANGE);
    if (!target || target.dead) return;

    const died = target.hit(MELEE_DAMAGE, this.pos.x, this.pos.z);
    app.effects?.blood(target.pos.x, 0.5, target.pos.z);
    if (died) app.missions?.noteKill();
    app.wanted?.add(HEAT_ASSAULT, 'assault');
  }

  /** Fire the equipped firearm at the nearest pedestrian ahead. */
  shoot(app) {
    app.audio?.shot(0.9);

    const dir = this.aimDir();
    app.effects?.muzzle(this.pos.x + dir.x * 0.6, 1.25, this.pos.z + dir.z * 0.6);
    app.rig?.addShake(0.06);

    const target = app.pedestrians?.nearest(this.pos, GUN_RANGE);
    if (target && !target.dead) {
      const damage = this.weapon === 'pistol' ? PISTOL_DAMAGE : SMG_DAMAGE;
      const died = target.hit(damage, this.pos.x, this.pos.z);
      app.effects?.blood(target.pos.x, 0.9, target.pos.z);
      if (died) app.missions?.noteKill();
    }

    app.pedestrians?.panic(this.pos.x, this.pos.z, 30);
    app.wanted?.add(this.weapon === 'pistol' ? HEAT_PISTOL : HEAT_SMG, 'shooting');
  }

  /**
   * Drain or refill stamina and report whether the player is sprinting this frame.
   * @returns {boolean} - True when sprinting is active
   */
  updateStaminaAndSpeed(dt, input) {
    const wantsSprint =
      input.key('ShiftLeft') && this.stamina > STAMINA_MIN_TO_SPRINT && !this.aiming;
    const moving = input.axis('KeyS', 'KeyW') !== 0 || input.axis('KeyA', 'KeyD') !== 0;

    if (wantsSprint && moving) {
      this.stamina = Math.max(0, this.stamina - dt * SPRINT_STAMINA_DRAIN);
    } else {
      this.stamina = Math.min(1, this.stamina + dt * STAMINA_REGEN);
    }
    return wantsSprint;
  }

  /** Movement speed for this frame, given the walk/run/sprint and aiming state. */
  currentSpeed(sprinting, input, opts) {
    // Sprint wins; Ctrl drops to a walk; otherwise jog.
    let speed = sprinting
      ? P.sprintSpeed
      : (input.key('ControlLeft') ? P.walkSpeed : P.runSpeed);

    // Aiming always slows the player to a steady combat walk.
    if (this.aiming) speed = Math.min(speed, AIM_WALK_SPEED);

    if (opts.speedMul) speed *= opts.speedMul;
    return speed;
  }

  /**
   * Desired horizontal movement direction, camera-relative, normalised.
   * @returns {{x: number, z: number, hasInput: boolean}}
   */
  desiredDirection(input, cameraYaw) {
    const forward = input.axis('KeyS', 'KeyW');
    const strafe = input.axis('KeyA', 'KeyD');
    const hasInput = forward !== 0 || strafe !== 0;

    if (!hasInput) return { x: 0, z: 0, hasInput: false };

    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    // Camera looks along -Z rotated by yaw; right is +X rotated by yaw.
    const forwardX = -sin;
    const forwardZ = -cos;
    const rightX = cos;
    const rightZ = -sin;

    let x = forwardX * forward + rightX * strafe;
    let z = forwardZ * forward + rightZ * strafe;
    const length = Math.hypot(x, z) || 1;
    x /= length;
    z /= length;

    return { x, z, hasInput: true };
  }

  /** Accelerate toward the target velocity, with reduced authority in the air. */
  applyAcceleration(dt, move, speed) {
    const control = this.grounded ? 1 : P.airControl;
    const targetVX = move.x * speed;
    const targetVZ = move.z * speed;
    // Barely any authority with no input, so a stopped player stays stopped.
    const accel = P.accel * control * (move.hasInput ? 1 : AIR_CONTROL_FLOOR);

    const rate = Math.min(1, (accel * dt) / Math.max(speed, 1) * 3);
    this.vel.x += (targetVX - this.vel.x) * rate;
    this.vel.z += (targetVZ - this.vel.z) * rate;

    if (!move.hasInput) {
      const friction = P.friction * dt;
      this.vel.x -= this.vel.x * Math.min(1, friction);
      this.vel.z -= this.vel.z * Math.min(1, friction);
    }
  }

  /** Gravity, jumping and landing detection. */
  applyGravityAndJump(dt, input) {
    this.vel.y -= P.gravity * dt;

    if (input.hit('Space') && this.grounded) {
      this.vel.y = P.jumpSpeed;
      this.grounded = false;
    }
  }

  /**
   * Integrate position, resolving each axis separately so the player slides along walls
   * instead of sticking to them.
   */
  integrateWithCollision(dt, colliders, opts) {
    const radius = P.radius;

    const nextX = this.pos.x + this.vel.x * dt;
    if (!this.collides(nextX, this.pos.z, radius, colliders)) this.pos.x = nextX;
    else this.vel.x *= WALL_BOUNCE;

    const nextZ = this.pos.z + this.vel.z * dt;
    if (!this.collides(this.pos.x, nextZ, radius, colliders)) this.pos.z = nextZ;
    else this.vel.z *= WALL_BOUNCE;

    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      // Report a hard landing for a thud + dust, but only from a meaningful fall.
      if (!this.grounded && this.vel.y < -9) this.onLand?.(-this.vel.y);
      this.pos.y = 0;
      this.vel.y = 0;
      this.grounded = true;
    }

    // Keep the player inside the map.
    const limit = opts.limit ?? DEFAULT_LIMIT;
    this.pos.x = Math.max(-limit, Math.min(limit, this.pos.x));
    this.pos.z = Math.max(-limit, Math.min(limit, this.pos.z));
  }

  /** Face the movement direction, or the camera direction while aiming. */
  updateFacing(dt, cameraYaw) {
    const planarSpeed = Math.hypot(this.vel.x, this.vel.z);

    if (this.aiming) {
      // While aiming, the body follows the camera so shots go where the player looks.
      this.facing = cameraYaw + Math.PI;
      return;
    }

    if (planarSpeed <= 0.6) return;

    const targetFacing = Math.atan2(this.vel.x, this.vel.z);
    let diff = targetFacing - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.facing += diff * Math.min(1, dt * FACING_TURN_RATE);
  }

  /** Advance the walk cycle and drive the limb skeleton. */
  updateAnimation(dt, sprinting) {
    const planarSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.speed01 = planarSpeed / P.sprintSpeed;
    this.phase += planarSpeed * dt * (sprinting ? 2.0 : 2.4);

    if (this.punchT > 0) this.punchT = Math.max(0, this.punchT - dt * 3.4);

    animateCharacter(this.parts, this.phase, Math.min(1, planarSpeed / P.runSpeed), {
      aiming: this.aiming && this.grounded,
      punch: this.punchT > 0 ? 1 - this.punchT : 0,
      run: sprinting,
    });
  }

  /** Place the body and blob shadow; the shadow shrinks as the player leaves the ground. */
  updateMeshAndShadow() {
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.mesh.rotation.y = this.facing;

    this.shadow.position.set(this.pos.x, 0.03 + this.pos.y * 0.02, this.pos.z);
    const scale = this.grounded ? 1 : Math.max(SHADOW_MIN_SCALE, 1 - this.pos.y * 0.25);
    this.shadow.scale.setScalar(scale);
  }

  /** Emit footstep events at a distance-based cadence while grounded and moving. */
  updateFootsteps(dt, sprinting) {
    const planarSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (!this.grounded || planarSpeed <= 1.4) return;

    this.footstepAccum += planarSpeed * dt;
    const interval = sprinting ? FOOTSTEP_INTERVAL_SPRINT : FOOTSTEP_INTERVAL_RUN;
    if (this.footstepAccum > interval) {
      this.footstepAccum = 0;
      this.onFootstep?.(sprinting);
    }
  }

  /**
   * Cylinder-vs-box collision test against every city collider.
   * Colliders shorter than ankle height are ignored so kerbs don't block the player.
   */
  collides(x, z, r, colliders) {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.h !== undefined && c.h < 0.35) continue;
      if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  /**
   * Point the camera rig should look at.
   * @param {THREE.Vector3} out - Vector to write into
   * @returns {THREE.Vector3} - out
   */
  lookTarget(out) {
    return out.set(this.pos.x, this.pos.y + 1.35, this.pos.z);
  }
}
