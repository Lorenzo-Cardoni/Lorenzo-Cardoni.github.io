// A small construction kit for the models: primitives are placed one by one, then every piece
// that shares a material is merged into a single mesh, so a whole building costs a few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, type MatKey } from './palette';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _a = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const HALF = Math.PI / 2;

export class Kit {
  private parts = new Map<MatKey, THREE.BufferGeometry[]>();

  private place(key: MatKey, geometry: THREE.BufferGeometry): this {
    const piece = geometry.index ? geometry.toNonIndexed() : geometry;
    piece.deleteAttribute('uv');
    piece.applyMatrix4(_m);
    const list = this.parts.get(key);
    if (list) list.push(piece);
    else this.parts.set(key, [piece]);
    return this;
  }

  /** Any geometry, moved to a position, turned (x, then y, then z applied last to first) and scaled. */
  put(key: MatKey, geometry: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): this {
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    return this.place(key, geometry);
  }

  /**
   * A box standing on height y. Boxes of some size get softly rounded edges, like a toy; thin ones
   * (window strips, stripes, rails) stay plain, which keeps the triangle count down.
   */
  box(key: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): this {
    const least = Math.min(w, h, d);
    const geometry = least >= 0.45 ? new RoundedBoxGeometry(w, h, d, 1, Math.min(0.35, least * 0.2)) : new THREE.BoxGeometry(w, h, d);
    return this.put(key, geometry, x, y + h / 2, z, 0, ry, 0);
  }

  /** An upright cylinder or cone frustum standing on height y. */
  cyl(key: MatKey, top: number, bottom: number, h: number, x: number, y: number, z: number, sides = 10): this {
    return this.put(key, new THREE.CylinderGeometry(top, bottom, h, sides), x, y + h / 2, z);
  }

  cone(key: MatKey, r: number, h: number, x: number, y: number, z: number, sides = 8): this {
    return this.put(key, new THREE.ConeGeometry(r, h, sides), x, y + h / 2, z);
  }

  /** A sphere centred on the point: smooth enough for soft shading. */
  ball(key: MatKey, r: number, x: number, y: number, z: number, detail = 2): this {
    return this.put(key, new THREE.IcosahedronGeometry(r, detail), x, y, z);
  }

  /** A lying cylinder along x or z, centred on the point. */
  rod(key: MatKey, r: number, length: number, x: number, y: number, z: number, axis: 'x' | 'z', sides = 10): this {
    return this.put(key, new THREE.CylinderGeometry(r, r, length, sides), x, y, z, axis === 'z' ? HALF : 0, 0, axis === 'x' ? HALF : 0);
  }

  /** A flat ring on the ground. */
  ring(key: MatKey, inner: number, outer: number, x: number, y: number, z: number, sides = 40): this {
    return this.put(key, new THREE.RingGeometry(inner, outer, sides), x, y, z, -HALF);
  }

  /** A torus lying flat, or standing with its axis along x. */
  torus(key: MatKey, r: number, tube: number, x: number, y: number, z: number, upright = false): this {
    return this.put(key, new THREE.TorusGeometry(r, tube, 6, 20), x, y, z, upright ? 0 : HALF, upright ? HALF : 0, 0);
  }

  /** A thin cylinder from one point to another. */
  link(key: MatKey, r: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): this {
    _a.set(bx - ax, by - ay, bz - az);
    const length = _a.length();
    _q.setFromUnitVectors(UP, _a.normalize());
    _m.compose(_p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(1, 1, 1));
    return this.place(key, new THREE.CylinderGeometry(r, r, length, 6));
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    this.parts.forEach((list, key) => {
      const merged = mergeGeometries(list, false);
      list.forEach((piece) => piece.dispose());
      if (merged) group.add(new THREE.Mesh(merged, mat(key)));
    });
    this.parts.clear();
    return group;
  }
}

/** Builds a separate group, for the pieces of a model that move on their own. */
export function part(build: (k: Kit) => void): THREE.Group {
  const kit = new Kit();
  build(kit);
  return kit.build();
}
