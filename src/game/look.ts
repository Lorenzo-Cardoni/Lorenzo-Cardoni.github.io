// Visual touches that work by patching the stock materials: a light grain on the ground and the
// walls, grass that sways in the wind, animated water, and dust behind the wheels. They read a
// small tiling noise texture with world coordinates, so the merged models need no UVs.
import * as THREE from 'three';

/** Seconds, for everything that moves in a shader. The world sets it every frame. */
export const shaderTime = { value: 0 };

/** A tiling noise texture: random values, blurred with wrap-around so it repeats seamlessly. */
function makeNoise(size = 128): THREE.DataTexture {
  let a = new Float32Array(size * size);
  let seed = 7;
  for (let i = 0; i < a.length; i++) {
    seed = (seed * 16807) % 2147483647;
    a[i] = seed / 2147483647;
  }
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(a.length);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += a[((y + dy + size) % size) * size + ((x + dx + size) % size)];
        b[y * size + x] = sum / 9;
      }
    }
    a = b;
  }
  // Stretch back to the full range after the blur flattened it.
  let lo = 1;
  let hi = 0;
  for (const v of a) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < a.length; i++) {
    const v = Math.round(((a[i] - lo) / (hi - lo || 1)) * 255);
    data.set([v, v, v, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
export const noiseMap = makeNoise();

/** The world position and normal, passed to the fragment shader. Handles instanced meshes. */
const WORLD_VARYINGS = `
  vec4 lookWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    lookWorld = instanceMatrix * lookWorld;
  #endif
  lookWorld = modelMatrix * lookWorld;
  vLookPos = lookWorld.xyz;
  vLookNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

/**
 * A light grain over a material: the noise is read on the plane the surface faces most, at a
 * fine and a coarse scale, and darkens or lightens the color by up to `strength`.
 */
export function addGrain(material: THREE.MeshLambertMaterial, scale = 0.35, strength = 0.12): THREE.MeshLambertMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.lookNoise = { value: noiseMap };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLookPos;\nvarying vec3 vLookNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WORLD_VARYINGS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D lookNoise;\nvarying vec3 vLookPos;\nvarying vec3 vLookNormal;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 lookN = abs(vLookNormal);
        vec2 lookUv = lookN.y > max(lookN.x, lookN.z) ? vLookPos.xz : (lookN.x > lookN.z ? vLookPos.zy : vLookPos.xy);
        float grain = texture2D(lookNoise, lookUv * ${scale.toFixed(3)}).r * 0.6 + texture2D(lookNoise, lookUv * ${(scale * 0.21).toFixed(3)}).r * 0.4;
        diffuseColor.rgb *= 1.0 + ${strength.toFixed(3)} * (grain * 2.0 - 1.0);`,
      );
  };
  material.customProgramCacheKey = () => `grain-${scale}-${strength}`;
  return material;
}

/** Grass that sways: each tuft bends with the wind, more at the tip, out of step with its neighbours. */
export function addSway(material: THREE.MeshLambertMaterial, amount = 0.14): THREE.MeshLambertMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.lookTime = shaderTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float lookTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 lookAt = instanceMatrix[3].xz;
      #else
        vec2 lookAt = vec2(0.0);
      #endif
      float lookWave = sin(lookTime * 1.6 + lookAt.x * 0.21 + lookAt.y * 0.17) + 0.4 * sin(lookTime * 3.3 + lookAt.x * 0.53);
      transformed.x += lookWave * ${amount.toFixed(3)} * transformed.y * transformed.y;
      transformed.z += lookWave * ${(amount * 0.6).toFixed(3)} * transformed.y * transformed.y;`,
    );
  };
  material.customProgramCacheKey = () => `sway-${amount}`;
  return material;
}

/** Animated water: two layers of drifting ripples, lighter crests and small glints of sun. */
export function addWater(material: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.lookNoise = { value: noiseMap };
    shader.uniforms.lookTime = shaderTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLookPos;\nvarying vec3 vLookNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WORLD_VARYINGS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D lookNoise;\nuniform float lookTime;\nvarying vec3 vLookPos;\nvarying vec3 vLookNormal;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 lookW = vLookPos.xz * 0.018;
        float lookA = texture2D(lookNoise, lookW + vec2(lookTime * 0.012, lookTime * 0.007)).r;
        float lookB = texture2D(lookNoise, lookW * 1.9 - vec2(lookTime * 0.009, -lookTime * 0.014)).r;
        float lookR = lookA * lookB;
        diffuseColor.rgb *= 0.9 + 0.35 * smoothstep(0.15, 0.5, lookR);
        diffuseColor.rgb += vec3(0.55) * smoothstep(0.52, 0.7, lookR);`,
      );
  };
  material.customProgramCacheKey = () => 'water';
  return material;
}

// ---------- Dust ----------

/** A puff of dust or spray: where, how big, and the color. */
interface Puff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  color: THREE.Color;
}

/**
 * Dust behind the wheels and spray behind the boat: a small pool of soft round points that rise,
 * grow and fade. `emit` adds puffs, `update` moves them.
 */
export function makeDust(max = 120) {
  const positions = new Float32Array(max * 3);
  const colors = new Float32Array(max * 3);
  const sizes = new Float32Array(max);
  const alphas = new Float32Array(max);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { scale: { value: 600 } },
    vertexShader: `
      attribute float size; attribute float alpha; attribute vec3 color;
      uniform float scale; varying float vAlpha; varying vec3 vColor;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * scale / max(-mv.z, 1.0);
        vAlpha = alpha; vColor = color;
      }`,
    fragmentShader: `
      varying float vAlpha; varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.1, d));
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const puffs: Puff[] = [];
  return {
    points,
    /** Viewport height in pixels, so puffs keep their size on any screen. */
    resize(height: number) {
      material.uniforms.scale.value = height;
    },
    emit(x: number, y: number, z: number, color: THREE.Color, spread = 0.6, size = 1.4) {
      if (puffs.length >= max) puffs.shift();
      puffs.push({
        x: x + (Math.random() - 0.5) * spread,
        y,
        z: z + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 1.2,
        vy: 0.6 + Math.random() * 0.8,
        vz: (Math.random() - 0.5) * 1.2,
        age: 0,
        life: 0.9 + Math.random() * 0.6,
        size: size * (0.7 + Math.random() * 0.6),
        color,
      });
    },
    update(dt: number) {
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.age += dt;
        if (p.age >= p.life) puffs.splice(i, 1);
      }
      puffs.forEach((p, i) => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const f = p.age / p.life;
        positions.set([p.x, p.y, p.z], i * 3);
        colors.set([p.color.r, p.color.g, p.color.b], i * 3);
        sizes[i] = p.size * (1 + f * 1.8);
        alphas[i] = 0.55 * (1 - f);
      });
      geometry.setDrawRange(0, puffs.length);
      for (const name of ['position', 'color', 'size', 'alpha']) geometry.attributes[name].needsUpdate = true;
    },
  };
}
