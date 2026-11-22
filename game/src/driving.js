// Turns keyboard input into vehicle controls when the player is driving, and gives the chase
// camera a target. Kept apart from the car physics so the AI can drive with the same Car API.

import * as THREE from 'three';
import { CONFIG } from './config.js';

const C = CONFIG.car;

export class DrivingController {
  constructor(player, input, rig) {
    this.player = player;
    this.input = input;
    this.rig = rig;
    this.hornCooldown = 0;
  }

  /** Reads WASD into the car's throttle/brake/steer. Called each frame while driving. */
  update(dt, onHorn) {
    const car = this.player.inCar;
    if (!car) return null;
    const input = this.input;

    const forward = input.axis('KeyS', 'KeyW');
    const steer = input.axis('KeyA', 'KeyD');

    car.throttle = forward;
    car.brake = input.key('Space') ? 0.15 : 0;
    car.handbrake = input.key('Space');
    // steer eases toward the input so the car does not snap
    const targetSteer = steer;
    car.steer += (targetSteer - car.steer) * Math.min(1, dt * 8);

    if (this.hornCooldown > 0) this.hornCooldown -= dt;
    if (input.hit('KeyF') && this.hornCooldown <= 0) {
      this.hornCooldown = 0.38;
      car.hornTimer = 0.3;
      onHorn?.(car);
    }

    // hand off to the camera: chase behind the car unless the player free-looks
    return car;
  }

  /** Camera focus point + auto-yaw target for the rig. */
  cameraFocus(car, out) {
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const speed01 = Math.min(1, Math.abs(car.speed) / car.maxSpeed);
    return out.set(car.pos.x + fx * 2.2, 1.75, car.pos.z + fz * 2.2);
  }

  autoYaw(car) {
    return car.heading + Math.PI;
  }

  speedFovBoost(car) {
    const s = Math.min(1, Math.abs(car.speed) / car.maxSpeed);
    return s * 12;
  }
}
