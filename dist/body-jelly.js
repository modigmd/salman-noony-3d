import * as THREE from 'three';
import {JellySpring} from './jelly-physics.mjs?v=jelly-1';

// Raw GLB coordinates; keep the contact patch fixed as the head and blanket wobble.
const deformation = `
uniform vec3 jellyBend;
uniform vec3 jellyRipple;
uniform float jellySquash;
const float jellyHeight = 1.894408;
const float jellyTau = 6.28318530718;
const vec2 jellyCenter = vec2(.0024175, -.0014455);
bool jellyAtRest() {
  return jellySquash == 0.0 && all(equal(jellyBend.xz, vec2(0.0))) && all(equal(jellyRipple.xz, vec2(0.0)));
}
float jellyAnchor(float y) {
  float t = clamp((y - .040) / .180, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
vec3 jellyWarp(vec3 point) {
  if(jellyAtRest() || point.y <= .040) return point;
  float h = clamp(point.y / jellyHeight, 0.0, 1.0);
  float phase = jellyTau * h;
  float bend = h * h * (3.0 - 2.0 * h);
  float halfSine = sin(phase * .5);
  float ripple = sin(phase) * halfSine * halfSine;
  float anchor = jellyAnchor(point.y);
  float radialScale = 1.0 - .5 * jellySquash * anchor * cos(phase);
  point.xz += (radialScale - 1.0) * (point.xz - jellyCenter)
    + anchor * (jellyBend.xz * bend + jellyRipple.xz * ripple);
  point.y += jellySquash * jellyHeight / jellyTau * anchor * sin(phase);
  return point;
}
vec3 jellyNormal(vec3 point, vec3 normal) {
  if(jellyAtRest() || point.y <= .040) return normal;
  float h = clamp(point.y / jellyHeight, 0.0, 1.0);
  float phase = jellyTau * h;
  float phaseSine = sin(phase), halfSine = sin(phase * .5);
  float anchor = jellyAnchor(point.y);
  float t = clamp((point.y - .040) / .180, 0.0, 1.0);
  float anchorDerivative = 6.0 * t * (1.0 - t) / .180;
  float radialScale = 1.0 - .5 * jellySquash * anchor * cos(phase);
  float radialDerivative = .5 * jellySquash
    * (anchor * jellyTau / jellyHeight * sin(phase) - anchorDerivative * cos(phase));
  float bendDerivative = anchorDerivative * h * h * (3.0 - 2.0 * h)
    + anchor * 6.0 * h * (1.0 - h) / jellyHeight;
  float rippleDerivative = anchorDerivative * phaseSine * halfSine * halfSine
    + anchor * jellyTau / jellyHeight
    * (cos(phase) * halfSine * halfSine + .5 * phaseSine * phaseSine);
  vec2 shear = radialDerivative * (point.xz - jellyCenter)
    + jellyBend.xz * bendDerivative + jellyRipple.xz * rippleDerivative;
  normal.xz /= radialScale;
  float heightDerivative = 1.0 + jellySquash
    * (anchor * cos(phase) + anchorDerivative * jellyHeight / jellyTau * sin(phase));
  normal.y = (normal.y - dot(shear, normal.xz)) / heightDerivative;
  return normal;
}`;

export class BodyJelly {
  constructor(mesh) {
    this.mesh=mesh;this.spring=new JellySpring();
    this.bend=new THREE.Vector3();this.ripple=new THREE.Vector3();this.squash={value:0};
    this.inverse=new THREE.Matrix4();this.linear=new THREE.Matrix3();this.velocity=new THREE.Vector3();
    // CheekJiggle is installed first; retain its shader, cache key and .020 bounds padding.
    const material=mesh.material, compile=material.onBeforeCompile.bind(material), key=material.customProgramCacheKey.bind(material);
    material.onBeforeCompile=(shader,renderer) => {
      compile(shader,renderer);
      shader.uniforms.jellyBend={value:this.bend};
      shader.uniforms.jellyRipple={value:this.ripple};
      shader.uniforms.jellySquash=this.squash;
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${deformation}`)
        .replace('#include <defaultnormal_vertex>',`// Compose the body Jacobian after the cheek Jacobian at the displaced point.
objectNormal = jellyNormal(position + cheekLeft.w * cheekOffsetLeft + cheekRight.w * cheekOffsetRight, objectNormal);
#include <defaultnormal_vertex>`)
        .replace('#include <project_vertex>',`transformed = jellyWarp(transformed);
#include <project_vertex>`);
    };
    material.customProgramCacheKey=() => key()+'-body-jelly-v2';
    material.needsUpdate=true;mesh.geometry.boundingSphere.radius+=.14;
  }

  update(elapsed,worldVelocity) {
    this.mesh.updateWorldMatrix(true,false);
    this.inverse.copy(this.mesh.matrixWorld).invert();this.linear.setFromMatrix4(this.inverse);
    this.velocity.copy(worldVelocity).applyMatrix3(this.linear);
    this.spring.update(elapsed,this.velocity.toArray());
    this.bend.fromArray(this.spring.upper);this.ripple.fromArray(this.spring.lower).multiplyScalar(.35);
    this.squash.value=THREE.MathUtils.clamp(this.spring.upper[1]*2/3,-.06,.06);
  }

  reset() {
    this.spring.reset();this.bend.set(0,0,0);this.ripple.set(0,0,0);this.squash.value=0;
  }
}
