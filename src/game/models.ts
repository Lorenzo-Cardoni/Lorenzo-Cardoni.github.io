// The low-poly models of the world: one per place, plus the drone, the year gates and the scenery.
// Every model is drawn around its own origin, standing on y = 0, with its front toward +z.
import * as THREE from 'three';
import { Kit, part } from './kit';
import { TAU, rng } from './layout';
import { mat, onPalette, tint, type MatKey } from './palette';
import { lettering, signTexture, toolTexture } from './signs';
import type { StationDef } from './stations';

export interface Built {
  group: THREE.Group;
  /** Height of the model, for the detection box drawn around it. */
  h: number;
  /** Moves the animated pieces. t is the time in seconds. */
  update?: (t: number) => void;
  /** Solid parts the drone cannot fly through: x, z, radius, height (all local). */
  solid?: [number, number, number, number][];
  /**
   * Roofs the drone can fly under or land on: centre x, z, half width, half depth, ceiling, top
   * (all local). Inside, the drone stays below the ceiling; above, it stays on the roof.
   */
  roofs?: [number, number, number, number, number, number][];
  /** Vehicles parked or moving here that the visitor can take. */
  vehicles?: { kind: VehicleKind; object: THREE.Object3D }[];
}

export type VehicleKind = 'drone' | 'car' | 'bike' | 'boat';

const HALF = Math.PI / 2;

// ---------- Drone ----------

export interface DroneModel {
  group: THREE.Group;
  rotors: THREE.Object3D[];
}

/** A quadcopter about 2 units across. Its nose points to -z. */
export function makeDrone(): DroneModel {
  const k = new Kit();
  k.box('white', 0.62, 0.2, 0.9, 0, -0.1, 0);
  k.box('dark', 0.46, 0.14, 0.5, 0, 0.1, -0.05);
  k.ball('dark', 0.13, 0, -0.2, -0.4);
  k.box('accent', 0.1, 0.1, 0.05, 0, -0.25, -0.53);
  for (const sx of [-1, 1]) {
    k.box('dark', 0.05, 0.05, 0.95, sx * 0.28, -0.42, 0);
    k.box('dark', 0.04, 0.3, 0.04, sx * 0.28, -0.4, -0.3);
    k.box('dark', 0.04, 0.3, 0.04, sx * 0.28, -0.4, 0.3);
    k.box('accent', 0.12, 0.06, 0.05, sx * 0.2, -0.04, -0.46);
    k.box('signal', 0.12, 0.06, 0.05, sx * 0.2, -0.04, 0.46);
    for (const sz of [-1, 1]) {
      k.put('structure', new THREE.BoxGeometry(0.09, 0.07, 1.2), sx * 0.42, 0, sz * 0.42, 0, Math.atan2(sx, sz), 0);
      k.cyl('dark', 0.1, 0.12, 0.18, sx * 0.8, -0.04, sz * 0.8, 8);
    }
  }
  const group = k.build();

  const disc = tint('light', 0.16);
  const rotors: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const rotor = part((r) => r.box('dark', 0.92, 0.02, 0.08, 0, 0, 0));
      const blur = new THREE.Mesh(new THREE.CircleGeometry(0.47, 20), disc);
      blur.rotation.x = -HALF;
      rotor.add(blur);
      rotor.position.set(sx * 0.8, 0.17, sz * 0.8);
      group.add(rotor);
      rotors.push(rotor);
    }
  }
  return { group, rotors };
}

// ---------- Vehicles ----------
// Each faces +z. The places use them as props, and the visitor can take them.

/** The 1:10 autonomous car of the Bosch challenge, at a size that fits the island. */
export function makeCar(): THREE.Group {
  const car = part((c) => {
    c.box('white', 1, 0.42, 1.9, 0, 0.2, 0);
    c.box('dark', 0.82, 0.34, 0.9, 0, 0.62, -0.15);
    c.box('accent', 0.2, 0.2, 0.2, 0, 0.96, 0.2);
    for (const sx of [-1, 1]) {
      c.box('accent', 0.2, 0.12, 0.05, sx * 0.3, 0.38, 0.96);
      c.box('signal', 0.2, 0.1, 0.05, sx * 0.3, 0.4, -0.96);
      for (const sz of [-1, 1]) c.rod('dark', 0.25, 0.2, sx * 0.55, 0.25, sz * 0.6, 'x', 10);
    }
  });
  car.scale.setScalar(1.25);
  const holder = new THREE.Group();
  holder.add(car);
  return holder;
}

/** The self-driving e-bike: its electronics box sits behind the seat. */
export function makeBike(): THREE.Group {
  const bike = part((b) => {
    for (const z of [-0.75, 0.75]) b.torus('dark', 0.5, 0.07, 0, 0.5, z, true);
    b.put('accent', new THREE.BoxGeometry(0.08, 0.08, 1.15), 0, 1.02, -0.05, -0.12);
    b.put('accent', new THREE.BoxGeometry(0.08, 0.08, 0.95), 0, 0.72, 0.3, 0.75);
    b.put('accent', new THREE.BoxGeometry(0.08, 0.08, 0.9), 0, 0.7, -0.42, -0.6);
    b.put('accent', new THREE.BoxGeometry(0.07, 0.07, 0.85), 0, 0.82, 0.68, HALF - 0.25);
    b.box('dark', 0.7, 0.06, 0.06, 0, 1.24, 0.6);
    b.box('dark', 0.22, 0.08, 0.4, 0, 1.12, -0.52);
    b.box('light', 0.36, 0.3, 0.5, 0, 0.72, -0.9);
    b.box('accent', 0.1, 0.05, 0.1, 0, 1.02, -0.9);
  });
  bike.scale.setScalar(1.35);
  const holder = new THREE.Group();
  holder.add(bike);
  return holder;
}

/** The support boat of the GeoPosBall sea trials. */
export function makeBoat(): THREE.Group {
  return part((b) => {
    b.box('white', 1.9, 0.9, 4.2, 0, -0.3, 0);
    b.put('white', new THREE.CylinderGeometry(1, 1, 0.9, 3), 0, 0.15, 2.6, 0, 0, 0, 1.1, 1, 1);
    b.box('structure', 1.4, 0.9, 1.6, 0, 0.6, -0.8);
    b.box('window', 1.2, 0.4, 0.06, 0, 0.95, 0.03);
    b.cyl('light', 0.04, 0.04, 1.6, 0, 1.5, -0.8, 5);
    b.box('signal', 0.5, 0.34, 0.04, 0.27, 2.7, -0.8);
  });
}

// ---------- Places ----------

type Builder = (def: StationDef) => Built;

/** A site camera on a pole: returns the head, which the caller pans. */
function cameraHead(): THREE.Group {
  const head = part((k) => {
    k.box('dark', 0.5, 0.36, 0.95, 0, -0.18, 0);
    k.box('accent', 0.22, 0.22, 0.05, 0, -0.11, 0.48);
  });
  const view = new THREE.Mesh(new THREE.ConeGeometry(2.4, 8, 14, 1, true), tint('accent', 0.1, true));
  view.rotation.x = -HALF;
  view.position.z = 4.4;
  head.add(view);
  head.rotation.order = 'YXZ';
  return head;
}

/**
 * A slice of a ring raised from y to y + h: centre (cx, cz), radii `inner` to `outer` (0 for a full
 * wedge), centred on the compass direction `dir` (0 is -z, a half turn +z) and spreading `half` either side.
 */
function fan(k: Kit, key: MatKey, cx: number, cz: number, inner: number, outer: number, dir: number, half: number, y: number, h: number) {
  // Drawn flat, then stood up: the shape's y axis becomes -z, so a compass direction d is the angle HALF - d.
  const mid = HALF - dir;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, mid - half, mid + half, false);
  if (inner > 0) shape.absarc(0, 0, inner, mid + half, mid - half, true);
  else shape.lineTo(0, 0);
  shape.closePath();
  k.put(key, new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 20 }), cx, y, cz, -HALF);
}

