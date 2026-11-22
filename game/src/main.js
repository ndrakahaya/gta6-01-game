// Entry point: renderer, city, player, vehicles and the simulation loop.
// Owns the title screen, the pause menu, saving and the story missions. Every other system
// attaches itself to `app`, which is also exposed on window for the screenshot harness.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeRng } from './rng.js';
import { buildSky } from './sky.js';
import { buildCity } from './city.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { Player } from './player.js';
import { VehicleManager } from './vehicles.js';
import { DrivingController } from './driving.js';
import { PedestrianManager } from './pedestrians.js';
import { TrafficManager } from './traffic.js';
import { WantedSystem } from './police.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { MissionManager } from './missions.js';
import { Hud } from './hud.js';
import { hasSave, writeSave, applySave, describeSave, clearSave } from './save.js';

// ===== CONSTANTS =====

// Seeds. The city seed is fixed so the skyline is identical on every load (screenshots and the
// two-run dossier diff both depend on that); the gameplay RNG is separate so spawn variation
// can change without altering the city.
const CITY_SEED = 20261117;
const GAMEPLAY_SEED = 9001;

const MAX_DT = 0.05;                 // clamp long frames so physics never explodes after a stall
const FPS_SAMPLE_WINDOW = 0.5;       // seconds between FPS readouts
const PIXEL_RATIO_CAP = 1.6;         // cap the device pixel ratio for performance

// Heat added for stealing a car.
const THEFT_HEAT = 0.7;

// Title-screen camera orbit.
const TITLE_ORBIT_RADIUS = 210;
const TITLE_ORBIT_WOBBLE = 26;
const TITLE_ORBIT_HEIGHT = 96;
const TITLE_LOOK_AHEAD = 40;
const TITLE_SPEED = 0.055;

// Skid/dust effect thresholds while driving.
const SKID_MIN_SPEED = 13;
const SKID_MIN_STEER = 0.5;

const canvas = document.getElementById('view');

/**
 * The single shared game object. Every subsystem hangs off this; it is also the handle the
 * browser-side screenshot/playtest harnesses drive.
 */
export const app = {
  scene: null, renderer: null, camera: null, city: null, player: null,
  input: null, rig: null, clock: null, rng: null, sky: null,
  vehicles: null, driving: null, pedestrians: null, traffic: null, wanted: null,
  effects: null, audio: null, missions: null, hud: null,
  time: 0, mode: 'title', paused: false,
  fps: 0, _fpsAccum: 0, _fpsFrames: 0,
  prompt: null,
};

// ===== BOOT =====

/** Build the renderer, world and every subsystem, then start the loop. */
function boot() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  // Shadows are faked with blob decals, so the shadow map stays off.
  renderer.shadowMap.enabled = false;
  app.renderer = renderer;

  app.scene = new THREE.Scene();
  app.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1600);

  app.sky = buildSky(app.scene, renderer);
  app.city = buildCity(app.scene, CITY_SEED);
  app.rng = makeRng(GAMEPLAY_SEED);
  app.input = new Input(canvas);
  app.rig = new CameraRig(app.camera, canvas);

  app.player = new Player(app.scene, app.rng);
  app.player.bindApp(app);

  // Vehicles, traffic and pedestrians all draw from the same RNG, so spawn order is deterministic.
  app.vehicles = new VehicleManager(app.scene, app.city, app.rng);
  app.vehicles.onCrash = (car, damage) => {
    // A crash only hurts the player when they were in the car that crashed.
    if (car === app.player.inCar) app.player.damage(damage * 0.35);
  };

  app.pedestrians = new PedestrianManager(app.scene, app.city, app.rng);
  app.traffic = new TrafficManager(app.scene, app.city, app.rng, app.vehicles);
  app.traffic.onCrash = (car, damage) => {
    if (car === app.player.inCar) app.player.damage(damage * 0.35);
  };

  app.wanted = new WantedSystem(app);
  app.effects = new Effects(app.scene);
  app.audio = new AudioEngine();
  app.missions = new MissionManager(app);
  app.hud = new Hud(app);

  wireCallbacks();

  app.driving = new DrivingController(app.player, app.input, app.rig);
  respawnAtSpawn();

  app.titleCam = { t: 0 };

  window.addEventListener('resize', onResize);

  document.getElementById('loading')?.classList.add('hidden');
  app.clock = new THREE.Clock();
  requestAnimationFrame(frame);
}

