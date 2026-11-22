// Story missions: three chained jobs that teach driving, then a chase, then a robbery run.
// Each mission is a list of steps with a world marker, a HUD objective line and short dialogue.
// The manager owns marker geometry (a glowing pillar you can see across the city) and decides
// when a step is done, so mission logic stays declarative and readable.

import * as THREE from 'three';

const GOLD = 0xffcf5c;
const BLUE = 0x4ea8ff;
const RED = 0xff4d4d;

/** One mission = ordered steps. Each step is one of: reach / deliver / kill / survive / drive. */
export const MISSIONS = [
  {
    id: 'm1',
    title: 'A Ride Downtown',
    intro: 'Rico: "You look lost, amigo. Prove you can handle a car and maybe I have work."',
    outro: 'Rico: "Not bad. Now stay alive — the Mercado boys are watching us."',
    reward: 250,
    steps: [
      {
        kind: 'reach',
        text: 'Steal a car from the street',
        hint: 'Press E next to any car',
        marker: null,          // no fixed marker: any car counts
        needsCar: true,
      },
      {
        kind: 'reach',
        text: 'Drive to the garage in Puerto Vela',
        poi: 'garage',
        radius: 11,
        needsCar: true,
      },
    ],
  },
  {
    id: 'm2',
    title: 'Heat on the Avenida',
    intro: 'Rico: "The Mercado crew took a shot at my cousin. Make them chase you and lose them."',
    outro: 'Rico: "They are off your tail. Here — spend it before someone takes it."',
    reward: 400,
    steps: [
      {
        kind: 'reach',
        text: 'Drive to Plaza Sol and start trouble',
        poi: 'plaza',
        radius: 14,
        needsCar: false,
        action: 'provoke',     // reaching here bumps the wanted level
      },
      {
        kind: 'survive',
        text: 'Escape the police — stay out of sight',
        duration: 22,
        marker: null,
      },
    ],
  },
  {
    id: 'm3',
    title: 'Banco Azul',
    intro: 'Rico: "Last job. Hit the Banco Azul, take the cash, and get to the docks."',
    outro: 'Rico: "Puerto Vela is yours, hermano. For now."',
    reward: 900,
    steps: [
      {
        kind: 'reach',
        text: 'Get to Banco Azul',
        poi: 'bank',
        radius: 12,
        needsCar: false,
      },
      {
        kind: 'kill',
        text: 'Fight off the guards (3 left)',
        count: 3,
        marker: null,
      },
      {
        kind: 'reach',
        text: 'Deliver the cash to the docks',
        poi: 'docks',
        radius: 13,
        needsCar: true,
      },
    ],
  },
];

export class MissionManager {
  constructor(app) {
    this.app = app;
    this.index = 0;
    this.step = 0;
    this.state = 'idle';      // idle | active | complete
    this.timer = 0;
    this.killCount = 0;
    this.marker = this.buildMarker();
    this.marker.visible = false;
    this.app.scene.add(this.marker);
    this.onChange = null;
    this.alertTimer = 0;
  }

  /** A gold pillar of light with a ring at the base — readable from a distance. */
  buildMarker() {
    const g = new THREE.Group();
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: GOLD, transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    pillar.position.y = 13;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.5, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    ring.position.y = 0.08;
    g.add(pillar, ring);
    g.userData.pillar = pillar;
    g.userData.ring = ring;
    return g;
  }

  get mission() { return MISSIONS[this.index] ?? null; }
  get currentStep() { return this.mission?.steps[this.step] ?? null; }

  start(index = 0) {
    this.index = Math.max(0, Math.min(MISSIONS.length - 1, index));
    this.step = 0;
    this.killCount = 0;
    this.state = 'active';
    this.beginStep();
    this.onChange?.();
  }

  beginStep() {
    const s = this.currentStep;
    this.timer = s?.duration ?? 0;
    this.killCount = 0;
    const pos = this.stepWorldPos();
    if (pos) {
      this.marker.position.set(pos.x, 0, pos.z);
      this.marker.visible = true;
    } else {
      this.marker.visible = false;
    }
    this.app.audio?.blip(880, 0.1, 'triangle', 0.12);
    this.onChange?.();
  }

