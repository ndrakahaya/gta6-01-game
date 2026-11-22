// Tunable constants for the whole game: world scale, physics feel, economy, camera.
// One place to change the numbers every other module reads.

export const CONFIG = {
  // City grid: GRID x GRID blocks, each CELL units wide, road strips between them.
  GRID: 11,
  CELL: 56,
  ROAD_W: 15,
  SIDEWALK: 4.2,

  // Player
  player: {
    walkSpeed: 4.4,
    runSpeed: 9.2,
    sprintSpeed: 13.0,
    accel: 42,
    friction: 12,
    airControl: 0.28,
    jumpSpeed: 7.2,
    gravity: 22,
    radius: 0.55,
    height: 1.85,
    maxHealth: 100,
    regenDelay: 12,
    regenRate: 5,
  },

  // Vehicles
  car: {
    maxSpeed: 34,
    reverseSpeed: 11,
    engineForce: 26,
    brakeForce: 40,
    drag: 0.42,
    rollingResist: 1.4,
    steerRate: 1.9,
    grip: 7.2,
    driftGrip: 2.4,
    handbrakeGrip: 1.1,
    radius: 1.35,
    enterRange: 3.6,
    maxHealth: 100,
  },

  // Camera
  cam: {
    foot: { dist: 6.2, height: 2.5, fov: 62 },
    car: { dist: 9.4, height: 3.9, fov: 68 },
    mouseSens: 0.0023,
    pitchMin: -0.75,
    pitchMax: 0.95,
    lerp: 12,
  },

  // Wanted / police
  wanted: {
    starHeat: [0, 1, 2.6, 4.2, 6.2, 8.6],
    decayPerSec: 0.16,
    decayAfterQuiet: 9,
    copCount: [0, 2, 3, 4, 6, 8],
    copSpeedMul: 1.06,
    bustRange: 3.4,
  },

  // Economy
  cashStart: 350,
  cashPerStarClear: 120,

  // Traffic / pedestrians
  trafficCount: 34,
  pedCount: 46,

  world: {
    fogColor: 0xbfd3e6,
    fogNear: 90,
    fogFar: 330,
    skyTop: 0x2f6fb5,
    skyHorizon: 0xd8e7f2,
    sunDir: [0.42, 0.78, 0.36],
    dayLength: 0, // 0 = static golden-hour daylight
  },

  saveKey: 'puertovela.save.v1',
  settingsKey: 'puertovela.settings.v1',
};

export const WORLD = {
  half: (CONFIG.GRID * CONFIG.CELL) / 2,
  get size() { return CONFIG.GRID * CONFIG.CELL; },
};
