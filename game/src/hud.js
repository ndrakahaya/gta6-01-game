// HUD: health/armor bars, cash, wanted stars, weapon + ammo, mission objective with distance,
// subtitle line for dialogue, and a live minimap drawn on a 2D canvas (roads, buildings as
// blocks, police, traffic, mission marker and the player arrow).

const MAP_PX = 200;
const MAP_RANGE = 118;   // world metres shown from the centre of the minimap

export class Hud {
  constructor(app) {
    this.app = app;
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
    this.subtitleTimer = 0;
    this.toastTimer = 0;
    this.starsShown = -1;
    this.lastCash = -1;
    this.mapScale = MAP_PX / (MAP_RANGE * 2);
    this.bob = 0;
  }

  showSubtitle(text, seconds = 4.5) {
    if (!this.el.subtitle) return;
    this.el.subtitle.textContent = text;
    this.el.subtitle.classList.remove('hidden');
    this.subtitleTimer = seconds;
  }

  toast(text, seconds = 2.6) {
    if (!this.el.toast) return;
    this.el.toast.textContent = text;
    this.el.toast.classList.remove('hidden');
    this.toastTimer = seconds;
  }

  flashDamage() {
    if (!this.el.flash) return;
    this.el.flash.style.opacity = '0.42';
    setTimeout(() => { if (this.el.flash) this.el.flash.style.opacity = '0'; }, 110);
  }

  update(dt) {
    const app = this.app;
    const p = app.player;

    // ---- bars ----
    if (this.el.health) {
      const hp = Math.max(0, Math.min(1, p.health / p.maxHealth));
      this.el.health.style.width = `${hp * 100}%`;
      this.el.health.style.background = hp > 0.55 ? '#57d06a' : hp > 0.25 ? '#e8b53a' : '#e2453a';
    }
    if (this.el.armor) {
      const ar = Math.max(0, Math.min(1, p.armor / 100));
      this.el.armor.style.width = `${Math.max(6, ar * 100)}%`;
    }

    // ---- cash ----
    if (this.el.cash && p.cash !== this.lastCash) {
      this.lastCash = p.cash;
      this.el.cash.textContent = `$${p.cash.toLocaleString()}`;
    }

    // ---- wanted stars ----
    const stars = app.wanted?.stars ?? 0;
    if (this.el.wanted && stars !== this.starsShown) {
      this.starsShown = stars;
      this.el.wanted.innerHTML = '';
      for (let i = 0; i < 5; i++) {
        const s = document.createElement('span');
        s.className = i < stars ? 'star on' : 'star';
        s.textContent = '★';
        this.el.wanted.appendChild(s);
      }
    }

    // ---- weapon ----
    if (this.el.weapon) {
      const w = p.weapon;
      this.el.weapon.textContent = w === 'fists' ? 'FISTS' : w === 'pistol' ? 'PISTOL' : 'SMG';
    }
    if (this.el.ammo) {
      const a = p.ammoFor(p.weapon);
      // fists have infinite ammo; a big "—" glyph reads as a stray white bar in the HUD, so print
      // the word instead of the dash
      this.el.ammo.textContent = a === Infinity ? '∞' : `${a}`;
      this.el.ammo.style.fontSize = a === Infinity ? '18px' : '26px';
    }

    // ---- objective ----
    const m = app.missions;
    if (this.el.objective && m) {
      if (m.state === 'active' || m.mission) {
        this.el.objective.classList.remove('hidden');
        if (this.el.objTitle) this.el.objTitle.textContent = m.titleLine() || 'OBJECTIVE';
        if (this.el.objText) this.el.objText.textContent = m.objectiveLine();
        if (this.el.objDist) {
          const d = m.objectiveDistance();
          this.el.objDist.textContent = d === null ? '' : `${Math.round(d)} m`;
        }
      } else {
        this.el.objective.classList.add('hidden');
      }
    }

    // ---- timers ----
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.el.subtitle?.classList.add('hidden');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast?.classList.add('hidden');
    }

