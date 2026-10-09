import test from 'node:test';
import assert from 'node:assert/strict';
import {JellySpring} from '../dist/jelly-physics.mjs';
import {ShakeSpring} from '../dist/shake-physics.mjs';

const length = vector => Math.hypot(...vector);
const advance = (spring, seconds, velocity = [0, 0, 0], rate = 120) => {
  for (let frame = 0; frame < Math.round(seconds * rate); frame++) spring.update(1 / rate, velocity);
};
const assertBounded = spring => {
  assert.ok(length(spring.upper) <= 0.090000000001);
  assert.ok(length(spring.lower) <= 0.065000000001);
  for (const band of spring.bands) {
    assert.ok(band.position.every(Number.isFinite));
    assert.ok(band.velocity.every(Number.isFinite));
    if (Math.abs(length(band.position) - band.limit) < 1e-12) {
      const outward = band.velocity.reduce((sum, value, axis) => sum + value * band.position[axis], 0);
      assert.ok(outward <= 1e-12);
    }
  }
};

test('rest stays stationary and the update result retains stable upper/lower arrays', () => {
  const spring = new JellySpring();
  const result = spring.update(1 / 120, [0, 0, 0]);
  assert.equal(result.upper, spring.upper);
  assert.equal(result.lower, spring.lower);
  assert.equal(spring.update(1 / 60, [0, 0, 0]), result);
  advance(spring, 1);
  assert.deepEqual(spring.upper, [0, 0, 0]);
  assert.deepEqual(spring.lower, [0, 0, 0]);
});

test('horizontal, vertical, and depth acceleration produce directional soft lag', () => {
  for (let axis = 0; axis < 3; axis++) {
    const spring = new JellySpring(), velocity = [0, 0, 0];
    velocity[axis] = 1;
    advance(spring, 0.075, velocity);
    assert.ok(spring.upper[axis] < -0.025);
    assert.ok(spring.lower[axis] < -0.01);
    assert.ok(Math.abs(spring.upper[axis]) > Math.abs(spring.lower[axis]));
    for (let other = 0; other < 3; other++) {
      if (other !== axis) {
        assert.equal(spring.upper[other], 0);
        assert.equal(spring.lower[other], 0);
      }
    }
    assertBounded(spring);
  }
});

test('independent upper and lower bands develop different phases instead of a rigid offset', () => {
  const spring = new JellySpring();
  advance(spring, 0.075, [1, 0, 0]);
  let differentPhase = false, upperRebound = false, lowerRebound = false;
  for (let frame = 0; frame < 120; frame++) {
    spring.update(1 / 120, [0, 0, 0]);
    if (spring.upper[0] * spring.lower[0] < -1e-6) differentPhase = true;
    if (spring.upper[0] > 0.005) upperRebound = true;
    if (spring.lower[0] > 0.005) lowerRebound = true;
    assertBounded(spring);
  }
  assert.ok(differentPhase, 'head and blanket must move out of phase during the rebound');
  assert.ok(upperRebound && lowerRebound);
  advance(spring, 2);
  assert.deepEqual(spring.upper, [0, 0, 0]);
  assert.deepEqual(spring.lower, [0, 0, 0]);
});

test('constant body velocity eventually stops deforming the model', () => {
  const spring = new JellySpring();
  advance(spring, 3, [0.8, -0.2, 0.1]);
  assert.ok(length(spring.upper) < 0.00001);
  assert.ok(length(spring.lower) < 0.00001);
  advance(spring, 3);
  assert.deepEqual(spring.upper, [0, 0, 0]);
  assert.deepEqual(spring.lower, [0, 0, 0]);
});

test('smooth reversing body velocity remains consistent at 30, 60, and 120 FPS', () => {
  const curves = [30, 60, 120].map(rate => {
    const spring = new JellySpring(), checkpoints = [];
    for (let frame = 1; frame <= rate; frame++) {
      const time = frame / rate;
      const signal = time <= 0.8
        ? 0.8 * Math.sin(2 * Math.PI * 2.8 * time) * Math.sin(Math.PI * time / 0.8) ** 2 : 0;
      spring.update(1 / rate, [signal, signal * -0.4, signal * 0.2]);
      assertBounded(spring);
      if (frame % (rate / 10) === 0) checkpoints.push([spring.upper.slice(), spring.lower.slice()]);
    }
    advance(spring, 3, [0, 0, 0], rate);
    assert.deepEqual(spring.upper, [0, 0, 0]);
    assert.deepEqual(spring.lower, [0, 0, 0]);
    return checkpoints;
  });
  for (const curve of curves.slice(0, 2)) {
    const maxError = Math.max(...curve.flatMap((bands, index) => bands.map((value, band) =>
      length(value.map((component, axis) => component - curves[2][index][band][axis])))));
    assert.ok(maxError < 0.004, `frame-rate deformation error ${maxError} exceeds .004`);
  }
  assert.ok(Math.max(...curves[0].map(bands => length(bands[0]))) > 0.035);
});

