// Visual effects: one pooled particle system for sparks, smoke, blood, muzzle flashes and
// explosions, plus tyre skid decals. Everything is drawn from two meshes (a Points cloud and an
// instanced quad batch) so heavy action does not multiply draw calls.

import * as THREE from 'three';

const MAX_PARTICLES = 900;
const MAX_SKIDS = 260;

export class Effects {
  constructor(scene) {
    this.scene = scene;

    // ---- particle cloud ----
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: 0.42, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.pool = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, gravity: 1, drag: 0.6 });
    }
    this.live = 0;

    // ---- skid marks: flat dark quads laid on the road ----
    // Kept short and lightly translucent: at 1 m long with strong opacity these stamps overlapped
    // into dense branching veins across the asphalt, which read as a corrupted texture rather than
    // tyre wear.
    const skidGeo = new THREE.PlaneGeometry(0.22, 0.55).rotateX(-Math.PI / 2);
    const skidMat = new THREE.MeshBasicMaterial({
      color: 0x232326, transparent: true, opacity: 0.26, depthWrite: false,
    });
    this.skids = new THREE.InstancedMesh(skidGeo, skidMat, MAX_SKIDS);
    this.skids.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.skids.frustumCulled = false;
    this.skids.count = 0;
    this.skids.renderOrder = 2;
    scene.add(this.skids);
    this.skidCount = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);

    // ---- explosion flash light substitute: a bright expanding sphere ----
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcf70, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashT = 0;
  }

  emit(x, y, z, opts = {}) {
    if (this.live >= MAX_PARTICLES) return;
    const i = this.live++;
    const p = this.pool[i];
    const spread = opts.spread ?? 3;
    p.life = p.max = opts.life ?? 0.6;
    p.vx = (opts.vx ?? 0) + (Math.random() - 0.5) * spread;
    p.vy = (opts.vy ?? 2) + Math.random() * spread * 0.6;
    p.vz = (opts.vz ?? 0) + (Math.random() - 0.5) * spread;
    const c = new THREE.Color(opts.color ?? '#ffcc66');
    p.r = c.r; p.g = c.g; p.b = c.b;
    p.gravity = opts.gravity ?? 9;
    p.drag = opts.drag ?? 0.7;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.colors[i * 3] = c.r;
    this.colors[i * 3 + 1] = c.g;
    this.colors[i * 3 + 2] = c.b;
    this.sizes[i] = opts.size ?? 0.4;
  }

  burst(x, y, z, count, opts) {
    for (let i = 0; i < count; i++) this.emit(x, y, z, opts);
  }

  muzzle(x, y, z) {
    this.burst(x, y, z, 7, { color: '#ffd27a', life: 0.14, spread: 5, vy: 1.2, gravity: 2, size: 0.3 });
  }

  impact(x, y, z) {
    this.burst(x, y, z, 12, { color: '#ffb347', life: 0.4, spread: 6, vy: 3, gravity: 12, size: 0.28 });
  }

  blood(x, y, z) {
    this.burst(x, y, z, 10, { color: '#a01f22', life: 0.5, spread: 3.4, vy: 2.2, gravity: 14, size: 0.24 });
  }

  dust(x, y, z) {
    this.burst(x, y, z, 4, { color: '#b9ae96', life: 0.5, spread: 1.6, vy: 0.7, gravity: 2, size: 0.34 });
  }

  explode(x, y, z) {
    this.burst(x, y, z, 60, { color: '#ff8a2b', life: 0.9, spread: 13, vy: 7, gravity: 7, size: 0.75 });
    this.burst(x, y, z, 34, { color: '#4a4a4a', life: 1.7, spread: 7, vy: 5, gravity: -1.4, size: 1.0 });
    this.burst(x, y, z, 22, { color: '#ffe9a8', life: 0.35, spread: 18, vy: 4, gravity: 10, size: 0.5 });
    this.flash.position.set(x, y + 0.6, z);
    this.flash.visible = true;
    this.flashT = 0.42;
  }

  skid(x, z, heading) {
    if (this.skidCount >= MAX_SKIDS) {
      // ring buffer: overwrite the oldest mark
      this.skidCount = 0;
    }
    const i = this.skidCount++;
    this._e.set(0, heading, 0);
    this._q.setFromEuler(this._e);
    this._p.set(x, 0.045, z);
    this._m.compose(this._p, this._q, this._s);
    this.skids.setMatrixAt(i, this._m);
    this.skids.count = this.skidCount;
    this.skids.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    let n = 0;
    for (let i = 0; i < this.live; i++) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      // compact live particles to the front of the buffers
      const px = this.positions[i * 3] + p.vx * dt;
      const py = this.positions[i * 3 + 1] + p.vy * dt;
      const pz = this.positions[i * 3 + 2] + p.vz * dt;
      p.vy -= p.gravity * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      const fade = p.life / p.max;
      this.positions[n * 3] = px;
      this.positions[n * 3 + 1] = Math.max(0.04, py);
      this.positions[n * 3 + 2] = pz;
      this.colors[n * 3] = p.r * fade;
      this.colors[n * 3 + 1] = p.g * fade;
      this.colors[n * 3 + 2] = p.b * fade;
      this.sizes[n] = p.max;
      if (n !== i) this.pool[n] = p;
      n++;
    }
    this.live = n;
    this.points.geometry.setDrawRange(0, n);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    if (this.flashT > 0) {
      this.flashT -= dt;
      const t = Math.max(0, this.flashT / 0.42);
      this.flash.scale.setScalar(1 + (1 - t) * 7);
      this.flash.material.opacity = t * 0.85;
      if (this.flashT <= 0) this.flash.visible = false;
    }
  }
}
