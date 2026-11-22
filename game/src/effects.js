// Visual effects system - manages particles, skid marks, and explosion effects with optimized rendering
// Uses pooled particle system and instanced meshes for performance
// Supports sparks, smoke, blood, muzzle flashes, explosions, and tire skid decals

import * as THREE from 'three';

// ===== EFFECT SYSTEM CONSTANTS =====

/** Maximum number of active particles in the particle system */
const MAX_PARTICLES = 900;
/** Maximum number of skid marks that can be displayed */
const MAX_SKID_MARKS = 260;

/**
 * Visual effects manager for the game
 * Handles all particle effects, skid marks, and explosion visuals with optimized rendering
 */
export class Effects {
  /**
   * Initialize the effects system
   * @param {THREE.Scene} scene - Three.js scene to add effects to
   */
  constructor(scene) {
    this.scene = scene;

    // ===== PARTICLE SYSTEM SETUP =====
    
    // Create particle geometry with attributes for position, color, and size
    const particleGeometry = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(MAX_PARTICLES * 3);
    this.particleColors = new Float32Array(MAX_PARTICLES * 3);
    this.particleSizes = new Float32Array(MAX_PARTICLES);
    
    // Set up geometry attributes
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    particleGeometry.setAttribute('size', new THREE.BufferAttribute(this.particleSizes, 1));
    particleGeometry.setDrawRange(0, 0); // Start with no particles drawn

    // Particle material with additive blending for bright effects
    const particleMaterial = new THREE.PointsMaterial({
      size: 0.42,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,           // Don't write to depth buffer for transparency
      sizeAttenuation: true,       // Particles get smaller with distance
      blending: THREE.AdditiveBlending, // Bright additive blending for glowing effects
    });

    // Create particle system and add to scene
    this.particleSystem = new THREE.Points(particleGeometry, particleMaterial);
    this.particleSystem.frustumCulled = false; // Always update particles for consistent rendering
    scene.add(this.particleSystem);

    // Particle pool for object reuse (performance optimization)
    this.particlePool = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particlePool.push({
        life: 0,                    // Current life remaining
        maxLife: 1,                 // Maximum life span
        velocityX: 0,               // X velocity
        velocityY: 0,               // Y velocity  
        velocityZ: 0,               // Z velocity
        red: 1,                     // Color components
        green: 1,
        blue: 1,
        gravity: 1,                 // Downward acceleration
        drag: 0.6,                  // Air resistance
      });
    }
    this.activeParticles = 0; // Number of currently active particles

    // ===== SKID MARK SYSTEM SETUP =====
    
    // Tire skid marks: flat dark quads laid on road surface
    // Kept short and translucent to avoid overlapping into dense patterns
    const skidGeometry = new THREE.PlaneGeometry(0.22, 0.55).rotateX(-Math.PI / 2);
    const skidMaterial = new THREE.MeshBasicMaterial({
      color: 0x232326,              // Dark gray for tire marks
      transparent: true,             // Allow transparency
      opacity: 0.26,                // Subtle visibility
      depthWrite: false,            // Don't affect depth testing
    });

    // Instanced mesh for efficient skid mark rendering
    this.skidMarks = new THREE.InstancedMesh(skidGeometry, skidMaterial, MAX_SKID_MARKS);
    this.skidMarks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // Optimize for frequent updates
    this.skidMarks.frustumCulled = false; // Always update skid marks
    this.skidMarks.count = 0; // Start with no skid marks
    this.skidMarks.renderOrder = 2; // Render after main scene objects
    scene.add(this.skidMarks);

    this.skidMarkCount = 0;
    
    // Reusable transformation objects to avoid garbage collection
    this.matrix = new THREE.Matrix4();
    this.quaternion = new THREE.Quaternion();
    this.euler = new THREE.Euler();
    this.position = new THREE.Vector3();
    this.scale = new THREE.Vector3(1, 1, 1);

    // ===== EXPLOSION FLASH SETUP =====
    
