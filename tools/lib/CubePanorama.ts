// A Matterport cube-map panorama (reference/matterport/panoramas_4k/<place>/{a,b,c,d,up}.jpg) sampled by direction.
// Matterport layout (verified on the terrace, street and courtyard panoramas): a, b, c, d are the side faces in turn,
// each 90° further clockwise seen from above (a → b turns right); `up` lies with its bottom edge against a and its
// right edge against b. The bottom face is not stored: nothing below the facades is ever sampled.
import sharp from "sharp";

export type Vec3 = [x: number, y: number, z: number];
type Rgb = [number, number, number];

const SIDES = ["a", "b", "c", "d"] as const;
const CHANNELS = 3;
const QUARTER_TURN_RAD = Math.PI / 2;

interface Face {
  data: Buffer;
  forward: Vec3;
  right: Vec3;
  /** Image "down" direction on the face plane (for a side face this is −world up). */
  down: Vec3;
}

const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

export class CubePanorama {
  private constructor(
    private readonly faces: Face[],
    readonly size: number,
  ) {}

  /** Loads the four side faces and the up face of `dir`. */
  static async load(dir: string): Promise<CubePanorama> {
    const read = async (name: string) => sharp(`${dir}/${name}.jpg`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const sides = await Promise.all(SIDES.map(read));
    const up = await read("up");
    const size = up.info.width;
    const faces: Face[] = sides.map((side, k) => {
      // Side k looks at azimuth k·90° (clockwise from above, +z = side a, +x = side b).
      const angle = k * QUARTER_TURN_RAD;
      const forward: Vec3 = [Math.sin(angle), 0, Math.cos(angle)];
      const right: Vec3 = [Math.cos(angle), 0, -Math.sin(angle)];
      return { data: side.data, forward, right, down: [0, -1, 0] };
    });
    // Up face: image down points towards side a, image right towards side b.
    faces.push({ data: up.data, forward: [0, 1, 0], right: faces[0]!.right, down: faces[0]!.forward });
    return new CubePanorama(faces, size);
  }

  /** Bilinear colour (bytes 0..255) of the panorama in direction `d` (any length). */
  sample(d: Vec3): Rgb {
    let best = this.faces[0]!;
    let bestDot = -Infinity;
    for (const face of this.faces) {
      const v = dot(d, face.forward);
      if (v > bestDot) {
        bestDot = v;
        best = face;
      }
    }
    const s = dot(d, best.right) / bestDot;
    const t = dot(d, best.down) / bestDot;
    return this.bilinear(best.data, ((s + 1) / 2) * this.size - 0.5, ((t + 1) / 2) * this.size - 0.5);
  }

  /** Direction of plane point (s, t) on the plane one unit in front of side face `face` (t up, s right). */
  static planeDirection(face: (typeof SIDES)[number], s: number, t: number): Vec3 {
    const angle = SIDES.indexOf(face) * QUARTER_TURN_RAD;
    return [Math.sin(angle) + s * Math.cos(angle), t, Math.cos(angle) - s * Math.sin(angle)];
  }

  private bilinear(data: Buffer, x: number, y: number): Rgb {
    const n = this.size;
    const x0 = Math.max(0, Math.min(n - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(n - 1, Math.floor(y)));
    const x1 = Math.min(n - 1, x0 + 1);
    const y1 = Math.min(n - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, x - x0));
    const ty = Math.max(0, Math.min(1, y - y0));
    const out: Rgb = [0, 0, 0];
    for (let c = 0; c < CHANNELS; c++) {
      const p00 = data[(y0 * n + x0) * CHANNELS + c]!;
      const p10 = data[(y0 * n + x1) * CHANNELS + c]!;
      const p01 = data[(y1 * n + x0) * CHANNELS + c]!;
      const p11 = data[(y1 * n + x1) * CHANNELS + c]!;
      out[c] = (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty;
    }
    return out;
  }
}
