// Sky, sun, hemisphere fill and distance fog. A single gradient dome plus a sun disc, so the
// whole scene reads as a bright coastal afternoon with no post-processing.

import * as THREE from 'three';
import { CONFIG } from './config.js';

export function buildSky(scene, renderer) {
  const skyGeo = new THREE.SphereGeometry(1400, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(CONFIG.world.skyTop) },
      horizon: { value: new THREE.Color(CONFIG.world.skyHorizon) },
      sunDir: { value: new THREE.Vector3(...CONFIG.world.sunDir).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 1.35 + 0.06, -1.0, 1.0);
        float t = pow(clamp(h, 0.0, 1.0), 0.62);
        vec3 col = mix(horizon, top, t);
        float sun = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.86, 0.62) * pow(sun, 26.0) * 0.85;
        col += vec3(1.0, 0.72, 0.42) * pow(sun, 5.0) * 0.10;
        // warm haze near the horizon
        col = mix(col, vec3(0.96, 0.90, 0.80), pow(1.0 - clamp(h, 0.0, 1.0), 9.0) * 0.5);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  scene.add(sky);

  scene.fog = new THREE.Fog(CONFIG.world.fogColor, CONFIG.world.fogNear, CONFIG.world.fogFar);

  // Key light: warm low sun with a wide shadow-less falloff (shadows are baked as blob decals)
  const sun = new THREE.DirectionalLight(0xfff0d4, 1.62);
  const dir = new THREE.Vector3(...CONFIG.world.sunDir).normalize();
  sun.position.copy(dir.clone().multiplyScalar(220));
  sun.target.position.set(200, 0, 200);
  sun.name = 'sun';
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xbcd9f0, 0x6d6552, 0.86);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xffffff, 0.24);
  scene.add(ambient);

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  return { sky, sun, hemi, ambient };
}
