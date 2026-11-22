// Vehicle driving controller - converts keyboard input to vehicle controls and manages chase camera
// Separates input handling from physics so AI can use the same Car API
// Handles steering, throttle, braking, handbrake, and horn functionality
//
// This module deliberately imports nothing: every vector it needs is supplied by the caller
// (the CameraRig owns the reusable focus vector), so a frame of driving allocates nothing.

/**
 * Driving controller for player-controlled vehicles
 * Manages input-to-control conversion and camera targeting for chase sequences
 */
export class DrivingController {
  /**
   * Initialize driving controller
   * @param {Object} player - Player object reference
   * @param {Object} input - Input system reference
   * @param {Object} rig - Camera rig reference
   */
  constructor(player, input, rig) {
    this.player = player;
    this.input = input;
    this.cameraRig = rig;
    this.hornCooldown = 0; // Time before horn can be used again
  }

  /**
   * Update vehicle controls based on keyboard input
   * Called each frame while player is driving a vehicle
   * @param {number} dt - Delta time since last update
   * @param {Function} onHorn - Callback function when horn is activated
   * @returns {Object|null} - Vehicle object for camera targeting, or null if not driving
   */
  update(dt, onHorn) {
    const vehicle = this.player.inCar;
    if (!vehicle) return null;

    // Get input values with axis support for smooth control
    const forwardInput = this.input.axis('KeyS', 'KeyW'); // Negative for reverse, positive for forward
    const steeringInput = this.input.axis('KeyA', 'KeyD'); // Negative for left, positive for right

    // Apply vehicle controls
    vehicle.throttle = forwardInput;
    vehicle.brake = this.input.key('Space') ? 0.15 : 0;
    vehicle.handbrake = this.input.key('Space');

    // Smooth steering response to prevent sudden direction changes
    const targetSteering = steeringInput;
    vehicle.steer += (targetSteering - vehicle.steer) * Math.min(1, dt * 8);

    // Horn activation with cooldown
    if (this.hornCooldown > 0) {
      this.hornCooldown -= dt;
    }

    if (this.input.hit('KeyF') && this.hornCooldown <= 0) {
      this.hornCooldown = 0.38; // Horn cooldown duration
      vehicle.hornTimer = 0.3; // Horn sound duration
      onHorn?.(vehicle); // Trigger horn sound callback
    }

    // Return vehicle for camera targeting
    return vehicle;
  }

  /**
   * Calculate camera focus point for chase camera
   * Provides a target point behind the vehicle for dynamic camera positioning
   * @param {Object} car - Vehicle object
   * @param {THREE.Vector3} out - Vector to store result
   * @returns {THREE.Vector3} - Camera focus position
   */
  cameraFocus(car, out) {
    // Calculate forward direction from vehicle heading
    const forwardX = Math.sin(car.heading);
    const forwardZ = Math.cos(car.heading);

    // Calculate speed ratio for dynamic positioning
    const speedRatio = Math.min(1, Math.abs(car.speed) / car.maxSpeed);

    // Focus point is behind the vehicle, distance varies with speed
    // Higher speed = camera follows further behind for better chase view
    const followDistance = 2.2 + speedRatio * 1.5; // Distance between 2.2 and 3.7 units

    return out.set(
      car.pos.x + forwardX * followDistance,
      1.75, // Fixed height for good chase view
      car.pos.z + forwardZ * followDistance
    );
  }

  /**
   * Calculate auto-yaw angle for camera behind vehicle
   * Provides ideal camera rotation when not manually controlled
   * @param {Object} car - Vehicle object
   * @returns {number} - Yaw angle in radians
   */
  autoYaw(car) {
    // Camera should point opposite to vehicle movement direction
    return car.heading + Math.PI;
  }

  /**
   * Calculate field of view boost based on vehicle speed
   * Increases FOV during high-speed chases for more dynamic feel
   * @param {Object} car - Vehicle object
   * @returns {number} - FOV boost in degrees
   */
  speedFovBoost(car) {
    const speedRatio = Math.min(1, Math.abs(car.speed) / car.maxSpeed);
    return speedRatio * 12; // Maximum 12-degree FOV boost at top speed
  }
}