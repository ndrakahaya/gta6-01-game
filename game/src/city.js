// Procedural city generation for Puerto Vela - creates a complete 3D city with roads, buildings, sidewalks, street furniture and navigation data
// Generates collision data, road graphs for traffic/pedestrian navigation, and various city landmarks

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeRng, rngRange, rngInt, pick, chance } from './rng.js';
import {
  texAsphalt, texConcrete, texGrass, texSand, texRoof,
  texFacade, texShopfront, mergeGeoms, buildingGeo,
} from './geo.js';

// ===== FACADE MATERIALS =====

/** Building facade styles with colors and architectural treatments */
const FACADE_STYLES = [
  { key: 'sand', tone: '#c9b79a', style: 'shutter' },      // Sandy beige with shutters
  { key: 'coral', tone: '#c08a76', style: 'shutter' },    // Coral pink with shutters
  { key: 'mint', tone: '#9fb8a4', style: 'plain' },        // Mint green, simple finish
  { key: 'bone', tone: '#d8d2c4', style: 'ribbon' },        // Bone white with ribbon accents
  { key: 'slate', tone: '#8d97a0', style: 'ribbon' },       // Slate blue with ribbon accents
  { key: 'clay', tone: '#a8705a', style: 'brick' },         // Clay brown brick texture
  { key: 'cream', tone: '#e0d6bd', style: 'plain' },        // Cream colored simple finish
  { key: 'teal', tone: '#7d9aa0', style: 'plain' },         // Teal blue simple finish
];

// ===== DERIVED LAYOUT CONSTANTS =====

// Mirrors of CONFIG, read directly by the free functions below so the layout values never have
// to be threaded through every call. Keep these in step with config.js.
const GRID_SIZE = CONFIG.GRID;
const CELL_SIZE = CONFIG.CELL;
const ROAD_WIDTH = CONFIG.ROAD_W;
const SIDEWALK_WIDTH = CONFIG.SIDEWALK;
const CITY_SPAN = GRID_SIZE * CELL_SIZE;

// ===== CITY UTILITY FUNCTIONS =====

/**
 * Calculate road center position for grid coordinate
 * @param {number} i - Grid coordinate (0 to N)
 * @returns {number} - World position of road center
 */
export function roadCenter(i) {
  return i * CONFIG.CELL;
}

/**
 * Check if a world position is on a drivable road
 * Used for vehicle spawning and pedestrian pathfinding
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {boolean} - True if position is on road
 */
export function onRoad(x, z) {
  const halfRoadWidth = CONFIG.ROAD_W / 2;
  const gridX = Math.abs(x / CONFIG.CELL - Math.round(x / CONFIG.CELL)) * CONFIG.CELL;
  const gridZ = Math.abs(z / CONFIG.CELL - Math.round(z / CONFIG.CELL)) * CONFIG.CELL;
  return gridX <= halfRoadWidth || gridZ <= halfRoadWidth;
}

// ===== MAIN CITY GENERATION =====

/**
 * Build the complete city of Puerto Vela with all geometry and navigation data
 * @param {THREE.Scene} scene - Three.js scene to add city to
 * @param {number} seed - Random seed for reproducible generation
 * @returns {Object} - Complete city data with geometry, colliders, and navigation
 */
