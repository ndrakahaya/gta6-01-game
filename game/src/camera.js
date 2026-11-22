// Third-person camera system with collision detection, smooth following, and dynamic modes
// Prevents camera clipping through buildings using sphere-casting algorithm
// Supports both on-foot and vehicle chase cameras with smooth transitions

import * as THREE from 'three';
import { CONFIG } from './config.js';

// Camera configuration constants (shorthand for easier access)
const C = CONFIG.cam;

export class CameraRig {
  /**
   * Initialize camera rig
   * @param {THREE.Camera} camera - Three.js camera to control
   * @param {HTMLElement} dom - DOM element for mouse input
   */
  constructor(camera, dom) {
    // Core camera references
    this.camera = camera;
    this.dom = dom;
    
    // Camera orientation (in radians)
    this.yaw = Math.PI * 0.25;        // Horizontal rotation (left/right)
    this.pitch = -0.14;               // Vertical rotation (up/down)
    
    // Distance controls
    this.dist = C.foot.dist;         // Current distance from target
    this.targetDist = C.foot.dist;    // Target distance (for smooth transitions)
    
    // Position and look-at targets
    this.current = new THREE.Vector3(0, 6, 10);      // Current camera position
    this.look = new THREE.Vector3(0, 1.4, 0);        // Target look-at position
    this.smoothLook = new THREE.Vector3(0, 1.4, 0);  // Smoothed look-at position
    
    // Camera effects
    this.shake = 0;                   // Screen shake intensity
    this.mode = 'foot';               // Current camera mode ('foot' or 'car')
    this.baseFov = C.foot.fov;       // Base field of view
    
    // Temporary vectors for calculations (reused to avoid garbage collection)
    this.camPos = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._lookTmp = new THREE.Vector3();
  }

  /**
   * Switch camera mode between on-foot and vehicle chase
   * @param {string} mode - Camera mode ('foot' or 'car')
   */
  setMode(mode) {
    this.mode = mode;
    this.targetDist = mode === 'car' ? C.car.dist : C.foot.dist;
    this.baseFov = mode === 'car' ? C.car.fov : C.foot.fov;
  }

  /**
   * Add screen shake effect
   * @param {number} amount - Shake intensity (clamped to maximum)
   */
  addShake(amount) {
    this.shake = Math.min(1.1, this.shake + amount);
  }

  /**
   * Handle mouse input for camera control
   * @param {Object} input - Input state object with mouseDX, mouseDY, and locked properties
   */
  handleMouse(input) {
    if (!input.locked) return;
    
    // Update camera rotation based on mouse movement
    this.yaw -= input.mouseDX * C.mouseSens;
    this.pitch -= input.mouseDY * C.mouseSens;
    
    // Clamp pitch to prevent camera flipping
    this.pitch = Math.max(C.pitchMin, Math.min(C.pitchMax, this.pitch));
  }

  /**
   * Sphere-cast collision detection to prevent camera clipping through geometry
   * Casts a sphere from the ideal camera position back toward the target until it finds a clear position
   * @param {THREE.Vector3} targetPos - Target position (player/vehicle)
   * @param {THREE.Vector3} idealPos - Ideal camera position (may be clipped)
   * @param {Array} colliders - Array of collision objects with minX, maxX, minZ, maxZ, h (height)
   * @returns {THREE.Vector3} - Clear camera position that doesn't intersect with geometry
   */
  resolveCollision(targetPos, idealPos, colliders) {
    const direction = this._tmp.copy(idealPos).sub(targetPos);
    const distance = direction.length();
    
    // If too close to target, return ideal position
    if (distance < 0.001) return idealPos;
    
    direction.normalize();
    
    let allowedDistance = distance;
    const stepSize = 0.7;           // Step size for collision checking
    const cameraRadius = 0.55;      // Camera collision radius
    
    // Check collision points along the camera ray
    for (let checkDistance = 0.8; checkDistance <= distance; checkDistance += stepSize) {
      const checkX = targetPos.x + direction.x * checkDistance;
      const checkY = targetPos.y + direction.y * checkDistance;
      const checkZ = targetPos.z + direction.z * checkDistance;
      
      // Skip points above maximum building height
      if (checkY > 26) continue;
      
      let isBlocked = false;
      
      // Check against all colliders
      for (let i = 0; i < colliders.length; i++) {
        const collider = colliders[i];
        
        // Check if point is within collider's XZ bounds
        if (checkX + cameraRadius > collider.minX && 
            checkX - cameraRadius < collider.maxX &&
            checkZ + cameraRadius > collider.minZ && 
            checkZ - cameraRadius < collider.maxZ) {
          
          // Check if point is below collider height plus buffer
          const colliderHeight = collider.h ?? 8; // Default height if not specified
          if (checkY < colliderHeight + 0.4) {
            isBlocked = true;
            break;
          }
        }
      }
      
      if (isBlocked) {
        allowedDistance = Math.max(1.2, checkDistance - stepSize);
        break;
      }
    }
    
    // Return the cleared position
    return idealPos.copy(targetPos).addScaledVector(direction, allowedDistance);
  }

