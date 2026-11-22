// Builds Puerto Vela: a procedural grid city of roads, sidewalks, blocks, buildings, street
// furniture and a waterfront. Also exports the collider list and road graph that traffic,
// police and the player all navigate with.

import * as THREE from 'three';
import { CONFIG, WORLD } from './config.js';
import { makeRng, rngRange, rngInt, pick, chance } from './rng.js';
import {
  texAsphalt, texConcrete, texGrass, texSand, texRoof,
  texFacade, texShopfront, mergeGeoms, buildingGeo,
} from './geo.js';

const FACADE_TONES = [
  { key: 'sand', tone: '#c9b79a', style: 'shutter' },
  { key: 'coral', tone: '#c08a76', style: 'shutter' },
  { key: 'mint', tone: '#9fb8a4', style: 'plain' },
  { key: 'bone', tone: '#d8d2c4', style: 'ribbon' },
  { key: 'slate', tone: '#8d97a0', style: 'ribbon' },
  { key: 'clay', tone: '#a8705a', style: 'brick' },
  { key: 'cream', tone: '#e0d6bd', style: 'plain' },
  { key: 'teal', tone: '#7d9aa0', style: 'plain' },
];

export function roadCenter(i) {
  return i * CONFIG.CELL;
}

/** True when a world point sits on drivable asphalt (used for spawns and ped paths). */
export function onRoad(x, z) {
  const half = CONFIG.ROAD_W / 2;
  const gx = Math.abs(x / CONFIG.CELL - Math.round(x / CONFIG.CELL)) * CONFIG.CELL;
  const gz = Math.abs(z / CONFIG.CELL - Math.round(z / CONFIG.CELL)) * CONFIG.CELL;
  return gx <= half || gz <= half;
}