export function buildCity(scene, seed = 20261117) {
  // Initialize random number generator and city group
  const randomGenerator = makeRng(seed);
  const cityGroup = new THREE.Group();
  cityGroup.name = 'city';
  scene.add(cityGroup);

  // City data collections
  const colliders = [];      // Collision boxes for buildings and obstacles
  const buildings = [];      // Visual building metadata for minimap tinting
  const streetLamps = [];    // Street lamp positions
  const treePositions = [];  // Tree positions and scales
  const parkingSpots = [];    // Parking spot locations and orientations
  const pedestrianRoutes = []; // Sidewalk path networks for pedestrians

  // City dimensions and constants
  const gridSize = CONFIG.GRID;
  const cellSize = CONFIG.CELL;
  const roadWidth = CONFIG.ROAD_W;
  const sidewalkWidth = CONFIG.SIDEWALK;
  const citySpan = gridSize * cellSize;

  // ===== GROUND BASE =====
  
  // Create main ground plane with grass texture
  const groundGeometry = new THREE.PlaneGeometry(citySpan * 2.6, citySpan * 2.6);
  groundGeometry.rotateX(-Math.PI / 2);
  const grassTexture = texGrass();
  grassTexture.repeat.set(120, 120);
  const ground = new THREE.Mesh(
    groundGeometry,
    new THREE.MeshLambertMaterial({ map: grassTexture, color: 0x9aa88c }),
  );
  ground.position.set(citySpan / 2, -0.05, citySpan / 2);
  ground.receiveShadow = false;
  cityGroup.add(ground);

  // ===== ROAD NETWORK =====
  
  // Create asphalt roads with texture
  const asphaltTexture = texAsphalt();
  asphaltTexture.repeat.set(2, 26);
  const roadMaterial = new THREE.MeshLambertMaterial({ 
    map: asphaltTexture, 
    color: 0xd8dce2 
  });
  
  const roadParts = [];
  for (let i = 0; i <= gridSize; i++) {
    const center = roadCenter(i);
    
    // North-south road strips
    roadParts.push({
      geometry: new THREE.PlaneGeometry(roadWidth, citySpan + roadWidth).rotateX(-Math.PI / 2),
      matrix: new THREE.Matrix4().makeTranslation(center, 0.01, citySpan / 2),
    });
    
    // East-west road strips
    roadParts.push({
      geometry: new THREE.PlaneGeometry(citySpan + roadWidth, roadWidth).rotateX(-Math.PI / 2),
      matrix: new THREE.Matrix4().makeTranslation(citySpan / 2, 0.012, center),
    });
  }
  
  const roadsMesh = new THREE.Mesh(mergeGeoms(roadParts), roadMaterial);
  roadsMesh.name = 'roads';
  cityGroup.add(roadsMesh);

  // ===== ROAD MARKINGS =====
  
  // Lane markings and stop lines
  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xe8e2cf });
  const lineParts = [];
  const stopLineParts = [];
  
  const dashLength = 3.0;
  const dashGap = 3.6;
  const junctionOffset = roadWidth / 2 + sidewalkWidth * 0.55;
  
  // Generate lane markings
  for (let i = 0; i <= gridSize; i++) {
    const center = roadCenter(i);
    
    // Place dashed lines along road segments
    for (let segment = 0; segment < gridSize; segment++) {
      const start = roadCenter(segment) + junctionOffset;
      const end = roadCenter(segment + 1) - junctionOffset;
      
      for (let position = start; position + dashLength <= end; position += dashLength + dashGap) {
        const centerOfDash = position + dashLength / 2;
        
        // North-south lane markings
        lineParts.push({
          geometry: new THREE.PlaneGeometry(0.3, dashLength).rotateX(-Math.PI / 2),
          matrix: new THREE.Matrix4().makeTranslation(center, 0.035, centerOfDash + dashLength / 2),
        });
        
        // East-west lane markings
        lineParts.push({
          geometry: new THREE.PlaneGeometry(dashLength, 0.3).rotateX(-Math.PI / 2),
          matrix: new THREE.Matrix4().makeTranslation(centerOfDash + dashLength / 2, 0.036, center),
        });
      }
    }
  }
  
  // Generate stop lines at intersections
  for (let i = 0; i <= gridSize; i++) {
    for (let j = 0; j <= gridSize; j++) {
      const centerX = roadCenter(i);
      const centerZ = roadCenter(j);
      const stopOffset = roadWidth / 2 + 0.9;
      
      // Four stop lines per intersection
      for (const [deltaX, deltaZ, width, depth] of [
        [0, -stopOffset, roadWidth, 0.4],    // North
        [0, stopOffset, roadWidth, 0.4],     // South
        [-stopOffset, 0, 0.4, roadWidth],   // West
        [stopOffset, 0, 0.4, roadWidth],    // East
      ]) {
        stopLineParts.push({
          geometry: new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2),
          matrix: new THREE.Matrix4().makeTranslation(
            centerX + deltaX * 1.1, 
            0.037, 
            centerZ + deltaZ * 1.1
          ),
        });
      }
    }
  }
  
  // Create and add road markings
  if (lineParts.length > 0) {
    const laneMarkings = new THREE.Mesh(mergeGeoms(lineParts), lineMaterial);
    laneMarkings.name = 'lane-markings';
    cityGroup.add(laneMarkings);
  }
  
  if (stopLineParts.length > 0) {
    const stopLines = new THREE.Mesh(
      mergeGeoms(stopLineParts), 
      new THREE.MeshBasicMaterial({ color: 0xd9d2bc })
    );
    stopLines.name = 'stop-lines';
    cityGroup.add(stopLines);
  }

  // ===== BLOCKS AND BUILDINGS =====
  
  // Sidewalk and building materials
  const concreteTexture = texConcrete();
  const sidewalkMaterial = new THREE.MeshLambertMaterial({ 
    map: concreteTexture, 
    color: 0xd6d2c8 
  });
  sidewalkMaterial.polygonOffset = true;
  sidewalkMaterial.polygonOffsetFactor = -1;

  // Facade material caching for performance
  const facadeMaterialCache = new Map();
  const getFacadeMaterial = (tone) => {
    if (facadeMaterialCache.has(tone.key)) {
      return facadeMaterialCache.get(tone.key);
    }
    const texture = texFacade(tone.key, tone.tone, tone.style);
    const material = new THREE.MeshLambertMaterial({ map: texture });
    facadeMaterialCache.set(tone.key, material);
    return material;
  };

  // Roof and shopfront materials
  const roofTexture = texRoof();
  roofTexture.repeat.set(3, 3);
  const roofMaterial = new THREE.MeshLambertMaterial({ 
    map: roofTexture, 
    color: 0x9aa0a6 
  });
  
  const shopfrontTexture = texShopfront();
  const shopfrontMaterial = new THREE.MeshLambertMaterial({ map: shopfrontTexture });

  // Group building parts by material for efficient rendering
  const buildingBodyParts = new Map();
  const roofParts = [];
  const shopfrontParts = [];
  const rooftopTrimParts = [];

  const blockInnerSize = cellSize - roadWidth - sidewalkWidth * 2;

  // Generate city blocks
  for (let blockX = 0; blockX < gridSize; blockX++) {
    for (let blockZ = 0; blockZ < gridSize; blockZ++) {
      const blockStartX = blockX * cellSize + roadWidth / 2 + sidewalkWidth;
      const blockStartZ = blockZ * cellSize + roadWidth / 2 + sidewalkWidth;
      const blockCenterX = blockStartX + blockInnerSize / 2;
      const blockCenterZ = blockStartZ + blockInnerSize / 2;

      // Sidewalk slab under the entire block
      const sidewalkSlab = new THREE.Mesh(
        new THREE.BoxGeometry(blockInnerSize + sidewalkWidth * 2, 0.22, blockInnerSize + sidewalkWidth * 2),
        sidewalkMaterial,
      );
      sidewalkSlab.position.set(blockCenterX, 0.11, blockCenterZ);
      cityGroup.add(sidewalkSlab);

      // Random chance for park blocks
      const isParkBlock = chance(randomGenerator, 0.085);
      if (isParkBlock) {
        createParkBlock(
          cityGroup, 
          blockCenterX, 
          blockCenterZ, 
          blockInnerSize, 
          randomGenerator, 
          treePositions,
          colliders
        );
        continue;
      }

      // Generate building lots within the block
      const numberOfLots = blockInnerSize > 26 ? rngInt(randomGenerator, 1, 3) : 1;
      const splitAxis = chance(randomGenerator, 0.5) ? 'x' : 'z';
      const lotSize = blockInnerSize / numberOfLots;

      for (let lotIndex = 0; lotIndex < numberOfLots; lotIndex++) {
        createBuildingLot({
          rng: randomGenerator,
          blockStartX,
          blockStartZ,
          blockCenterX,
          blockCenterZ,
          lotIndex,
          lotSize,
          splitAxis,
          blockInnerSize,
          bodyParts: buildingBodyParts,
          roofParts,
          shopParts: shopfrontParts,
          trimParts: rooftopTrimParts,
          colliders,
          buildings,
        });
      }
    }
  }

  // Create building meshes from grouped parts
  createBuildingMeshes(
    cityGroup, 
    buildingBodyParts, 
    roofParts, 
    shopfrontParts, 
    rooftopTrimParts,
    FACADE_STYLES,
    getFacadeMaterial,
    roofMaterial,
    shopfrontMaterial
  );

  // ===== STREET FURNITURE =====
  
  // Street lamps
  createStreetLamps(
    cityGroup, 
    gridSize, 
    citySpan, 
    randomGenerator, 
    streetLamps
  );

  // Trees (already added during park generation)
  if (treePositions.length > 0) {
    createTrees(cityGroup, treePositions, colliders);
  }

  // ===== WATERFRONT =====
  
  createWaterfront(cityGroup, citySpan);

  // ===== PARKING AND NAVIGATION =====
  
  // Generate parking spots along curbs
  generateParkingSpots(cityGroup, gridSize, citySpan, randomGenerator, parkingSpots);

  // Create pedestrian sidewalk routes
  generatePedestrianRoutes(gridSize, citySpan, pedestrianRoutes);

  // Create road graph for traffic navigation
  const roadGraph = createRoadGraph(gridSize, citySpan);

  // ===== LANDMARKS AND SPAWN POINTS =====
  
  // Points of interest for missions and navigation
  const pointsOfInterest = {
    garage: { x: roadCenter(2), z: roadCenter(9) + 7, name: 'Garage' },
    docks: { x: roadCenter(8), z: roadCenter(9) + 12, name: 'Docks' },
    club: { x: roadCenter(5), z: roadCenter(6), name: 'Club Neon' },
    bank: { x: roadCenter(3), z: roadCenter(4), name: 'Banco Azul' },
    airstrip: { x: roadCenter(9), z: roadCenter(2), name: 'Airstrip' },
    marina: { x: roadCenter(2), z: roadCenter(2), name: 'Marina' },
    plaza: { x: roadCenter(5), z: roadCenter(1), name: 'Plaza Sol' },
  };

  const cityCenter = { x: citySpan / 2, z: citySpan / 2 };

  return {
    // Core city data
    group: cityGroup,
    colliders,
    buildings,
    nodes: roadGraph.nodes,
    neighbours: roadGraph.neighbours,
    index: roadGraph.index,

    // City elements. These public key names are the contract every other module imports:
    // lampPositions → lamps, parkedSpots → kerbside parking, pedRoutes → pedestrian sidewalks,
    // poi → named landmarks, centre → middle of the grid.
    lampPositions: streetLamps,
    parkedSpots: parkingSpots,
    pedRoutes: pedestrianRoutes,
    poi: pointsOfInterest,
    centre: cityCenter,
    
    // City dimensions
    span: citySpan,
    cell: cellSize,
    grid: gridSize,
    roadWidth,
    sidewalk: sidewalkWidth,
    
    // Spawn and navigation helpers
    spawnPoint: { x: roadCenter(5) + 3.4, z: roadCenter(6) + 12, yaw: Math.PI },
    
    /**
     * Find nearest road graph node to a world position
     * @param {number} x - World X coordinate
     * @param {number} z - World Z coordinate
     * @returns {number} - Index of nearest node
     */
    nearestNode(x, z) {
      const gridI = Math.max(0, Math.min(gridSize, Math.round(x / cellSize)));
      const gridJ = Math.max(0, Math.min(gridSize, Math.round(z / cellSize)));
      return roadGraph.index(gridI, gridJ);
    },
    
    /**
     * Generate random drivable point on road network
     * @param {Function} rand - Random number generator function
     * @returns {Object} - {x, z, rot} position and rotation
     */
    randomRoadPoint(rand = Math.random) {
      const isVertical = rand() < 0.5;
      const roadIndex = Math.floor(rand() * (gridSize + 1));
      const blockPosition = (Math.floor(rand() * gridSize) + 0.5) * cellSize;
      
      if (isVertical) {
        return { 
          x: roadCenter(roadIndex), 
          z: blockPosition, 
          rot: rand() < 0.5 ? 0 : Math.PI 
        };
      }
      return { 
        x: blockPosition, 
        z: roadCenter(roadIndex), 
        rot: rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2 
      };
    },
  };
}

