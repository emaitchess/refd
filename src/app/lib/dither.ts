// Warp-dither engine backing the masked DitherBanner.

// 2×2 ordered dither — a finer, more regular halftone than 4×4 (matches the
// paper.design "2x2" warp reference).
const BAYER = [
  [0, 2],
  [3, 1],
];

const SCALE = 1 / 170; // feature size in px — smaller divisor = bigger swirls
const WARP = 3.6; // domain-warp amplitude — higher = more liquid, turbulent flow

const hash = (ix: number, iy: number): number => {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const smooth = (f: number): number => f * f * (3 - 2 * f);

const valueNoise = (x: number, y: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};

const fbm = (x: number, y: number): number =>
  0.64 * valueNoise(x, y) + 0.36 * valueNoise(x * 2.13 + 7.7, y * 2.13 + 3.1);

// Double domain-warped fbm (~[0.2, 0.8]): fbm fed through two warp passes (Inigo
// Quilez "warp") for a fluid marble flow.
const warpRaw = (x: number, y: number, t: number): number => {
  const sx = x * SCALE;
  const sy = y * SCALE;
  const q1x = fbm(sx + t * 0.05, sy - t * 0.02);
  const q1y = fbm(sx + 5.2, sy + 1.3 + t * 0.045);
  const q2x = fbm(sx + WARP * q1x + 1.7, sy + WARP * q1y - t * 0.03);
  const q2y = fbm(sx + WARP * q1x - t * 0.02, sy + WARP * q1y + 9.2);
  return fbm(sx + WARP * q2x - t * 0.015, sy + WARP * q2y + t * 0.01);
};

// Warp density biased toward "filled" (~[0.4, 1]) — for a legible, warp-textured
// fill (the wordmark). The warp still modulates dot density, but no region falls
// into an empty band, so masked text stays readable.
export const warpDensity = (x: number, y: number, t: number): number =>
  0.72 + (warpRaw(x, y, t) - 0.5) * 1.05;

// Paint Bayer-thresholded cells where density(x,y) exceeds the cell's threshold.
export const drawDither = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  alpha: number,
  cell: number,
  density: (x: number, y: number) => number,
): void => {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  const n = BAYER.length;
  const levels = n * n;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  for (let gy = 0; gy < rows; gy += 1) {
    const y = gy * cell;
    const bayerRow = BAYER[gy % n] as number[];
    for (let gx = 0; gx < cols; gx += 1) {
      const x = gx * cell;
      const threshold = ((bayerRow[gx % n] ?? 0) + 0.5) / levels;
      if (density(x, y) > threshold) {
        ctx.fillRect(x, y, cell - 1, cell - 1);
      }
    }
  }
};
