// Low-poly 3D character system with box-based geometry and skeletal animation
// Creates humanoid characters from simple boxes with nested group hierarchies for limb movement
// Shared by player characters, pedestrians, and police - customized through color palettes and props

import * as THREE from 'three';
import { texFace } from './geo.js';

// ===== CHARACTER COLOR PALETTES =====

/** Skin tone colors for character customization */
const SKIN_COLORS = ['#c98f6b', '#a9704f', '#e0b48c', '#7d5236', '#d9a679', '#5f3d28'];
/** Shirt colors for character customization */
const SHIRT_COLORS = ['#d9534f', '#3f7cac', '#f0ad4e', '#5cb85c', '#8e6cb0', '#e8e8e8', '#2f3b46', '#c96f9c'];
/** Pants colors for character customization */
const PANTS_COLORS = ['#2d3a4a', '#3c3c46', '#5a4632', '#243036', '#4b4b58', '#6b6b6b'];
/** Hair colors for character customization */
const HAIR_COLORS = ['#1a1a1a', '#3b2416', '#6b4a2a', '#9c7b4a', '#20242c'];

// ===== GEOMETRY HELPERS =====

/**
 * Create a simple box mesh with specified material
 * @param {number} width - Box width
 * @param {number} height - Box height
 * @param {number} depth - Box depth
 * @param {string|number} color - Color for the box
 * @param {Object} opts - Optional rendering options
 * @param {boolean} opts.flat - Whether to use flat shading
 * @returns {THREE.Mesh} - Box mesh
 */
function createBox(width, height, depth, color, opts = {}) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshLambertMaterial({ 
    color, 
    flatShading: !!opts.flat 
  });
  const mesh = new THREE.Mesh(geometry, material);
  return mesh;
}

// ===== CHARACTER CREATION =====

/**
 * Build a low-poly humanoid character with skeletal structure
 * Creates a hierarchy of nested groups for limb animation
 * @param {Function} rng - Random number generator for character variation
 * @param {Object} palette - Custom color palette for character
 * @param {string} palette.skin - Skin color (defaults to random from SKIN_COLORS)
 * @param {string} palette.shirt - Shirt color (defaults to random from SHIRT_COLORS)
 * @param {string} palette.pants - Pants color (defaults to random from PANTS_COLORS)
 * @param {string} palette.hair - Hair color (defaults to random from HAIR_COLORS)
 * @param {number} palette.build - Body scale factor (0.92-1.08, default random)
 * @returns {Object} - Character object with root mesh and animation parts
 * @returns {THREE.Group} return.root - Root group containing entire character
 * @returns {Object} return.parts - Named joint groups for animation
 */
