// Procedural texture and geometry generation system - creates all game textures at runtime using canvas 2D
// Generates materials for roads, buildings, characters, and environment without external image files
// Provides geometry utilities for efficient 3D model construction

import * as THREE from 'three';

// ===== TEXTURE CACHE =====

/** Cache for generated textures to avoid regeneration */
const textureCache = new Map();

// ===== CANVAS UTILITIES =====

/**
 * Create a 2D canvas with specified dimensions
 * @param {number} width - Canvas width in pixels
 * @param {number} height - Canvas height in pixels
 * @returns {Object} - Canvas and 2D context object
 */
function createCanvas2D(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  return { canvas, context };
}

/**
 * Finish canvas and create Three.js texture with proper settings
 * @param {HTMLCanvasElement} canvas - Canvas to convert to texture
 * @param {boolean} repeat - Whether texture should repeat (default: true)
 * @returns {THREE.CanvasTexture} - Configured Three.js texture
 */
function createTextureFromCanvas(canvas, repeat = true) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; // Use correct color space for lighting
  
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  
  texture.anisotropy = 4; // Enable anisotropic filtering for better quality
  return texture;
}

/**
 * Add noise to canvas image data for texture variation
 * @param {CanvasRenderingContext2D} context - 2D canvas context
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} amount - Noise intensity (0-255)
 */
function addNoiseToTexture(context, width, height, amount) {
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * amount;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));     // Red
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise)); // Green
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise)); // Blue
    // Alpha channel (i + 3) is left unchanged
  }
  
  context.putImageData(imageData, 0, 0);
}

// ===== PROCEDURAL TEXTURE GENERATORS =====

/**
 * Generate asphalt texture with aggregate speckle for road surfaces
 * Creates realistic road texture with varied stone aggregate appearance
 * @returns {THREE.CanvasTexture} - Asphalt texture
 */
export function generateAsphaltTexture() {
  const cacheKey = 'asphalt';
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  
  const size = 256;
  const { canvas, context } = createCanvas2D(size, size);
  
  // Base asphalt color
  context.fillStyle = '#6b6f76';
  context.fillRect(0, 0, size, size);
  
  // Add aggregate speckles (stone fragments)
  for (let i = 0; i < 2600; i++) {
    const value = 88 + Math.random() * 52; // Varied stone colors
    context.fillStyle = `rgba(${value},${value + 2},${value + 6},${0.28 + Math.random() * 0.5})`;
    const radius = Math.random() * 2.2 + 0.4; // Random stone sizes
    context.beginPath();
    context.arc(Math.random() * size, Math.random() * size, radius, 0, Math.PI * 2);
    context.fill();
  }
  
  // Add crack lines for realism
  context.strokeStyle = 'rgba(48,50,56,0.28)';
  context.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    context.beginPath();
    context.moveTo(Math.random() * size, 0);
    context.bezierCurveTo(
      Math.random() * size, size * 0.3,
      Math.random() * size, size * 0.7,
      Math.random() * size, size
    );
    context.stroke();
  }
  
  const texture = createTextureFromCanvas(canvas);
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * Generate sidewalk concrete texture with expansion joints
 * Creates realistic concrete sidewalk appearance with grid pattern
 * @returns {THREE.CanvasTexture} - Concrete texture
 */
