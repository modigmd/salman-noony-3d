import test from 'node:test';
import assert from 'node:assert/strict';
import {ShakeSpring} from '../dist/shake-physics.mjs';

const length = value => Math.hypot(...value);
const acceleration = (x, y = 0, z = 0) => ({acceleration: {x, y, z}});
const gravity = (x, y, z) => ({acceleration: {x: null, y: null, z: null}, accelerationIncludingGravity: {x, y, z}});
const run = (spring, from, seconds, rate = 120, sensor = null, angle = 0) => {
  for (let frame = 1; frame <= Math.round(seconds * rate); frame++) {
    const now = from + frame / rate;
    if (sensor) assert.equal(spring.sample(sensor(now), angle, now), true);
    spring.update(1 / rate, now);
  }
};

test('valid motion excludes gravity, rejects noise, and lags opposite acceleration', () => {
  const quiet = new ShakeSpring();
  run(quiet, 0, 1, 120, () => acceleration(0.3, -0.2, 0.1));
  assert.deepEqual(quiet.position, [0, 0, 0]);
  const spring = new ShakeSpring();
  assert.equal(spring.sample({...acceleration(8), accelerationIncludingGravity: {x: 0, y: 9.8, z: 0}}, 0, 0), true);
  run(spring, 0, 0.15, 120, () => acceleration(8));
  assert.ok(spring.position[0] < -0.03, `normal shake displacement ${spring.position[0]} must be visible`);
  assert.equal(spring.position[1], 0);
  assert.equal(spring.position[2], 0);
  assert.ok(length(spring.position) < 0.10);
});

test('portrait and landscape directions rotate into screen axes', () => {
  const cases = [
    {angle: 0, native: [8, 0, 0], expected: [-1, 0, 0]},
    {angle: 90, native: [0, -8, 0], expected: [-1, 0, 0]},
    {angle: -90, native: [0, 8, 0], expected: [-1, 0, 0]},
    {angle: 180, native: [-8, 0, 0], expected: [-1, 0, 0]},
    {angle: 90, native: [8, 0, 0], expected: [0, -1, 0]},
    {angle: 0, native: [0, 0, 8], expected: [0, 0, -1]}
  ];
  for (const {angle, native, expected} of cases) {
    const spring = new ShakeSpring();
    spring.sample(acceleration(...native), angle, 0);
    run(spring, 0, 0.15, 120, () => acceleration(...native), angle);
    for (let axis = 0; axis < 3; axis++) {
      if (!expected[axis]) assert.ok(Math.abs(spring.position[axis]) < 1e-12);
      else assert.ok(spring.position[axis] * expected[axis] > 0.03);
    }
  }
});

test('gravity fallback seeds a static tilted pose without movement', () => {
  for (const pose of [[0, 9.81, 0], [4.905, 0, 8.4957], [-6, 7, 3.35]]) {
    const spring = new ShakeSpring();
    assert.equal(spring.sample(gravity(...pose), 0, 0), true);
    run(spring, 0, 2, 60, () => gravity(...pose));
    assert.deepEqual(spring.position, [0, 0, 0]);
    assert.deepEqual(spring.velocity, [0, 0, 0]);
  }
});

test('gravity baseline rejects slow tilt and detects a subsequent shake', () => {
  const spring = new ShakeSpring();
  spring.sample(gravity(0, 9.81, 0), 0, 0);
  run(spring, 0, 3, 120, time => gravity(9.81 * Math.sin(time * 0.25), 9.81 * Math.cos(time * 0.25), 0));
  assert.deepEqual(spring.position, [0, 0, 0]);
  const tilted = [9.81 * Math.sin(0.75), 9.81 * Math.cos(0.75), 0];
  run(spring, 3, 1, 120, () => gravity(...tilted));
  run(spring, 4, 0.2, 120, () => gravity(tilted[0] + 8, tilted[1], 0));
  assert.ok(spring.position[0] < -0.025);
});