export function buildCharacter(rng, palette = {}) {
  // Select colors from palette or use random defaults
  const skinColor = palette.skin ?? SKIN_COLORS[Math.floor(rng() * SKIN_COLORS.length)];
  const shirtColor = palette.shirt ?? SHIRT_COLORS[Math.floor(rng() * SHIRT_COLORS.length)];
  const pantsColor = palette.pants ?? PANTS_COLORS[Math.floor(rng() * PANTS_COLORS.length)];
  const hairColor = palette.hair ?? HAIR_COLORS[Math.floor(rng() * HAIR_COLORS.length)];
  const bodyScale = palette.build ?? (0.92 + rng() * 0.16); // Height variation 92%-108%

  // Create root group
  const root = new THREE.Group();
  root.name = 'character';

  // Hip group (central pivot point)
  const hipGroup = new THREE.Group();
  hipGroup.position.y = 0.92 * bodyScale; // Hip position based on height
  root.add(hipGroup);

  // ===== TORSO SECTION =====
  const torso = createBox(0.56, 0.66, 0.32, shirtColor);
  torso.position.y = 0.33; // Center on hip group
  hipGroup.add(torso);

  // ===== HEAD AND NECK SECTION =====
  const neck = createBox(0.16, 0.08, 0.16, skinColor);
  neck.position.y = 0.70; // Position on top of torso
  hipGroup.add(neck);

  const head = createBox(0.30, 0.32, 0.30, skinColor);
  head.position.y = 0.90; // Position on top of neck
  hipGroup.add(head);

  // Add face texture to front of head
  const faceTexture = texFace(`${skinColor}-${hairColor}`, skinColor, hairColor);
  const faceMaterial = new THREE.MeshLambertMaterial({ map: faceTexture });
  const faceGeometry = new THREE.PlaneGeometry(0.295, 0.315);
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.position.set(0, 0.90, 0.1508); // Slightly in front of head
  hipGroup.add(face);

  // Hair (sits on top of head)
  const hair = createBox(0.32, 0.10, 0.32, hairColor);
  hair.position.y = 1.045; // Slightly above head
  hipGroup.add(hair);

  // ===== ARM CREATION =====
  /**
   * Create an arm with shoulder, upper arm, forearm, and hand
   * @param {number} side - -1 for left, 1 for right
   * @returns {Object} - Arm joint groups
   */
  const createArm = (side) => {
    const shoulderPivot = new THREE.Group();
    shoulderPivot.position.set(side * 0.34, 0.60, 0); // Position on torso
    hipGroup.add(shoulderPivot);

    // Upper arm
    const upperArm = createBox(0.15, 0.34, 0.16, shirtColor);
    upperArm.position.y = -0.17; // Extend downward from shoulder
    shoulderPivot.add(upperArm);

    // Elbow joint
    const elbowJoint = new THREE.Group();
    elbowJoint.position.y = -0.34; // Position at end of upper arm
    shoulderPivot.add(elbowJoint);

    // Forearm
    const forearm = createBox(0.14, 0.30, 0.15, skinColor);
    forearm.position.y = -0.15; // Extend downward from elbow
    elbowJoint.add(forearm);

    // Hand
    const hand = createBox(0.13, 0.11, 0.14, skinColor);
    hand.position.y = -0.33; // Position at end of forearm
    elbowJoint.add(hand);

    return { 
      shoulder: shoulderPivot, 
      elbow: elbowJoint 
    };
  };

  const leftArm = createArm(-1);
  const rightArm = createArm(1);

  // ===== LEG CREATION =====
  /**
   * Create a leg with hip, thigh, shin, and foot
   * @param {number} side - -1 for left, 1 for right
   * @returns {Object} - Leg joint groups
   */
  const createLeg = (side) => {
    const hipPivot = new THREE.Group();
    hipPivot.position.set(side * 0.15, 0.02, 0); // Position at hip level
    hipGroup.add(hipPivot);

    // Thigh
    const thigh = createBox(0.19, 0.42, 0.20, pantsColor);
    thigh.position.y = -0.21; // Extend downward from hip
    hipPivot.add(thigh);

    // Knee joint
    const kneeJoint = new THREE.Group();
    kneeJoint.position.y = -0.42; // Position at end of thigh
    hipPivot.add(kneeJoint);

    // Shin
    const shin = createBox(0.17, 0.40, 0.18, pantsColor);
    shin.position.y = -0.20; // Extend downward from knee
    kneeJoint.add(shin);

    // Foot/ shoe
    const foot = createBox(0.19, 0.10, 0.28, '#1c1f24');
    foot.position.set(0, -0.44, 0.04); // Position at end of shin with slight forward offset
    kneeJoint.add(foot);

    return { 
      hip: hipPivot, 
      knee: kneeJoint 
    };
  };

  const leftLeg = createLeg(-1);
  const rightLeg = createLeg(1);

  // ===== ANIMATION PARTS MAP =====
  // Provides named access to all joint groups for animation system
  const animationParts = {
    // Core body
    hips: hipGroup,
    torso: torso,
    head: head,
    hair: hair,
    
    // Arms (left and right)
    leftShoulder: leftArm.shoulder,
    leftElbow: leftArm.elbow,
    rightShoulder: rightArm.shoulder,
    rightElbow: rightArm.elbow,
    
    // Legs (left and right)
    leftHip: leftLeg.hip,
    leftKnee: leftLeg.knee,
    rightHip: rightLeg.hip,
    rightKnee: rightLeg.knee,
    
    // Character properties
    build: bodyScale,
  };

  return { root, parts: animationParts };
}

// ===== CHARACTER ANIMATION =====

/**
 * Animate character limbs based on movement state and actions
 * Drives the skeletal system with walk cycles and special animations
 * @param {Object} parts - Character animation parts from buildCharacter()
 * @param {number} phase - Animation phase (advances with movement distance)
 * @param {number} speed01 - Normalized speed (0-1, where 1 is running)
 * @param {Object} opts - Animation options
 * @param {boolean} opts.run - Whether character is running (affects animation amplitude)
 * @param {boolean} opts.aiming - Whether character is aiming (overrides walk cycle)
 * @param {number} opts.punch - Punch animation progress (0-1, 0 = no punch, 1 = full extension)
 * @param {boolean} opts.crouch - Whether character is crouching
 */
