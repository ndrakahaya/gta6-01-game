// Entry point: renderer, city, player, vehicles and the simulation loop. Owns the title screen,
// the pause menu, saving and the story missions. Every other system attaches itself to `app`.

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

const canvas = document.getElementById('view');

export const app = {
  scene: null, renderer: null, camera: null, city: null, player: null,
  input: null, rig: null, clock: null, rng: null, sky: null,
  vehicles: null, driving: null, pedestrians: null, traffic: null, wanted: null,
  effects: null, audio: null, missions: null, hud: null,
  time: 0, mode: 'title', paused: false,
  fps: 0, _fpsAccum: 0, _fpsFrames: 0,
  prompt: null,
};

function boot() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = false;
  app.renderer = renderer;

  app.scene = new THREE.Scene();
  app.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1600);

  app.sky = buildSky(app.scene, renderer);
  app.city = buildCity(app.scene, 20261117);
  app.rng = makeRng(9001);
  app.input = new Input(canvas);
  app.rig = new CameraRig(app.camera, canvas);

  app.player = new Player(app.scene, app.rng);
  app.player.bindApp(app);

  app.vehicles = new VehicleManager(app.scene, app.city, app.rng);
  app.vehicles.onCrash = (car, dmg) => {
    if (car === app.player.inCar) app.player.damage(dmg * 0.35);
  };

  app.pedestrians = new PedestrianManager(app.scene, app.city, app.rng);
  app.traffic = new TrafficManager(app.scene, app.city, app.rng, app.vehicles);
  app.traffic.onCrash = (car, dmg) => {
    if (car === app.player.inCar) app.player.damage(dmg * 0.35);
  };

  app.wanted = new WantedSystem(app);
  app.effects = new Effects(app.scene);
  app.audio = new AudioEngine();
  app.missions = new MissionManager(app);
  app.hud = new Hud(app);

  app.player.onFootstep = (run) => app.audio.footstep(run);
  app.player.onLand = (force) => { if (force > 12) app.audio.crash(0.5); };

  app.wanted.onStarChange = (stars) => {
    app.hud.toast(stars > 0 ? 'WANTED LEVEL UP' : 'You lost the police', 2.2);
  };
  app.wanted.onBusted = () => busted();
  app.missions.onChange = () => app.hud.update(0);
  app.onMissionComplete = (m) => {
    app.hud.toast(`MISSION COMPLETE — $${m.reward}`, 4);
    app.hud.showSubtitle(m.outro, 5.5);
    writeSave(app);
  };

  app.driving = new DrivingController(app.player, app.input, app.rig);
  respawnAtSpawn();

  app.titleCam = { t: 0 };

  window.addEventListener('resize', () => {
    app.camera.aspect = window.innerWidth / window.innerHeight;
    app.camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  document.getElementById('loading')?.classList.add('hidden');
  app.clock = new THREE.Clock();
  requestAnimationFrame(frame);
}

function respawnAtSpawn() {
  const s = app.city.spawnPoint;
  app.player.setPos(s.x, s.z);
  app.player.facing = Math.PI;
  app.player.dead = false;
  app.player.health = CONFIG.player.maxHealth;
  app.player.mesh.visible = true;
  app.player.shadow.visible = true;
  app.player.mesh.rotation.z = 0;
  app.player.mesh.position.set(s.x, 0, s.z);
  if (app.player.inCar) {
    app.player.inCar.occupiedByPlayer = false;
    app.player.inCar.driver = null;
    app.player.inCar = null;
  }
}

/** Title screen: swoop the camera over the city so the menu sits on a live skyline. */
function updateTitleCam(dt) {
  const t = app.titleCam.t + dt * 0.055;
  app.titleCam.t = t;
  const c = app.city.centre;
  const r = 210 + Math.sin(t * 0.9) * 26;
  const a = t * 0.6 + 2.2;
  app.camera.position.set(c.x + Math.cos(a) * r, 96 + Math.sin(t * 1.4) * 14, c.z + Math.sin(a) * r);
  app.camera.lookAt(c.x + Math.cos(a + 1.1) * 40, 8, c.z + Math.sin(a + 1.1) * 40);
  app.camera.fov = 58;
  app.camera.updateProjectionMatrix();
  app.sky.sky.position.set(app.camera.position.x, 0, app.camera.position.z);
  app.effects.update(dt);
}

const _focus = new THREE.Vector3();

function updatePlay(dt) {
  const input = app.input;
  const player = app.player;
  const vehicles = app.vehicles;

  app.rig.handleMouse(input);

  if (player.inCar) {
    const car = app.driving.update(dt, (c) => {
      c.hornTimer = 0.3;
      app.audio.horn();
    });
    app.rig.setMode('car');
    app.driving.cameraFocus(car, _focus);
    app.rig.update(dt, _focus, app.city.colliders, {
      sky: app.sky.sky,
      autoYaw: app.driving.autoYaw(car),
      mouseActive: Math.abs(input.mouseDX) > 1,
      speedFov: app.driving.speedFovBoost(car),
    });
    car.update(dt, { colliders: app.city.colliders });
    player.pos.set(car.pos.x, 0, car.pos.z);
    player.facing = car.heading;
  } else {
    app.rig.setMode('foot');
    _focus.set(player.pos.x, player.pos.y + 1.42, player.pos.z);
    app.rig.update(dt, _focus, app.city.colliders, { sky: app.sky.sky });
    player.update(dt, input, app.rig.yaw, app.city.colliders, { limit: app.city.span + 30 });

    const near = vehicles.findNearestEnterable(player.pos, CONFIG.car.enterRange);
    vehicles.nearCar = near;
    if (input.hit('KeyE') && near) {
      vehicles.enterCar(near, player);
      player.setWeapon(player.weapon);
      app.wanted.add(0.7, 'car theft');
      app.hud.toast(`Stole the ${near.spec.label}`, 2.2);
      app.audio.blip(520, 0.12, 'square', 0.14);
      input.pressed.delete('KeyE');
    }
  }

  if (player.inCar && input.hit('KeyE')) {
    vehicles.exitCar(player);
    input.pressed.delete('KeyE');
  }

  // start the waiting mission at the marker
  if (!player.inCar && input.hit('KeyE') && app.missions.state !== 'active' && app.missions.mission) {
    app.missions.start(app.missions.index);
    app.hud.showSubtitle(app.missions.mission.intro, 5.5);
    input.pressed.delete('KeyE');
  }

  // weapon switching: 1 fists, 2 pistol, 3 smg
  if (input.hit('Digit1')) player.setWeapon('fists');
  if (input.hit('Digit2') && (player.ammo.pistol > 0 || player.reserve.pistol > 0)) player.setWeapon('pistol');
  if (input.hit('Digit3') && (player.ammo.smg > 0 || player.reserve.smg > 0)) player.setWeapon('smg');

  app.pedestrians.update(dt, player.pos, app.vehicles.cars);
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

  // tyre smoke while sliding hard
  if (player.inCar && Math.abs(player.inCar.vel) > 13 && Math.abs(player.inCar.steer) > 0.5) {
    const c = player.inCar;
    app.effects.dust(c.pos.x, 0.2, c.pos.z);
    app.effects.skid(c.pos.x, c.pos.z, c.heading);
  }

  app.hud.update(dt);
  updatePrompt();

  if (player.dead && !app._wastedShown) {
    app._wastedShown = true;
    wasted();
  } else if (!player.dead) {
    app._wastedShown = false;
  }
}

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

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, app.clock.getDelta());
  if (app.freeze) {
    app.renderer.render(app.scene, app.camera);
    return;
  }
  app.time += dt;

  app._fpsAccum += dt;
  app._fpsFrames++;
  if (app._fpsAccum > 0.5) {
    app.fps = Math.round(app._fpsFrames / app._fpsAccum);
    app._fpsAccum = 0;
    app._fpsFrames = 0;
  }

  if (app.mode === 'play' && !app.paused) {
    updatePlay(dt);
  } else if (app.mode === 'title') {
    updateTitleCam(dt);
  }
  app.input.endFrame();

  app.renderer.render(app.scene, app.camera);
}

