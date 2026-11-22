// Player on foot: camera-relative WASD movement, gravity, jump, cylinder-vs-box collision
// against the city, and the state combat needs (health, aiming, punch cooldown, weapon).

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildCharacter, animateCharacter, buildPistol, buildBlobShadow } from './character.js';

const P = CONFIG.player;

export class Player {
  constructor(scene, rng) {
    const { root, parts } = buildCharacter(rng, {
      shirt: '#1d2b3a', pants: '#2a2f38', skin: '#c98f6b', hair: '#171a1f', build: 1.0,
    });
    this.mesh = root;
    this.parts = parts;
    this.mesh.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
    scene.add(this.mesh);

    this.shadow = buildBlobShadow(0.62, 0.36);
    scene.add(this.shadow);

    this.pistol = buildPistol();
    this.pistol.visible = false;
    this.parts.foreR.add(this.pistol);

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
    this.punchT = 0;
    this.inCar = null;
    this.dead = false;
    this.hurtTimer = 0;
    this.lastDamageAt = -999;
    this.regenAccum = 0;
    this.stamina = 1;
    this.footstepAccum = 0;
    this.onFootstep = null;
  }

  get eyeY() { return 1.68; }

  /** main.js hands the app object over so combat can reach pedestrians, effects and audio. */
  bindApp(app) {
    this.app = app;
  }