/** Connect the cross-system callbacks (audio hooks, HUD refreshes, mission flow). */
function wireCallbacks() {
  app.player.onFootstep = (running) => app.audio.footstep(running);
  app.player.onLand = (force) => {
    // Only a genuinely heavy landing makes a thud.
    if (force > 12) app.audio.crash(0.5);
  };

  app.wanted.onStarChange = (stars) => {
    app.hud.toast(stars > 0 ? 'WANTED LEVEL UP' : 'You lost the police', 2.2);
  };
  app.wanted.onBusted = () => busted();

  // Mission progress and completion both refresh the HUD; completion also autosaves.
  app.missions.onChange = () => app.hud.update(0);
  app.onMissionComplete = (mission) => {
    app.hud.toast(`MISSION COMPLETE — $${mission.reward}`, 4);
    app.hud.showSubtitle(mission.outro, 5.5);
    writeSave(app);
  };
}

/** Keep the camera aspect and renderer size in step with the window. */
function onResize() {
  app.camera.aspect = window.innerWidth / window.innerHeight;
  app.camera.updateProjectionMatrix();
  app.renderer.setSize(window.innerWidth, window.innerHeight, false);
}

/** Put the player back at the city spawn point, on foot, at full health. */
function respawnAtSpawn() {
  const spawn = app.city.spawnPoint;

  app.player.setPos(spawn.x, spawn.z);
  app.player.facing = Math.PI;
  app.player.dead = false;
  app.player.health = CONFIG.player.maxHealth;
  app.player.mesh.visible = true;
  app.player.shadow.visible = true;
  app.player.mesh.rotation.z = 0;
  app.player.mesh.position.set(spawn.x, 0, spawn.z);

  // Detach cleanly from any car left behind, or the car stays flagged as player-occupied.
  if (app.player.inCar) {
    app.player.inCar.occupiedByPlayer = false;
    app.player.inCar.driver = null;
    app.player.inCar = null;
  }
}

// ===== TITLE SCREEN CAMERA =====

/** Swoop the camera over the city so the menu sits on a live skyline. */
function updateTitleCam(dt) {
  const t = app.titleCam.t + dt * TITLE_SPEED;
  app.titleCam.t = t;

  const centre = app.city.centre;
  const radius = TITLE_ORBIT_RADIUS + Math.sin(t * 0.9) * TITLE_ORBIT_WOBBLE;
  const angle = t * 0.6 + 2.2;

  app.camera.position.set(
    centre.x + Math.cos(angle) * radius,
    TITLE_ORBIT_HEIGHT + Math.sin(t * 1.4) * 14,
    centre.z + Math.sin(angle) * radius,
  );
  app.camera.lookAt(
    centre.x + Math.cos(angle + 1.1) * TITLE_LOOK_AHEAD,
    8,
    centre.z + Math.sin(angle + 1.1) * TITLE_LOOK_AHEAD,
  );
  app.camera.fov = 58;
  app.camera.updateProjectionMatrix();

  // Keep the sky dome centred on the orbiting camera.
  app.sky.sky.position.set(app.camera.position.x, 0, app.camera.position.z);
  app.effects.update(dt);
}

// ===== PLAY UPDATE =====

// Reused every frame so the loop allocates nothing.
const _focus = new THREE.Vector3();

