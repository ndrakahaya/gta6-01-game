// Heads-up display: health/armor bars, cash, wanted stars, weapon + ammo, mission objective with
// live distance, subtitle line for dialogue, toast notifications, and a 2D canvas minimap that
// renders roads, buildings, police, traffic, the mission marker and the player arrow.

// ===== MINIMAP CONSTANTS =====

/** Size of the minimap canvas in pixels */
const MAP_PIXELS = 200;
/** World distance (metres) shown from the centre of the minimap to its edge */
const MAP_RANGE = 118;

/** Health bar colour thresholds: green above 55%, amber above 25%, red below. */
const HEALTH_GREEN = '#57d06a';
const HEALTH_AMBER = '#e8b53a';
const HEALTH_RED = '#e2453a';

/**
 * Heads-up display controller.
 * Reads live state off the app each frame and writes it into the DOM, plus redraws the minimap.
 */
export class Hud {
  constructor(app) {
    this.app = app;

    // Cache every DOM node once so the per-frame update is pure property writes.
    this.el = {
      hud: document.getElementById('hud'),
      health: document.getElementById('health-fill'),
      armor: document.getElementById('stamina-fill'),
      cash: document.getElementById('cash'),
      wanted: document.getElementById('wanted'),
      weapon: document.getElementById('weapon-name'),
      ammo: document.getElementById('ammo'),
      objective: document.getElementById('objective'),
      objTitle: document.getElementById('objective-title'),
      objText: document.getElementById('objective-text'),
      objDist: document.getElementById('objective-dist'),
      subtitle: document.getElementById('subtitle'),
      toast: document.getElementById('toast'),
      flash: document.getElementById('damage-flash'),
      clock: document.getElementById('clock'),
    };

    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas?.getContext('2d') ?? null;

    // Transient UI timers (seconds remaining) and change-detection caches.
    this.subtitleTimer = 0;
    this.toastTimer = 0;
    this.starsShown = -1;   // last rendered star count, avoids rebuilding the DOM every frame
    this.lastCash = -1;     // last rendered cash value, avoids toLocaleString churn
    this.mapScale = MAP_PIXELS / (MAP_RANGE * 2);
    this.bob = 0;           // unused animation phase, kept for future minimap pulse effects
  }

  // ===== TRANSIENT MESSAGES =====

  /**
   * Show a dialogue subtitle for a limited time.
   * @param {string} text - Line to display
   * @param {number} seconds - How long to keep it on screen
   */
  showSubtitle(text, seconds = 4.5) {
    if (!this.el.subtitle) return;
    this.el.subtitle.textContent = text;
    this.el.subtitle.classList.remove('hidden');
    this.subtitleTimer = seconds;
  }

  /**
   * Show a short toast notification (pickups, mission updates).
   * @param {string} text - Message to display
   * @param {number} seconds - How long to keep it on screen
   */
  toast(text, seconds = 2.6) {
    if (!this.el.toast) return;
    this.el.toast.textContent = text;
    this.el.toast.classList.remove('hidden');
    this.toastTimer = seconds;
  }

  /** Flash the red damage overlay briefly when the player takes a hit. */
  flashDamage() {
    if (!this.el.flash) return;
    this.el.flash.style.opacity = '0.42';
    setTimeout(() => {
      if (this.el.flash) this.el.flash.style.opacity = '0';
    }, 110);
  }

  // ===== PER-FRAME UPDATE =====

  /**
   * Refresh all HUD elements from live game state.
   * @param {number} dt - Delta time in seconds (drives the transient timers)
   */
  update(dt) {
    const app = this.app;
    const player = app.player;

    this.updateBars(player);
    this.updateCash(player);
    this.updateWanted(app.wanted?.stars ?? 0);
    this.updateWeapon(player);
    this.updateObjective(app.missions);
    this.updateTimers(dt);
    this.updateClock(app.time ?? 0);
    this.drawMinimap();
  }