export function animateCharacter(parts, phase, speed01, opts = {}) {
  const amplitude = Math.min(1, speed01) * (opts.run ? 1.35 : 1.0); // Animation intensity
  const sinePhase = Math.sin(phase);
  const cosinePhase = Math.cos(phase * 2); // Double frequency for natural walk

  // Hip bobbing and height adjustment
  parts.hips.position.y = (0.92 * parts.build) + Math.abs(sinePhase) * 0.045 * amplitude + 
                          (opts.crouch ? -0.22 : 0);

  // Leg animations (walking/running cycle)
  parts.leftHip.rotation.x = sinePhase * 0.85 * amplitude;
  parts.rightHip.rotation.x = -sinePhase * 0.85 * amplitude;
  parts.leftKnee.rotation.x = Math.max(0, -sinePhase) * 0.9 * amplitude;
  parts.rightKnee.rotation.x = Math.max(0, sinePhase) * 0.9 * amplitude;

  // Arm animations based on current action
  if (opts.aiming) {
    // Aiming pose: right arm extended forward, left arm steady for balance
    parts.rightShoulder.rotation.x = -1.45; // Extended forward
    parts.rightShoulder.rotation.z = 0.06; // Slight inward angle
    parts.rightElbow.rotation.x = -0.12; // Slight bend in elbow
    parts.leftShoulder.rotation.x = -0.55; // Back for balance
    parts.leftShoulder.rotation.z = -0.4; // Outward for stability
    parts.leftElbow.rotation.x = -0.7; // Bent for balance
    
  } else if (opts.punch) {
    // Punch animation: timed forward motion. A falsy value means "no punch in progress".
    const punchProgress = opts.punch; // 0..1 swing progress
    const punchSwing = Math.sin(punchProgress * Math.PI);
    
    parts.rightShoulder.rotation.x = -1.9 * punchSwing; // Forward punch
    parts.rightShoulder.rotation.z = -0.2 * punchSwing; // Siding motion
    parts.rightElbow.rotation.x = -0.35; // Extended elbow
    parts.leftShoulder.rotation.x = 0.6 * punchSwing; // Counterbalance
    parts.leftShoulder.rotation.z = 0.12 * punchSwing; // Opposite motion
    parts.leftElbow.rotation.x = -0.5; // Defensive position
    
  } else {
    // Normal walking arm swing
    parts.rightShoulder.rotation.x = -sinePhase * 0.7 * amplitude;
    parts.leftShoulder.rotation.x = sinePhase * 0.7 * amplitude;
    parts.rightShoulder.rotation.z = 0.05; // Slight outward swing
    parts.leftShoulder.rotation.z = -0.05; // Slight inward swing
    parts.rightElbow.rotation.x = -0.25 - Math.abs(sinePhase) * 0.35 * amplitude;
    parts.leftElbow.rotation.x = -0.25 - Math.abs(cosinePhase) * 0.2 * amplitude;
  }

  // Body lean when moving fast (dynamic response to speed)
  parts.torso.rotation.x = Math.min(0.22, speed01 * 0.16);
}

// ===== PROPS AND ACCESSORIES =====

/**
 * Build a simple pistol prop for character hands
 * Creates a low-poly pistol that's visible at screenshot scale
 * @returns {THREE.Group} - Pistol group with slide and grip components
 */
export function buildPistol() {
  const pistolGroup = new THREE.Group();

  // Slide (main barrel section)
  const slide = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.09, 0.30),
    new THREE.MeshLambertMaterial({ color: 0x2b2f33 }), // Dark gray metal
  );
  slide.position.z = 0.08; // Extend forward
  pistolGroup.add(slide);

  // Grip (handle section)
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.16, 0.09),
    new THREE.MeshLambertMaterial({ color: 0x3b3229 }), // Brown/tan grip
  );
  grip.position.set(0, -0.11, 0.0); // Position below slide
  grip.rotation.x = -0.25; // Angle for natural grip
  pistolGroup.add(grip);

  // Position pistol in hand (right hand typically)
  pistolGroup.position.set(0.02, -0.34, 0.10);
  
  return pistolGroup;
}

// ===== VISUAL EFFECTS =====

/**
 * Create a simple blob shadow for characters
 * Cheap alternative to shadow maps - dark ellipse decal under character
 * @param {number} radius - Shadow radius (typically matches character width)
 * @param {number} opacity - Shadow opacity (0-1)
 * @returns {THREE.Mesh} - Shadow mesh
 */
export function buildBlobShadow(radius = 0.5, opacity = 0.34) {
  const geometry = new THREE.CircleGeometry(radius, 14).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,           // Black shadow
    transparent: true,        // Allow opacity
    opacity: opacity,         // Shadow visibility
    depthWrite: false,        // Don't affect depth testing
  });
  const shadowMesh = new THREE.Mesh(geometry, material);
  shadowMesh.position.y = 0.03; // Slightly above ground
  shadowMesh.renderOrder = 1;  // Render after character (transparency sorting)
  
  return shadowMesh;
}

// ===== EXPORT COLOR PALETTES =====
// Allow external access to color constants for customization
export { SKIN_COLORS as SKIN, SHIRT_COLORS as SHIRT, PANTS_COLORS as PANTS, HAIR_COLORS as HAIR };