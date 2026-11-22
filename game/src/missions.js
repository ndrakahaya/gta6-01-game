// Story missions: three chained jobs that teach driving, then a chase, then a robbery run.
// Each mission is an ordered list of steps, each with a world marker, a HUD objective line and
// short dialogue. The manager owns the marker geometry (a glowing pillar readable across the
// city) and decides when a step is done, so the mission data stays declarative and readable.

import * as THREE from 'three';

// Marker colours.
const GOLD = 0xffcf5c;
const BLUE = 0x4ea8ff;
const RED = 0xff4d4d;

// Marker geometry constants.
const PILLAR_RADIUS = 1.5;
const PILLAR_HEIGHT = 26;
const RING_INNER = 1.6;
const RING_OUTER = 2.5;
const MARKER_DEFAULT_RADIUS = 12;   // fallback arrival radius when a step omits `radius`

// Heat added when a mission step deliberately provokes the police.
const PROVOKE_HEAT = 2.2;

/**
 * One mission = ordered steps. Each step is one of:
 *   reach   — get to a point (optionally while driving); may carry an `action`
 *   kill    — take out a number of guards
 *   survive — stay clear of the police for `duration` seconds
 *   drive   — (reserved) driving-specific objectives
 */
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

/**
 * Runs the mission chain: tracks the current step, shows or hides the world marker, and
 * reports progress to the HUD through onChange() and onMissionComplete().
 */
export class MissionManager {
  constructor(app) {
    this.app = app;

    this.index = 0;          // current mission
    this.step = 0;           // current step within the mission
    this.state = 'idle';     // idle | active | complete
    this.timer = 0;          // seconds remaining on timed steps
    this.killCount = 0;      // kills banked toward the current kill step

    this.marker = this.buildMarker();
    this.marker.visible = false;
    this.app.scene.add(this.marker);

    this.onChange = null;         // HUD refresh hook
    this.alertTimer = 0;          // reserved for a "new mission" banner
  }

  // ===== MARKER =====