// ---------------------------------------------------------------- flows

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

  app.rig.yaw = app.player.facing + Math.PI;
  app.rig.pitch = -0.1;
  app.rig.smoothLook.set(app.player.pos.x, 1.4, app.player.pos.z);
  app.rig.camera.position.set(
    app.player.pos.x + Math.sin(app.rig.yaw) * 6,
    2.6,
    app.player.pos.z + Math.cos(app.rig.yaw) * 6,
  );
  try { app.input.requestLock(); } catch { /* needs a gesture */ }
}

function pauseGame() {
  if (app.mode !== 'play' || app.paused) return;
  app.paused = true;
  document.getElementById('pause-screen')?.classList.remove('hidden');
  updatePauseStats();
  app.input.releaseLock();
}

function updatePauseStats() {
  const el = document.getElementById('pause-stats');
  if (!el) return;
  const m = app.missions;
  el.innerHTML = `Cash $${app.player.cash.toLocaleString()} &nbsp;·&nbsp; Mission ${Math.min(3, m.index + 1)}/3 ${m.mission ? '· ' + m.mission.title : ''}`;
}

function resumeGame() {
  app.paused = false;
  document.getElementById('pause-screen')?.classList.add('hidden');
  try { app.input.requestLock(); } catch { /* ignore */ }
}

function busted() {
  app.wanted.clear();
  const fine = app.wanted.resolveBust();
  respawnAtSpawn();
  app.hud.toast(`BUSTED — paid $${fine}`, 4);
  app.audio.fail();
}

function wasted() {
  app.wanted.clear();
  document.getElementById('gameover-screen')?.classList.remove('hidden');
  const el = document.getElementById('gameover-text');
  if (el) el.textContent = `You went down in Puerto Vela. Cash on hand: $${app.player.cash.toLocaleString()}`;
  app.paused = true;
  app.audio.fail();
  app.input.releaseLock();
}

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

// ---------------------------------------------------------------- UI wiring

const $ = (id) => document.getElementById(id);

$('btn-new')?.addEventListener('click', () => { clearSave(); startGame(false); });
$('btn-continue')?.addEventListener('click', () => {
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

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (app.mode === 'play') {
      if (app.paused) resumeGame(); else pauseGame();
    } else {
      $('controls-screen')?.classList.add('hidden');
    }
  }
  if (e.code === 'KeyR' && app.mode === 'play' && e.shiftKey) writeSave(app);
});

function refreshSaveLabel() {
  const el = $('save-info');
  const data = hasSave();
  if (el) el.textContent = data ? describeSave(data) : 'No save yet — start a new game';
  const btn = $('btn-continue');
  if (btn) btn.disabled = !data;
}
refreshSaveLabel();

window.__app = app;
window.__startForTest = () => startGame(false);
boot();
