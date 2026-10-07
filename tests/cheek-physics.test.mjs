import test from 'node:test';
import assert from 'node:assert/strict';
import {CHEEK_CENTERS, cheekWeight, cheekGradient, CheekSpring} from '../dist/cheek-physics.mjs';

const length = vector => Math.hypot(...vector);
const advance = (spring, seconds, velocity = [0, 0, 0], rate = 120) => {
  for (let frame = 0; frame < Math.round(seconds * rate); frame++) spring.update(1 / rate, velocity);
};

test('cheek centers are fully weighted and duplicate positions produce identical masks', () => {
  assert.deepEqual(CHEEK_CENTERS, [[-0.170, 1.310, 0.290], [0.185, 1.310, 0.290]]);
  for (const center of CHEEK_CENTERS) {
    assert.equal(cheekWeight(center, center), 1);
    const point = [center[0] + 0.02, center[1] - 0.01, center[2] + 0.02];
    assert.equal(cheekWeight(point, center), cheekWeight(point.slice(), center));
    assert.deepEqual(cheekGradient(point, center), cheekGradient(point.slice(), center));
    assert.equal(cheekWeight(point, CHEEK_CENTERS[center === CHEEK_CENTERS[0] ? 1 : 0]), 0);
  }
});

test('eyes, central face, rear head, blanket, and distant ears remain fixed', () => {
  const protectedPoints = [
    [0.010, 1.310, 0.290],
    [-0.170, 1.410, 0.290],
    [-0.170, 1.310, 0.170],
    [-0.170, 1.240, 0.290],
    [-0.360, 1.310, 0.290],
    [0.360, 1.310, 0.290]
  ];
  for (const point of protectedPoints) {
    for (const center of CHEEK_CENTERS) assert.equal(cheekWeight(point, center), 0);
  }
});

test('ellipsoid and gate boundaries fade smoothly to zero', () => {
  const center = CHEEK_CENTERS[0];
  assert.ok(cheekWeight([-0.170 - 0.120 + 1e-5, 1.310, 0.290], center) < 1e-6);
  assert.equal(cheekWeight([-0.170 - 0.120 - 1e-5, 1.310, 0.290], center), 0);
  assert.ok(length(cheekGradient([-0.290, 1.310, 0.290], center)) < 0.015);
  assert.ok(cheekWeight([-0.170, 1.240 + 1e-5, 0.290], center) < 1e-6);
  assert.ok(cheekWeight([-0.170, 1.405 - 1e-5, 0.290], center) < 1e-6);
  assert.ok(cheekWeight([-0.095 - 1e-5, 1.310, 0.290], center) < 1e-6);
  for (let axis = 0; axis < 3; axis++) {
    const point = [-0.185, 1.300, 0.305];
    const before = point.slice(), after = point.slice();
    before[axis] -= 1e-5;
    after[axis] += 1e-5;
    const reference = (cheekWeight(after, center) - cheekWeight(before, center)) / 2e-5;
    assert.ok(Math.abs(cheekGradient(point, center)[axis] - reference) < 0.0001);
  }
});

test('stationary input stays stationary, including small frame deltas', () => {
  const spring = new CheekSpring();
  advance(spring, 1);
  spring.update(0.001, [0, 0, 0]);
  assert.deepEqual(spring.position, [0, 0, 0]);
  assert.deepEqual(spring.velocity, [0, 0, 0]);
});

test('motion causes directional lag, release rebounds, and settles within one second', () => {
  const spring = new CheekSpring();
  advance(spring, 0.075, [0.8, -0.4, 0.2]);
  assert.ok(spring.position[0] < -0.008);
  assert.ok(spring.position[1] > 0.004);
  assert.ok(spring.position[2] < -0.002);
  assert.ok(Math.abs(spring.position[1] / spring.position[0] + 0.5) < 1e-10);
  let rebound = false;
  for (let frame = 0; frame < 120; frame++) {
    spring.update(1 / 120, [0, 0, 0]);
    if (spring.position[0] > 0.002) rebound = true;
  }
  assert.ok(rebound);
  assert.deepEqual(spring.position, [0, 0, 0]);
  assert.deepEqual(spring.velocity, [0, 0, 0]);
});

