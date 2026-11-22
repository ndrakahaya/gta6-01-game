// Third-person camera: orbit yaw/pitch from the mouse, sphere-cast against buildings so the
// camera never clips through walls, smooth follow, and a snap mode for the vehicle chase view.

import * as THREE from 'three';
import { CONFIG } from './config.js';

const C = CONFIG.cam;

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.yaw = Math.PI * 0.25;
    this.pitch = -0.14;
    this.dist = C.foot.dist;
    this.targetDist = C.foot.dist;
    this.current = new THREE.Vector3(0, 6, 10);
    this.look = new THREE.Vector3(0, 1.4, 0);
    this.smoothLook = new THREE.Vector3(0, 1.4, 0);
    this.shake = 0;
    this.mode = 'foot';
    this.baseFov = C.foot.fov;
    this.camPos = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._lookTmp = new THREE.Vector3();
  }

  setMode(mode) {
    this.mode = mode;
    this.targetDist = mode === 'car' ? C.car.dist : C.foot.dist;
    this.baseFov = mode === 'car' ? C.car.fov : C.foot.fov;
  }

  addShake(amount) {
    this.shake = Math.min(1.1, this.shake + amount);
  }

  handleMouse(input) {
    if (!input.locked) return;
    this.yaw -= input.mouseDX * C.mouseSens;
    this.pitch -= input.mouseDY * C.mouseSens;
    this.pitch = Math.max(C.pitchMin, Math.min(C.pitchMax, this.pitch));
  }

  /** Sphere-cast the ideal camera position back toward the target until it clears geometry. */
  resolveCollision(targetPos, idealPos, colliders) {
    const dir = this._tmp.copy(idealPos).sub(targetPos);
    const dist = dir.length();
    if (dist < 0.001) return idealPos;
    dir.divideScalar(dist);
    let allowed = dist;
    const step = 0.7;
    const r = 0.55;
    for (let d = 0.8; d <= dist; d += step) {
      const px = targetPos.x + dir.x * d;
      const py = targetPos.y + dir.y * d;
      const pz = targetPos.z + dir.z * d;
      if (py > 26) continue;
      let blocked = false;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        if (px + r > c.minX && px - r < c.maxX && pz + r > c.minZ && pz - r < c.maxZ) {
          if (py < (c.h ?? 8) + 0.4) { blocked = true; break; }
        }
      }
      if (blocked) { allowed = Math.max(1.2, d - step); break; }
    }
    return idealPos.copy(targetPos).addScaledVector(dir, allowed);
  }

  update(dt, focus, colliders, opts = {}) {
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 6);

    // Auto-align behind the car when driving, unless the player has just moved the mouse.
    if (opts.autoYaw !== undefined && this.mode === 'car') {
      let diff = opts.autoYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const rate = opts.mouseActive ? 0.5 : 3.4;
      this.yaw += diff * Math.min(1, dt * rate);
    }

    const tx = focus.x;
    const ty = focus.y;
    const tz = focus.z;

    this.look.set(tx, ty, tz);
    this.smoothLook.lerp(this.look, Math.min(1, dt * 16));

    const cosP = Math.cos(this.pitch);
    const ideal = new THREE.Vector3(
      tx + Math.sin(this.yaw) * cosP * this.dist,
      ty + this.dist * -Math.sin(this.pitch) + 0.9,
      tz + Math.cos(this.yaw) * cosP * this.dist,
    );
    if (ideal.y < ty - 0.5) ideal.y = ty - 0.5;

    this.resolveCollision(this.smoothLook, ideal, colliders);

    const follow = this.mode === 'car' ? Math.min(1, dt * 9) : Math.min(1, dt * 11);
    this.camera.position.lerp(ideal, follow);

    if (this.shake > 0.001) {
      const s = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * s * 0.6;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.6;
      this.camera.position.z += (Math.random() - 0.5) * s * 0.6;
      this.shake *= 0.86;
      if (this.shake < 0.002) this.shake = 0;
    }

    this.camera.lookAt(this.smoothLook);

    const speedFov = opts.speedFov ?? 0;
    const targetFov = this.baseFov + speedFov;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();

    // keep the sky dome centred on the viewer
    if (opts.sky) {
      opts.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    }
  }

  /** Forward vector on the horizontal plane, used for aiming and car steering. */
  forward(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right(out) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
}