export function generateConcreteTexture() {
  const cacheKey = 'concrete';
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  
  const size = 256;
  const { canvas, context } = createCanvas2D(size, size);
  
  // Base concrete color
  context.fillStyle = '#c3beb4';
  context.fillRect(0, 0, size, size);
  
  // Add concrete texture variations
  for (let i = 0; i < 1400; i++) {
    const value = 160 + Math.random() * 60; // Varied concrete tones
    context.fillStyle = `rgba(${value},${value - 4},${value - 12},0.35)`;
    context.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  
  // Add expansion joints (grid lines)
  context.strokeStyle = 'rgba(140,136,128,0.85)';
  context.lineWidth = 2;
  for (let i = 0; i <= 2; i++) {
    const position = (i * size) / 2;
    // Vertical lines
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, size);
    context.stroke();
    // Horizontal lines
    context.beginPath();
    context.moveTo(0, position);
    context.lineTo(size, position);
    context.stroke();
  }
  
  const texture = createTextureFromCanvas(canvas);
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * Generate grass texture for ground surfaces
 * Creates natural grass appearance with color variation
 * @returns {THREE.CanvasTexture} - Grass texture
 */
export function generateGrassTexture() {
  const cacheKey = 'grass';
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  
  const size = 128;
  const { canvas, context } = createCanvas2D(size, size);
  
  // Base grass color
  context.fillStyle = '#5c7a45';
  context.fillRect(0, 0, size, size);
  
  // Add grass blade variations
  for (let i = 0; i < 2400; i++) {
    const value = 70 + Math.random() * 60; // Varied green tones
    context.fillStyle = `rgba(${value * 0.75},${value},${value * 0.5},0.5)`;
    context.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  
  const texture = createTextureFromCanvas(canvas);
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * Generate sand texture for beach areas
 * Creates sandy beach appearance with natural variation
 * @returns {THREE.CanvasTexture} - Sand texture
 */
export function generateSandTexture() {
  const cacheKey = 'sand';
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  
  const size = 128;
  const { canvas, context } = createCanvas2D(size, size);
  
  // Base sand color
  context.fillStyle = '#d6bf96';
  context.fillRect(0, 0, size, size);
  
  // Add noise for natural sand variation
  addNoiseToTexture(context, size, size, 34);
  
  const texture = createTextureFromCanvas(canvas);
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * Generate roof texture for building tops
 * Creates roofing material appearance with tile lines
 * @returns {THREE.CanvasTexture} - Roof texture
 */
export function generateRoofTexture() {
  const cacheKey = 'roof';
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  
  const size = 128;
  const { canvas, context } = createCanvas2D(size, size);
  
  // Base roof color
  context.fillStyle = '#8b8e93';
  context.fillRect(0, 0, size, size);
  
  // Add tile lines
  context.fillStyle = 'rgba(148,152,158,0.6)';
  for (let i = 0; i < 40; i += 4) {
    context.fillRect(0, i, size, 2);
  }
  
  // Add noise for texture variation
  addNoiseToTexture(context, size, size, 22);
  
  const texture = createTextureFromCanvas(canvas);
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * Generate building facade texture with windows
 * Creates architectural facade with repeating window pattern
 * @param {string} key - Unique identifier for facade style
 * @param {string} tone - Base building color
 * @param {string} style - Facade style ('shutter', 'ribbon', 'brick', 'plain')
 * @returns {THREE.CanvasTexture} - Facade texture
 */
export function generateFacadeTexture(key, tone, style) {
  const cacheKey = `facade:${key}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  
  const width = 192;
  const height = 192;
  const { canvas, context } = createCanvas2D(width, height);
  
  // Base building color
  context.fillStyle = tone;
  context.fillRect(0, 0, width, height);
  
  // Add texture variation
  addNoiseToTexture(context, width, height, 16);
  
  // Window grid configuration
  const columns = 3;
  const rows = 2;
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  
  // Draw windows
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const windowX = col * cellWidth + cellWidth * 0.18;
      const windowY = row * cellHeight + cellHeight * 0.2;
      const windowWidth = cellWidth * 0.64;
      const windowHeight = cellHeight * (style === 'ribbon' ? 0.5 : 0.58);
      
      // Window frame
      context.fillStyle = 'rgba(60,64,70,0.5)';
      context.fillRect(windowX - 2, windowY - 2, windowWidth + 4, windowHeight + 4);
      
      // Window glass with lighting variation
      const gradient = context.createLinearGradient(windowX, windowY, windowX + windowWidth, windowY + windowHeight);
      const isLit = Math.random() < 0.24; // 24% chance of lit window
      
      if (isLit) {
        // Warm interior lighting
        gradient.addColorStop(0, '#f2e3b0');
        gradient.addColorStop(1, '#cdbb85');
      } else {
        // Cool exterior lighting
        gradient.addColorStop(0, '#a9c2d4');
        gradient.addColorStop(0.55, '#6b869b');
        gradient.addColorStop(1, '#4a6478');
      }
      
      context.fillStyle = gradient;
      context.fillRect(windowX, windowY, windowWidth, windowHeight);
      
      // Window mullion (vertical divider)
      context.strokeStyle = 'rgba(50,54,60,0.55)';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(windowX + windowWidth / 2, windowY);
      context.lineTo(windowX + windowWidth / 2, windowY + windowHeight);
      context.stroke();
      
      // Shutters for shutter style
      if (style === 'shutter') {
        context.fillStyle = 'rgba(86,92,100,0.5)';
        context.fillRect(windowX - 6, windowY, 5, windowHeight);
        context.fillRect(windowX + windowWidth + 1, windowY, 5, windowHeight);
      }
      
      // Window reflection
      context.fillStyle = 'rgba(255,255,255,0.3)';
      context.fillRect(windowX - 3, windowY + windowHeight, windowWidth + 6, 3);
    }
    
    // Floor line shadow
    context.fillStyle = 'rgba(0,0,0,0.1)';
    context.fillRect(0, (row + 1) * cellHeight - 5, width, 5);
  }
  
  // Brick pattern for brick style
  if (style === 'brick') {
    context.globalAlpha = 0.12;
    context.strokeStyle = '#2a1d17';
    context.lineWidth = 1;
    for (let y = 0; y < height; y += 8) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    context.globalAlpha = 1;
  }
  
  const texture = createTextureFromCanvas(canvas);
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * Generate shopfront texture for commercial building bases
 * Creates storefront appearance with signs and display windows
 * @returns {THREE.CanvasTexture} - Shopfront texture
 */
export function generateShopfrontTexture() {
  const cacheKey = 'shop';
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  
  const width = 256;
  const height = 128;
  const { canvas, context } = createCanvas2D(width, height);
  
  // Base shopfront color
  context.fillStyle = '#8a8b8f';
  context.fillRect(0, 0, width, height);
  
  // Sign colors for variety
  const signColors = ['#c0392b', '#1f6f8b', '#d4a017', '#2e8b57', '#7a4ea8', '#d4642a'];
  
  // Draw four shop units
  for (let i = 0; i < 4; i++) {
    const shopX = i * (width / 4);
    
    // Vertical divider between shops
    context.fillStyle = '#6f7075';
    context.fillRect(shopX, 0, 5, height);
    
    // Sign area
    context.fillStyle = signColors[i % signColors.length];
    context.fillRect(shopX + 9, 6, width / 4 - 18, 20);
    
    // Sign text area (placeholder for actual text)
    context.fillStyle = 'rgba(255,255,255,0.92)';
    context.fillRect(shopX + 18, 13, width / 4 - 46, 6);
    
    // Display window with gradient
    const windowGradient = context.createLinearGradient(shopX, 32, shopX, height);
    windowGradient.addColorStop(0, '#c3d8e6');
    windowGradient.addColorStop(0.55, '#8a939c');
    windowGradient.addColorStop(1, '#59636b');
    context.fillStyle = windowGradient;
    context.fillRect(shopX + 11, 32, width / 4 - 22, height - 44);
    
    // Window frame
    context.strokeStyle = 'rgba(30,32,36,0.85)';
    context.lineWidth = 3;
    context.strokeRect(shopX + 11, 32, width / 4 - 22, height - 44);
    
    // Window divider
    context.beginPath();
    context.moveTo(shopX + width / 8, 32);
    context.lineTo(shopX + width / 8, height - 12);
    context.stroke();
    
    // Window reflection
    context.fillStyle = 'rgba(255,255,255,0.4)';
    context.fillRect(shopX + 11, height - 14, width / 4 - 22, 3);
  }
  
  const texture = createTextureFromCanvas(canvas);
  textureCache.set(cacheKey, texture);
  return texture;
}

/**
 * Generate face texture for character heads
 * Creates simple face features with skin and hair
 * @param {string} key - Unique identifier for face style
 * @param {string} skinColor - Skin tone color
 * @param {string} hairColor - Hair color
 * @returns {THREE.CanvasTexture} - Face texture
 */
export function generateFaceTexture(key, skinColor, hairColor) {
  const cacheKey = `face:${key}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  
  const size = 128;
  const { canvas, context } = createCanvas2D(size, size);
  
  // Skin base
  context.fillStyle = skinColor;
  context.fillRect(0, 0, size, size);
  
  // Hair
  context.fillStyle = hairColor;
  context.fillRect(0, 0, size, 22);
  
  // Hairline (curved)
  context.beginPath();
  context.moveTo(0, 22);
  context.quadraticCurveTo(size * 0.5, 34, size, 22);
  context.lineTo(size, 0);
  context.lineTo(0, 0);
  context.fill();
  
  // Eyes
  const eyeY = 56;
  context.fillStyle = '#f4f1ea'; // White of eyes
  context.fillRect(26, eyeY, 26, 13);
  context.fillRect(76, eyeY, 26, 13);
  
  // Irises
  context.fillStyle = '#3a2b20'; // Brown iris
  context.fillRect(35, eyeY + 3, 9, 8);
  context.fillRect(85, eyeY + 3, 9, 8);
  
  // Pupils
  context.fillStyle = '#111'; // Black pupils
  context.fillRect(38, eyeY + 5, 4, 4);
  context.fillRect(88, eyeY + 5, 4, 4);
  
  // Eyebrows
  context.fillStyle = hairColor;
  context.fillRect(22, eyeY - 10, 32, 5);
  context.fillRect(74, eyeY - 10, 32, 5);
  
  // Nose shadow
  context.fillStyle = 'rgba(0,0,0,0.16)';
  context.fillRect(58, eyeY + 16, 10, 20);
  
  // Mouth line
  context.fillStyle = 'rgba(0,0,0,0.22)';
  context.fillRect(54, eyeY + 34, 18, 4);
  
  // Mouth
  context.fillStyle = 'rgba(90,40,40,0.85)'; // Lips
  context.fillRect(46, 104, 36, 5);
  
  // Mouth shadow
  context.fillStyle = 'rgba(0,0,0,0.12)';
  context.fillRect(46, 109, 36, 3);
  
  // Chin shadow
  context.fillStyle = 'rgba(0,0,0,0.07)';
  context.fillRect(0, 118, size, 10);
  
  const texture = createTextureFromCanvas(canvas, false); // Face texture doesn't repeat
  textureCache.set(cacheKey, texture);
  return texture;
}

// ===== GEOMETRY UTILITIES =====

/**
 * Merge multiple geometries with transformations into a single non-indexed geometry
 * Optimizes rendering by reducing draw calls
 * @param {Array} parts - Array of {geometry, matrix} objects
 * @returns {THREE.BufferGeometry} - Merged geometry with position, normal, and UV attributes
 */
export function mergeGeometries(parts) {
  let totalVertexCount = 0;
  const preparedGeometries = parts.map(({ geometry, matrix }) => {
    const geometryToMerge = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) geometryToMerge.applyMatrix4(matrix);
    totalVertexCount += geometryToMerge.attributes.position.count;
    return geometryToMerge;
  });
  
  // Create attribute arrays
  const positionArray = new Float32Array(totalVertexCount * 3);
  const normalArray = new Float32Array(totalVertexCount * 3);
  const uvArray = new Float32Array(totalVertexCount * 2);
  
  let offset = 0;
  for (const geometry of preparedGeometries) {
    // Copy position data
    positionArray.set(geometry.attributes.position.array, offset * 3);
    
    // Copy normal data if available
    if (geometry.attributes.normal) {
      normalArray.set(geometry.attributes.normal.array, offset * 3);
    }
    
    // Copy UV data if available
    if (geometry.attributes.uv) {
      uvArray.set(geometry.attributes.uv.array, offset * 2);
    }
    
    offset += geometry.attributes.position.count;
    geometry.dispose(); // Clean up original geometry
  }
  
  // Create merged geometry
  const mergedGeometry = new THREE.BufferGeometry();
  mergedGeometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
  mergedGeometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3));
  mergedGeometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
  mergedGeometry.computeBoundingSphere();
  
  return mergedGeometry;
}

/**
 * Merge colored boxes into a single vertex-colored geometry
 * Creates efficient geometry for props and character parts
 * @param {Array} boxes - Array of box definitions with {w,h,d,x,y,z,color,rx?,ry?,rz?}
 * @returns {THREE.BufferGeometry} - Merged geometry with vertex colors
 */
export function mergeColoredBoxes(boxes) {
  const geometries = boxes.map((b) => {
    // Box field names are the compact w/h/d contract callers use (see pedestrians.js).
    let geometry = new THREE.BoxGeometry(b.w, b.h, b.d);

    // Apply rotations if specified
    if (b.rx) geometry.rotateX(b.rx);
    if (b.ry) geometry.rotateY(b.ry);
    if (b.rz) geometry.rotateZ(b.rz);

    // Apply translation
    geometry.translate(b.x ?? 0, b.y ?? 0, b.z ?? 0);

    // Convert to non-indexed for merging
    geometry = geometry.toNonIndexed();

    // Add vertex colors
    const color = new THREE.Color(b.color);
    const vertexCount = geometry.attributes.position.count;
    const colorArray = new Float32Array(vertexCount * 3);
    
    for (let i = 0; i < vertexCount; i++) {
      colorArray[i * 3] = color.r;
      colorArray[i * 3 + 1] = color.g;
      colorArray[i * 3 + 2] = color.b;
    }
    
    geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    return geometry;
  });
  
  // Merge all geometries
  let totalVertexCount = 0;
  for (const geometry of geometries) {
    totalVertexCount += geometry.attributes.position.count;
  }
  
  const positionArray = new Float32Array(totalVertexCount * 3);
  const normalArray = new Float32Array(totalVertexCount * 3);
  const colorArray = new Float32Array(totalVertexCount * 3);
  
  let offset = 0;
  for (const geometry of geometries) {
    positionArray.set(geometry.attributes.position.array, offset * 3);
    normalArray.set(geometry.attributes.normal.array, offset * 3);
    colorArray.set(geometry.attributes.color.array, offset * 3);
    
    offset += geometry.attributes.position.count;
    geometry.dispose();
  }
  
  const mergedGeometry = new THREE.BufferGeometry();
  mergedGeometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
  mergedGeometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3));
  mergedGeometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
  mergedGeometry.computeBoundingSphere();
  
  return mergedGeometry;
}