test('actual sensor-driven ShakeSpring velocity creates visible soft-band separation at every frame rate', () => {
  const peaks = [30, 60, 120].map(rate => {
    const shake = new ShakeSpring(), jelly = new JellySpring();
    let peakUpper = 0, peakLower = 0, peakSeparation = 0;
    shake.sample({acceleration: {x: 0, y: 0, z: 0}}, 0, 0);
    for (let frame = 1; frame <= rate; frame++) {
      const time = frame / rate;
      const signal = time <= 0.8 ? 8 * Math.sin(2 * Math.PI * 3 * time) : 0;
      shake.sample({acceleration: {x: signal, y: signal * 0.3, z: 0}}, 0, time);
      shake.update(1 / rate, time);
      jelly.update(1 / rate, shake.velocity);
      assertBounded(jelly);
      peakUpper = Math.max(peakUpper, length(jelly.upper));
      peakLower = Math.max(peakLower, length(jelly.lower));
      peakSeparation = Math.max(peakSeparation, length(jelly.upper.map((value, axis) => value - jelly.lower[axis])));
    }
    assert.ok(peakUpper > 0.06);
    assert.ok(peakLower > 0.03);
    assert.ok(peakSeparation > 0.04);
    for (let frame = 1; frame <= rate * 4; frame++) {
      shake.update(1 / rate, 1 + frame / rate);
      jelly.update(1 / rate, shake.velocity);
    }
    assert.deepEqual(jelly.upper, [0, 0, 0]);
    assert.deepEqual(jelly.lower, [0, 0, 0]);
    return [peakUpper, peakLower, peakSeparation];
  });
  for (let statistic = 0; statistic < 3; statistic++) {
    assert.ok(Math.max(...peaks.map(peak => peak[statistic])) - Math.min(...peaks.map(peak => peak[statistic])) < 0.015);
  }
});

test('rapid extreme diagonal reversals remain bounded and settle after input stops', () => {
  for (const rate of [30, 60, 120]) {
    const spring = new JellySpring();
    let upperAtBound = false, lowerAtBound = false, positive = false, negative = false;
    for (let frame = 0; frame < rate * 4; frame++) {
      const sign = Math.floor(frame / (rate / 7)) % 2 ? -1 : 1;
      spring.update(1 / rate, [1000 * sign, -800 * sign, 700 * sign]);
      assertBounded(spring);
      if (length(spring.upper) > 0.0899) upperAtBound = true;
      if (length(spring.lower) > 0.0649) lowerAtBound = true;
      if (spring.upper[0] > 0.01) positive = true;
      if (spring.upper[0] < -0.01) negative = true;
    }
    assert.ok(upperAtBound && lowerAtBound);
    assert.ok(positive && negative);
    advance(spring, 3, [0, 0, 0], rate);
    assert.deepEqual(spring.upper, [0, 0, 0]);
    assert.deepEqual(spring.lower, [0, 0, 0]);
  }
});

test('reset and invalid or suspended updates clear all deformation and input history', () => {
  for (const elapsed of [0, -1, NaN, Infinity, 0.251, 1]) {
    const spring = new JellySpring();
    advance(spring, 0.075, [1, 0, 0]);
    spring.update(elapsed, [1, 0, 0]);
    assert.deepEqual(spring.upper, [0, 0, 0]);
    assert.deepEqual(spring.lower, [0, 0, 0]);
    assert.deepEqual(spring.previousInput, [0, 0, 0]);
    assert.deepEqual(spring.smoothedVelocity, [0, 0, 0]);
    assert.equal(spring.accumulator, 0);
  }
  for (const input of [null, [], [1, 0], [NaN, 0, 0], [Infinity, 0, 0], 'bad']) {
    const spring = new JellySpring();
    advance(spring, 0.075, [1, 0, 0]);
    spring.update(1 / 60, input);
    assert.deepEqual(spring.upper, [0, 0, 0]);
    assert.deepEqual(spring.lower, [0, 0, 0]);
  }
  const spring = new JellySpring();
  advance(spring, 0.075, [1, 0, 0]);
  spring.reset();
  advance(spring, 1);
  assert.deepEqual(spring.upper, [0, 0, 0]);
  assert.deepEqual(spring.lower, [0, 0, 0]);
});

test('short accumulated frames and capped catch-up remain stable', () => {
  const spring = new JellySpring();
  for (let frame = 0; frame < 240; frame++) spring.update(1 / 240, [0.4 * Math.sin(frame / 20), 0, 0]);
  assertBounded(spring);
  assert.ok(length(spring.upper) > 0.001);
  for (let frame = 0; frame < 20; frame++) {
    spring.update(0.2, [frame % 2 ? -2 : 2, 0, 0]);
    assertBounded(spring);
    assert.ok(spring.accumulator < 1e-12);
  }
});