test('motion and reversal have the same trajectories at 30, 60, and 120 FPS', () => {
  const curves = [30, 60, 120].map(rate => {
    const spring = new CheekSpring();
    const checkpoints = [];
    for (const velocity of [[0.7, 0.2, 0], [0.7, 0.2, 0], [-0.7, -0.2, 0], [0, 0, 0]]) {
      advance(spring, 0.1, velocity, rate);
      checkpoints.push(spring.position.slice());
    }
    advance(spring, 1, [0, 0, 0], rate);
    assert.deepEqual(spring.position, [0, 0, 0]);
    return checkpoints;
  });
  for (let curve = 1; curve < curves.length; curve++) {
    for (let checkpoint = 0; checkpoint < curves[0].length; checkpoint++) {
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(Math.abs(curves[curve][checkpoint][axis] - curves[0][checkpoint][axis]) < 1e-10);
      }
    }
  }
  assert.ok(curves[0][2][0] > 0, 'reversal must respond in the new opposite direction');
});

test('smooth changing orbit velocity remains close across frame rates', () => {
  const angularFrequency = 2 * Math.PI / 0.6;
  const curves = [30, 60, 120].map(rate => {
    const spring = new CheekSpring(), checkpoints = [];
    for (let frame = 0; frame < rate * 1.2; frame++) {
      const start = frame / rate, end = (frame + 1) / rate;
      // Orbit measurements report displacement averaged over the rendered frame.
      const velocity = end <= 0.6 + 1e-10
        ? 0.8 * (Math.cos(angularFrequency * start) - Math.cos(angularFrequency * end))
          / (angularFrequency * (end - start)) : 0;
      spring.update(1 / rate, [velocity, 0, 0]);
      if ((frame + 1) % (rate / 10) === 0) checkpoints.push(spring.position[0]);
    }
    advance(spring, 0.4, [0, 0, 0], rate);
    assert.deepEqual(spring.position, [0, 0, 0]);
    return checkpoints;
  });
  for (const curve of curves.slice(0, 2)) {
    const maxError = Math.max(...curve.map((value, index) => Math.abs(value - curves[2][index])));
    assert.ok(maxError < 0.0003, `frame-rate displacement error ${maxError} exceeds 0.0003`);
  }
});

test('repeated extreme diagonal input remains finite and bounded at every supported rate', () => {
  for (const rate of [30, 60, 120]) {
    const spring = new CheekSpring();
    let reachedBound = false;
    for (let frame = 0; frame < rate * 5; frame++) {
      const sign = Math.floor(frame / (rate / 10)) % 2 ? -1 : 1;
      spring.update(1 / rate, [100 * sign, -80 * sign, 70 * sign]);
      assert.ok(spring.position.every(Number.isFinite));
      assert.ok(spring.velocity.every(Number.isFinite));
      assert.ok(length(spring.position) <= 0.020000000001);
      if (Math.abs(length(spring.position) - 0.020) < 1e-12) {
        reachedBound = true;
        const outwardSpeed = spring.velocity.reduce((sum, value, axis) =>
          sum + value * spring.position[axis], 0);
        assert.ok(outwardSpeed <= 1e-12);
      }
    }
    assert.ok(reachedBound);
    advance(spring, 1, [0, 0, 0], rate);
    assert.deepEqual(spring.position, [0, 0, 0]);
  }
});

test('reset clears displacement, velocity, smoothing, and accumulated time', () => {
  const spring = new CheekSpring();
  advance(spring, 0.1, [1, 0, 0]);
  spring.update(0.003, [1, 0, 0]);
  assert.ok(length(spring.position) > 0);
  spring.reset();
  assert.deepEqual(spring.position, [0, 0, 0]);
  assert.deepEqual(spring.velocity, [0, 0, 0]);
  assert.deepEqual(spring.smoothedVelocity, [0, 0, 0]);
  assert.equal(spring.accumulator, 0);
  advance(spring, 1);
  assert.deepEqual(spring.position, [0, 0, 0]);
});

test('invalid input and long suspension reset motion, and capped catch-up stays bounded', () => {
  for (const delta of [NaN, Infinity, -1, 0, 0.251, 1]) {
    const spring = new CheekSpring();
    advance(spring, 0.1, [1, 0, 0]);
    spring.update(delta, [1, 0, 0]);
    assert.deepEqual(spring.position, [0, 0, 0]);
    assert.deepEqual(spring.velocity, [0, 0, 0]);
  }
  for (const input of [null, [], [1, 0], [Infinity, 0, 0], [NaN, 0, 0]]) {
    const spring = new CheekSpring();
    advance(spring, 0.1, [1, 0, 0]);
    spring.update(1 / 60, input);
    assert.deepEqual(spring.position, [0, 0, 0]);
  }
  const delayed = new CheekSpring(), reference = new CheekSpring();
  delayed.update(0.2, [1, 0, 0]);
  advance(reference, 8 / 120, [1, 0, 0]);
  assert.deepEqual(delayed.position, reference.position);
});
