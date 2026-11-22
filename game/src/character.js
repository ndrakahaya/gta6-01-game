// Low-poly humanoid built from boxes, with a skeleton of nested groups so limbs can swing.
// Shared by the player, pedestrians and police; only the palette and props differ.

import * as THREE from 'three';
import { mergeGeoms, texFace } from './geo.js';

const SKIN = ['#c98f6b', '#a9704f', '#e0b48c', '#7d5236', '#d9a679', '#5f3d28'];
const SHIRT = ['#d9534f', '#3f7cac', '#f0ad4e', '#5cb85c', '#8e6cb0', '#e8e8e8', '#2f3b46', '#c96f9c'];
const PANTS = ['#2d3a4a', '#3c3c46', '#5a4632', '#243036', '#4b4b58', '#6b6b6b'];
const HAIR = ['#1a1a1a', '#3b2416', '#6b4a2a', '#9c7b4a', '#20242c'];

function box(w, h, d, color, opts = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshLambertMaterial({ color, flatShading: !!opts.flat });
  const mesh = new THREE.Mesh(g, m);
  return mesh;
}

/**
 * Builds a humanoid. Returns {root, parts} where parts holds the joints the animator drives.
 * Origin at the feet, facing +Z.
 */
export function buildCharacter(rng, palette = {}) {
  const skin = palette.skin ?? SKIN[Math.floor(rng() * SKIN.length)];
  const shirt = palette.shirt ?? SHIRT[Math.floor(rng() * SHIRT.length)];
  const pants = palette.pants ?? PANTS[Math.floor(rng() * PANTS.length)];
  const hair = palette.hair ?? HAIR[Math.floor(rng() * HAIR.length)];
  const build = palette.build ?? (0.92 + rng() * 0.16);

  const root = new THREE.Group();
  root.name = 'character';

  const hips = new THREE.Group();
  hips.position.y = 0.92 * build;
  root.add(hips);

  // Torso
  const torso = box(0.56, 0.66, 0.32, shirt);
  torso.position.y = 0.33;
  hips.add(torso);

  // Neck + head
  const neck = box(0.16, 0.08, 0.16, skin);
  neck.position.y = 0.70;
  hips.add(neck);
  const head = box(0.30, 0.32, 0.30, skin);
  head.position.y = 0.90;
  hips.add(head);
  // Face only on the +Z face of the head box; the rest keeps the plain skin material.
  const faceTex = texFace(`${skin}-${hair}`, skin, hair);
  const faceMat = new THREE.MeshLambertMaterial({ map: faceTex });
  const faceGeo = new THREE.PlaneGeometry(0.295, 0.315);
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.position.set(0, 0.90, 0.1508);
  hips.add(face);
  const hairMesh = box(0.32, 0.10, 0.32, hair);
  hairMesh.position.y = 1.045;
  hips.add(hairMesh);

  // Arms: shoulder pivot at the top of the limb
  const makeArm = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.34, 0.60, 0);
    const upper = box(0.15, 0.34, 0.16, shirt);
    upper.position.y = -0.17;
    pivot.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    const fore = box(0.14, 0.30, 0.15, skin);
    fore.position.y = -0.15;
    elbow.add(fore);
    const hand = box(0.13, 0.11, 0.14, skin);
    hand.position.y = -0.33;
    elbow.add(hand);
    pivot.add(elbow);
    hips.add(pivot);
    return { pivot, elbow };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // Legs
  const makeLeg = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.15, 0.02, 0);
    const thigh = box(0.19, 0.42, 0.20, pants);
    thigh.position.y = -0.21;
    pivot.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    const shin = box(0.17, 0.40, 0.18, pants);
    shin.position.y = -0.20;
    knee.add(shin);
    const shoe = box(0.19, 0.10, 0.28, '#1c1f24');
    shoe.position.set(0, -0.44, 0.04);
    knee.add(shoe);
    pivot.add(knee);
    hips.add(pivot);
    return { pivot, knee };
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  const parts = {
    hips, torso, head, hair: hairMesh,
    armL: armL.pivot, foreL: armL.elbow,
    armR: armR.pivot, foreR: armR.elbow,
    legL: legL.pivot, shinL: legL.knee,
    legR: legR.pivot, shinR: legR.knee,
    build,
  };
  return { root, parts };
}

/**
 * Drives the limb skeleton from a walk cycle phase and speed.
 * `phase` advances with distance travelled; `armSwing` is overridden when aiming/carrying.
 */
export function animateCharacter(parts, phase, speed01, opts = {}) {
  const amp = Math.min(1, speed01) * (opts.run ? 1.35 : 1.0);
  const s = Math.sin(phase);
  const c = Math.cos(phase * 2);

  parts.hips.position.y = (0.92 * parts.build) + Math.abs(s) * 0.045 * amp + (opts.crouch ? -0.22 : 0);

  parts.legL.rotation.x = s * 0.85 * amp;
  parts.legR.rotation.x = -s * 0.85 * amp;
  parts.shinL.rotation.x = Math.max(0, -s) * 0.9 * amp;
  parts.shinR.rotation.x = Math.max(0, s) * 0.9 * amp;

  if (opts.aiming) {
    // right arm forward holding a weapon, left arm steady
    parts.armR.rotation.x = -1.45;
    parts.armR.rotation.z = 0.06;
    parts.foreR.rotation.x = -0.12;
    parts.armL.rotation.x = -0.55;
    parts.armL.rotation.z = -0.4;
    parts.foreL.rotation.x = -0.7;
  } else if (opts.punch) {
    const t = opts.punch; // 0..1 swing progress
    const swing = Math.sin(t * Math.PI);
    parts.armR.rotation.x = -1.9 * swing;
    parts.armR.rotation.z = -0.2 * swing;
    parts.foreR.rotation.x = -0.35;
    parts.armL.rotation.x = 0.6 * swing;
    parts.armL.rotation.z = 0.12;
    parts.foreL.rotation.x = -0.5;
  } else {
    parts.armR.rotation.x = -s * 0.7 * amp;
    parts.armL.rotation.x = s * 0.7 * amp;
    parts.armR.rotation.z = 0.05;
    parts.armL.rotation.z = -0.05;
    parts.foreR.rotation.x = -0.25 - Math.abs(s) * 0.35 * amp;
    parts.foreL.rotation.x = -0.25 - Math.abs(c) * 0.2 * amp;
  }

  // slight body lean when moving fast
  parts.torso.rotation.x = Math.min(0.22, speed01 * 0.16);
}

/** A tiny pistol so the armed state reads at screenshot scale. */
export function buildPistol() {
  const g = new THREE.Group();
  const slide = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.09, 0.30),
    new THREE.MeshLambertMaterial({ color: 0x2b2f33 }),
  );
  slide.position.z = 0.08;
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.16, 0.09),
    new THREE.MeshLambertMaterial({ color: 0x3b3229 }),
  );
  grip.position.set(0, -0.11, 0.0);
  grip.rotation.x = -0.25;
  g.add(slide, grip);
  g.position.set(0.02, -0.34, 0.10);
  return g;
}

/** Simple hard shadows: a dark ellipse decal under an actor, cheaper than shadow maps. */
export function buildBlobShadow(radius = 0.5, opacity = 0.34) {
  const g = new THREE.CircleGeometry(radius, 14).rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity, depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.y = 0.03;
  mesh.renderOrder = 1;
  return mesh;
}

export { SKIN, SHIRT, PANTS, HAIR };