/** One frame of live gameplay. */
function updatePlay(dt) {
  const input = app.input;
  const player = app.player;
  const vehicles = app.vehicles;

  app.rig.handleMouse(input);

  if (player.inCar) {
    updateDriving(dt, input, player);
  } else {
    updateOnFoot(dt, input, player, vehicles);
  }

  // Leaving a car is checked after entry so the same keypress can't do both.
  if (player.inCar && input.hit('KeyE')) {
    vehicles.exitCar(player);
    input.pressed.delete('KeyE');
  }

  // Start the waiting mission at the golden marker.
  if (!player.inCar && input.hit('KeyE') && app.missions.state !== 'active' && app.missions.mission) {
    app.missions.start(app.missions.index);
    app.hud.showSubtitle(app.missions.mission.intro, 5.5);
    input.pressed.delete('KeyE');
  }

  updateWeaponSwitch(input, player);
  updateWorld(dt, player, vehicles);
  updateHudAndDeathState(dt, player);
}

/** Driving branch: hand control to the controller, then chase the car with the rig. */
function updateDriving(dt, input, player) {
  const car = app.driving.update(dt, (c) => {
    c.hornTimer = 0.3;
    app.audio.horn();
  });

  app.rig.setMode('car');
  app.driving.cameraFocus(car, _focus);
  app.rig.update(dt, _focus, app.city.colliders, {
    sky: app.sky.sky,
    autoYaw: app.driving.autoYaw(car),
    // A recent mouse nudge disables the auto-align briefly so the player can free-look.
    mouseActive: Math.abs(input.mouseDX) > 1,
    speedFov: app.driving.speedFovBoost(car),
  });

  car.update(dt, { colliders: app.city.colliders });
  // The player's logical position rides along with the car.
  player.pos.set(car.pos.x, 0, car.pos.z);
  player.facing = car.heading;
}

/** On-foot branch: move the character and offer the enter-vehicle prompt. */
function updateOnFoot(dt, input, player, vehicles) {
  app.rig.setMode('foot');
  _focus.set(player.pos.x, player.pos.y + 1.42, player.pos.z);
  app.rig.update(dt, _focus, app.city.colliders, { sky: app.sky.sky });

  player.update(dt, input, app.rig.yaw, app.city.colliders, { limit: app.city.span + 30 });

  const near = vehicles.findNearestEnterable(player.pos, CONFIG.car.enterRange);
  vehicles.nearCar = near;

  if (input.hit('KeyE') && near) {
    vehicles.enterCar(near, player);
    player.setWeapon(player.weapon);
    app.wanted.add(THEFT_HEAT, 'car theft');
    app.hud.toast(`Stole the ${near.spec.label}`, 2.2);
    app.audio.blip(520, 0.12, 'square', 0.14);
    input.pressed.delete('KeyE');
  }
}

/** Weapon hotkeys: 1 fists, 2 pistol, 3 SMG (firearms only if the player has any rounds). */
function updateWeaponSwitch(input, player) {
  if (input.hit('Digit1')) player.setWeapon('fists');
  if (input.hit('Digit2') && (player.ammo.pistol > 0 || player.reserve.pistol > 0)) {
    player.setWeapon('pistol');
  }
  if (input.hit('Digit3') && (player.ammo.smg > 0 || player.reserve.smg > 0)) {
    player.setWeapon('smg');
  }
}

/** Tick every AI system, then integrate the remaining vehicles and refresh the wheel batch. */
function updateWorld(dt, player, vehicles) {
  app.pedestrians.update(dt, player.pos, vehicles.cars);
  app.traffic.update(dt, player.pos, player.inCar);
  app.wanted.update(dt);
  app.missions.update(dt, player);
  app.effects.update(dt);
  app.audio.update(dt, player.inCar, app.wanted.nearestCopDist ?? 999, app.wanted.stars);

  for (const car of vehicles.cars) {
    if (car !== player.inCar) car.update(dt, { colliders: app.city.colliders });
  }
  vehicles.syncWheels();
  vehicles.cullFar(player.pos);

  updateSkidEffects(player.inCar);
}

/** Lay down tyre smoke and road marks while the player's car is sliding hard. */
function updateSkidEffects(car) {
  if (!car) return;
  if (Math.abs(car.vel) <= SKID_MIN_SPEED || Math.abs(car.steer) <= SKID_MIN_STEER) return;

  app.effects.dust(car.pos.x, 0.2, car.pos.z);
  app.effects.skid(car.pos.x, car.pos.z, car.heading);
}