const BUILDERS: Record<string, Builder> = {
  // Home: the landing pad the flight starts from.
  pad: () => {
    const k = new Kit();
    k.cyl('dark', 6.5, 6.8, 0.3, 0, 0, 0, 36);
    k.ring('accent', 5.3, 5.55, 0, 0.32, 0, 56);
    // The site's mark: four corner brackets and a square.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        k.box('accent', 1.5, 0.04, 0.3, sx * 2.25, 0.3, sz * 2.85);
        k.box('accent', 0.3, 0.04, 1.5, sx * 2.85, 0.3, sz * 2.25);
      }
    }
    k.box('accent', 1.3, 0.04, 1.3, 0, 0.3, 0);
    k.box('structure', 4.2, 2.8, 3.2, -6.4, 0, -5.6);
    k.box('light', 4.6, 0.25, 3.6, -6.4, 2.8, -5.6);
    k.box('window', 3.2, 0.9, 0.08, -6.4, 1.3, -3.98);
    k.cyl('light', 0.09, 0.12, 8.5, 6.6, 0, -5.4, 6);
    k.box('accent', 1.7, 0.9, 0.06, 7.5, 7.4, -5.4);
    const group = k.build();
    const dish = part((d) => {
      d.cyl('light', 0.08, 0.08, 0.9, 0, 0, 0, 6);
      d.box('light', 1.5, 0.7, 0.1, 0, 0.9, 0);
    });
    dish.position.set(-6.4, 3.05, -5.6);
    group.add(dish);
    return { group, h: 8.5, update: (t) => (dish.rotation.y = t * 0.8), solid: [[-6.4, -5.6, 2.8, 3.4]] };
  },

  // Inim Electronics: an R&D building watched by cameras.
  office: () => {
    const k = new Kit();
    k.box('structure', 12, 6, 7, 0, 0, -1);
    k.box('dark', 12.4, 0.3, 7.4, 0, 6, -1);
    k.box('light', 5.5, 9.5, 5.5, -3.6, 0, -0.6);
    k.box('dark', 5.9, 0.3, 5.9, -3.6, 9.5, -0.6);
    for (const y of [1.4, 3.6]) k.box('window', 5.4, 1.1, 0.08, 2.9, y, 2.54);
    for (const y of [1.5, 3.6, 5.7, 7.8]) k.box('window', 4.5, 0.9, 0.08, -3.6, y, 2.19);
    k.box('dark', 3, 0.2, 1.6, 3, 2.7, 3.2);
    k.box('accent', 3, 0.08, 0.08, 3, 2.62, 3.98);
    k.cyl('light', 0.12, 0.16, 2.2, 3, 6.3, -1.5, 6);
    for (const x of [-7.6, 7.6]) k.cyl('light', 0.08, 0.1, 4.2, x, 0, 5.6, 6);
    const group = k.build();
    const heads = [
      [3, 8.86, -1.5, 0.35],
      [-7.6, 4.56, 5.6, 0.5],
      [7.6, 4.56, 5.6, 0.5],
    ].map(([x, y, z, tilt]) => {
      const head = cameraHead();
      head.position.set(x, y, z);
      head.rotation.x = tilt;
      group.add(head);
      return head;
    });
    return {
      group,
      h: 10.5,
      update: (t) => heads.forEach((head, i) => (head.rotation.y = Math.sin(t * 0.5 + i * 2.1) * 1.1)),
      solid: [[-0.5, -1, 7.6, 9.8]],
    };
  },

  // Lega del Filo d'Oro: a non-profit for deafblind people. A small residential quarter with a
  // community centre, gardens and a tactile guide path that people walk along in pairs.
  residential: () => {
    const k = new Kit();
    const house = (x: number, z: number, ry: number, w: number, d: number, h: number) => {
      const c = Math.cos(ry);
      const n = Math.sin(ry);
      const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * n, z - lx * n + lz * c];
      k.box('white', w, h, d, x, 0, z, ry);
      // A triangular prism, ridge from front to back.
      const roof = new THREE.CylinderGeometry(1, 1, 1, 3).rotateX(-HALF);
      k.put('roof', roof, x, h + 0.62, z, 0, ry, 0, (w + 0.6) / 1.732, 1.25, d + 0.6);
      const [dx, dz] = at(0, d / 2 + 0.02);
      k.box('dark', 0.9, 1.6, 0.06, dx, 0, dz, ry);
      for (const side of [-1, 1]) {
        const [wx, wz] = at(side * w * 0.3, d / 2 + 0.02);
        k.box('window', 0.8, 0.8, 0.05, wx, 1.3, wz, ry);
      }
      const [gx, gz] = at(w / 2 + 1.4, 0);
      k.box('tree', 1.4, 0.7, d * 0.9, gx, 0, gz, ry);
    };
    house(-8, -6, 0.3, 3.8, 4.2, 3);
    house(-9.2, 2, HALF - 0.2, 3.6, 4, 2.8);
    house(8.2, -5.6, -0.35, 3.8, 4.2, 3.2);
    house(9, 2.6, -HALF + 0.15, 3.6, 4, 2.8);

    // Community centre: low, wide, with a canopy over the entrance.
    k.box('light', 8.4, 3, 5.2, 0, 0, -7);
    k.box('tree', 8.6, 0.3, 5.4, 0, 3, -7);
    k.box('window', 6.4, 1.2, 0.06, 0, 1, -4.38);
    k.box('light', 3.4, 0.2, 2, 0, 2.4, -3.4);
    for (const x of [-1.5, 1.5]) k.cyl('light', 0.08, 0.08, 2.4, x, 0, -2.5, 6);
    k.box('accent', 2.4, 0.12, 0.06, 0, 2.6, -2.38);


    // Tactile guide path: a loop of raised studs the residents follow with their feet.
    k.ring('light', 3.4, 5.2, 0, 0.05, 2.4, 48);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU;
      k.box('accent', 0.42, 0.06, 0.42, Math.cos(a) * 4.3, 0.06, 2.4 + Math.sin(a) * 4.3, -a);
    }
    k.box('light', 1.6, 0.04, 3.2, 0, 0.04, -1.2);
    k.ball('tree', 1.6, 0, 1.1, 2.4, 1);
    k.box('dark', 1.6, 0.4, 0.5, -1.6, 0, 6.9);
    k.box('dark', 1.6, 0.4, 0.5, 1.6, 0, 6.9);
    for (const [x, z] of [
      [-4.2, 8.6],
      [4.4, 8.4],
      [-11, -2.6],
      [11.2, -1.4],
    ]) {
      k.cyl('trunk', 0.14, 0.18, 0.9, x, 0, z, 5);
      k.ball('tree', 1.1, x, 1.9, z, 0);
    }
    const group = k.build();

    // Pairs walking the guide path: one guides, one follows a hand on the shoulder.
    const person = part((p) => {
      p.cyl('light', 0.22, 0.28, 1.05, 0, 0, 0, 8);
      p.ball('light', 0.25, 0, 1.3, 0);
    }).children[0] as THREE.Mesh;
    const pairs = [0, 0.5].map(() => {
      const a = new THREE.Mesh(person.geometry, person.material);
      const b = new THREE.Mesh(person.geometry, person.material);
      group.add(a, b);
      return [a, b];
    });
    return {
      group,
      h: 5,
      update: (t) =>
        pairs.forEach(([a, b], i) => {
          const angle = t * 0.16 + i * Math.PI;
          a.position.set(Math.cos(angle) * 4.3, 0.06, 2.4 + Math.sin(angle) * 4.3);
          b.position.set(Math.cos(angle - 0.2) * 4.3, 0.06, 2.4 + Math.sin(angle - 0.2) * 4.3);
        }),
      solid: [
        [0, -7, 4.8, 3.4],
        [-8, -6, 2.6, 4.3],
        [-9.2, 2, 2.6, 4.1],
        [8.2, -5.6, 2.6, 4.5],
        [9, 2.6, 2.6, 4.1],
      ],
    };
  },

  // Pieralisi: a factory with the motor test bench in front of it.
  factory: () => {
    const k = new Kit();
    k.box('structure', 12, 4.6, 7, 0, 0, -2.5);
    for (let i = 0; i < 3; i++) {
      const x = -4 + i * 4;
      k.put('dark', new THREE.BoxGeometry(4.3, 0.25, 7), x, 5.4, -2.5, 0, 0, 0.38);
      k.box('window', 0.08, 1.4, 6.4, x + 1.96, 4.7, -2.5);
    }
    k.cyl('light', 0.5, 0.62, 9.5, 4.6, 0, -4.6, 8);
    k.box('dark', 2.6, 3.1, 0.1, -3.2, 0, 1.02);
    k.box('window', 3.2, 1.1, 0.08, 2.6, 2, 1.02);
    k.box('dark', 7.4, 0.35, 2.4, 1.4, 0, 4.8);
    k.rod('light', 0.72, 2, -0.6, 1.2, 4.8, 'x', 14);
    k.rod('structure', 1.02, 2.7, 3.5, 1.45, 4.8, 'x', 14);
    for (const x of [-1.2, 0, 2.6, 4.4]) k.box('dark', 0.3, 0.5, 1.6, x, 0.3, 4.8);
    k.box('light', 0.9, 1.7, 0.7, -3.6, 0, 4.8);
    k.box('accent', 0.5, 0.14, 0.05, -3.6, 1.3, 5.17);
    const group = k.build();
    const shaft = part((s) => {
      s.rod('accent', 0.13, 1.75, 0, 0, 0, 'x', 8);
      s.rod('dark', 0.46, 0.26, 0, 0, 0, 'x', 12);
      s.box('accent', 0.12, 1.05, 0.14, 0, -0.525, 0);
    });
    shaft.position.set(1.28, 1.3, 4.8);
    group.add(shaft);
    return { group, h: 9.5, update: (t) => (shaft.rotation.x = t * 7), solid: [[0, -2.5, 7.2, 6.4]] };
  },

  // University laboratory: a workshop and the pool the underwater prototype was tested in.
  lab: () => {
    const k = new Kit();
    k.box('structure', 7, 3.4, 5, -2, 0, -2.2);
    k.box('structure', 6.9, 1.1, 1.2, -2, 3.4, -2.2);
    k.put('dark', new THREE.BoxGeometry(7.4, 0.22, 3.1), -2, 4.05, -3.55, -0.45);
    k.put('dark', new THREE.BoxGeometry(7.4, 0.22, 3.1), -2, 4.05, -0.85, 0.45);
    k.box('window', 2.2, 1.2, 0.08, -3.4, 1.2, 0.33);
    k.box('dark', 1.3, 2.3, 0.08, -0.2, 0, 0.33);
    k.box('light', 5.6, 0.7, 4.6, 3.8, 0, 3.4);
    k.box('pool', 5, 0.06, 4, 3.8, 0.68, 3.4);
    k.box('dark', 1.6, 0.9, 0.8, 3.2, 0, -1.6);
    k.box('accent', 0.4, 0.06, 0.3, 3.2, 0.9, -1.6);
    const group = k.build();
    const probe = part((p) => {
      p.ball('signal', 0.45, 0, 0, 0);
      p.cyl('light', 0.04, 0.04, 0.9, 0, 0.3, 0, 5);
    });
    group.add(probe);
    return {
      group,
      h: 5.6,
      update: (t) => probe.position.set(3.8 + Math.sin(t * 0.4) * 1.4, 0.82 + Math.sin(t * 1.7) * 0.08, 3.4 + Math.cos(t * 0.31) * 0.9),
      solid: [[-2, -2.2, 4.6, 4.8]],
    };
  },

  // A school without a model of its own: a hall with a colonnade and a pediment.
  hall: () => {
    const k = new Kit();
    k.box('light', 12, 0.5, 8, 0, 0, -1.5);
    k.box('structure', 10.4, 5, 6, 0, 0.5, -2);
    for (let i = 0; i < 6; i++) k.cyl('light', 0.32, 0.36, 4.2, -4.5 + i * 1.8, 0.5, 1.7, 8);
    k.box('light', 11, 0.6, 1.7, 0, 4.7, 1.5);
    k.put('structure', new THREE.CylinderGeometry(1, 1, 1.5, 3), 0, 6.05, 1.5, -HALF, 0, 0, 6.35, 1, 1.5);
    k.box('dark', 1.6, 2.6, 0.1, 0, 0.5, 1.02);
    return { group: k.build(), h: 8, solid: [[0, -2, 6.6, 7.2]] };
  },

  // Università Politecnica delle Marche, the engineering campus on Monte Dago where both degrees
  // were taken. Behind, the grey concrete tower and the terraced wings, wrapped in ribbon windows,
  // with steel ducts up the front. In front, the main lecture hall: a fan whose roof steps up like
  // the seats inside, a round stair tower at its tip, and a plaza paved in rays around it. The
  // mini-drone over the plaza is the BSc thesis, attitude control.
  campus: () => {
    const k = new Kit();

    // Wing behind: three floors and a set-back top floor.
    k.box('structure', 19, 4.4, 4.4, 0.5, 0, -7.2);
    k.box('light', 19.3, 0.25, 4.7, 0.5, 4.4, -7.2);
    k.box('structure', 15, 1.6, 2.6, 1.5, 4.65, -8.1);
    k.box('light', 15.3, 0.2, 2.9, 1.5, 6.25, -8.1);
    for (const y of [0.7, 2.1, 3.5]) k.box('window', 18.4, 0.62, 0.08, 0.5, y, -4.96);
    k.box('window', 14.4, 0.6, 0.08, 1.5, 5.2, -6.76);
    for (const x of [-1, 5.4, 6.6]) {
      k.cyl('light', 0.3, 0.3, 5.8, x, 0, -4.7, 10);
      k.cyl('dark', 0.34, 0.34, 0.2, x, 5.8, -4.7, 10);
    }

    // The tower, ribbon windows on every floor, and the stair core beside it.
    const TX = -4.6;
    const TZ = -7.6;
    k.box('structure', 5.4, 17.5, 5.4, TX, 0, TZ);
    for (let i = 0; i < 8; i++) {
      const y = 5 + i * 1.5;
      k.box('window', 5, 0.62, 0.08, TX, y, TZ + 2.74);
      k.box('window', 0.08, 0.62, 5, TX + 2.74, y, TZ);
      k.box('window', 0.08, 0.62, 5, TX - 2.74, y, TZ);
    }
    k.box('dark', 5.8, 0.3, 5.8, TX, 17.5, TZ);
    k.box('structure', 2.4, 1.4, 2.4, TX + 0.8, 17.8, TZ - 0.6);
    k.cyl('light', 0.06, 0.1, 2.6, TX - 1.2, 17.8, TZ + 1.2, 6);
    k.box('white', 1.6, 16.2, 1.8, -8.1, 0, TZ);
    k.box('window', 0.3, 14, 0.08, -8.1, 1, TZ + 0.94);

    // Terraced wing on the right, stepping back toward the top.
    k.box('structure', 3.8, 3.3, 7, 9.1, 0, -1.1);
    k.box('light', 4, 0.2, 7.2, 9.1, 3.3, -1.1);
    k.box('structure', 2.2, 1.5, 6, 9.9, 3.5, -1.6);
    k.box('light', 2.4, 0.2, 6.2, 9.9, 5, -1.6);
    for (const y of [0.8, 2.2]) {
      k.box('window', 3.4, 0.6, 0.08, 9.1, y, 2.44);
      k.box('window', 0.08, 0.6, 6.6, 7.16, y, -1.1);
    }
    k.box('window', 0.08, 0.55, 5.6, 8.76, 3.95, -1.6);

    // The lecture hall: steps of roof rising away from the tip, each edged with a dark line,
    // between two side walls that climb with them.
    const AZ = 4.6;
    const SPREAD = 0.85;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const r0 = 1.5 + (7.1 * i) / steps;
      const r1 = 1.5 + (7.1 * (i + 1)) / steps;
      const top = 1.3 + 0.52 * (i + 1);
      fan(k, 'white', 0, AZ, r0, r1, 0, SPREAD, 0, top);
      fan(k, 'light', 0, AZ, r0 + 0.14, r1, 0, SPREAD, top, 0.04);
      fan(k, 'dark', 0, AZ, r0, r0 + 0.14, 0, SPREAD, top, 0.05);
      for (const side of [-1, 1]) {
        const a = side * SPREAD;
        const mid = (r0 + r1) / 2;
        k.box('white', 0.3, top + 0.5, r1 - r0 + 0.02, Math.sin(a) * mid, 0, AZ - Math.cos(a) * mid, Math.PI - a);
      }
    }
    k.cyl('white', 1.5, 1.5, 3.6, 0, 0, AZ, 20);
    k.cyl('dark', 1.2, 1.2, 0.05, 0, 3.6, AZ, 20);
    k.box('dark', 0.9, 2, 0.1, 0, 0, AZ + 1.47);
    k.box('dark', 0.24, 1, 0.1, 0, 2.3, AZ + 1.47);

    // The plaza: rays and rings of paving, a low wall open toward the road.
    const PLAZA = Math.PI;
    const WIDE = 1.75;
    fan(k, 'light', 0, AZ, 1.5, 7.4, PLAZA, WIDE, 0, 0.06);
    for (const r of [3.4, 5.4]) fan(k, 'dark', 0, AZ, r, r + 0.08, PLAZA, WIDE, 0.06, 0.02);
    for (let j = 0; j <= 8; j++) {
      const d = PLAZA - WIDE + (j * 2 * WIDE) / 8;
      k.box('dark', 0.07, 0.02, 5.9, Math.sin(d) * 4.45, 0.06, AZ - Math.cos(d) * 4.45, Math.PI - d);
    }
    for (const side of [-1, 1]) fan(k, 'white', 0, AZ, 7.4, 7.7, PLAZA + side * 1.05, 0.6, 0, 0.55);

    for (const [x, z] of [
      [-11.6, 2.4],
      [-11.2, -3],
      [11.4, 5.8],
      [5.6, 11.6],
    ]) {
      k.cyl('trunk', 0.14, 0.18, 1.1, x, 0, z, 5);
      k.ball('tree', 1.3, x, 2.2, z, 0);
    }
    const group = k.build();

    const lamp = part((l) => l.ball('accent', 0.2, 0, 0, 0));
    lamp.position.set(TX - 1.2, 20.6, TZ + 1.2);
    group.add(lamp);
    const mini = makeDrone();
    mini.group.scale.setScalar(0.6);
    mini.group.rotation.order = 'YXZ';
    group.add(mini.group);
    return {
      group,
      h: 21,
      update: (t) => {
        lamp.visible = t % 1.4 < 0.7;
        mini.group.position.set(3.4, 2.6 + Math.sin(t * 1.9) * 0.12, 9);
        // Tilts, then settles, the way a tuned attitude controller does.
        const kick = (t % 4) / 4;
        mini.group.rotation.z = Math.exp(-kick * 6) * Math.cos(kick * 22) * 0.5;
        mini.group.rotation.y = t * 0.3;
        mini.rotors.forEach((rotor, i) => (rotor.rotation.y = t * (i % 2 ? 31 : -31)));
      },
      solid: [
        [TX, TZ, 3.9, 19.3],
        [-8.1, TZ, 1.3, 16.2],
        [-6.5, -7.2, 2.6, 6.5],
        [-1.5, -7.2, 2.6, 6.5],
        [3.5, -7.2, 2.6, 6.5],
        [8, -7.2, 2.6, 6.5],
        [0, -0.4, 5.6, 4.7],
        [-4.6, -1.8, 2.6, 4.7],
        [4.6, -1.8, 2.6, 4.7],
        [0, AZ, 1.6, 3.7],
        [9.1, -2.6, 2.4, 5.2],
        [9.1, 0.8, 2.4, 3.5],
      ],
    };
  },

  // Publication: a page of the paper, standing.
  paper: () => {
    const k = new Kit();
    k.box('dark', 3.8, 0.9, 2.2, 0, 0, 0);
    k.box('accent', 3.8, 0.08, 0.08, 0, 0.82, 1.12);
    const group = k.build();
    const sheet = part((s) => {
      s.box('white', 4.2, 5.6, 0.22, 0, 0, 0);
      s.box('accent', 2.6, 0.32, 0.06, -0.5, 4.6, 0.12);
      for (let i = 0; i < 7; i++) {
        const short = i % 3 === 2;
        s.box('structure', short ? 2.2 : 3.4, 0.14, 0.06, short ? -0.6 : 0, 3.95 - i * 0.4, 0.12);
      }
      [0.6, 1.0, 0.8, 1.3].forEach((h, j) => s.box('accent', 0.34, h, 0.06, -1.5 + j * 0.5, 0.4, 0.12));
      s.box('structure', 1.3, 0.14, 0.06, 1.05, 1.3, 0.12);
      s.box('structure', 1.3, 0.14, 0.06, 1.05, 0.9, 0.12);
      s.box('structure', 0.9, 0.14, 0.06, 0.85, 0.5, 0.12);
    });
    sheet.position.y = 0.9;
    sheet.rotation.x = -0.12;
    group.add(sheet);
    return { group, h: 6.8, solid: [[0, -0.3, 2.6, 6.4]] };
  },

  // Bosch Future Mobility Challenge: a scale car that drives its circuit alone.
  circuit: () => {
    const k = new Kit();
    k.ring('asphalt', 6.6, 9.8, 0, 0.06, 0, 64);
    k.ring('white', 6.6, 6.76, 0, 0.08, 0, 64);
    k.ring('white', 9.64, 9.8, 0, 0.08, 0, 64);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      if (Math.abs(Math.sin(a)) > 0.94 && Math.sin(a) > 0) continue;
      k.box('white', 0.9, 0.03, 0.14, Math.cos(a) * 8.2, 0.08, Math.sin(a) * 8.2, -a - HALF);
    }
    for (let i = -2; i <= 2; i++) k.box('white', 0.36, 0.03, 2.7, i * 0.72, 0.08, 8.2);
    k.cyl('light', 0.06, 0.06, 2.4, 2.6, 0, 10.8, 6);
    k.rod('signal', 0.62, 0.1, 2.6, 2.7, 10.8, 'z', 8);
    k.cyl('light', 0.06, 0.06, 2.4, -10.7, 0, -1.5, 6);
    k.put('accent', new THREE.BoxGeometry(0.9, 0.9, 0.1), -10.7, 2.7, -1.5, 0, HALF, Math.PI / 4);
    k.cyl('light', 0.22, 0.26, 1.1, -2.6, 0, 10.9, 8);
    k.ball('light', 0.27, -2.6, 1.36, 10.9);
    k.box('structure', 3, 0.9, 1.8, 0, 0, 0);
    k.box('dark', 1.3, 0.85, 0.08, 0, 0.9, -0.2);
    k.box('window', 1.14, 0.7, 0.04, 0, 0.98, -0.15);
    const group = k.build();
    const car = makeCar();
    group.add(car);
    return {
      group,
      h: 4,
      update: (t) => {
        const a = t * 0.7;
        car.position.set(Math.cos(a) * 8.2, 0.08, Math.sin(a) * 8.2);
        car.rotation.y = -a;
      },
      vehicles: [{ kind: 'car', object: car }],
    };
  },

  // Hackathon 2024: the litter-collecting robot.
  robot: () => {
    const k = new Kit();
    const scatter = rng(24);
    for (let i = 0; i < 9; i++) {
      const a = scatter() * TAU;
      const d = 2.6 + scatter() * 2.4;
      k.box(i % 3 ? 'light' : 'signal', 0.3, 0.2 + scatter() * 0.2, 0.3, Math.cos(a) * d, 0, Math.sin(a) * d, scatter() * 3);
    }
    k.cyl('structure', 0.75, 0.62, 1.4, 3.6, 0, 1.6, 10);
    k.torus('accent', 0.74, 0.07, 3.6, 1, 1.6);
    const group = k.build();
    const body = part((b) => {
      b.box('dark', 1.8, 0.5, 1.6, 0, 0.2, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod('dark', 0.4, 0.26, sx * 1, 0.4, sz * 0.5, 'x', 10);
      b.box('white', 1.5, 1.7, 1.2, 0, 0.7, 0);
      b.box('accent', 0.7, 0.4, 0.05, 0, 1.55, 0.61);
      b.box('structure', 1.1, 0.9, 0.5, 0, 0.8, -0.85);
      b.put('light', new THREE.BoxGeometry(0.18, 0.18, 1.5), 0.86, 1.5, 0.75, 0.55);
      b.box('dark', 0.34, 0.14, 0.3, 0.86, 0.98, 1.38);
    });
    const head = part((h) => {
      h.box('white', 1.2, 0.8, 1, 0, 0, 0);
      for (const sx of [-1, 1]) h.box('accent', 0.22, 0.22, 0.05, sx * 0.28, 0.36, 0.51);
      h.cyl('light', 0.03, 0.03, 0.5, 0, 0.8, 0, 5);
      h.ball('signal', 0.1, 0, 1.35, 0);
    });
    head.position.y = 2.5;
    body.add(head);
    body.scale.setScalar(1.5);
    group.add(body);
    return {
      group,
      h: 5.8,
      update: (t) => {
        head.rotation.y = Math.sin(t * 0.9) * 0.7;
        body.position.y = Math.abs(Math.sin(t * 2.4)) * 0.06;
        body.rotation.y = Math.sin(t * 0.3) * 0.5;
      },
      solid: [[0, 0, 2, 5]],
    };
  },

  // Hackathon 2023: an event with a crowd kept moving in two lanes.
  tent: () => {
    const k = new Kit();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl('light', 0.1, 0.1, 3, sx * 2.6, 0, -2.6 + sz * 2.6, 6);
    k.put('white', new THREE.ConeGeometry(4.3, 2.2, 4), 0, 4.1, -2.6, 0, Math.PI / 4, 0);
    k.box('dark', 4.4, 0.5, 3, 0, 0, -3);
    k.box('dark', 3.2, 1.9, 0.15, 0, 0.9, -4.6);
    k.box('window', 2.8, 1.5, 0.05, 0, 1.1, -4.5);
    k.box('accent', 1.2, 0.16, 0.04, -0.6, 2.2, -4.46);
    k.box('accent', 0.08, 0.6, 6.4, 0, 0, 4.3);
    for (const z of [1.2, 4.3, 7.4]) k.cyl('light', 0.09, 0.09, 0.9, 0, 0, z, 6);
    const group = k.build();
    const person = part((p) => {
      p.cyl('light', 0.24, 0.3, 1.1, 0, 0, 0, 8);
      p.ball('light', 0.27, 0, 1.36, 0);
    });
    const figure = person.children[0] as THREE.Mesh;
    const crowd = Array.from({ length: 12 }, () => {
      const one = new THREE.Mesh(figure.geometry, figure.material);
      group.add(one);
      return one;
    });
    return {
      group,
      h: 5.6,
      update: (t) =>
        crowd.forEach((one, i) => {
          const lane = i % 2 ? 1 : -1;
          const f = (t * 0.11 + i / crowd.length) % 1;
          one.position.set(lane * (1 + (i % 3) * 0.55), 0, lane > 0 ? 7.6 - f * 6.4 : 1.2 + f * 6.4);
        }),
    };
  },

  // MSc thesis: a hangar, the hardware-in-the-loop bench and a drone that takes injected faults.
  hangar: () => {
    const k = new Kit();
    k.put('structure', new THREE.CylinderGeometry(4.6, 4.6, 9, 16, 1, false, 0, Math.PI), -4.6, 0, -3, 0, HALF, HALF);
    k.box('dark', 5.8, 3.4, 0.1, -4.6, 0, 1.56);
    k.box('accent', 5.8, 0.1, 0.12, -4.6, 3.4, 1.58);
    k.cyl('dark', 3.4, 3.5, 0.2, 4.6, 0, 2.4, 30);
    k.ring('accent', 2.6, 2.78, 4.6, 0.22, 2.4, 44);
    k.box('light', 2.8, 0.9, 1.1, 4.6, 0, -4.6);
    k.box('dark', 1.5, 1, 0.1, 4.2, 0.95, -4.9);
    k.box('window', 1.36, 0.86, 0.04, 4.2, 1.02, -4.84);
    k.box('dark', 0.5, 0.2, 0.4, 5.5, 0.9, -4.5);
    k.box('accent', 0.14, 0.05, 0.14, 5.5, 1.1, -4.5);
    k.cyl('light', 0.07, 0.09, 6, 9.6, 0, -3.4, 6);
    k.put('signal', new THREE.ConeGeometry(0.45, 1.8, 8), 10.5, 5.7, -3.4, 0, 0, -HALF);
    const group = k.build();
    const test = makeDrone();
    test.group.rotation.order = 'YXZ';
    group.add(test.group);
    const alarm = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), tint('signal', 1));
    alarm.position.y = 0.35;
    test.group.add(alarm);
    return {
      group,
      h: 7.6,
      update: (t) => {
        // Every six seconds a fault is injected: the drone shakes, then the diagnosis clears it.
        const phase = t % 6;
        const fault = phase > 3.6 && phase < 5.2;
        const shake = fault ? 1 : 0;
        test.group.position.set(4.6 + shake * Math.sin(t * 9) * 0.25, 3.3 + Math.sin(t * 1.6) * 0.15 - shake * 0.4, 2.4);
        test.group.rotation.x = shake * Math.sin(t * 13) * 0.3;
        test.group.rotation.z = shake * Math.cos(t * 11) * 0.35;
        test.group.rotation.y = t * 0.25;
        alarm.visible = fault && t % 0.3 < 0.15;
        test.rotors.forEach((rotor, i) => (rotor.rotation.y = t * (i % 2 ? 33 : -33) * (fault && i === 0 ? 0.3 : 1)));
      },
      solid: [[-4.6, -3, 5.8, 5.4]],
    };
  },

  // Super-resolution: the same picture at the detector's resolution and at twice that.
  pixelwall: () => {
    const k = new Kit();
    // A crude handgun outline: the object the detector has to find when it covers a few pixels.
    const inside = (u: number, v: number) => (u > 0.18 && u < 0.84 && v > 0.56 && v < 0.78) || (u > 0.56 && u < 0.76 && v > 0.24 && v < 0.6);
    const board = (cx: number, n: number) => {
      const cell = 4 / n;
      k.box('dark', 4.5, 4.5, 0.2, cx, 1.75, -0.3);
      for (const x of [-1.6, 1.6]) k.cyl('light', 0.1, 0.12, 1.8, cx + x, 0, -0.3, 6);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          let cover = 0;
          for (const du of [0.25, 0.75]) for (const dv of [0.25, 0.75]) cover += inside((i + du) / n, (j + dv) / n) ? 0.25 : 0;
          const key = cover > 0.6 ? 'white' : cover > 0.2 ? 'light' : (i + j) % 2 ? 'structure' : 'dark';
          k.box(key, cell * 0.9, cell * 0.9, 0.2 + cover * 0.3, cx + (i - (n - 1) / 2) * cell, 2 + j * cell + cell * 0.05, -0.1);
        }
      }
    };
    board(-3.5, 4);
    board(3.5, 8);
    // The detection only lands on the sharper picture.
    k.box('accent', 3.1, 0.1, 0.1, 3.52, 4.42, 0.35);
    k.box('accent', 3.1, 0.1, 0.1, 3.52, 2.72, 0.35);
    k.box('accent', 0.1, 1.8, 0.1, 2.02, 2.72, 0.35);
    k.box('accent', 0.1, 1.8, 0.1, 5.02, 2.72, 0.35);
    for (const dx of [-0.35, 0.25]) {
      k.put('accent', new THREE.BoxGeometry(0.8, 0.16, 0.12), dx, 4.28, 0, 0, 0, -0.7);
      k.put('accent', new THREE.BoxGeometry(0.8, 0.16, 0.12), dx, 3.78, 0, 0, 0, 0.7);
    }
    k.cyl('light', 0.09, 0.12, 4.4, 0, 0, 6, 6);
    const group = k.build();
    const head = cameraHead();
    head.position.set(0, 4.76, 6);
    head.rotation.x = 0.2;
    group.add(head);
    return { group, h: 6.8, update: (t) => (head.rotation.y = Math.PI + Math.sin(t * 0.6) * 0.5) };
  },

  // GeoPosBall: the logger buoys at sea, with the support boat.
  buoys: () => {
    const group = new THREE.Group();
    const spots = [
      [-3, 1.6],
      [0.6, -2.6],
      [3.4, 2.2],
    ];
    const floats = spots.map(([x, z]) => {
      const buoy = part((b) => {
        b.ball('signal', 0.85, 0, 0.2, 0);
        b.torus('white', 0.86, 0.1, 0, 0.28, 0);
        b.cyl('light', 0.05, 0.05, 1.7, 0, 0.9, 0, 5);
        b.ball('accent', 0.15, 0, 2.7, 0);
      });
      buoy.position.set(x, 0, z);
      const ripple = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 40), tint('accent', 0.6));
      ripple.rotation.x = -HALF;
      ripple.position.set(x, 0.06, z);
      group.add(buoy, ripple);
      return { buoy, ripple };
    });
    const boat = makeBoat();
    boat.position.set(-6.2, 0, -3.2);
    boat.rotation.order = 'YXZ';
    group.add(boat);
    return {
      group,
      h: 4.2,
      update: (t) => {
        floats.forEach(({ buoy, ripple }, i) => {
          buoy.position.y = Math.sin(t * 1.3 + i * 2) * 0.16;
          buoy.rotation.x = Math.sin(t * 1.1 + i) * 0.12;
          buoy.rotation.z = Math.cos(t * 0.9 + i * 1.7) * 0.12;
          const f = (t * 0.3 + i / 3) % 1;
          ripple.scale.setScalar(1 + f * 3.6);
          (ripple.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - f);
        });
        boat.position.y = Math.sin(t * 0.9) * 0.1;
        boat.rotation.set(Math.sin(t * 0.8) * 0.04, 0.9, Math.sin(t * 0.6) * 0.06);
      },
      vehicles: [{ kind: 'boat', object: boat }],
    };
  },

  // Volleyball detection: a court, and a box that follows the ball.
  court: () => {
    const k = new Kit();
    k.box('court', 18, 0.12, 10, 0, 0, 0);
    for (const sz of [-1, 1]) {
      k.box('white', 16, 0.03, 0.12, 0, 0.12, sz * 4);
      k.cyl('light', 0.1, 0.1, 2.7, 0, 0, sz * 4.5, 6);
    }
    for (const x of [-8, -2.7, 0, 2.7, 8]) k.box('white', 0.12, 0.03, 8, x, 0.12, 0);
    k.box('white', 0.1, 0.1, 9, 0, 2.5, 0);
    k.box('white', 0.1, 0.1, 9, 0, 1.5, 0);
    for (let i = 0; i <= 12; i++) k.box('white', 0.05, 1, 0.05, 0, 1.5, -4.5 + i * 0.75);
    k.box('dark', 0.8, 2.3, 0.8, 0, 0, -5.4);
    k.box('light', 1, 0.12, 1, 0, 2.3, -5.4);
    [
      [-5.2, -2.2],
      [-3.4, 1.9],
      [-6.6, 1.4],
      [5.4, 2.1],
      [3.3, -1.8],
      [6.7, -1.2],
    ].forEach(([x, z]) => {
      const key = x < 0 ? 'light' : 'structure';
      k.cyl(key, 0.3, 0.34, 1.35, x, 0.12, z, 8);
      k.ball(key, 0.3, x, 1.78, z);
    });
    const group = k.build();
    const ball = part((b) => b.ball('white', 0.34, 0, 0, 0));
    const box = part((b) => {
      for (const s of [-1, 1]) {
        b.box('accent', 1.3, 0.07, 0.07, 0, s * 0.62 - 0.035, 0);
        b.box('accent', 0.07, 1.3, 0.07, s * 0.62, -0.65, 0);
      }
    });
    group.add(ball, box);
    return {
      group,
      h: 5.4,
      update: (t) => {
        const u = (t / 1.3) % 2;
        const f = u < 1 ? u : 2 - u;
        const p = u % 1;
        ball.position.set(-4.6 + 9.2 * f, 1.7 + 13.6 * p * (1 - p), Math.sin(t * 0.7) * 2.2);
        ball.rotation.x = t * 5;
        box.position.copy(ball.position);
      },
    };
  },

  // Autonomous e-bike: it rides its loop without a rider.
  biketrack: () => {
    const k = new Kit();
    k.ring('asphalt', 4.5, 6.9, 0, 0.06, 0, 56);
    k.ring('white', 5.64, 5.76, 0, 0.08, 0, 56);
    k.box('light', 2.2, 0.9, 1, 0, 0, 0);
    k.box('dark', 0.9, 0.1, 0.6, -0.3, 0.9, 0);
    k.box('accent', 0.2, 0.05, 0.2, -0.3, 1, 0);
    for (let i = 0; i < 4; i++) k.cone('signal', 0.25, 0.6, Math.cos(i * HALF + 0.7) * 3.8, 0, Math.sin(i * HALF + 0.7) * 3.8, 8);
    const group = k.build();
    const bike = makeBike();
    bike.rotation.order = 'YXZ';
    group.add(bike);
    return {
      group,
      h: 3.6,
      update: (t) => {
        const a = t * 0.75;
        bike.position.set(Math.cos(a) * 5.7, 0.08, Math.sin(a) * 5.7);
        bike.rotation.set(0, -a, 0.2);
      },
      vehicles: [{ kind: 'bike', object: bike }],
    };
  },

  // Skills: one mast per group of tools, with a tile for each tool winding up it.
  pylons: (def) => {
    const k = new Kit();
    const groups = def.icons?.length ? def.icons : def.extra.map((n) => Array.from({ length: n }, () => null));
    const gap = Math.min(5.6, 17 / Math.max(groups.length - 1, 1));
    const STEP = 1.4;
    const masts = groups.map((tools, i) => {
      const x = (i - (groups.length - 1) / 2) * gap;
      const top = 2.4 + tools.length * STEP;
      k.cyl('dark', 0.85, 1, 0.4, x, 0, 0, 8);
      k.cyl('light', 0.1, 0.22, top, x, 0.4, 0, 6);
      k.ball('accent', 0.24, x, top + 0.55, 0);
      return { x, top, tools };
    });
    k.box('structure', 3, 0.9, 1, 0, 0, 4.6);
    k.put('window', new THREE.BoxGeometry(2.6, 0.06, 0.8), 0, 1.05, 4.6, 0.35);
    const group = k.build();

    const tile = new THREE.PlaneGeometry(1.35, 1.35);
    const back = new THREE.BoxGeometry(1.44, 1.44, 0.06);
    const spinners = masts.map(({ x, tools }) => {
      const spinner = new THREE.Group();
      spinner.position.x = x;
      tools.forEach((tool, j) => {
        const holder = new THREE.Group();
        holder.rotation.y = j * 2.2;
        holder.position.y = 1.4 + j * STEP;
        const face = tool
          ? new THREE.Mesh(tile, new THREE.MeshBasicMaterial({ map: toolTexture(tool), transparent: true }))
          : new THREE.Mesh(tile, mat('accent'));
        face.position.z = 0.86;
        const plate = new THREE.Mesh(back, mat('dark'));
        plate.position.z = 0.81;
        holder.add(plate, face);
        spinner.add(holder);
      });
      group.add(spinner);
      return spinner;
    });
    const scans = masts.map(({ x }) => {
      const scan = part((sc) => sc.torus('accent', 1.15, 0.05, 0, 0, 0));
      scan.position.x = x;
      group.add(scan);
      return scan;
    });
    return {
      group,
      h: Math.max(...masts.map((m) => m.top)) + 1.2,
      update: (t) => {
        spinners.forEach((spinner, i) => (spinner.rotation.y = t * 0.25 * (i % 2 ? 1 : -1)));
        scans.forEach((scan, i) => (scan.position.y = 1.3 + (0.5 + 0.5 * Math.sin(t * 0.8 + i * 1.4)) * (masts[i].top - 1.3)));
      },
      solid: masts.map(({ x, top }) => [x, 0, 1.3, top + 0.8] as [number, number, number, number]),
    };
  },

  // Data science hall: a temple with an open colonnade at both ends, the avenue running through
  // its aisle, and the course projects on plinths inside (they are places of their own).
  museum: () => {
    const k = new Kit();
    const HW = 9;
    const HL = 15;
    const CEIL = 7;
    k.box('light', HW * 2 + 1, 0.04, HL * 2 + 1, 0, 0, 0);
    k.box('asphalt', 3.3, 0.02, HL * 2 + 1, 0, 0.04, 0);
    for (const sx of [-1, 1]) k.box('accent', 0.12, 0.02, HL * 2 - 2, sx * 2.3, 0.04, 0);

    const columns: [number, number][] = [];
    for (let z = -13.5; z <= 13.5; z += 3) for (const sx of [-1, 1]) columns.push([sx * 8.4, z]);
    for (const x of [-8.4, -5.6, 5.6, 8.4]) for (const sz of [-1, 1]) columns.push([x, sz * 14.4]);
    for (const [x, z] of columns) {
      k.box('white', 1.1, 0.3, 1.1, x, 0.04, z);
      k.cyl('white', 0.36, 0.44, CEIL - 0.6, x, 0.34, z, 10);
      k.box('white', 1.1, 0.3, 1.1, x, CEIL - 0.3, z);
    }
    // Inner walls with screens facing the aisle.
    for (const sx of [-1, 1]) {
      k.box('light', 0.5, CEIL, 22, sx * 6.6, 0, 0);
      // Screens with a small bar chart, facing the aisle.
      for (const z of [-6.5, 0, 6.5]) {
        k.box('dark', 0.1, 2.2, 3.4, sx * 6.3, 2.2, z);
        [0.5, 0.9, 0.7, 1.4, 1.1].forEach((h, j) => k.box('accent', 0.04, h, 0.42, sx * 6.24, 2.5, z - 1.1 + j * 0.55));
      }
      k.box('accent', 0.25, 0.06, 26, sx * 3, CEIL - 0.04, 0);
    }
    k.box('white', HW * 2 + 1, 1.1, HL * 2 + 1.4, 0, CEIL, 0);
    k.box('accent', HW * 2 + 1.04, 0.14, HL * 2 + 1.44, 0, CEIL + 0.5, 0);
    const roof = new THREE.CylinderGeometry(1, 1, 1, 3).rotateX(-HALF);
    k.put('structure', roof, 0, CEIL + 1.1 + 1.6, 0, 0, 0, 0, (HW * 2 + 1.6) / 1.732, 3.2 / 1.5, HL * 2 + 1.8);
    const group = k.build();

    let accentHex = 0xc3f25e;
    const words = lettering('DATA SCIENCE', () => '#' + accentHex.toString(16).padStart(6, '0'));
    onPalette((p) => {
      accentHex = p.accent;
      words.redraw();
    });
    const sign = new THREE.MeshBasicMaterial({ map: words.map, transparent: true, depthWrite: false });
    for (const end of [1, -1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), sign);
      plane.position.set(0, CEIL + 2.05, end * (HL + 0.95));
      plane.rotation.y = end > 0 ? 0 : Math.PI;
      group.add(plane);
    }

    const solid: [number, number, number, number][] = columns.map(([x, z]) => [x, z, 0.6, CEIL + 4.3]);
    for (const sx of [-1, 1]) for (let z = -11; z <= 11; z += 1.2) solid.push([sx * 6.6, z, 0.65, CEIL + 4.3]);
    return {
      group,
      h: CEIL + 4.3,
      solid,
      roofs: [[0, 0, HW + 0.8, HL + 0.9, CEIL, CEIL + 4.3]],
    };
  },

  // Contact: the lighthouse at the southern tip.
  lighthouse: () => {
    const k = new Kit();
    k.cyl('rock', 4.2, 5, 1.2, 0, 0, 0, 9);
    k.cyl('white', 1.5, 2.3, 13, 0, 1.2, 0, 14);
    k.cyl('structure', 2.09, 2.19, 1.6, 0, 3.4, 0, 14);
    k.cyl('structure', 1.765, 1.865, 1.6, 0, 8.7, 0, 14);
    k.box('dark', 0.9, 1.9, 0.2, 0, 1.2, 2.2);
    k.cyl('dark', 2.3, 2.3, 0.25, 0, 14.2, 0, 14);
    k.cyl('accent', 1.05, 1.05, 1.7, 0, 14.45, 0, 10);
    k.cone('dark', 1.5, 1.4, 0, 16.15, 0, 10);
    k.ball('accent', 0.16, 0, 17.65, 0);
    k.box('structure', 3, 2.2, 2.4, -5.6, 0, 1.6);
    k.box('dark', 3.3, 0.2, 2.7, -5.6, 2.2, 1.6);
    k.box('window', 0.9, 0.8, 0.06, -5.6, 1, 2.82);
    k.cyl('light', 0.06, 0.06, 1.1, 4.9, 0, 3.4, 6);
    k.box('accent', 0.5, 0.4, 0.8, 4.9, 1.1, 3.4);
    k.box('signal', 0.06, 0.36, 0.26, 5.19, 1.5, 3.5);
    const group = k.build();
    const lamp = new THREE.Group();
    const light = tint('accent', 0.2, true);
    for (const side of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(2.6, 30, 18, 1, true), light);
      beam.rotation.x = side * HALF;
      beam.position.z = -side * 15;
      lamp.add(beam);
    }
    lamp.position.y = 15.3;
    group.add(lamp);
    return { group, h: 18.4, update: (t) => (lamp.rotation.y = t * 0.5), solid: [[0, 0, 3, 17.6]] };
  },

  // Fallback for a job or degree the table in stations.ts does not know.
  block: () => {
    const k = new Kit();
    k.box('structure', 9, 6.4, 6.4, 0, 0, -1);
    k.box('dark', 9.4, 0.3, 6.8, 0, 6.4, -1);
    for (const y of [1.4, 3.5]) k.box('window', 7.4, 1, 0.08, 0, y, 2.24);
    k.box('accent', 2.4, 0.1, 0.1, 0, 5.4, 2.26);
    return { group: k.build(), h: 7, solid: [[0, -1, 5.8, 6.8]] };
  },
};