test('orientation changes clear old motion and seed the new static gravity pose', () => {
  const spring = new ShakeSpring();
  spring.sample(gravity(0, 9.8, 0), 0, 0);
  run(spring, 0, 0.2, 120, () => gravity(8, 9.8, 0));
  assert.ok(length(spring.position) > 0.025);
  assert.equal(spring.sample(gravity(9.8, 0, 0), 90, 0.21), true);
  assert.deepEqual(spring.position, [0, 0, 0]);
  run(spring, 0.21, 1, 120, () => gravity(9.8, 0, 0), 90);
  assert.deepEqual(spring.position, [0, 0, 0]);
  assert.equal(spring.sample(gravity(9.8, 0, 0), 450, 1.22), true);
  assert.equal(spring.angleDegrees, 90);
});

test('invalid or null readings do not pass as valid sensor data', () => {
  const spring = new ShakeSpring();
  for (const event of [null, {}, {acceleration: null}, acceleration(null), acceleration(NaN), acceleration(Infinity),
    {acceleration: {x: 2, y: 0}}, {acceleration: {x: '2', y: 0, z: 0}}, gravity(null, 9.8, 0)]) {
    assert.equal(spring.sample(event, 0, 0), false);
  }
  assert.equal(spring.sample(acceleration(8), NaN, 0), false);
  assert.equal(spring.sample(acceleration(8), 0, NaN), false);
  assert.equal(spring.sample(acceleration(8), 0, -1), false);
  assert.equal(spring.sample(acceleration(8), 0, 1), true);
  assert.equal(spring.sample(null, 90, 1.05), false);
  assert.equal(spring.samples.length, 1);
  assert.equal(spring.angleDegrees, 0);
  assert.equal(spring.sample(acceleration(-8), 0, 0.9), false);
  assert.equal(spring.sample(gravity(0, 9.8, 0), 0, 1.1), true);
});

test('30, 60, and 120 FPS trajectories agree for a fixed 60 Hz sensor stream', () => {
  const curves = [30, 60, 120].map(rate => {
    const spring = new ShakeSpring(), checkpoints = [];
    spring.sample(acceleration(0), 0, 0);
    let sensorFrame = 1;
    for (let frame = 1; frame <= rate * 2; frame++) {
      const now = frame / rate;
      while (sensorFrame / 60 <= now + 1e-10) {
        const sampleTime = sensorFrame++ / 60;
        const value = sampleTime <= 0.8 ? 8 * Math.sin(2 * Math.PI * 3 * sampleTime) : 0;
        spring.sample(acceleration(value, value * 0.3), 0, sampleTime);
      }
      spring.update(1 / rate, now);
      if (frame % (rate / 10) === 0) checkpoints.push(spring.position.slice());
    }
    return checkpoints;
  });
  for (const curve of curves.slice(0, 2)) {
    const maxError = Math.max(...curve.map((value, index) =>
      length(value.map((component, axis) => component - curves[2][index][axis]))));
    assert.ok(maxError < 0.003, `sensor/render rate error ${maxError} must stay under .003 model units`);
  }
  assert.ok(Math.max(...curves[0].map(length)) > 0.03);
});

test('changing sensor rates remain consistent with render rates', () => {
  const peaks = [30, 60, 120].map(rate => {
    const spring = new ShakeSpring();
    let peak = 0;
    spring.sample(acceleration(0), 0, 0);
    for (let frame = 1; frame <= rate; frame++) {
      const now = frame / rate;
      const value = now < 0.8 ? 8 * Math.sin(2 * Math.PI * 3 * now) : 0;
      spring.sample(acceleration(value), 0, now);
      spring.update(1 / rate, now);
      peak = Math.max(peak, length(spring.position));
    }
    return peak;
  });
  assert.ok(Math.min(...peaks) > 0.03);
  assert.ok(Math.max(...peaks) - Math.min(...peaks) < 0.007);
});