// ===== BUILDING GENERATION HELPERS =====

/**
 * Create a park block with grass and trees
 * @param {THREE.Group} group - City group to add to
 * @param {number} centerX - Block center X
 * @param {number} centerZ - Block center Z
 * @param {number} size - Block inner size
 * @param {Function} rng - Random number generator
 * @param {Array} trees - Array to add tree positions to
 * @param {Array} colliders - Array to add collision data to
 */
function createParkBlock(group, centerX, centerZ, size, rng, trees, colliders) {
  // Grass patch in park
  const grassTexture = texGrass();
  const grassMaterial = new THREE.MeshLambertMaterial({ 
    map: grassTexture, 
    color: 0x9fbb86 
  });
  const grassPatch = new THREE.Mesh(
    new THREE.BoxGeometry(size * 0.72, 0.14, size * 0.72), 
    grassMaterial
  );
  grassPatch.position.set(centerX, 0.22, centerZ);
  group.add(grassPatch);

  // Add trees to park
  const numberOfTrees = rngInt(rng, 3, 6);
  for (let tree = 0; tree < numberOfTrees; tree++) {
    trees.push({
      x: centerX + rngRange(rng, -size * 0.3, size * 0.3),
      z: centerZ + rngRange(rng, -size * 0.3, size * 0.3),
      scale: rngRange(rng, 0.85, 1.35),
    });
  }
}