  stepWorldPos() {
    const s = this.currentStep;
    if (!s) return null;
    if (s.poi) {
      const p = this.app.city.poi[s.poi];
      return p ? { x: p.x, z: p.z } : null;
    }
    return null;
  }

  /** Distance from the player to the current objective, for the HUD line. */
  objectiveDistance() {
    const pos = this.stepWorldPos();
    if (!pos) return null;
    const p = this.app.player.inCar ? this.app.player.inCar.pos : this.app.player.pos;
    return Math.hypot(pos.x - p.x, pos.z - p.z);
  }

  /** A step finished — advance, or complete the whole mission. */
  advance() {
    this.step += 1;
    if (this.step >= this.mission.steps.length) {
      this.completeMission();
    } else {
      this.beginStep();
    }
  }

  completeMission() {
    const m = this.mission;
    this.state = 'complete';
    this.marker.visible = false;
    this.app.player.cash += m.reward;
    this.app.audio?.missionDone();

    // Advance BEFORE the callback so an autosave records the *next* mission, not the finished
    // one. Saving first left CONTINUE resuming on a completed mission it could only replay.
    if (this.index < MISSIONS.length - 1) {
      this.index += 1;
      this.step = 0;
      this.state = 'idle';
    }
    this.onChange?.();
    this.app.onMissionComplete?.(m);
  }

  /** Called by combat when a guard dies during a kill step. */
  noteKill() {
    const s = this.currentStep;
    if (!s || s.kind !== 'kill' || this.state !== 'active') return;
    this.killCount += 1;
    this.onChange?.();
    if (this.killCount >= s.count) this.advance();
  }

  update(dt, player) {
    // marker pulse
    if (this.marker.visible) {
      const t = performance.now() / 1000;
      this.marker.userData.pillar.material.opacity = 0.16 + Math.sin(t * 2.2) * 0.07;
      this.marker.userData.ring.rotation.y = t * 0.7;
    }
    if (this.state !== 'active') return;
    const s = this.currentStep;
    if (!s) return;

    const inCar = !!player.inCar;
    const pos = inCar ? player.inCar.pos : player.pos;

    if (s.kind === 'reach') {
      if (s.needsCar && !inCar) return;
      if (s.poi) {
        const p = this.app.city.poi[s.poi];
        if (!p) return;
        if (Math.hypot(p.x - pos.x, p.z - pos.z) <= (s.radius ?? 12)) {
          if (s.action === 'provoke') this.app.wanted?.add(2.2, 'mission');
          this.advance();
        }
      } else if (s.needsCar && inCar) {
        // "steal a car": satisfied the moment the player is driving a car they took
        if (player.inCar?.stolen || player.inCar?.driver === 'player') this.advance();
      }
    } else if (s.kind === 'kill') {
      // kill steps are driven by noteKill(); nothing to poll
    } else if (s.kind === 'survive') {
      // must stay out of wanted sight
      const stars = this.app.wanted?.stars ?? 0;
      if (stars === 0) {
        this.timer -= dt;
        if (this.timer <= 0) this.advance();
      } else {
        this.timer = s.duration;
      }
    }
  }

  /** HUD text: "MISSION 2/3 · Heat on the Avenida". */
  titleLine() {
    if (!this.mission) return '';
    return `MISSION ${this.index + 1}/${MISSIONS.length} · ${this.mission.title}`;
  }

  /** HUD objective line, with the remaining count for kill steps. */
  objectiveLine() {
    const s = this.currentStep;
    if (!s || this.state !== 'active') return 'Press E at the golden marker to start';
    if (s.kind === 'kill') {
      return `${s.text.replace(/\d+/, Math.max(0, s.count - this.killCount))}`;
    }
    if (s.kind === 'survive') {
      return `${s.text} — ${Math.ceil(this.timer)}s`;
    }
    return s.text;
  }

  saveState() {
    return {
      index: this.index,
      step: this.step,
      state: this.state,
      timer: this.timer,
      killCount: this.killCount,
    };
  }

  loadState(st) {
    if (!st) return;
    this.index = st.index ?? 0;
    this.step = st.step ?? 0;
    this.state = st.state ?? 'idle';
    this.timer = st.timer ?? 0;
    this.killCount = st.killCount ?? 0;
    if (this.state === 'active') this.beginStep();
    this.onChange?.();
  }
}