  /**
   * Update camera position and orientation
   * @param {number} dt - Delta time since last update
   * @param {THREE.Vector3} focus - Target position to follow (player/vehicle)
   * @param {Array} colliders - Collision objects for camera clipping prevention
   * @param {Object} opts - Optional configuration
   * @param {number} opts.autoYaw - Auto-align yaw angle (for vehicle mode)
   * @param {boolean} opts.mouseActive - Whether mouse was recently moved
   * @param {number} opts.speedFov - Additional FOV based on speed
   * @param {THREE.Object3D} opts.sky - Sky dome object to center on camera
   */
  update(dt, focus, colliders, opts = {}) {
    // Smooth distance transition
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 6);

    // Auto-align camera behind vehicle when in car mode
    if (opts.autoYaw !== undefined && this.mode === 'car') {
      let yawDifference = opts.autoYaw - this.yaw;
      
      // Normalize angle difference to [-π, π] range
      while (yawDifference > Math.PI) yawDifference -= Math.PI * 2;
      while (yawDifference < -Math.PI) yawDifference += Math.PI * 2;
      
      // Alignment rate depends on whether player is actively steering
      const alignmentRate = opts.mouseActive ? 0.5 : 3.4;
      this.yaw += yawDifference * Math.min(1, dt * alignmentRate);
    }

    const targetX = focus.x;
    const targetY = focus.y;
    const targetZ = focus.z;

    // Update look-at target with smoothing
    this.look.set(targetX, targetY, targetZ);
    this.smoothLook.lerp(this.look, Math.min(1, dt * 16));

    // Calculate ideal camera position using spherical coordinates
    const cosPitch = Math.cos(this.pitch);
    const idealPosition = new THREE.Vector3(
      targetX + Math.sin(this.yaw) * cosPitch * this.dist,
      targetY + this.dist * -Math.sin(this.pitch) + 0.9,
      targetZ + Math.cos(this.yaw) * cosPitch * this.dist,
    );
    
    // Prevent camera from going below target height
    if (idealPosition.y < targetY - 0.5) {
      idealPosition.y = targetY - 0.5;
    }

    // Resolve camera collision with environment
    this.resolveCollision(this.smoothLook, idealPosition, colliders);

    // Smooth camera follow with different rates for foot/car modes
    const followRate = this.mode === 'car' ? Math.min(1, dt * 9) : Math.min(1, dt * 11);
    this.camera.position.lerp(idealPosition, followRate);

    // Apply screen shake effect if active
    if (this.shake > 0.001) {
      const shakeIntensity = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * shakeIntensity * 0.6;
      this.camera.position.y += (Math.random() - 0.5) * shakeIntensity * 0.6;
      this.camera.position.z += (Math.random() - 0.5) * shakeIntensity * 0.6;
      
      // Decay shake effect
      this.shake *= 0.86;
      if (this.shake < 0.002) this.shake = 0;
    }

    // Make camera look at smoothed target
    this.camera.lookAt(this.smoothLook);

    // Update field of view with speed-based adjustments
    const speedBasedFov = opts.speedFov ?? 0;
    const targetFov = this.baseFov + speedBasedFov;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();

    // Center sky dome on camera position (if provided)
    if (opts.sky) {
      opts.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    }
  }

  /**
   * Get forward vector on horizontal plane (for aiming and vehicle steering)
   * @param {THREE.Vector3} out - Vector to store result (reused for performance)
   * @returns {THREE.Vector3} - Forward direction vector (normalized)
   */
  forward(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /**
   * Get right vector on horizontal plane
   * @param {THREE.Vector3} out - Vector to store result (reused for performance)
   * @returns {THREE.Vector3} - Right direction vector (normalized)
   */
  right(out) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
}