/** The small objects shown on plinths along the avenue, one per side project. */
const EXHIBITS: Record<string, (k: Kit) => void> = {
  chip: (k) => {
    k.box('dark', 2, 0.3, 2, 0, -0.15, 0);
    k.box('accent', 0.8, 0.06, 0.8, 0, 0.15, 0);
    for (let i = -3; i <= 3; i++) {
      for (const s of [-1, 1]) {
        k.box('light', 0.12, 0.1, 0.34, i * 0.26, -0.1, s * 1.12);
        k.box('light', 0.34, 0.1, 0.12, s * 1.12, -0.1, i * 0.26);
      }
    }
  },
  clusters: (k) => {
    const random = rng(7);
    const centres: [number, number, number, 'accent' | 'signal' | 'white'][] = [
      [-0.8, 0.3, 0, 'accent'],
      [0.75, 0.6, 0.3, 'signal'],
      [0, -0.6, -0.6, 'white'],
    ];
    for (const [x, y, z, key] of centres) {
      for (let i = 0; i < 7; i++) k.ball(key, 0.15, x + (random() - 0.5) * 0.9, y + (random() - 0.5) * 0.9, z + (random() - 0.5) * 0.9, 0);
    }
  },
  chart: (k) => {
    k.box('dark', 3.3, 2.3, 0.12, 0, -1.15, 0);
    k.box('structure', 1.1, 1.5, 0.04, 0.95, -0.75, 0.08);
    const y = (i: number) => Math.sin(i * 1.1) * 0.42 + i * 0.05 - 0.15;
    for (let i = 0; i < 7; i++) {
      const x0 = -1.35 + i * 0.39;
      const dy = y(i + 1) - y(i);
      k.put(i < 5 ? 'accent' : 'signal', new THREE.BoxGeometry(Math.hypot(0.39, dy) + 0.06, 0.08, 0.06), x0 + 0.195, (y(i) + y(i + 1)) / 2, 0.12, 0, 0, Math.atan2(dy, 0.39));
    }
  },
  chat: (k) => {
    k.box('white', 2.6, 1.5, 0.4, 0, -0.3, 0);
    k.put('white', new THREE.ConeGeometry(0.36, 0.7, 4), -0.7, -0.55, 0, 0, 0, Math.PI);
    for (const x of [-0.6, 0, 0.6]) k.ball('dark', 0.16, x, 0.45, 0.22, 0);
    k.box('structure', 1.2, 0.5, 0.3, 0.8, -1.5, 0);
    k.box('accent', 0.16, 0.16, 0.06, 1.1, -1.3, 0.16);
    k.box('accent', 0.3, 0.08, 0.06, 0.5, -1.26, 0.16);
  },
  graph: (k) => {
    const nodes = [
      [0, 0, 0],
      [1.1, 0.5, 0.2],
      [-1, 0.7, -0.3],
      [0.4, -0.9, 0.7],
      [-0.7, -0.7, -0.6],
      [0.2, 1.1, -0.7],
      [-0.3, 0.2, 1.1],
    ];
    nodes.forEach(([x, y, z], i) => k.ball(i === 0 ? 'accent' : 'light', i === 0 ? 0.3 : 0.17, x, y, z));
    for (const [a, b] of [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [1, 5], [2, 4], [3, 6]]) {
      k.link('structure', 0.035, nodes[a][0], nodes[a][1], nodes[a][2], nodes[b][0], nodes[b][1], nodes[b][2]);
    }
  },
  box: (k) => {
    k.box('light', 1.4, 1.4, 1.4, 0, -0.7, 0);
    k.box('accent', 1.5, 0.1, 1.5, 0, -0.05, 0);
  },
};