    // ---- clock (in-world hours, 1 real minute = 1 game hour) ----
    if (this.el.clock) {
      const total = 16 * 60 + Math.floor((app.time ?? 0) * 1.0);
      const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
      const mm = String(total % 60).padStart(2, '0');
      this.el.clock.textContent = `${hh}:${mm}`;
    }

    this.drawMinimap();
  }

  drawMinimap() {
    const ctx = this.ctx;
    if (!ctx) return;
    const app = this.app;
    const p = app.player;
    const focus = p.inCar ? p.inCar.pos : p.pos;
    const heading = p.inCar ? p.inCar.heading : p.facing;
    const S = this.mapScale;

    ctx.clearRect(0, 0, MAP_PX, MAP_PX);
    ctx.save();
    ctx.translate(MAP_PX / 2, MAP_PX / 2);

    // background — outside the city limits reads as open water/outskirts, so the map does not look
    // like it has a broken left half when the player stands near the edge of the grid
    ctx.fillStyle = '#121a22';
    ctx.fillRect(-MAP_PX / 2, -MAP_PX / 2, MAP_PX, MAP_PX);

    const toMap = (wx, wz) => [(wx - focus.x) * S, (wz - focus.z) * S];

    // city footprint, so the map edge reads as the town boundary rather than missing data
    const span = app.city.span;
    const [lx, lz] = toMap(0, 0);
    const [rx, rz] = toMap(span, span);
    ctx.fillStyle = '#232c36';
    ctx.fillRect(lx, lz, rx - lx, rz - lz);

    // roads first, so buildings sit on top of them the way blocks do in the world.
    // Width is clamped hard: at world scale a road is a wide band that floods the map grey, so the
    // map is drawn the way a paper street map is — thin consistent lines, not true-to-scale width.
    ctx.strokeStyle = '#7d8b98';
    ctx.lineWidth = 3;
    ctx.lineCap = 'square';
    for (let i = 0; i <= app.city.grid; i++) {
      const c = i * app.city.cell;
      const [ax, az] = toMap(c, 0);
      const [, bz] = toMap(c, span);
      ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(ax, bz); ctx.stroke();
      const [bx2, bz2] = toMap(span, c);
      const [ax2] = toMap(0, c);
      ctx.beginPath(); ctx.moveTo(ax2, bz2); ctx.lineTo(bx2, bz2); ctx.stroke();
    }

    // buildings as blocks, inset so the road grid stays visible between them
    ctx.fillStyle = '#333c47';
    for (const b of app.city.buildings) {
      const [mx, mz] = toMap(b.x, b.z);
      const w = Math.max(1.2, b.w * S * 0.9);
      const d = Math.max(1.2, b.d * S * 0.9);
      if (mx < -MAP_PX / 2 - 24 || mx > MAP_PX / 2 + 24) continue;
      if (mz < -MAP_PX / 2 - 24 || mz > MAP_PX / 2 + 24) continue;
      ctx.fillRect(mx - w / 2, mz - d / 2, w, d);
    }

    // mission marker
    const m = app.missions;
    if (m?.marker?.visible) {
      const [mx, mz] = toMap(m.marker.position.x, m.marker.position.z);
      ctx.fillStyle = '#ffcf5c';
      ctx.beginPath();
      ctx.arc(mx, mz, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,207,92,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, mz, 8, 0, Math.PI * 2);
      ctx.stroke();
    }

    // police blips
    if (app.wanted?.cops) {
      ctx.fillStyle = '#5aa8ff';
      for (const cop of app.wanted.cops) {
        if (!cop.mesh.visible) continue;
        const [cx, cz] = toMap(cop.pos.x, cop.pos.z);
        ctx.beginPath(); ctx.arc(cx, cz, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // traffic blips
    ctx.fillStyle = 'rgba(190,205,220,0.75)';
    for (const car of app.vehicles.cars) {
      if (!car.mesh.visible || car === p.inCar) continue;
      const [cx, cz] = toMap(car.pos.x, car.pos.z);
      ctx.fillRect(cx - 1.2, cz - 1.2, 2.4, 2.4);
    }

    // player arrow at centre
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

    ctx.restore();
    this.bob += 0.02;
  }
}