/**
 * Create a single building lot inside a block and register its geometry, collision box and
 * minimap metadata. Takes one options object because the lot touches many shared collections.
 * @param {Object} lot - see the destructuring below; `rng` and the part arrays are required.
 */
function createBuildingLot({
  rng, blockStartX, blockStartZ, blockCenterX, blockCenterZ,
  lotIndex, lotSize, splitAxis, blockInnerSize,
  bodyParts, roofParts, shopParts, trimParts, colliders, buildings,
}) {
  const lotInset = rngRange(rng, 0.5, 1.6);
  const width = splitAxis === 'x' ? lotSize - lotInset * 1.6 : blockInnerSize - lotInset * 1.6;
  const depth = splitAxis === 'x' ? blockInnerSize - lotInset * 1.6 : lotSize - lotInset * 1.6;
  const positionX = splitAxis === 'x' ? blockStartX + lotIndex * lotSize + lotSize / 2 : blockCenterX;
  const positionZ = splitAxis === 'x' ? blockCenterZ : blockStartZ + lotIndex * lotSize + lotSize / 2;

  // Building dimensions
  const numberOfFloors = pick(rng, [2, 3, 3, 4, 5, 6, 8, 10]);
  const buildingHeight = numberOfFloors * 3.4 + rngRange(rng, 0, 2);
  const facadeStyle = pick(rng, FACADE_STYLES);
  const materialKey = facadeStyle.key;

  // Building body geometry
  const buildingGeometry = buildingGeo(width, buildingHeight, depth);
  const baseY = 0.22; // On top of sidewalk
  bodyParts.set(materialKey, bodyParts.get(materialKey) ?? []);
  bodyParts.get(materialKey).push({
    geometry: buildingGeometry,
    matrix: new THREE.Matrix4().makeTranslation(positionX, baseY + buildingHeight / 2, positionZ),
  });

  // Ground floor shopfront for taller buildings
  if (buildingHeight > 10) {
    const shopfrontHeight = 3.0;
    shopParts.push({
      geometry: new THREE.BoxGeometry(width + 0.06, shopfrontHeight, depth + 0.06),
      matrix: new THREE.Matrix4().makeTranslation(positionX, baseY + shopfrontHeight / 2, positionZ),
    });
  }

  // Roof and rooftop details
  roofParts.push({
    geometry: new THREE.BoxGeometry(width + 0.5, 0.45, depth + 0.5),
    matrix: new THREE.Matrix4().makeTranslation(positionX, baseY + buildingHeight + 0.1, positionZ),
  });

  // Rooftop equipment for visual interest
  if (chance(rng, 0.6)) {
    const rooftopWidth = width * rngRange(rng, 0.2, 0.35);
    const rooftopDepth = depth * rngRange(rng, 0.2, 0.35);
    const rooftopHeight = rngRange(rng, 1.0, 2.2);
    
    trimParts.push({
      geometry: new THREE.BoxGeometry(rooftopWidth, rooftopHeight, rooftopDepth),
      matrix: new THREE.Matrix4().makeTranslation(
        positionX + rngRange(rng, -width * 0.2, width * 0.2),
        baseY + buildingHeight + 0.9,
        positionZ + rngRange(rng, -depth * 0.2, depth * 0.2),
      ),
    });
  }

  // Add collision data and building metadata.
  // Every consumer (car, player, pedestrian, camera) reads the collider height as `h`, and the
  // minimap reads building blocks as w/d — those key names are the cross-module contract.
  colliders.push({
    minX: positionX - width / 2,
    maxX: positionX + width / 2,
    minZ: positionZ - depth / 2,
    maxZ: positionZ + depth / 2,
    h: buildingHeight + baseY,
  });

  buildings.push({
    x: positionX, z: positionZ, w: width, d: depth, h: buildingHeight,
    tone: facadeStyle.key,
  });

  return { width, depth, height: buildingHeight };
}