/** Refresh the HUD (plus the context prompt) and fire the WASTED flow exactly once. */
function updateHudAndDeathState(dt, player) {
  app.hud.update(dt);
  updatePrompt();

  if (player.dead && !app._wastedShown) {
    app._wastedShown = true;
    wasted();
  } else if (!player.dead) {
    app._wastedShown = false;
  }
}

// ===== CONTEXT PROMPT =====

/** Show the single most relevant action for the player's current situation. */
function updatePrompt() {
  const el = document.getElementById('prompt');
  if (!el) return;

  const player = app.player;
  let text;

  if (player.inCar) {
    text = 'E — leave vehicle';
  } else if (app.vehicles.nearCar) {
    text = `E — steal the ${app.vehicles.nearCar.spec.label}`;
  } else if (app.missions.state !== 'active' && app.missions.mission) {
    text = `E — start: ${app.missions.mission.title}`;
  } else if (player.weapon === 'fists') {
    text = 'Left click — punch';
  } else {
    text = `Left click — fire (${player.ammoFor(player.weapon)})`;
  }

  if (el.textContent !== text) el.textContent = text;
  el.classList.remove('hidden');
}

// Exposed so the screenshot harness can refresh the HUD after posing a scene while the loop is
// frozen — otherwise the prompt keeps whatever text the last live frame left behind.
app.updatePrompt = updatePrompt;

// ===== MAIN LOOP =====

function frame() {
  requestAnimationFrame(frame);

  const dt = Math.min(MAX_DT, app.clock.getDelta());

  // A frozen loop still renders, but never advances the simulation: the screenshot harness
  // relies on this to pose a scene and capture it exactly as posed.
  if (app.freeze) {
    app.renderer.render(app.scene, app.camera);
    return;
  }

  app.time += dt;
  sampleFps(dt);

  if (app.mode === 'play' && !app.paused) {
    updatePlay(dt);
  } else if (app.mode === 'title') {
    updateTitleCam(dt);
  }

  app.input.endFrame();
  app.renderer.render(app.scene, app.camera);
}

/** Rolling FPS estimate over a fixed window. */
function sampleFps(dt) {
  app._fpsAccum += dt;
  app._fpsFrames += 1;

  if (app._fpsAccum > FPS_SAMPLE_WINDOW) {
    app.fps = Math.round(app._fpsFrames / app._fpsAccum);
    app._fpsAccum = 0;
    app._fpsFrames = 0;
  }
}

// ===== GAME FLOWS =====

/**
 * Enter play mode, from the title screen or the CONTINUE button.
 * @param {boolean} fromSave - Restore the stored save rather than starting fresh
 */
function startGame(fromSave = false) {
  app.audio.init();
  app.audio.resume();

  app.mode = 'play';
  app.paused = false;
  app._wastedShown = false;

  document.getElementById('title-screen')?.classList.add('hidden');
  document.getElementById('hud')?.classList.remove('hidden');

  if (fromSave) {
    const data = hasSave();
    if (data && applySave(app, data)) {
      app.hud.showSubtitle('Welcome back to Puerto Vela.', 3.4);
    }
  } else {
    app.missions.start(0);
    app.hud.showSubtitle(app.missions.mission.intro, 5.5);
  }

  // Snap the camera behind the player so play starts on a sensible framing.
  app.rig.yaw = app.player.facing + Math.PI;
  app.rig.pitch = -0.1;
  app.rig.smoothLook.set(app.player.pos.x, 1.4, app.player.pos.z);
  app.rig.camera.position.set(
    app.player.pos.x + Math.sin(app.rig.yaw) * 6,
    2.6,
    app.player.pos.z + Math.cos(app.rig.yaw) * 6,
  );

  // Pointer lock needs a user gesture, so this can throw if called programmatically.
  try { app.input.requestLock(); } catch { /* needs a gesture */ }
}

/** Open the pause menu and release the mouse. */
function pauseGame() {
  if (app.mode !== 'play' || app.paused) return;

  app.paused = true;
  document.getElementById('pause-screen')?.classList.remove('hidden');
  updatePauseStats();
  app.input.releaseLock();
}

