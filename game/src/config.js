// Game configuration constants - centralized tuning for all game systems
// All values tuned for optimal playfeel and visual balance in Puerto Vela

export const CONFIG = {
  // ===== WORLD DIMENSIONS =====
  // City layout: GRID x GRID grid system, with CELL-sized blocks
  GRID: 11,              // City grid dimensions (11x11 blocks)
  CELL: 56,              // Size of each city block in units
  ROAD_W: 15,            // Road width between blocks
  SIDEWALK: 4.2,         // Sidewalk width on each side of roads

  // ===== PLAYER CHARACTER =====
  player: {
    // Movement speeds (units/second)
    walkSpeed: 4.4,      // Normal walking pace
    runSpeed: 9.2,       // Jogging speed
    sprintSpeed: 13.0,   // Maximum sprint speed
    
    // Physics constants
    accel: 42,           // Acceleration rate (how quickly player reaches max speed)
    friction: 12,        // Ground friction (how quickly player slows down)
    airControl: 0.28,    // Airborne maneuverability (0-1, higher = more control)
    jumpSpeed: 7.2,      // Initial jump velocity
    gravity: 22,         // Downward acceleration force
    
    // Collision and health
    radius: 0.55,        // Player collision radius
    height: 1.85,        // Player height for collision detection
    maxHealth: 100,      // Maximum hit points
    regenDelay: 12,      // Seconds before health regeneration starts
    regenRate: 5,        // HP per second when regenerating
  },

  // ===== VEHICLE PHYSICS =====
  car: {
    // Speed limits (units/second)
    maxSpeed: 34,        // Top speed for most vehicles
    reverseSpeed: 11,    // Maximum reverse speed
    
    // Engine and braking forces
    engineForce: 26,     // Acceleration power (higher = faster acceleration)
    brakeForce: 40,      // Braking power (higher = stronger brakes)
    
    // Physics constants
    drag: 0.42,          // Air resistance (0-1, higher = more drag)
    rollingResist: 1.4,  // Rolling resistance on wheels
    steerRate: 1.9,      // Steering responsiveness (higher = sharper turns)
    grip: 7.2,           // Normal tire grip for cornering
    driftGrip: 2.4,      // Reduced grip during drifts
    handbrakeGrip: 1.1,  // Extra grip when handbrake is applied
    
    // Interaction and collision
    radius: 1.35,        // Vehicle collision radius
    enterRange: 3.6,     // Distance to enter/exit vehicle
    maxHealth: 100,      // Vehicle durability
  },

  // ===== CAMERA SYSTEM =====
  cam: {
    // Camera presets for different game states
    foot: {              // On-foot camera
      dist: 6.2,        // Distance behind player
      height: 2.5,      // Height above ground
      fov: 62,          // Field of view in degrees
    },
    car: {               // Driving camera
      dist: 9.4,        // Distance behind vehicle
      height: 3.9,      // Height above ground
      fov: 68,          // Slightly wider FOV for driving
    },
    
    // Camera controls
    mouseSens: 0.0023,  // Mouse sensitivity for camera control
    pitchMin: -0.75,     // Minimum camera pitch angle (radians)
    pitchMax: 0.95,     // Maximum camera pitch angle
    lerp: 12,           // Camera smoothing factor (higher = smoother but slower)
  },

  // ===== LAW ENFORCEMENT SYSTEM =====
  wanted: {
    // Heat level thresholds for each wanted star (0-5 stars)
    starHeat: [0, 1, 2.6, 4.2, 6.2, 8.6],
    
    // Heat decay mechanics
    decayPerSec: 0.16,  // Heat reduction per second when not wanted
    decayAfterQuiet: 9, // Seconds of no activity before heat decays faster
    
    // Police response
    copCount: [0, 2, 3, 4, 6, 8],      // Number of responding officers per star level
    copSpeedMul: 1.06,                  // Police speed multiplier relative to player
    bustRange: 3.4,                     // Distance at which police can arrest player
  },

  // ===== ECONOMY SYSTEM =====
  cashStart: 350,       // Starting money for new players
  cashPerStarClear: 120, // Reward for successfully evading police wanted level

  // ===== POPULATION DENSITY =====
  trafficCount: 34,     // Number of AI vehicles in the city
  pedCount: 46,         // Number of pedestrians in the city

  // ===== WORLD ATMOSPHERE =====
  world: {
    // Fog and atmosphere
    fogColor: 0xbfd3e6,  // Light blue-gray fog color
    fogNear: 90,         // Distance where fog becomes visible
    fogFar: 330,         // Distance where fog is fully opaque
    
    // Sky gradient
    skyTop: 0x2f6fb5,    // Deep blue at zenith
    skyHorizon: 0xd8e7f2, // Light blue at horizon
    
    // Lighting
    sunDir: [0.42, 0.78, 0.36], // Sun direction vector (normalized)
    dayLength: 0,        // 0 = static golden-hour lighting (no time progression)
  },

  // ===== PERSISTENCE =====
  saveKey: 'puertovela.save.v1',      // LocalStorage key for game saves
  settingsKey: 'puertovela.settings.v1', // LocalStorage key for player settings
};

// ===== DERIVED WORLD CONSTANTS =====
// Calculated from grid dimensions - no need to modify these
export const WORLD = {
  half: (CONFIG.GRID * CONFIG.CELL) / 2,  // Half the world size (center point)
  get size() { return CONFIG.GRID * CONFIG.CELL; },  // Full world size in units
};