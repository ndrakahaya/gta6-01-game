// Save / load through localStorage: player position, cash, health, weapon, wanted stars and
// mission progress. A save is written on demand (pause menu) and on mission completion, and
// read back on the title screen's CONTINUE button.

import { CONFIG } from './config.js';

const KEY = CONFIG.saveKey;

export function hasSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

export function writeSave(app) {
  const p = app.player;
  const car = p.inCar;
  const data = {
    version: 1,
    savedAt: Date.now(),
    player: {
      x: +p.pos.x.toFixed(2),
      y: +p.pos.y.toFixed(2),
      z: +p.pos.z.toFixed(2),
      facing: +p.facing.toFixed(3),
      health: +p.health.toFixed(1),
      armor: +p.armor.toFixed(1),
      cash: p.cash,
      weapon: p.weapon,
      ammo: { ...p.ammo },
      reserve: { ...p.reserve },
      inCar: !!car,
    },
    car: car ? { x: +car.pos.x.toFixed(2), z: +car.pos.z.toFixed(2), heading: +car.heading.toFixed(3), kind: car.kind, color: car.color } : null,
    wanted: { heat: +(app.wanted?.heat ?? 0).toFixed(2) },
    mission: app.missions?.saveState() ?? null,
    stats: { time: +(app.time ?? 0).toFixed(1) },
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return data;
  } catch {
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

/** Apply a save to a running game. Returns true when it was applied. */
export function applySave(app, data) {
  if (!data || !data.player) return false;
  const p = app.player;
  const s = data.player;

  p.setPos(s.x, s.z);
  p.pos.y = s.y ?? 0;
  p.facing = s.facing ?? 0;
  p.health = Math.max(1, s.health ?? CONFIG.player.maxHealth);
  p.armor = s.armor ?? 0;
  p.cash = s.cash ?? CONFIG.cashStart;
  p.weapon = s.weapon ?? 'fists';
  p.setWeapon(p.weapon);
  p.ammo = { pistol: 0, smg: 0, ...(s.ammo ?? {}) };
  p.reserve = { pistol: 0, smg: 0, ...(s.reserve ?? {}) };
  p.dead = false;
  p.mesh.visible = true;
  p.shadow.visible = true;
  p.mesh.position.set(p.pos.x, 0, p.pos.z);

  if (data.wanted) app.wanted?.add(0, 'restore');
  if (app.wanted && data.wanted?.heat) {
    app.wanted.heat = data.wanted.heat;
    app.wanted.stars = Math.floor(app.wanted.heat);
  }

  app.missions?.loadState(data.mission);
  return true;
}

/** Human-readable line for the title screen. */
export function describeSave(data) {
  if (!data) return '';
  const when = new Date(data.savedAt || Date.now());
  const cash = data.player?.cash ?? 0;
  const idx = (data.mission?.index ?? 0) + 1;
  return `Save · $${cash} · mission ${idx}/3 · ${when.toLocaleString()}`;
}