  setPos(x, z) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
  }

  setWeapon(kind) {
    this.weapon = kind;
    const armed = kind !== 'fists';
    this.pistol.visible = kind === 'pistol' || kind === 'smg';
  }

  ammoFor(kind) {
    if (kind === 'fists') return Infinity;
    return this.ammo[kind] ?? 0;
  }

  /** Facing direction on the ground plane, with a little spread — used for bullets and muzzle FX. */
  aimDir() {
    const f = this.facing;
    const v = new THREE.Vector3(Math.sin(f), 0, Math.cos(f));
    const s = 0.04;
    v.x += (Math.random() - 0.5) * s;
    v.z += (Math.random() - 0.5) * s;
    return v.normalize();
  }

  /** Called by combat; returns true when a round was actually spent. */
  consumeAmmo() {
    if (this.weapon === 'fists') return true;
    if ((this.ammo[this.weapon] ?? 0) <= 0) {
      const res = this.reserve[this.weapon] ?? 0;
      if (res <= 0) return false;
      const magSize = this.weapon === 'pistol' ? 12 : 30;
      const take = Math.min(magSize, res);
      this.ammo[this.weapon] = take;
      this.reserve[this.weapon] = res - take;
    }
    this.ammo[this.weapon] -= 1;
    return true;
  }

  damage(amount, fromPos) {
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

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /**
   * Movement + collisions. `cameraYaw` makes WASD camera-relative like every third-person
   * game; `colliders` is the city's box list.
   */
  update(dt, input, cameraYaw, colliders, opts = {}) {
    if (this.dead) {
      animateCharacter(this.parts, 0, 0, { crouch: true });
      this.mesh.rotation.z = -Math.PI / 2;
      this.mesh.position.set(this.pos.x, 0.3, this.pos.z);
      this.shadow.position.set(this.pos.x, 0.03, this.pos.z);
      return;
    }
    this.mesh.rotation.z = 0;

    if (this.hurtTimer > 0) this.hurtTimer -= dt;

    // health regen after a quiet window
    const now = performance.now() / 1000;
    if (now - this.lastDamageAt > P.regenDelay && this.health < this.maxHealth) {
      this.regenAccum += dt * P.regenRate;
      if (this.regenAccum >= 1) {
        const whole = Math.floor(this.regenAccum);
        this.health = Math.min(this.maxHealth, this.health + whole);
        this.regenAccum -= whole;
      }
    }

    // combat: punch or shoot
    const A = this.app;
    if (A && input.hit('Mouse0')) {
      if (this.weapon === 'fists') {
        this.punchT = 0.3;
        A.audio?.punch();
        const target = A.pedestrians?.nearest(this.pos, 2.6);
        if (target && !target.dead) {
          const died = target.hit(18, this.pos.x, this.pos.z);
          A.effects?.blood(target.pos.x, 0.5, target.pos.z);
          if (died) A.missions?.noteKill();
          A.wanted?.add(0.5, 'assault');
        }
      } else if (this.consumeAmmo()) {
        A.audio?.shot(0.9);
        const dir = this.aimDir();
        A.effects?.muzzle(this.pos.x + dir.x * 0.6, 1.25, this.pos.z + dir.z * 0.6);
        A.rig?.addShake(0.06);
        const target = A.pedestrians?.nearest(this.pos, 32);
        if (target && !target.dead) {
          const dmg = this.weapon === 'pistol' ? 34 : 20;
          const died = target.hit(dmg, this.pos.x, this.pos.z);
          A.effects?.blood(target.pos.x, 0.9, target.pos.z);
          if (died) A.missions?.noteKill();
        }
        A.pedestrians?.panic(this.pos.x, this.pos.z, 30);
        A.wanted?.add(this.weapon === 'pistol' ? 0.9 : 1.3, 'shooting');
      } else {
        A.audio?.blip(180, 0.06, 'square', 0.08);
      }
    }

    const sprinting = input.key('ShiftLeft') && this.stamina > 0.05 && !this.aiming;
    const forward = input.axis('KeyS', 'KeyW');
    const strafe = input.axis('KeyA', 'KeyD');
    const hasInput = forward !== 0 || strafe !== 0;

    let speed = sprinting ? P.sprintSpeed : (input.key('ControlLeft') ? P.walkSpeed : P.runSpeed);
    if (this.aiming) speed = Math.min(speed, 3.6);
    if (opts.speedMul) speed *= opts.speedMul;

    // stamina drains while sprinting, refills otherwise
    if (sprinting && hasInput) this.stamina = Math.max(0, this.stamina - dt * 0.24);
    else this.stamina = Math.min(1, this.stamina + dt * 0.3);

    // desired direction in world space from camera yaw
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    let dx = 0;
    let dz = 0;
    if (hasInput) {
      // camera looks along -Z rotated by yaw
      const fx = -sin;
      const fz = -cos;
      const rx = cos;
      const rz = -sin;
      dx = fx * forward + rx * strafe;
      dz = fz * forward + rz * strafe;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
    }

    const control = this.grounded ? 1 : P.airControl;
    const targetVX = dx * speed;
    const targetVZ = dz * speed;
    const a = P.accel * control * (hasInput ? 1 : 0.001);
    this.vel.x += (targetVX - this.vel.x) * Math.min(1, a * dt / Math.max(speed, 1) * 3);
    this.vel.z += (targetVZ - this.vel.z) * Math.min(1, a * dt / Math.max(speed, 1) * 3);

    if (!hasInput) {
      const f = P.friction * dt;
      this.vel.x -= this.vel.x * Math.min(1, f);
      this.vel.z -= this.vel.z * Math.min(1, f);
    }

    // gravity + jump
    this.vel.y -= P.gravity * dt;
    if (input.hit('Space') && this.grounded) {
      this.vel.y = P.jumpSpeed;
      this.grounded = false;
    }

    // integrate with axis-separated collision resolution so sliding along walls works
    const r = P.radius;
    let nx = this.pos.x + this.vel.x * dt;
    if (!this.collides(nx, this.pos.z, r, colliders)) this.pos.x = nx;
    else this.vel.x *= -0.12;

    let nz = this.pos.z + this.vel.z * dt;
    if (!this.collides(this.pos.x, nz, r, colliders)) this.pos.z = nz;
    else this.vel.z *= -0.12;

    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      if (!this.grounded && this.vel.y < -9) this.onLand?.(-this.vel.y);
      this.pos.y = 0;
      this.vel.y = 0;
      this.grounded = true;
    }

    // keep inside the map
    const lim = opts.limit ?? 640;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));

    // facing: movement direction, or camera direction while aiming
    const planarSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.aiming) {
      this.facing = cameraYaw + Math.PI;
    } else if (planarSpeed > 0.6) {
      const target = Math.atan2(this.vel.x, this.vel.z);
      let diff = target - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * Math.min(1, dt * 14);
    }

    // animation
    this.speed01 = planarSpeed / P.sprintSpeed;
    this.phase += planarSpeed * dt * (sprinting ? 2.0 : 2.4);
    if (this.punchT > 0) this.punchT = Math.max(0, this.punchT - dt * 3.4);
    animateCharacter(this.parts, this.phase, Math.min(1, planarSpeed / P.runSpeed), {
      aiming: this.aiming && this.grounded,
      punch: this.punchT > 0 ? 1 - this.punchT : 0,
      run: sprinting,
    });

    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.mesh.rotation.y = this.facing;
    this.shadow.position.set(this.pos.x, 0.03 + this.pos.y * 0.02, this.pos.z);
    const sc = this.grounded ? 1 : Math.max(0.55, 1 - this.pos.y * 0.25);
    this.shadow.scale.setScalar(sc);

    // footsteps drive sound + dust
    if (this.grounded && planarSpeed > 1.4) {
      this.footstepAccum += planarSpeed * dt;
      if (this.footstepAccum > (sprinting ? 1.5 : 1.9)) {
        this.footstepAccum = 0;
        this.onFootstep?.(sprinting);
      }
    }
  }

  /** Cylinder vs. all building boxes, resolved as an AABB test with a small skin. */
  collides(x, z, r, colliders) {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.h !== undefined && c.h < 0.35) continue;
      if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  /** Point the camera rig should look at. */
  lookTarget(out) {
    return out.set(this.pos.x, this.pos.y + 1.35, this.pos.z);
  }
}
