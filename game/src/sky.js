// Sky dome, sun, hemispheric fill, ambient fill and distance fog.
// A single gradient shader dome plus a procedural sun disc gives a bright coastal afternoon
// with no post-processing and no image assets.

import * as THREE from 'three';
import { CONFIG } from './config.js';

// Dome radius. Far enough out that the fog and the far clip plane never bite into it, while
// still small enough that a 24x16 sphere has plenty of tessellation for a smooth gradient.
const SKY_RADIUS = 1400;

// The sun's core and halo colours, and the horizon haze tint, are written as literals inside the
// fragment shader below — they are per-fragment constants there, not uniforms.

/**
 * Build the sky dome, lighting rig and fog for the scene.
 * @param {THREE.Scene} scene - Scene to populate
 * @param {THREE.WebGLRenderer} renderer - Renderer, configured here for tone mapping
 * @returns {Object} - { sky, sun, hemi, ambient } references for the caller to keep
 */
export function buildSky(scene, renderer) {
  const skyGeometry = new THREE.SphereGeometry(SKY_RADIUS, 24, 16);

  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,   // render the inside of the dome
    depthWrite: false,      // never occlude anything
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
        // Vertical gradient: remap the view direction's height into a 0..1 blend factor.
        float h = clamp(vDir.y * 1.35 + 0.06, -1.0, 1.0);
        float t = pow(clamp(h, 0.0, 1.0), 0.62);
        vec3 col = mix(horizon, top, t);

        // Sun disc: a tight bright core with a wide, far dimmer halo around it.
        float sun = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.86, 0.62) * pow(sun, 26.0) * 0.85;
        col += vec3(1.0, 0.72, 0.42) * pow(sun, 5.0) * 0.10;

        // Warm haze near the horizon, tinting the whole lower sky.
        col = mix(col, vec3(0.96, 0.90, 0.80), pow(1.0 - clamp(h, 0.0, 1.0), 9.0) * 0.5);

        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.name = 'sky';
  // The dome always surrounds the camera, so frustum culling it would be wrong (and pointless).
  sky.frustumCulled = false;
  scene.add(sky);

  // Distance fog matched to the horizon colour so the world edge dissolves instead of ending.
  scene.fog = new THREE.Fog(CONFIG.world.fogColor, CONFIG.world.fogNear, CONFIG.world.fogFar);

  // Key light: warm, low afternoon sun positioned far along the configured direction.
  const sunDirection = new THREE.Vector3(...CONFIG.world.sunDir).normalize();
  const sun = new THREE.DirectionalLight(0xfff0d4, 1.62);
  sun.position.copy(sunDirection.clone().multiplyScalar(220));
  sun.target.position.set(200, 0, 200);
  sun.name = 'sun';
  // Shadows are faked with blob decals under actors, so this light casts none — cheaper by far.
  scene.add(sun, sun.target);

  // Sky/ground hemisphere fill keeps unlit faces from going flat black.
  const hemi = new THREE.HemisphereLight(0xbcd9f0, 0x6d6552, 0.86);
  scene.add(hemi);

  // A touch of flat ambient so nothing is ever fully in shadow.
  const ambient = new THREE.AmbientLight(0xffffff, 0.24);
  scene.add(ambient);

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  return { sky, sun, hemi, ambient };
}