function exhibit(kind: string): Built {
  const k = new Kit();
  k.cyl('dark', 1.5, 1.7, 0.7, 0, 0, 0, 16);
  k.cyl('light', 1.55, 1.55, 0.1, 0, 0.7, 0, 16);
  k.ring('accent', 1.2, 1.32, 0, 0.82, 0, 32);
  const group = k.build();
  const object = part(EXHIBITS[kind] ?? EXHIBITS.box);
  object.rotation.order = 'XYZ';
  object.rotation.x = kind === 'chip' ? 0.5 : 0;
  group.add(object);
  return {
    group,
    h: 4.6,
    update: (t) => {
      object.position.y = 2.6 + Math.sin(t * 1.1) * 0.12;
      object.rotation.y = kind === 'chart' || kind === 'chat' ? Math.sin(t * 0.5) * 0.6 : t * 0.4;
    },
    solid: [[0, 0, 1.9, 3.8]],
  };
}

export function buildStation(def: StationDef): Built {
  const [name, kind] = def.model.split(':');
  const built = name === 'exhibit' ? exhibit(kind) : (BUILDERS[name] ?? BUILDERS.block)(def);
  if (def.sign) addSign(built, def);
  return built;
}

/** The board in front of a place, at its front left, turned a little toward the road. */
function addSign(built: Built, def: StationDef) {
  const reach = def.r / def.scale - 1.6;
  const angle = 0.7;
  const x = -Math.sin(angle) * reach;
  const z = Math.cos(angle) * reach;
  const board = part((k) => {
    for (const sx of [-2.1, 2.1]) k.box('dark', 0.18, 1.7, 0.18, sx, 0, -0.08);
    k.box('dark', 5.3, 2.75, 0.14, 0, 1.55, -0.12);
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.5), new THREE.MeshBasicMaterial({ map: signTexture(def.sign!) }));
  face.position.set(0, 2.92, 0);
  board.add(face);
  board.position.set(x, 0, z);
  board.rotation.y = -angle * 0.45;
  built.group.add(board);
  built.solid = [...(built.solid ?? []), [x, z, 1.6, 4.4]];
}

