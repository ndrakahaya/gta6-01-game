// Save / load through localStorage.
// Persists player position, cash, health, weapon loadout, wanted level and mission progress.
// A save is written on demand (pause menu) and on mission completion, and read back on the
// title screen's CONTINUE button.

import { CONFIG } from './config.js';

// Storage key, versioned so a future format change can migrate rather than crash.
const KEY = CONFIG.saveKey;

/** Current save format version, bumped whenever the shape below changes incompatibly. */
const SAVE_VERSION = 1;

/**
 * Read the raw save object from storage.
 * @returns {Object|null} - Parsed save, or null when absent/corrupt/blocked
 */
export function hasSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    // Private mode, quota errors or a corrupt value all resolve to "no save".
    return null;
  }
}

/**
 * Snapshot the running game to storage.
 * Numbers are rounded to keep the payload small; the position is rounded to centimetres.
 * @param {Object} app - Live game object
 * @returns {Object|null} - The written save, or null when storage is unavailable
 */
export function writeSave(app) {
  const player = app.player;
  const car = player.inCar;

  const data = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    player: {
      x: +player.pos.x.toFixed(2),
      y: +player.pos.y.toFixed(2),
      z: +player.pos.z.toFixed(2),
      facing: +player.facing.toFixed(3),
      health: +player.health.toFixed(1),
      armor: +player.armor.toFixed(1),
      cash: player.cash,
      weapon: player.weapon,
      ammo: { ...player.ammo },
      reserve: { ...player.reserve },
      inCar: !!car,
    },
    car: car
      ? {
          x: +car.pos.x.toFixed(2),
          z: +car.pos.z.toFixed(2),
          heading: +car.heading.toFixed(3),
          kind: car.kind,
          color: car.color,
        }
      : null,
    wanted: { heat: +(app.wanted?.heat ?? 0).toFixed(2) },
    mission: app.missions?.saveState() ?? null,
    stats: { time: +(app.time ?? 0).toFixed(1) },
  };

  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return data;
  } catch {
    // Quota exceeded or private mode: saving is best-effort, never fatal.
    return null;
  }
}

/** Delete the stored save. */
export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode: nothing to clear */
  }
}

/**
 * Apply a save to a running game.
 * @param {Object} app - Live game object
 * @param {Object} data - Save payload from hasSave()
 * @returns {boolean} - True when the save was applied
 */
export function applySave(app, data) {
  if (!data || !data.player) return false;

  const player = app.player;
  const saved = data.player;

  player.setPos(saved.x, saved.z);
  player.pos.y = saved.y ?? 0;
  player.facing = saved.facing ?? 0;
  // Never restore below 1 HP, so a save taken in a fatal moment can't load straight into death.
  player.health = Math.max(1, saved.health ?? CONFIG.player.maxHealth);
  player.armor = saved.armor ?? 0;
  player.cash = saved.cash ?? CONFIG.cashStart;
  player.weapon = saved.weapon ?? 'fists';
  player.setWeapon(player.weapon);
  // Spread over defaults so an older save missing a weapon slot still loads cleanly.
  player.ammo = { pistol: 0, smg: 0, ...(saved.ammo ?? {}) };
  player.reserve = { pistol: 0, smg: 0, ...(saved.reserve ?? {}) };
  player.dead = false;
  player.mesh.visible = true;
  player.shadow.visible = true;
  player.mesh.position.set(player.pos.x, 0, player.pos.z);

  // Restore heat, and rebuild the star count from it. add(0) resets any prior decay timers.
  if (data.wanted) app.wanted?.add(0, 'restore');
  if (app.wanted && data.wanted?.heat) {
    app.wanted.heat = data.wanted.heat;
    app.wanted.stars = Math.floor(app.wanted.heat);
  }

  app.missions?.loadState(data.mission);
  return true;
}

/**
 * Human-readable one-line summary of a save, for the title screen's CONTINUE button.
 * @param {Object} data - Save payload from hasSave()
 * @returns {string} - Summary line, or '' when there is nothing to describe
 */
export function describeSave(data) {
  if (!data) return '';
  const when = new Date(data.savedAt || Date.now());
  const cash = data.player?.cash ?? 0;
  const missionIndex = (data.mission?.index ?? 0) + 1;
  return `Save · $${cash} · mission ${missionIndex}/3 · ${when.toLocaleString()}`;
}