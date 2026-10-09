const STEP = 1 / 120;
const MAX_STEPS = 8;
const SMOOTHING = 1 - Math.exp(-STEP / 0.025);
const MAX_SPEED = 3;
const MAX_ACCELERATION = 35;

export class JellySpring {
  constructor() {
    this.upper = [0, 0, 0];
    this.lower = [0, 0, 0];
    this.offsets = {upper: this.upper, lower: this.lower};
    this.bands = [
      {position: this.upper, velocity: [0, 0, 0], frequency: 2 * Math.PI * 2.2, damping: 0.24, gain: 1, limit: 0.09},
      {position: this.lower, velocity: [0, 0, 0], frequency: 2 * Math.PI * 3.4, damping: 0.28, gain: 0.7, limit: 0.065}
    ];
    this.smoothedVelocity = [0, 0, 0];
    this.previousInput = [0, 0, 0];
    this.accumulator = 0;
  }

  reset() {
    this.bands.forEach(band => {
      band.position.fill(0);
      band.velocity.fill(0);
    });
    this.smoothedVelocity.fill(0);
    this.previousInput.fill(0);
    this.accumulator = 0;
  }

  update(elapsedSeconds, motionVelocity) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || elapsedSeconds > 0.25
      || !motionVelocity || motionVelocity.length !== 3 || typeof motionVelocity.every !== 'function'
      || !motionVelocity.every(Number.isFinite)) {
      this.reset();
      return this.offsets;
    }

    const speed = Math.hypot(...motionVelocity);
    const inputScale = speed > MAX_SPEED ? MAX_SPEED / speed : 1;
    const input = Array.from(motionVelocity, value => value * inputScale);
    this.accumulator = Math.min(this.accumulator + elapsedSeconds, MAX_STEPS * STEP);

    for (let steps = 0; this.accumulator + 1e-12 >= STEP && steps < MAX_STEPS; steps++) {
      this.accumulator = Math.max(0, this.accumulator - STEP);
      // Body velocity is sampled once per rendered frame; interpolate for each solver step.
      const blend = Math.max(0, Math.min(1, (elapsedSeconds - this.accumulator) / elapsedSeconds));
      const change = input.map((value, axis) =>
        (this.previousInput[axis] + (value - this.previousInput[axis]) * blend
          - this.smoothedVelocity[axis]) * SMOOTHING);
      const acceleration = Math.hypot(...change) / STEP;
      const forceScale = acceleration > MAX_ACCELERATION ? MAX_ACCELERATION / acceleration : 1;
      for (let axis = 0; axis < 3; axis++) this.smoothedVelocity[axis] += change[axis];

      for (const band of this.bands) {
        const stiffness = band.frequency ** 2, damping = 2 * band.damping * band.frequency;
        for (let axis = 0; axis < 3; axis++) {
          // Relative deformation lags acceleration of the already moving body.
          band.velocity[axis] -= change[axis] * band.gain * forceScale;
          band.velocity[axis] += (-stiffness * band.position[axis] - damping * band.velocity[axis]) * STEP;
          band.position[axis] += band.velocity[axis] * STEP;
        }
        const displacement = Math.hypot(...band.position);
        if (displacement > band.limit) {
          for (let axis = 0; axis < 3; axis++) band.position[axis] *= band.limit / displacement;
          const outwardSpeed = band.velocity.reduce((sum, value, axis) =>
            sum + value * band.position[axis] / band.limit, 0);
          if (outwardSpeed > 0) {
            for (let axis = 0; axis < 3; axis++) {
              band.velocity[axis] -= outwardSpeed * band.position[axis] / band.limit;
            }
          }
        }
      }
    }
    this.previousInput.splice(0, 3, ...input);
    if (speed < 1e-6 && Math.hypot(...this.smoothedVelocity) < 1e-4
      && this.bands.every(band => Math.hypot(...band.position) < 0.0002
        && Math.hypot(...band.velocity) < 0.003)) this.reset();
    return this.offsets;
  }
}