test('stopped sensor input becomes stale, rebounds, and settles to exact zero', () => {
  for (const rate of [30, 60, 120]) {
    const spring = new ShakeSpring();
    spring.sample(acceleration(8), 0, 0);
    run(spring, 0, 0.2, rate, () => acceleration(8));
    assert.ok(spring.position[0] < -0.03);
    let rebound = false;
    for (let frame = 1; frame <= rate * 2; frame++) {
      spring.update(1 / rate, 0.2 + frame / rate);
      if (spring.position[0] > 0.002) rebound = true;
    }
    assert.ok(rebound);
    assert.deepEqual(spring.position, [0, 0, 0]);
    assert.deepEqual(spring.velocity, [0, 0, 0]);
  }
});

test('extreme diagonal repeated input and reversals remain finite and bounded', () => {
  for (const rate of [30, 60, 120]) {
    const spring = new ShakeSpring();
    let reachedBound = false, negative = false, positive = false;
    for (let frame = 0; frame < rate * 5; frame++) {
      const sign = Math.floor(frame / (rate / 5)) % 2 ? -1 : 1;
      const now = frame / rate;
      spring.sample(acceleration(1e6 * sign, -1e6 * sign, 1e6 * sign), 0, now);
      spring.update(1 / rate, now);
      assert.ok(spring.position.every(Number.isFinite));
      assert.ok(spring.velocity.every(Number.isFinite));
      assert.ok(length(spring.position) <= 0.100000000001);
      if (spring.position[0] < -0.02) negative = true;
      if (spring.position[0] > 0.02) positive = true;
      if (Math.abs(length(spring.position) - 0.10) < 1e-12) {
        reachedBound = true;
        const outwardSpeed = spring.velocity.reduce((sum, value, axis) => sum + value * spring.position[axis], 0);
        assert.ok(outwardSpeed <= 1e-12);
      }
    }
    assert.ok(reachedBound);
    assert.ok(negative && positive);
    run(spring, 5, 2);
    assert.deepEqual(spring.position, [0, 0, 0]);
  }
});

test('reset clears physics, readings, and gravity baseline before a new pose', () => {
  const spring = new ShakeSpring();
  spring.sample(gravity(0, 9.8, 0), 0, 0);
  run(spring, 0, 0.2, 120, () => gravity(8, 9.8, 0));
  assert.ok(length(spring.position) > 0.025);
  spring.reset();
  assert.deepEqual(spring.position, [0, 0, 0]);
  assert.deepEqual(spring.velocity, [0, 0, 0]);
  assert.deepEqual(spring.smoothedAcceleration, [0, 0, 0]);
  assert.deepEqual(spring.samples, []);
  assert.equal(spring.gravity, null);
  assert.equal(spring.gravityTime, null);
  assert.ok(spring.accumulator < 1e-12);
  spring.sample(gravity(0, 0, 9.8), 90, 2);
  run(spring, 2, 1, 120, () => gravity(0, 0, 9.8), 90);
  assert.deepEqual(spring.position, [0, 0, 0]);
});

test('invalid elapsed time and suspended frames reset, while catch-up is limited to eight steps', () => {
  for (const delta of [0, -1, NaN, Infinity, 0.251, 1]) {
    const spring = new ShakeSpring();
    spring.sample(acceleration(8), 0, 0);
    run(spring, 0, 0.1, 120, () => acceleration(8));
    spring.update(delta, 0.2);
    assert.deepEqual(spring.position, [0, 0, 0]);
    assert.deepEqual(spring.samples, []);
  }
  const spring = new ShakeSpring();
  spring.sample(acceleration(8), 0, 0);
  spring.update(0.2, 0.2);
  assert.ok(length(spring.position) > 0);
  assert.ok(length(spring.position) < 0.10);
  assert.ok(spring.accumulator < 1e-12);
  spring.update(1 / 60, NaN);
  assert.deepEqual(spring.position, [0, 0, 0]);
});