/** Write cash and mission progress into the pause panel. */
function updatePauseStats() {
  const el = document.getElementById('pause-stats');
  if (!el) return;

  const missions = app.missions;
  const missionLine = missions.mission ? ` · ${missions.mission.title}` : '';
  el.innerHTML =
    `Cash $${app.player.cash.toLocaleString()} &nbsp;·&nbsp; ` +
    `Mission ${Math.min(3, missions.index + 1)}/3${missionLine}`;
}

/** Close the pause menu and re-acquire the mouse. */
function resumeGame() {
  app.paused = false;
  document.getElementById('pause-screen')?.classList.add('hidden');
  try { app.input.requestLock(); } catch { /* ignore */ }
}

/** Caught by the police: clear the heat, pay the fine, respawn at the spawn point. */
function busted() {
  app.wanted.clear();
  const fine = app.wanted.resolveBust();
  respawnAtSpawn();
  app.hud.toast(`BUSTED — paid $${fine}`, 4);
  app.audio.fail();
}

/** Killed on foot: show the WASTED screen and stop the simulation. */
function wasted() {
  app.wanted.clear();
  document.getElementById('gameover-screen')?.classList.remove('hidden');

  const el = document.getElementById('gameover-text');
  if (el) {
    el.textContent = `You went down in Puerto Vela. Cash on hand: $${app.player.cash.toLocaleString()}`;
  }

  app.paused = true;
  app.audio.fail();
  app.input.releaseLock();
}

/** Respawn from the WASTED screen at full health. */
function respawnAfterDeath() {
  document.getElementById('gameover-screen')?.classList.add('hidden');

  app.paused = false;
  app.player.dead = false;
  app.player.health = app.player.maxHealth;
  app.player.mesh.rotation.z = 0;

  respawnAtSpawn();
  app._wastedShown = false;
  try { app.input.requestLock(); } catch { /* ignore */ }
}

// ===== UI WIRING =====

const $ = (id) => document.getElementById(id);

$('btn-new')?.addEventListener('click', () => {
  clearSave();
  startGame(false);
});

$('btn-continue')?.addEventListener('click', () => {
  // Fall back to a new game if the save vanished between page load and the click.
  if (hasSave()) startGame(true);
  else startGame(false);
});

$('btn-controls')?.addEventListener('click', () => $('controls-screen')?.classList.remove('hidden'));
$('btn-controls2')?.addEventListener('click', () => $('controls-screen')?.classList.remove('hidden'));
$('btn-controls-back')?.addEventListener('click', () => $('controls-screen')?.classList.add('hidden'));

$('btn-resume')?.addEventListener('click', () => resumeGame());

$('btn-save')?.addEventListener('click', () => {
  const data = writeSave(app);
  app.hud.toast(data ? 'Game saved' : 'Save failed', 2.2);
  updatePauseStats();
});

$('btn-quit')?.addEventListener('click', () => {
  app.paused = false;
  app.mode = 'title';
  $('pause-screen')?.classList.add('hidden');
  $('hud')?.classList.add('hidden');
  $('title-screen')?.classList.remove('hidden');
  app.input.releaseLock();
  refreshSaveLabel();
});

$('btn-respawn')?.addEventListener('click', () => respawnAfterDeath());

// Global keyboard shortcuts: Escape pauses, Shift+R quicksaves.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (app.mode === 'play') {
      if (app.paused) resumeGame();
      else pauseGame();
    } else {
      $('controls-screen')?.classList.add('hidden');
    }
  }

  if (e.code === 'KeyR' && app.mode === 'play' && e.shiftKey) writeSave(app);
});

/** Reflect the stored save in the title screen's summary line and CONTINUE button. */
function refreshSaveLabel() {
  const el = $('save-info');
  const data = hasSave();
  if (el) el.textContent = data ? describeSave(data) : 'No save yet — start a new game';

  const btn = $('btn-continue');
  if (btn) btn.disabled = !data;
}

refreshSaveLabel();

// Harness handles: the playtest and screenshot scripts drive the game through these.
window.__app = app;
window.__startForTest = () => startGame(false);

boot();