// ---------- Year gates ----------

export function makeGate(): THREE.Group {
  const k = new Kit();
  for (const s of [-1, 1]) {
    k.cyl('light', 0.14, 0.18, 6.4, s * 4.4, 0, 0, 6);
    k.box('accent', 9.4, 0.08, 0.08, 0, 6.02, s * 0.27);
  }
  k.box('dark', 9.6, 0.5, 0.5, 0, 6.1, 0);
  return k.build();
}

// ---------- Scenery ----------

/** Trees and rocks, drawn as instances. `spots` holds x, y, z and a size for each one. */
export function makeScenery(trees: number[][], rocks: number[][]): THREE.Group {
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();

  const crown = part((k) => {
    k.cone('tree', 1.05, 2.5, 0, 0.7, 0, 6);
    k.cone('tree', 0.72, 1.9, 0, 2.2, 0, 6);
  }).children[0] as THREE.Mesh;
  const trunk = part((k) => k.cyl('trunk', 0.13, 0.17, 0.8, 0, 0, 0, 5)).children[0] as THREE.Mesh;
  const stone = part((k) => k.ball('rock', 1, 0, 0.3, 0, 0)).children[0] as THREE.Mesh;

  const fill = (source: THREE.Mesh, spots: number[][], squash = 1) => {
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, spots.length);
    spots.forEach(([x, y, z, size], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, (x * 12.9898 + z * 78.233) % TAU, 0);
      dummy.scale.set(size, size * squash, size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  };

  fill(crown, trees);
  fill(trunk, trees);
  fill(stone, rocks, 0.6);
  return group;
}

/** Marker above a place that has not been logged yet. */
export function makeBeacon(): { diamond: THREE.Mesh; beam: THREE.Mesh } {
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.75), mat('accent'));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1, 6, 1, true), beamMaterial());
  return { diamond, beam };
}

let sharedBeam: THREE.MeshBasicMaterial | undefined;
const beamMaterial = () => (sharedBeam ??= tint('accent', 0.3, true));