export function buildCity(scene, seed = 20261117) {
  const rng = makeRng(seed);
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  const colliders = [];      // {minX,maxX,minZ,maxZ,h} axis-aligned boxes the player cannot enter
  const buildings = [];      // visual metadata, used for minimap tinting
  const lampPositions = [];
  const treePositions = [];
  const parkedSpots = [];    // {x,z,rot} good spots for parked cars
  const pedRoutes = [];      // sidewalk polylines

  const N = CONFIG.GRID;
  const CELL = CONFIG.CELL;
  const ROAD = CONFIG.ROAD_W;
  const SW = CONFIG.SIDEWALK;
  const span = N * CELL;

  // ---------- ground ----------
  const groundGeo = new THREE.PlaneGeometry(span * 2.6, span * 2.6);
  groundGeo.rotateX(-Math.PI / 2);
  const gtex = texGrass();
  gtex.repeat.set(120, 120);
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshLambertMaterial({ map: gtex, color: 0x9aa88c }),
  );
  ground.position.set(span / 2, -0.05, span / 2);
  ground.receiveShadow = false;
  group.add(ground);

  // ---------- asphalt ----------
  const asphalt = texAsphalt();
  asphalt.repeat.set(2, 26);
  const roadMat = new THREE.MeshLambertMaterial({ map: asphalt, color: 0xd8dce2 });
  const roadParts = [];
  for (let i = 0; i <= N; i++) {
    const c = roadCenter(i);
    // north-south strip
    roadParts.push({
      geometry: new THREE.PlaneGeometry(ROAD, span + ROAD).rotateX(-Math.PI / 2),
      matrix: new THREE.Matrix4().makeTranslation(c, 0.01, span / 2),
    });
    // east-west strip
    roadParts.push({
      geometry: new THREE.PlaneGeometry(span + ROAD, ROAD).rotateX(-Math.PI / 2),
      matrix: new THREE.Matrix4().makeTranslation(span / 2, 0.012, c),
    });
  }
  const roadGeo = mergeGeoms(roadParts);
  const roads = new THREE.Mesh(roadGeo, roadMat);
  roads.name = 'roads';
  group.add(roads);

  // ---------- lane markings ----------
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8e2cf });
  const lineParts = [];
  const dashLen = 3.0;
  const dashGap = 3.6;
  const junction = ROAD / 2 + SW * 0.55;
  for (let i = 0; i <= N; i++) {
    const c = roadCenter(i);
    // walk each straight run between two intersections and lay dashes on it
    for (let k = 0; k < N; k++) {
      const a = roadCenter(k) + junction;
      const b = roadCenter(k + 1) - junction;
      for (let t = a; t + dashLen <= b; t += dashLen + dashGap) {
        const mid = t + dashLen / 2;
        lineParts.push({
          geometry: new THREE.PlaneGeometry(0.3, dashLen).rotateX(-Math.PI / 2),
          matrix: new THREE.Matrix4().makeTranslation(c, 0.035, mid + dashLen / 2),
        });
        lineParts.push({
          geometry: new THREE.PlaneGeometry(dashLen, 0.3).rotateX(-Math.PI / 2),
          matrix: new THREE.Matrix4().makeTranslation(mid + dashLen / 2, 0.036, c),
        });
      }
    }
  }
  // solid stop lines at each intersection mouth
  const stopParts = [];
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const cx = roadCenter(i);
      const cz = roadCenter(j);
      const off = ROAD / 2 + 0.9;
      for (const [dx, dz, w, d] of [
        [0, -off, ROAD, 0.4], [0, off, ROAD, 0.4],
        [-off, 0, 0.4, ROAD], [off, 0, 0.4, ROAD],
      ]) {
        stopParts.push({
          geometry: new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
          matrix: new THREE.Matrix4().makeTranslation(cx + dx * 1.1, 0.037, cz + dz * 1.1),
        });
      }
    }
  }
  const markings = new THREE.Mesh(mergeGeoms(lineParts), lineMat);
  markings.name = 'lane-markings';
  group.add(markings);
  const stops = new THREE.Mesh(mergeGeoms(stopParts), new THREE.MeshBasicMaterial({ color: 0xd9d2bc }));
  stops.name = 'stop-lines';
  group.add(stops);

  // ---------- blocks: sidewalk slab + buildings ----------
  const concrete = texConcrete();
  const walkMat = new THREE.MeshLambertMaterial({ map: concrete, color: 0xd6d2c8 });
  walkMat.polygonOffset = true;
  walkMat.polygonOffsetFactor = -1;

  const facadeCache = new Map();
  const facadeMat = (tone) => {
    if (facadeCache.has(tone.key)) return facadeCache.get(tone.key);
    const t = texFacade(tone.key, tone.tone, tone.style);
    const m = new THREE.MeshLambertMaterial({ map: t });
    facadeCache.set(tone.key, m);
    return m;
  };

  const roofTex = texRoof();
  roofTex.repeat.set(3, 3);
  const roofMat = new THREE.MeshLambertMaterial({ map: roofTex, color: 0x9aa0a6 });
  const shopTex = texShopfront();
  const shopMat = new THREE.MeshLambertMaterial({ map: shopTex });

  // Group merged building bodies by facade material key.
  const bodyParts = new Map();
  const roofParts = [];
  const shopParts = [];
  const trimParts = [];

  const blockInner = CELL - ROAD - SW * 2; // usable footprint per block

  for (let bx = 0; bx < N; bx++) {
    for (let bz = 0; bz < N; bz++) {
      const x0 = bx * CELL + ROAD / 2 + SW;
      const z0 = bz * CELL + ROAD / 2 + SW;
      const cx = x0 + blockInner / 2;
      const cz = z0 + blockInner / 2;

      // sidewalk slab under the whole block
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(blockInner + SW * 2, 0.22, blockInner + SW * 2),
        walkMat,
      );
      slab.position.set(cx, 0.11, cz);
      group.add(slab);

      const isPark = chance(rng, 0.085);
      if (isPark) {
        // a little green with trees: no collider so the player can cross it
        const grassTex = texGrass();
        const gm = new THREE.MeshLambertMaterial({ map: grassTex, color: 0x9fbb86 });
        const patch = new THREE.Mesh(new THREE.BoxGeometry(blockInner * 0.72, 0.14, blockInner * 0.72), gm);
        patch.position.set(cx, 0.22, cz);
        group.add(patch);
        const nTrees = rngInt(rng, 3, 6);
        for (let t = 0; t < nTrees; t++) {
          treePositions.push({
            x: cx + rngRange(rng, -blockInner * 0.3, blockInner * 0.3),
            z: cz + rngRange(rng, -blockInner * 0.3, blockInner * 0.3),
            s: rngRange(rng, 0.85, 1.35),
          });
        }
        continue;
      }

      // split the block into 1-3 lots along one axis so the skyline varies
      const lots = blockInner > 26 ? rngInt(rng, 1, 3) : 1;
      const axis = chance(rng, 0.5) ? 'x' : 'z';
      const lotSize = blockInner / lots;
      for (let l = 0; l < lots; l++) {
        const inset = rngRange(rng, 0.5, 1.6);
        const w = axis === 'x' ? lotSize - inset * 1.6 : blockInner - inset * 1.6;
        const d = axis === 'x' ? blockInner - inset * 1.6 : lotSize - inset * 1.6;
        const px = axis === 'x' ? x0 + l * lotSize + lotSize / 2 : cx;
        const pz = axis === 'x' ? cz : z0 + l * lotSize + lotSize / 2;

        const floors = pick(rng, [2, 3, 3, 4, 5, 6, 8, 10]);
        const h = floors * 3.4 + rngRange(rng, 0, 2);
        const tone = pick(rng, FACADE_TONES);
        const matKey = tone.key;

        // body sits on top of the 0.22 slab
        const geo = buildingGeo(w, h, d);
        const z0y = 0.22;
        bodyParts.set(matKey, bodyParts.get(matKey) ?? []);
        bodyParts.get(matKey).push({
          geometry: geo,
          matrix: new THREE.Matrix4().makeTranslation(px, z0y + h / 2, pz),
        });

        // ground-floor shopfront band on taller buildings facing the road
        if (h > 10) {
          const bandH = 3.0;
          shopParts.push({
            geometry: new THREE.BoxGeometry(w + 0.06, bandH, d + 0.06),
            matrix: new THREE.Matrix4().makeTranslation(px, z0y + bandH / 2, pz),
          });
        }

        // parapet + roof
        roofParts.push({
          geometry: new THREE.BoxGeometry(w + 0.5, 0.45, d + 0.5),
          matrix: new THREE.Matrix4().makeTranslation(px, z0y + h + 0.1, pz),
        });
        // a rooftop box (AC unit / stair house) for silhouette interest
        if (chance(rng, 0.6)) {
          const bw = w * rngRange(rng, 0.2, 0.35);
          const bd = d * rngRange(rng, 0.2, 0.35);
          trimParts.push({
            geometry: new THREE.BoxGeometry(bw, rngRange(rng, 1.0, 2.2), bd),
            matrix: new THREE.Matrix4().makeTranslation(
              px + rngRange(rng, -w * 0.2, w * 0.2),
              z0y + h + 0.9,
              pz + rngRange(rng, -d * 0.2, d * 0.2),
            ),
          });
        }

        colliders.push({
          minX: px - w / 2, maxX: px + w / 2,
          minZ: pz - d / 2, maxZ: pz + d / 2,
          h: h + z0y,
        });
        buildings.push({ x: px, z: pz, w, d, h, tone: tone.key });
      }
    }
  }

  for (const [key, parts] of bodyParts) {
    if (!parts.length) continue;
    const tone = FACADE_TONES.find((t) => t.key === key);
    const mesh = new THREE.Mesh(mergeGeoms(parts), facadeMat(tone));
    mesh.name = `buildings-${key}`;
    group.add(mesh);
  }
  if (shopParts.length) {
    const m = new THREE.Mesh(mergeGeoms(shopParts), shopMat);
    m.name = 'shopfronts';
    group.add(m);
  }
  if (roofParts.length) {
    const m = new THREE.Mesh(mergeGeoms(roofParts), roofMat);
    m.name = 'roofs';
    group.add(m);
  }
  if (trimParts.length) {
    const m = new THREE.Mesh(mergeGeoms(trimParts), new THREE.MeshLambertMaterial({ color: 0xb3b7bb }));
    m.name = 'rooftop-units';
    group.add(m);
  }

  // ---------- street lamps ----------
  const lampPoleParts = [];
  const lampHeadParts = [];
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      if (!chance(rng, 0.55)) continue;
      const cx = roadCenter(i);
      const cz = roadCenter(j) + CELL * 0.5;
      if (cz > span - 2) continue;
      const side = chance(rng, 0.5) ? 1 : -1;
      const lx = cx + side * (ROAD / 2 + 1.0);
      lampPositions.push({ x: lx, z: cz });
      lampPoleParts.push({
        geometry: new THREE.CylinderGeometry(0.13, 0.17, 6.4, 6),
        matrix: new THREE.Matrix4().makeTranslation(lx, 3.2, cz),
      });
      lampHeadParts.push({
        geometry: new THREE.BoxGeometry(1.1, 0.22, 0.5),
        matrix: new THREE.Matrix4().makeTranslation(lx - side * 0.5, 6.4, cz),
      });
    }
  }
  if (lampPoleParts.length) {
    const poles = new THREE.Mesh(mergeGeoms(lampPoleParts), new THREE.MeshLambertMaterial({ color: 0x555c63 }));
    poles.name = 'lamp-poles';
    group.add(poles);
    const heads = new THREE.Mesh(
      mergeGeoms(lampHeadParts),
      new THREE.MeshBasicMaterial({ color: 0xffe9b8 }),
    );
    heads.name = 'lamp-heads';
    group.add(heads);
  }

  // ---------- trees ----------
  if (treePositions.length) {
    const trunkParts = [];
    const crownParts = [];
    for (const t of treePositions) {
      trunkParts.push({
        geometry: new THREE.CylinderGeometry(0.22 * t.s, 0.3 * t.s, 2.4 * t.s, 6),
        matrix: new THREE.Matrix4().makeTranslation(t.x, 1.2 * t.s, t.z),
      });
      crownParts.push({
        geometry: new THREE.IcosahedronGeometry(1.85 * t.s, 0),
        matrix: new THREE.Matrix4().makeTranslation(t.x, 3.5 * t.s, t.z),
      });
      colliders.push({
        minX: t.x - 0.4, maxX: t.x + 0.4,
        minZ: t.z - 0.4, maxZ: t.z + 0.4, h: 2.4 * t.s,
      });
    }
    group.add(new THREE.Mesh(mergeGeoms(trunkParts), new THREE.MeshLambertMaterial({ color: 0x5b4632 })));
    group.add(new THREE.Mesh(mergeGeoms(crownParts), new THREE.MeshLambertMaterial({ color: 0x4a7a44, flatShading: true })));
  }

  // ---------- waterfront along the south edge ----------
  const sandTex = texSand();
  sandTex.repeat.set(30, 6);
  const beach = new THREE.Mesh(
    new THREE.BoxGeometry(span + 160, 0.1, 46),
    new THREE.MeshLambertMaterial({ map: sandTex, color: 0xd8c49b }),
  );
  beach.position.set(span / 2, 0.02, span + 23);
  group.add(beach);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 2.4, 900, 1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x2c6f8f, transparent: true, opacity: 0.92 }),
  );
  water.position.set(span / 2, -0.35, span + 46 + 450);
  water.name = 'sea';
  group.add(water);

  // ---------- parked car spots along every other curb ----------
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j < N; j++) {
      if (!chance(rng, 0.5)) continue;
      const c = roadCenter(i);
      const z = roadCenter(j) + CELL * 0.5 + rngRange(rng, -4, 4);
      const side = chance(rng, 0.5) ? 1 : -1;
      parkedSpots.push({
        x: c + side * (ROAD / 2 - 1.9),
        z,
        rot: side > 0 ? Math.PI : 0,
      });
    }
  }
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i < N; i++) {
      if (!chance(rng, 0.5)) continue;
      const c = roadCenter(j);
      const x = roadCenter(i) + CELL * 0.5 + rngRange(rng, -4, 4);
      const side = chance(rng, 0.5) ? 1 : -1;
      parkedSpots.push({
        x,
        z: c + side * (ROAD / 2 - 1.9),
        rot: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      });
    }
  }

  // ---------- sidewalk routes for pedestrians (one per block edge) ----------
  for (let i = 0; i <= N; i++) {
    const x = roadCenter(i) + (ROAD / 2 + SW * 0.5);
    pedRoutes.push({ axis: 'z', fixed: x, from: ROAD / 2, to: span - ROAD / 2 });
    pedRoutes.push({ axis: 'z', fixed: roadCenter(i) - (ROAD / 2 + SW * 0.5), from: ROAD / 2, to: span - ROAD / 2 });
  }
  for (let j = 0; j <= N; j++) {
    const z = roadCenter(j) + (ROAD / 2 + SW * 0.5);
    pedRoutes.push({ axis: 'x', fixed: z, from: ROAD / 2, to: span - ROAD / 2 });
    pedRoutes.push({ axis: 'x', fixed: roadCenter(j) - (ROAD / 2 + SW * 0.5), from: ROAD / 2, to: span - ROAD / 2 });
  }

  // ---------- road graph for traffic ----------
  const nodes = [];
  const index = (i, j) => j * (N + 1) + i;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      nodes.push({ i, j, x: roadCenter(i), z: roadCenter(j) });
    }
  }
  const neighbours = nodes.map((n) => {
    const out = [];
    if (n.i > 0) out.push(index(n.i - 1, n.j));
    if (n.i < N) out.push(index(n.i + 1, n.j));
    if (n.j > 0) out.push(index(n.i, n.j - 1));
    if (n.j < N) out.push(index(n.i, n.j + 1));
    return out;
  });

  // Named places the story leans on: an intersection plus a facing point.
  const poi = {
    garage: { x: roadCenter(2), z: roadCenter(9) + 7, name: 'Garage' },
    docks: { x: roadCenter(8), z: roadCenter(9) + 12, name: 'Docks' },
    club: { x: roadCenter(5), z: roadCenter(6), name: 'Club Neon' },
    bank: { x: roadCenter(3), z: roadCenter(4), name: 'Banco Azul' },
    airstrip: { x: roadCenter(9), z: roadCenter(2), name: 'Airstrip' },
    marina: { x: roadCenter(2), z: roadCenter(2), name: 'Marina' },
    plaza: { x: roadCenter(5), z: roadCenter(1), name: 'Plaza Sol' },
  };

  const centre = { x: span / 2, z: span / 2 };

  return {
    group, colliders, buildings, nodes, neighbours, index,
    lampPositions, parkedSpots, pedRoutes, poi, centre,
    span, cell: CELL, grid: N, roadWidth: ROAD, sidewalk: SW,
    /** A good starting spot: mid-block on the main avenue, facing the plaza. */
    spawnPoint: { x: roadCenter(5) + 3.4, z: roadCenter(6) + 12, yaw: Math.PI },
    /** Nearest road-graph node index to a world position. */
    nearestNode(x, z) {
      const i = Math.max(0, Math.min(N, Math.round(x / CELL)));
      const j = Math.max(0, Math.min(N, Math.round(z / CELL)));
      return index(i, j);
    },
    /** Random drivable point (on a road, mid-block) — used for spawns. */
    randomRoadPoint(rand = Math.random) {
      const vertical = rand() < 0.5;
      const a = Math.floor(rand() * (N + 1));
      const b = (Math.floor(rand() * N) + 0.5) * CELL;
      if (vertical) return { x: roadCenter(a), z: b, rot: rand() < 0.5 ? 0 : Math.PI };
      return { x: b, z: roadCenter(a), rot: rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2 };
    },
  };
}