/**
 * Create building meshes from grouped parts
 * @param {THREE.Group} group - City group to add to
 * @param {Map} bodyParts - Grouped building body parts
 * @param {Array} roofParts - Roof parts array
 * @param {Array} shopParts - Shopfront parts array
 * @param {Array} trimParts - Rooftop trim parts array
 * @param {Array} facadeStyles - Available facade styles
 * @param {Function} getFacadeMaterial - Function to get facade materials
 * @param {THREE.Material} roofMaterial - Roof material
 * @param {THREE.Material} shopMaterial - Shopfront material
 */
function createBuildingMeshes(group, bodyParts, roofParts, shopParts, trimParts,
                            facadeStyles, getFacadeMaterial, roofMaterial, shopMaterial) {
  
  // Create building body meshes
  for (const [key, parts] of bodyParts) {
    if (!parts.length) continue;
    const style = facadeStyles.find((s) => s.key === key);
    const mesh = new THREE.Mesh(mergeGeoms(parts), getFacadeMaterial(style));
    mesh.name = `buildings-${key}`;
    group.add(mesh);
  }

  // Create shopfront mesh
  if (shopParts.length > 0) {
    const shopMesh = new THREE.Mesh(mergeGeoms(shopParts), shopMaterial);
    shopMesh.name = 'shopfronts';
    group.add(shopMesh);
  }

  // Create roof mesh
  if (roofParts.length > 0) {
    const roofMesh = new THREE.Mesh(mergeGeoms(roofParts), roofMaterial);
    roofMesh.name = 'roofs';
    group.add(roofMesh);
  }

  // Create rooftop equipment mesh
  if (trimParts.length > 0) {
    const trimMesh = new THREE.Mesh(
      mergeGeoms(trimParts), 
      new THREE.MeshLambertMaterial({ color: 0xb3b7bb })
    );
    trimMesh.name = 'rooftop-units';
    group.add(trimMesh);
  }
}