  /** Health and armor bars, with the health fill recoloured by severity. */
  updateBars(player) {
    if (this.el.health) {
      const hp = Math.max(0, Math.min(1, player.health / player.maxHealth));
      this.el.health.style.width = `${hp * 100}%`;
      this.el.health.style.background =
        hp > 0.55 ? HEALTH_GREEN : hp > 0.25 ? HEALTH_AMBER : HEALTH_RED;
    }
    if (this.el.armor) {
      const armor = Math.max(0, Math.min(1, player.armor / 100));
      // Never collapse to nothing: a sliver of fill reads better than an empty bar.
      this.el.armor.style.width = `${Math.max(6, armor * 100)}%`;
    }
  }

  /** Cash readout, formatted with thousands separators, only rewritten when the value changes. */
  updateCash(player) {
    if (!this.el.cash || player.cash === this.lastCash) return;
    this.lastCash = player.cash;
    this.el.cash.textContent = `$${player.cash.toLocaleString()}`;
  }

  /** Wanted star row, rebuilt only when the star count changes. */
  updateWanted(stars) {
    if (!this.el.wanted || stars === this.starsShown) return;
    this.starsShown = stars;
    this.el.wanted.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const star = document.createElement('span');
      star.className = i < stars ? 'star on' : 'star';
      star.textContent = '★';
      this.el.wanted.appendChild(star);
    }
  }

  /** Weapon name plus ammo count; fists show an infinity glyph. */
  updateWeapon(player) {
    if (this.el.weapon) {
      const w = player.weapon;
      this.el.weapon.textContent = w === 'fists' ? 'FISTS' : w === 'pistol' ? 'PISTOL' : 'SMG';
    }
    if (this.el.ammo) {
      const ammo = player.ammoFor(player.weapon);
      // Fists have infinite ammo. A big "—" glyph reads as a stray white bar in the HUD, so we
      // print the infinity symbol at a smaller font instead.
      this.el.ammo.textContent = ammo === Infinity ? '∞' : `${ammo}`;
      this.el.ammo.style.fontSize = ammo === Infinity ? '18px' : '26px';
    }
  }

  /** Mission objective panel: title, description and live distance to the marker. */
  updateObjective(missions) {
    if (!this.el.objective || !missions) return;

    const active = missions.state === 'active' || missions.mission;
    if (!active) {
      this.el.objective.classList.add('hidden');
      return;
    }

    this.el.objective.classList.remove('hidden');
    if (this.el.objTitle) this.el.objTitle.textContent = missions.titleLine() || 'OBJECTIVE';
    if (this.el.objText) this.el.objText.textContent = missions.objectiveLine();
    if (this.el.objDist) {
      const distance = missions.objectiveDistance();
      this.el.objDist.textContent = distance === null ? '' : `${Math.round(distance)} m`;
    }
  }

  /** Count down and hide the subtitle and toast after their time runs out. */
  updateTimers(dt) {
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.el.subtitle?.classList.add('hidden');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast?.classList.add('hidden');
    }
  }

  /** In-world clock. Starts at 16:00 and advances one game hour per real minute. */
  updateClock(time) {
    if (!this.el.clock) return;
    const totalMinutes = 16 * 60 + Math.floor(time * 1.0);
    const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');
    this.el.clock.textContent = `${hh}:${mm}`;
  }

  // ===== MINIMAP =====

  /**
   * Redraw the minimap: dark surroundings, city footprint, road grid, building blocks, the
   * mission marker, police and traffic blips, all centred on the player with a heading arrow.
   */
  drawMinimap() {
    const ctx = this.ctx;
    if (!ctx) return;

    const app = this.app;
    const player = app.player;
    const focus = player.inCar ? player.inCar.pos : player.pos;
    const heading = player.inCar ? player.inCar.heading : player.facing;
    const scale = this.mapScale;

    ctx.clearRect(0, 0, MAP_PIXELS, MAP_PIXELS);
    ctx.save();
    ctx.translate(MAP_PIXELS / 2, MAP_PIXELS / 2);

    // Dark background. Near the grid edge the outside reads as open water/outskirts, so the map
    // never looks like it has a broken half.
    ctx.fillStyle = '#121a22';
    ctx.fillRect(-MAP_PIXELS / 2, -MAP_PIXELS / 2, MAP_PIXELS, MAP_PIXELS);

    // Convert a world point into minimap-relative pixel coordinates.
    const toMap = (wx, wz) => [(wx - focus.x) * scale, (wz - focus.z) * scale];

    // City footprint so the map edge reads as the town boundary rather than missing data.
    const span = app.city.span;
    const [left, top] = toMap(0, 0);
    const [right, bottom] = toMap(span, span);
    ctx.fillStyle = '#232c36';
    ctx.fillRect(left, top, right - left, bottom - top);

    this.drawRoadGrid(toMap, span, app.city.grid, app.city.cell);
    this.drawBuildingBlocks(toMap, app.city.buildings);
    this.drawMissionMarker(toMap, app.missions);
    this.drawPoliceBlips(toMap, app.wanted);
    this.drawTrafficBlips(toMap, app.vehicles, player);
    this.drawPlayerArrow(heading);

    ctx.restore();
    this.bob += 0.02;
  }

  /**
   * Draw the road network as thin, evenly weighted lines.
   * Width is deliberately clamped short of true-to-scale: at world scale a road band would flood
   * the map grey, so this reads like a paper street map instead.
   */
  drawRoadGrid(toMap, span, grid, cell) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#7d8b98';
    ctx.lineWidth = 3;
    ctx.lineCap = 'square';

    for (let i = 0; i <= grid; i++) {
      const c = i * cell;

      // North-south road
      const [ax, az] = toMap(c, 0);
      const [, bz] = toMap(c, span);
      ctx.beginPath();
      ctx.moveTo(ax, az);
      ctx.lineTo(ax, bz);
      ctx.stroke();

      // East-west road
      const [bx, bz2] = toMap(span, c);
      const [ax2] = toMap(0, c);
      ctx.beginPath();
      ctx.moveTo(ax2, bz2);
      ctx.lineTo(bx, bz2);
      ctx.stroke();
    }
  }

  /** Draw buildings as inset blocks so the road grid stays visible between them. */
  drawBuildingBlocks(toMap, buildings) {
    const ctx = this.ctx;
    const scale = this.mapScale;
    ctx.fillStyle = '#333c47';

    for (const building of buildings) {
      const [mx, mz] = toMap(building.x, building.z);

      // Cull well outside the visible window (with margin) before drawing.
      if (mx < -MAP_PIXELS / 2 - 24 || mx > MAP_PIXELS / 2 + 24) continue;
      if (mz < -MAP_PIXELS / 2 - 24 || mz > MAP_PIXELS / 2 + 24) continue;

      const w = Math.max(1.2, building.w * scale * 0.9);
      const d = Math.max(1.2, building.d * scale * 0.9);
      ctx.fillRect(mx - w / 2, mz - d / 2, w, d);
    }
  }

  /** Draw the pulsing yellow mission marker when one is active on screen. */
  drawMissionMarker(toMap, missions) {
    if (!missions?.marker?.visible) return;

    const ctx = this.ctx;
    const [mx, mz] = toMap(missions.marker.position.x, missions.marker.position.z);

    // Solid centre dot.
    ctx.fillStyle = '#ffcf5c';
    ctx.beginPath();
    ctx.arc(mx, mz, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Faint halo ring around it.
    ctx.strokeStyle = 'rgba(255,207,92,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mx, mz, 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** Draw police blips as blue dots. */
  drawPoliceBlips(toMap, wanted) {
    if (!wanted?.cops) return;

    const ctx = this.ctx;
    ctx.fillStyle = '#5aa8ff';
    for (const cop of wanted.cops) {
      if (!cop.mesh.visible) continue;
      const [cx, cz] = toMap(cop.pos.x, cop.pos.z);
      ctx.beginPath();
      ctx.arc(cx, cz, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Draw traffic blips as small squares, skipping the car the player is driving. */
  drawTrafficBlips(toMap, vehicles, player) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(190,205,220,0.75)';
    for (const car of vehicles.cars) {
      if (!car.mesh.visible || car === player.inCar) continue;
      const [cx, cz] = toMap(car.pos.x, car.pos.z);
      ctx.fillRect(cx - 1.2, cz - 1.2, 2.4, 2.4);
    }
  }

  /** Draw the white player arrow at the centre, rotated to the current heading. */
  drawPlayerArrow(heading) {
    const ctx = this.ctx;
    ctx.save();
    ctx.rotate(-heading + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.6);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}