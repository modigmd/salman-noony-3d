export const CHEEK_CENTERS = [
  [-0.170, 1.310, 0.290],
  [0.185, 1.310, 0.290]
];

const RADII = [0.120, 0.095, 0.115];
const GRADIENT_EPSILON = 0.0001;
const STEP = 1 / 120;
const MAX_STEPS = 8;
const FREQUENCY = 2 * Math.PI * 3.5;
const DAMPING = 2 * 0.28 * FREQUENCY;
const SMOOTHING = 1 - Math.exp(-STEP / 0.035);
const DRIVE_GAIN = 0.8;
const MAX_SPEED = 2;
const MAX_ACCELERATION = 20;
const MAX_DISPLACEMENT = 0.020;

function smoothstep(lower, upper, value) {
  const t = Math.max(0, Math.min(1, (value - lower) / (upper - lower)));
  return t * t * (3 - 2 * t);
}

export function cheekWeight(point, center) {
  const [x, y, z] = point;
  let q = 0;
  for (let axis = 0; axis < 3; axis++) {
    q += ((point[axis] - center[axis]) / RADII[axis]) ** 2;
  }
  return Math.max(0, 1 - q) ** 2
    * smoothstep(0.105, 0.135, Math.abs(x - 0.010))
    * smoothstep(1.240, 1.265, y)
    * (1 - smoothstep(1.375, 1.405, y))
    * smoothstep(0.170, 0.210, z);
}

export function cheekGradient(point, center) {
  const gradient = [];
  for (let axis = 0; axis < 3; axis++) {
    const before = point.slice();
    const after = point.slice();
    before[axis] -= GRADIENT_EPSILON;
    after[axis] += GRADIENT_EPSILON;
    gradient.push((cheekWeight(after, center) - cheekWeight(before, center))
      / (2 * GRADIENT_EPSILON));
  }
  return gradient;
}

export class CheekSpring {
  constructor() {
    this.position = [0, 0, 0];
    this.velocity = [0, 0, 0];
    this.smoothedVelocity = [0, 0, 0];
    this.accumulator = 0;
  }

  reset() {
    this.position.fill(0);
    this.velocity.fill(0);
    this.smoothedVelocity.fill(0);
    this.accumulator = 0;
  }

  update(elapsedSeconds, motionVelocity) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || elapsedSeconds > 0.25
      || !motionVelocity || motionVelocity.length !== 3 || !motionVelocity.every(Number.isFinite)) {
      this.reset();
      return this.position;
    }

    const speed = Math.hypot(...motionVelocity);
    const inputScale = speed > MAX_SPEED ? MAX_SPEED / speed : 1;
    const input = motionVelocity.map(value => value * inputScale);
    this.accumulator = Math.min(this.accumulator + elapsedSeconds, MAX_STEPS * STEP);

    for (let steps = 0; this.accumulator + 1e-12 >= STEP && steps < MAX_STEPS; steps++) {
      this.accumulator = Math.max(0, this.accumulator - STEP);
      const change = input.map((value, axis) =>
        (value - this.smoothedVelocity[axis]) * SMOOTHING);
      const acceleration = Math.hypot(...change) / STEP;
      const forceScale = acceleration > MAX_ACCELERATION ? MAX_ACCELERATION / acceleration : 1;

      for (let axis = 0; axis < 3; axis++) {
        this.smoothedVelocity[axis] += change[axis];
        this.velocity[axis] -= change[axis] * DRIVE_GAIN * forceScale;
        this.velocity[axis] += (-(FREQUENCY ** 2) * this.position[axis]
          - DAMPING * this.velocity[axis]) * STEP;
        this.position[axis] += this.velocity[axis] * STEP;
      }

      const displacement = Math.hypot(...this.position);
      if (displacement > MAX_DISPLACEMENT) {
        const scale = MAX_DISPLACEMENT / displacement;
        for (let axis = 0; axis < 3; axis++) this.position[axis] *= scale;
        const outwardSpeed = this.velocity.reduce((sum, value, axis) =>
          sum + value * this.position[axis] / MAX_DISPLACEMENT, 0);
        if (outwardSpeed > 0) {
          for (let axis = 0; axis < 3; axis++) {
            this.velocity[axis] -= outwardSpeed * this.position[axis] / MAX_DISPLACEMENT;
          }
        }
      }

      // Stop imperceptible residual motion instead of rendering forever.
      if (speed < 1e-6 && Math.hypot(...this.smoothedVelocity) < 1e-4
        && Math.hypot(...this.position) < 0.00012 && Math.hypot(...this.velocity) < 0.003) {
        this.reset();
        break;
      }
    }
    return this.position;
  }
}