// ===== STREET FURNITURE HELPERS =====

/**
 * Create street lamps along roads
 * @param {THREE.Group} group - City group to add to
 * @param {number} gridSize - City grid size
 * @param {number} citySpan - Total city span
 * @param {Function} rng - Random number generator
 * @param {Array} lamps - Array to add lamp positions to
 */
function createStreetLamps(group, gridSize, citySpan, rng, lamps) {
  const poleParts = [];
  const headParts = [];
  
  for (let i = 0; i <= gridSize; i++) {
    for (let j = 0; j <= gridSize; j++) {
      if (!chance(rng, 0.55)) continue; // Skip some positions for realism
      
      const centerX = roadCenter(i);
      const centerZ = roadCenter(j) + CELL_SIZE * 0.5;
      
      if (centerZ > citySpan - 2) continue; // Don't place at city edge
      
      const side = chance(rng, 0.5) ? 1 : -1;
      const lampX = centerX + side * (ROAD_WIDTH / 2 + 1.0);
      
      lamps.push({ x: lampX, z: centerZ });
      
      // Lamp pole
      poleParts.push({
        geometry: new THREE.CylinderGeometry(0.13, 0.17, 6.4, 6),
        matrix: new THREE.Matrix4().makeTranslation(lampX, 3.2, centerZ),
      });
      
      // Lamp head
      headParts.push({
        geometry: new THREE.BoxGeometry(1.1, 0.22, 0.5),
        matrix: new THREE.Matrix4().makeTranslation(lampX - side * 0.5, 6.4, centerZ),
      });
    }
  }
  
  // Create lamp meshes
  if (poleParts.length > 0) {
    const poleMesh = new THREE.Mesh(
      mergeGeoms(poleParts), 
      new THREE.MeshLambertMaterial({ color: 0x555c63 })
    );
    poleMesh.name = 'lamp-poles';
    group.add(poleMesh);
    
    const headMesh = new THREE.Mesh(
      mergeGeoms(headParts),
      new THREE.MeshBasicMaterial({ color: 0xffe9b8 })
    );
    headMesh.name = 'lamp-heads';
    group.add(headMesh);
  }
}