  /** A gold pillar of light with a ring at the base — readable from a distance. */
  buildMarker() {
    const group = new THREE.Group();

    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(PILLAR_RADIUS, PILLAR_RADIUS, PILLAR_HEIGHT, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: GOLD,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,   // visible from inside as well as outside
        depthWrite: false,
      }),
    );
    pillar.position.y = PILLAR_HEIGHT / 2;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(RING_INNER, RING_OUTER, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    ring.position.y = 0.08;

    group.add(pillar, ring);
    group.userData.pillar = pillar;
    group.userData.ring = ring;
    return group;
  }

  // ===== QUERIES =====

  get mission() { return MISSIONS[this.index] ?? null; }
  get currentStep() { return this.mission?.steps[this.step] ?? null; }

  /**
   * World position of the current step's objective, or null when the marker is dynamic
   * (e.g. "steal any car").
   * @returns {{x: number, z: number}|null}
   */
  stepWorldPos() {
    const step = this.currentStep;
    if (!step?.poi) return null;

    const poi = this.app.city.poi[step.poi];
    return poi ? { x: poi.x, z: poi.z } : null;
  }

  /** Distance from the player to the current objective, for the HUD line. */
  objectiveDistance() {
    const target = this.stepWorldPos();
    if (!target) return null;

    const player = this.app.player;
    const pos = player.inCar ? player.inCar.pos : player.pos;
    return Math.hypot(target.x - pos.x, target.z - pos.z);
  }

  // ===== LIFECYCLE =====

  /**
   * Start a mission.
   * @param {number} index - Mission index to start
   */
  start(index = 0) {
    this.index = Math.max(0, Math.min(MISSIONS.length - 1, index));
    this.step = 0;
    this.killCount = 0;
    this.state = 'active';
    this.beginStep();
    this.onChange?.();
  }

  /** Enter the current step: reset the timer/kills, place the marker, cue the audio sting. */
  beginStep() {
    const step = this.currentStep;
    this.timer = step?.duration ?? 0;
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

  /** A step finished — advance, or complete the whole mission. */
  advance() {
    this.step += 1;

    if (this.step >= this.mission.steps.length) {
      this.completeMission();
    } else {
      this.beginStep();
    }
  }

  /** Pay the reward, hide the marker, and queue the next mission. */
  completeMission() {
    const mission = this.mission;

    this.state = 'complete';
    this.marker.visible = false;
    this.app.player.cash += mission.reward;
    this.app.audio?.missionDone();

    // Advance BEFORE the callback so an autosave records the *next* mission, not the finished
    // one. Saving first left CONTINUE resuming on a completed mission it could only replay.
    if (this.index < MISSIONS.length - 1) {
      this.index += 1;
      this.step = 0;
      this.state = 'idle';
    }

    this.onChange?.();
    this.app.onMissionComplete?.(mission);
  }

  /** Called by combat when a guard dies during a kill step. */
  noteKill() {
    const step = this.currentStep;
    if (!step || step.kind !== 'kill' || this.state !== 'active') return;

    this.killCount += 1;
    this.onChange?.();
    if (this.killCount >= step.count) this.advance();
  }

  // ===== PER-FRAME =====

  /**
   * Pulse the marker and evaluate the current objective condition.
   * @param {number} dt - Delta time in seconds
   * @param {Object} player - Player instance
   */
  update(dt, player) {
    this.pulseMarker();
    if (this.state !== 'active') return;

    const step = this.currentStep;
    if (!step) return;

    const inCar = !!player.inCar;
    const pos = inCar ? player.inCar.pos : player.pos;

    if (step.kind === 'reach') {
      this.updateReachStep(step, player, inCar, pos);
    } else if (step.kind === 'kill') {
      // Kill steps advance from noteKill(); nothing to poll here.
    } else if (step.kind === 'survive') {
      this.updateSurviveStep(dt, step);
    }
  }

  /** Animate the pillar opacity and ring rotation so the marker always reads as live. */
  pulseMarker() {
    if (!this.marker.visible) return;

    const t = performance.now() / 1000;
    this.marker.userData.pillar.material.opacity = 0.16 + Math.sin(t * 2.2) * 0.07;
    this.marker.userData.ring.rotation.y = t * 0.7;
  }

  /** Arrival check for a "reach" step. */
  updateReachStep(step, player, inCar, pos) {
    if (step.needsCar && !inCar) return;

    if (step.poi) {
      const poi = this.app.city.poi[step.poi];
      if (!poi) return;

      const radius = step.radius ?? MARKER_DEFAULT_RADIUS;
      if (Math.hypot(poi.x - pos.x, poi.z - pos.z) <= radius) {
        // Some steps provoke the police as a scripted consequence of arriving.
        if (step.action === 'provoke') this.app.wanted?.add(PROVOKE_HEAT, 'mission');
        this.advance();
      }
      return;
    }

    // "Steal a car": satisfied the moment the player is driving a car they took.
    if (step.needsCar && inCar) {
      if (player.inCar?.stolen || player.inCar?.driver === 'player') this.advance();
    }
  }

  /** Countdown check for a "survive" step: only ticks while the player is not wanted. */
  updateSurviveStep(dt, step) {
    const stars = this.app.wanted?.stars ?? 0;

    if (stars === 0) {
      this.timer -= dt;
      if (this.timer <= 0) this.advance();
    } else {
      // Being seen resets the clock — the whole point is to break line of sight.
      this.timer = step.duration;
    }
  }

  // ===== HUD TEXT =====

  /** HUD title: "MISSION 2/3 · Heat on the Avenida". */
  titleLine() {
    if (!this.mission) return '';
    return `MISSION ${this.index + 1}/${MISSIONS.length} · ${this.mission.title}`;
  }

  /** HUD objective line, with the remaining count for kill steps and a timer for survive steps. */
  objectiveLine() {
    const step = this.currentStep;
    if (!step || this.state !== 'active') return 'Press E at the golden marker to start';

    if (step.kind === 'kill') {
      // Replace the baked-in number in the step text with the live remaining count.
      return step.text.replace(/\d+/, Math.max(0, step.count - this.killCount));
    }
    if (step.kind === 'survive') {
      return `${step.text} — ${Math.ceil(this.timer)}s`;
    }
    return step.text;
  }

  // ===== PERSISTENCE =====

  /** Snapshot mission progress for the save file. */
  saveState() {
    return {
      index: this.index,
      step: this.step,
      state: this.state,
      timer: this.timer,
      killCount: this.killCount,
    };
  }

  /**
   * Restore mission progress from a save.
   * @param {Object|null} state - Payload from saveState()
   */
  loadState(state) {
    if (!state) return;

    this.index = state.index ?? 0;
    this.step = state.step ?? 0;
    this.state = state.state ?? 'idle';
    this.timer = state.timer ?? 0;
    this.killCount = state.killCount ?? 0;

    // Re-arm the marker and timer for an in-progress step.
    if (this.state === 'active') this.beginStep();
    this.onChange?.();
  }
}

// Re-exported so callers can reach the marker palette without importing internals.
export { GOLD, BLUE, RED };
