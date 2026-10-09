const STEP = 1 / 120;
const MAX_STEPS = 8;
const FREQUENCY = 2 * Math.PI * 2.8;
const STIFFNESS = FREQUENCY ** 2;
const DAMPING = 2 * 0.3 * FREQUENCY;
const DRIVE_GAIN = 1.5;
const DEADZONE = 0.6;
const MAX_ACCELERATION = 25;
const MAX_DISPLACEMENT = 0.10;
const GRAVITY_TIME = 0.18;
const INPUT_SMOOTHING = 1 - Math.exp(-STEP / 0.025);
const STALE_AFTER = 0.12;
const SENSOR_DELAY = 1 / 30;

const vector = reading => reading
  && [reading.x, reading.y, reading.z].every(Number.isFinite)
  ? [reading.x, reading.y, reading.z] : null;

export class ShakeSpring {
  constructor() {
    this.position = [0, 0, 0];
    this.velocity = [0, 0, 0];
    this.smoothedAcceleration = [0, 0, 0];
    this.reset();
  }

  reset() {
    this.position.fill(0);
    this.velocity.fill(0);
    this.smoothedAcceleration.fill(0);
    this.accumulator = 0;
    this.gravity = null;
    this.gravityTime = null;
    this.samples = [];
    this.angleDegrees = null;
  }

  sample(event, angleDegrees, nowSeconds) {
    if (!Number.isFinite(angleDegrees) || !Number.isFinite(nowSeconds) || nowSeconds < 0
      || (this.samples.length && nowSeconds < this.samples.at(-1).time)) return false;

    let acceleration = vector(event?.acceleration);
    const raw = acceleration ? null : vector(event?.accelerationIncludingGravity);
    if (!acceleration && !raw) return false;
    const normalizedAngle = (angleDegrees % 360 + 360) % 360;
    if (this.angleDegrees !== null && normalizedAngle !== this.angleDegrees) this.reset();
    this.angleDegrees = normalizedAngle;
    if (acceleration) {
      this.gravity = null;
      this.gravityTime = null;
    } else {
      if (!this.gravity || nowSeconds - this.gravityTime > 0.25) {
        // Seed the current pose so enabling sensors never treats gravity as a shake.
        this.gravity = raw.slice();
      } else {
        const blend = 1 - Math.exp(-(nowSeconds - this.gravityTime) / GRAVITY_TIME);
        for (let axis = 0; axis < 3; axis++) {
          this.gravity[axis] += (raw[axis] - this.gravity[axis]) * blend;
        }
      }
      this.gravityTime = nowSeconds;
      acceleration = raw.map((value, axis) => value - this.gravity[axis]);
    }

    const angle = normalizedAngle * Math.PI / 180;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    // Native portrait axes become screen-right, screen-up, and toward the viewer.
    const screen = [
      acceleration[0] * cosine - acceleration[1] * sine,
      acceleration[0] * sine + acceleration[1] * cosine,
      acceleration[2]
    ];
    const magnitude = Math.hypot(...screen);
    const scale = magnitude > DEADZONE ? Math.min(magnitude - DEADZONE, MAX_ACCELERATION) / magnitude : 0;
    const reading = {time: nowSeconds, acceleration: screen.map(value => value * scale)};
    if (this.samples.at(-1)?.time === nowSeconds) this.samples[this.samples.length - 1] = reading;
    else this.samples.push(reading);
    while (this.samples.length > 2 && (this.samples[1].time < nowSeconds - 0.5 || this.samples.length > 128)) {
      this.samples.shift();
    }
    return true;
  }

  accelerationAt(time) {
    while (this.samples.length > 1 && this.samples[1].time <= time) this.samples.shift();
    const before = this.samples[0], after = this.samples[1];
    if (!before || time < before.time) return [0, 0, 0];
    if (after) {
      const blend = (time - before.time) / (after.time - before.time);
      return before.acceleration.map((value, axis) => value + (after.acceleration[axis] - value) * blend);
    }
    const stale = Math.max(0, time - before.time - STALE_AFTER);
    const decay = stale > 0.4 ? 0 : Math.exp(-stale / 0.05);
    return before.acceleration.map(value => value * decay);
  }

  update(elapsedSeconds, nowSeconds) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || elapsedSeconds > 0.25
      || !Number.isFinite(nowSeconds) || nowSeconds < 0) {
      this.reset();
      return this.position;
    }
    this.accumulator = Math.min(this.accumulator + elapsedSeconds, MAX_STEPS * STEP);
    for (let steps = 0; this.accumulator + 1e-12 >= STEP && steps < MAX_STEPS; steps++) {
      this.accumulator = Math.max(0, this.accumulator - STEP);
      // Interpolate sensor timestamps at each solver step, independent of render FPS.
      // A short fixed delay gives 30–120 Hz sensors time to supply both endpoints.
      const input = this.accelerationAt(nowSeconds - this.accumulator - SENSOR_DELAY);
      for (let axis = 0; axis < 3; axis++) {
        this.smoothedAcceleration[axis] += (input[axis] - this.smoothedAcceleration[axis]) * INPUT_SMOOTHING;
        this.velocity[axis] += (-DRIVE_GAIN * this.smoothedAcceleration[axis]
          - STIFFNESS * this.position[axis] - DAMPING * this.velocity[axis]) * STEP;
        this.position[axis] += this.velocity[axis] * STEP;
      }
      const displacement = Math.hypot(...this.position);
      if (displacement > MAX_DISPLACEMENT) {
        for (let axis = 0; axis < 3; axis++) this.position[axis] *= MAX_DISPLACEMENT / displacement;
        const outwardSpeed = this.velocity.reduce((sum, value, axis) =>
          sum + value * this.position[axis] / MAX_DISPLACEMENT, 0);
        if (outwardSpeed > 0) {
          for (let axis = 0; axis < 3; axis++) {
            this.velocity[axis] -= outwardSpeed * this.position[axis] / MAX_DISPLACEMENT;
          }
        }
      }
      if (Math.hypot(...input) < 1e-4 && Math.hypot(...this.smoothedAcceleration) < 1e-4
        && Math.hypot(...this.position) < 0.0002 && Math.hypot(...this.velocity) < 0.004) {
        this.position.fill(0);
        this.velocity.fill(0);
        this.smoothedAcceleration.fill(0);
      }
    }
    return this.position;
  }
}