/**
 * Create trees from positions
 * @param {THREE.Group} group - City group to add to
 * @param {Array} positions - Tree positions and scales
 * @param {Array} colliders - Array to add collision data to
 */
function createTrees(group, positions, colliders) {
  const trunkParts = [];
  const crownParts = [];
  
  for (const tree of positions) {
    // Tree trunk
    trunkParts.push({
      geometry: new THREE.CylinderGeometry(0.22 * tree.scale, 0.3 * tree.scale, 2.4 * tree.scale, 6),
      matrix: new THREE.Matrix4().makeTranslation(tree.x, 1.2 * tree.scale, tree.z),
    });
    
    // Tree crown (foliage)
    crownParts.push({
      geometry: new THREE.IcosahedronGeometry(1.85 * tree.scale, 0),
      matrix: new THREE.Matrix4().makeTranslation(tree.x, 3.5 * tree.scale, tree.z),
    });
    
    // Tree collision. `h` is the height key every mover reads.
    colliders.push({
      minX: tree.x - 0.4,
      maxX: tree.x + 0.4,
      minZ: tree.z - 0.4,
      maxZ: tree.z + 0.4,
      h: 2.4 * tree.scale,
    });
  }
  
  // Create tree meshes
  group.add(new THREE.Mesh(mergeGeoms(trunkParts), new THREE.MeshLambertMaterial({ color: 0x5b4632 })));
  group.add(new THREE.Mesh(mergeGeoms(crownParts), new THREE.MeshLambertMaterial({ color: 0x4a7a44, flatShading: true })));
}

/**
 * Create waterfront area at city edge
 * @param {THREE.Group} group - City group to add to
 * @param {number} citySpan - Total city span
 */
function createWaterfront(group, citySpan) {
  // Beach
  const sandTexture = texSand();
  sandTexture.repeat.set(30, 6);
  const beach = new THREE.Mesh(
    new THREE.BoxGeometry(citySpan + 160, 0.1, 46),
    new THREE.MeshLambertMaterial({ map: sandTexture, color: 0xd8c49b }),
  );
  beach.position.set(citySpan / 2, 0.02, citySpan + 23);
  group.add(beach);

  // Ocean water
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(citySpan * 2.4, 900, 1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ 
      color: 0x2c6f8f, 
      transparent: true, 
      opacity: 0.92 
    }),
  );
  water.position.set(citySpan / 2, -0.35, citySpan + 46 + 450);
  water.name = 'sea';
  group.add(water);
}

/**
 * Generate parking spots along road curbs
 * @param {THREE.Group} group - City group to add to
 * @param {number} gridSize - City grid size
 * @param {number} citySpan - Total city span
 * @param {Function} rng - Random number generator
 * @param {Array} spots - Array to add parking spots to
 */