/**
 * Create building geometry with properly scaled UVs for texture tiling
 * Ensures facade textures maintain proper window scale regardless of building size
 * @param {number} width - Building width
 * @param {number} height - Building height
 * @param {number} depth - Building depth
 * @param {number} tileWidth - Texture tile width (default: 7.5)
 * @param {number} tileHeight - Texture tile height (default: 7.0)
 * @returns {THREE.BoxGeometry} - Building geometry with scaled UVs
 */
export function createBuildingGeometry(width, height, depth, tileWidth = 7.5, tileHeight = 7.0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uvAttribute = geometry.attributes.uv;
  
  // UV scaling factors for each face
  const faceUVScales = [
    [depth / tileWidth, height / tileHeight], // Front face
    [depth / tileWidth, height / tileHeight], // Back face
    [width / tileWidth, depth / tileWidth],  // Right face
    [width / tileWidth, depth / tileWidth],  // Left face
    [width / tileWidth, height / tileHeight], // Top face
    [width / tileWidth, height / tileHeight], // Bottom face
  ];
  
  // Apply UV scaling to each face
  for (let face = 0; face < 6; face++) {
    const [scaleU, scaleV] = faceUVScales[face];
    for (let vertex = 0; vertex < 4; vertex++) {
      const vertexIndex = face * 4 + vertex;
      uvAttribute.setXY(
        vertexIndex,
        uvAttribute.getX(vertexIndex) * scaleU,
        uvAttribute.getY(vertexIndex) * scaleV
      );
    }
  }
  
  uvAttribute.needsUpdate = true;
  return geometry;
}

// ===== CACHE MANAGEMENT =====

/**
 * Clean up texture cache and dispose of all textures
 * Important for memory management when reloading or changing scenes
 */
export function cleanupTextureCache() {
  for (const texture of textureCache.values()) {
    texture.dispose?.(); // Safe disposal with optional chaining
  }
  textureCache.clear();
}

// ===== EXPORT ALIASES FOR BACKWARD COMPATIBILITY =====
// The descriptive generate*/create* names live above; these short aliases are the names the rest
// of the game imports, so call sites stay terse.
export {
  generateAsphaltTexture as texAsphalt,
  generateConcreteTexture as texConcrete,
  generateGrassTexture as texGrass,
  generateSandTexture as texSand,
  generateRoofTexture as texRoof,
  generateFacadeTexture as texFacade,
  generateShopfrontTexture as texShopfront,
  generateFaceTexture as texFace,
  mergeGeometries as mergeGeoms,
  createBuildingGeometry as buildingGeo,
  cleanupTextureCache as disposeCache,
};