    // Explosion flash effect: bright expanding sphere (light substitute)
    this.explosionFlash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ 
        color: 0xffcf70,             // Bright orange-yellow
        transparent: true,           // Fade out over time
        opacity: 0,                  // Start invisible
        depthWrite: false,          // Don't affect depth testing
      }),
    );
    this.explosionFlash.visible = false;
    scene.add(this.explosionFlash);
    
    this.flashTimer = 0; // Timer for flash animation
  }

  // ===== PARTICLE EMISSION METHODS =====

  /**
   * Emit a single particle at specified position
   * @param {number} x - X position
   * @param {number} y - Y position  
   * @param {number} z - Z position
   * @param {Object} opts - Particle options
   * @param {number} opts.spread - Random velocity spread (default: 3)
   * @param {number} opts.life - Particle lifetime in seconds (default: 0.6)
   * @param {number} opts.vx - Initial X velocity (default: 0)
   * @param {number} opts.vy - Initial Y velocity (default: 2)
   * @param {number} opts.vz - Initial Z velocity (default: 0)
   * @param {string} opts.color - Particle color in hex format (default: '#ffcc66')
   * @param {number} opts.gravity - Downward acceleration (default: 9)
   * @param {number} opts.drag - Air resistance factor (default: 0.7)
   * @param {number} opts.size - Particle size (default: 0.4)
   */
  emit(x, y, z, opts = {}) {
    if (this.activeParticles >= MAX_PARTICLES) return; // Pool full
    
    const particleIndex = this.activeParticles++;
    const particle = this.particlePool[particleIndex];
    
    // Initialize particle properties
    const spread = opts.spread ?? 3;
    particle.life = particle.maxLife = opts.life ?? 0.6;
    particle.velocityX = (opts.vx ?? 0) + (Math.random() - 0.5) * spread;
    particle.velocityY = (opts.vy ?? 2) + Math.random() * spread * 0.6;
    particle.velocityZ = (opts.vz ?? 0) + (Math.random() - 0.5) * spread;
    
    // Set particle color
    const color = new THREE.Color(opts.color ?? '#ffcc66');
    particle.red = color.r;
    particle.green = color.g;
    particle.blue = color.b;
    
    // Physics properties
    particle.gravity = opts.gravity ?? 9;
    particle.drag = opts.drag ?? 0.7;
    
    // Update geometry attributes
    this.particlePositions[particleIndex * 3] = x;
    this.particlePositions[particleIndex * 3 + 1] = y;
    this.particlePositions[particleIndex * 3 + 2] = z;
    
    this.particleColors[particleIndex * 3] = color.r;
    this.particleColors[particleIndex * 3 + 1] = color.g;
    this.particleColors[particleIndex * 3 + 2] = color.b;
    
    this.particleSizes[particleIndex] = opts.size ?? 0.4;
  }

  /**
   * Emit multiple particles in a burst
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} z - Z position
   * @param {number} count - Number of particles to emit
   * @param {Object} opts - Particle options (passed to emit)
   */
  burst(x, y, z, count, opts) {
    for (let i = 0; i < count; i++) {
      this.emit(x, y, z, opts);
    }
  }

  // ===== PRESET EFFECT METHODS =====

  /**
   * Muzzle flash effect (gunfire)
   * @param {number} x - Muzzle position X
   * @param {number} y - Muzzle position Y
   * @param {number} z - Muzzle position Z
   */
  muzzle(x, y, z) {
    this.burst(x, y, z, 7, { 
      color: '#ffd27a', 
      life: 0.14, 
      spread: 5, 
      velocityY: 1.2, 
      gravity: 2, 
      size: 0.3 
    });
  }

  /**
   * Impact effect (collision debris)
   * @param {number} x - Impact position X
   * @param {number} y - Impact position Y
   * @param {number} z - Impact position Z
   */
  impact(x, y, z) {
    this.burst(x, y, z, 12, { 
      color: '#ffb347', 
      life: 0.4, 
      spread: 6, 
      velocityY: 3, 
      gravity: 12, 
      size: 0.28 
    });
  }

  /**
   * Blood effect (damage impact)
   * @param {number} x - Blood position X
   * @param {number} y - Blood position Y
   * @param {number} z - Blood position Z
   */
  blood(x, y, z) {
    this.burst(x, y, z, 10, { 
      color: '#a01f22', 
      life: 0.5, 
      spread: 3.4, 
      velocityY: 2.2, 
      gravity: 14, 
      size: 0.24 
    });
  }

  /**
   * Dust effect (ground disturbance)
   * @param {number} x - Dust position X
   * @param {number} y - Dust position Y
   * @param {number} z - Dust position Z
   */
  dust(x, y, z) {
    this.burst(x, y, z, 4, { 
      color: '#b9ae96', 
      life: 0.5, 
      spread: 1.6, 
      velocityY: 0.7, 
      gravity: 2, 
      size: 0.34 
    });
  }

  /**
   * Explosion effect with multiple particle types and flash
   * @param {number} x - Explosion center X
   * @param {number} y - Explosion center Y
   * @param {number} z - Explosion center Z
   */
  explode(x, y, z) {
    // Primary explosion particles (bright, fast, rising)
    this.burst(x, y, z, 60, { 
      color: '#ff8a2b', 
      life: 0.9, 
      spread: 13, 
      velocityY: 7, 
      gravity: 7, 
      size: 0.75 
    });
    
    // Smoke particles (dark, slow, lingering)
    this.burst(x, y, z, 34, { 
      color: '#4a4a4a', 
      life: 1.7, 
      spread: 7, 
      velocityY: 5, 
      gravity: -1.4, // Slight upward drift for smoke
      size: 1.0 
    });
    
    // Secondary flash particles (bright sparks)
    this.burst(x, y, z, 22, { 
      color: '#ffe9a8', 
      life: 0.35, 
      spread: 18, 
      velocityY: 4, 
      gravity: 10, 
      size: 0.5 
    });
    
    // Explosion flash effect
    this.explosionFlash.position.set(x, y + 0.6, z);
    this.explosionFlash.visible = true;
    this.flashTimer = 0.42; // Flash duration
  }

  // ===== SKID MARK METHODS =====

  /**
   * Add tire skid mark at position
   * @param {number} x - Skid mark X position
   * @param {number} z - Skid mark Z position
   * @param {number} heading - Vehicle heading in radians
   */
  skid(x, z, heading) {
    if (this.skidMarkCount >= MAX_SKID_MARKS) {
      // Ring buffer: overwrite oldest mark when pool is full
      this.skidMarkCount = 0;
    }
    
    const skidIndex = this.skidMarkCount++;
    
    // Set up transformation for skid mark orientation
    this.euler.set(0, heading, 0); // Rotation around Y axis
    this.quaternion.setFromEuler(this.euler);
    this.position.set(x, 0.045, z); // Slightly above ground
    
    // Compose matrix and set instance data
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.skidMarks.setMatrixAt(skidIndex, this.matrix);
    
    // Update instance count and mark matrix for update
    this.skidMarks.count = this.skidMarkCount;
    this.skidMarks.instanceMatrix.needsUpdate = true;
  }

  // ===== UPDATE METHOD =====

  /**
   * Update all effects and animations
   * @param {number} dt - Delta time since last update
   */
  update(dt) {
    // ===== UPDATE PARTICLES =====
    
    let activeCount = 0;
    
    // Update each particle and compact live particles to front of array
    for (let i = 0; i < this.activeParticles; i++) {
      const particle = this.particlePool[i];
      
      // Decrease particle life
      particle.life -= dt;
      if (particle.life <= 0) continue; // Skip dead particles
      
      // Update particle physics
      const newX = this.particlePositions[i * 3] + particle.velocityX * dt;
      const newY = this.particlePositions[i * 3 + 1] + particle.velocityY * dt;
      const newZ = this.particlePositions[i * 3 + 2] + particle.velocityZ * dt;
      
      // Apply gravity and drag
      particle.velocityY -= particle.gravity * dt;
      const dragFactor = Math.max(0, 1 - particle.drag * dt);
      particle.velocityX *= dragFactor;
      particle.velocityZ *= dragFactor;
      
      // Calculate fade factor based on remaining life
      const fadeFactor = particle.life / particle.maxLife;
      
      // Move active particle to front of array and update its data
      this.particlePositions[activeCount * 3] = newX;
      this.particlePositions[activeCount * 3 + 1] = Math.max(0.04, newY); // Keep above ground
      this.particlePositions[activeCount * 3 + 2] = newZ;
      
      // Fade colors
      this.particleColors[activeCount * 3] = particle.red * fadeFactor;
      this.particleColors[activeCount * 3 + 1] = particle.green * fadeFactor;
      this.particleColors[activeCount * 3 + 2] = particle.blue * fadeFactor;
      
      this.particleSizes[activeCount] = particle.maxLife;
      
      // Move particle data to active position if needed
      if (activeCount !== i) {
        this.particlePool[activeCount] = particle;
      }
      
      activeCount++;
    }
    
    // Update particle system
    this.activeParticles = activeCount;
    this.particleSystem.geometry.setDrawRange(0, activeCount);
    this.particleSystem.geometry.attributes.position.needsUpdate = true;
    this.particleSystem.geometry.attributes.color.needsUpdate = true;

    // ===== UPDATE EXPLOSION FLASH =====
    
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      
      // Calculate flash progress (1.0 = full brightness, 0.0 = invisible)
      const flashProgress = Math.max(0, this.flashTimer / 0.42);
      
      // Expand flash sphere and fade out
      this.explosionFlash.scale.setScalar(1 + (1 - flashProgress) * 7); // Expand up to 8x size
      this.explosionFlash.material.opacity = flashProgress * 0.85; // Fade to 85% opacity
      
      // Hide flash when animation complete
      if (this.flashTimer <= 0) {
        this.explosionFlash.visible = false;
      }
    }
  }
}