function generateParkingSpots(group, gridSize, citySpan, rng, spots) {
  // Parking spots along north-south roads
  for (let i = 0; i <= gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      if (!chance(rng, 0.5)) continue;
      
      const roadCenterX = roadCenter(i);
      const spotZ = roadCenter(j) + CELL_SIZE * 0.5 + rngRange(rng, -4, 4);
      const side = chance(rng, 0.5) ? 1 : -1;
      
      // Kerb parking spot. `rot` faces the car along the kerb; vehicles.js reads spot.rot.
      spots.push({
        x: roadCenterX + side * (ROAD_WIDTH / 2 - 1.9),
        z: spotZ,
        rot: side > 0 ? Math.PI : 0,
      });
    }
  }
  
  // Parking spots along east-west roads
  for (let j = 0; j <= gridSize; j++) {
    for (let i = 0; i < gridSize; i++) {
      if (!chance(rng, 0.5)) continue;
      
      const roadCenterZ = roadCenter(j);
      const spotX = roadCenter(i) + CELL_SIZE * 0.5 + rngRange(rng, -4, 4);
      const side = chance(rng, 0.5) ? 1 : -1;
      
      spots.push({
        x: spotX,
        z: roadCenterZ + side * (ROAD_WIDTH / 2 - 1.9),
        rot: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      });
    }
  }
}

/**
 * Generate pedestrian sidewalk routes
 * @param {number} gridSize - City grid size
 * @param {number} citySpan - Total city span
 * @param {Array} routes - Array to add routes to
 */
function generatePedestrianRoutes(gridSize, citySpan, routes) {
  // Routes along north-south sidewalks
  for (let i = 0; i <= gridSize; i++) {
    const x = roadCenter(i) + (ROAD_WIDTH / 2 + SIDEWALK_WIDTH * 0.5);
    routes.push({ axis: 'z', fixed: x, from: ROAD_WIDTH / 2, to: citySpan - ROAD_WIDTH / 2 });
    routes.push({ axis: 'z', fixed: roadCenter(i) - (ROAD_WIDTH / 2 + SIDEWALK_WIDTH * 0.5), from: ROAD_WIDTH / 2, to: citySpan - ROAD_WIDTH / 2 });
  }
  
  // Routes along east-west sidewalks
  for (let j = 0; j <= gridSize; j++) {
    const z = roadCenter(j) + (ROAD_WIDTH / 2 + SIDEWALK_WIDTH * 0.5);
    routes.push({ axis: 'x', fixed: z, from: ROAD_WIDTH / 2, to: citySpan - ROAD_WIDTH / 2 });
    routes.push({ axis: 'x', fixed: roadCenter(j) - (ROAD_WIDTH / 2 + SIDEWALK_WIDTH * 0.5), from: ROAD_WIDTH / 2, to: citySpan - ROAD_WIDTH / 2 });
  }
}

/**
 * Create road graph for traffic navigation
 * @param {number} gridSize - City grid size
 * @param {number} citySpan - Total city span
 * @returns {Object} - Road graph data
 */
function createRoadGraph(gridSize, citySpan) {
  const nodes = [];
  const nodeIndex = (i, j) => j * (gridSize + 1) + i;
  
  // Create nodes at all road intersections
  for (let j = 0; j <= gridSize; j++) {
    for (let i = 0; i <= gridSize; i++) {
      nodes.push({ 
        i, j, 
        x: roadCenter(i), 
        z: roadCenter(j) 
      });
    }
  }
  
  // Create neighbour connections (grid-adjacent nodes only).
  const neighbours = nodes.map((node) => {
    const connections = [];
    if (node.i > 0) connections.push(nodeIndex(node.i - 1, node.j));
    if (node.i < gridSize) connections.push(nodeIndex(node.i + 1, node.j));
    if (node.j > 0) connections.push(nodeIndex(node.i, node.j - 1));
    if (node.j < gridSize) connections.push(nodeIndex(node.i, node.j + 1));
    return connections;
  });

  return { nodes, neighbours, index: nodeIndex };
}

// ===== EXPORT MATERIAL CONSTANTS =====
export { FACADE_STYLES as FACADE_TONES };