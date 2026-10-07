import * as THREE from 'three';
import {CHEEK_CENTERS, cheekWeight, cheekGradient, CheekSpring} from './cheek-physics.mjs';

export const MAX_OFFSET = .020;

export class CheekJiggle {
  constructor(mesh) {
    this.mesh=mesh;
    this.offsets=[new THREE.Vector3(),new THREE.Vector3()];
    this.springs=[new CheekSpring(),new CheekSpring()];
    this.gradients=[[],[]];
    this.previous=null;
    this.right=new THREE.Vector3();this.up=new THREE.Vector3();this.motion=new THREE.Vector3();
    this.anchor=new THREE.Vector3();this.horizontal=new THREE.Vector3();this.radial=new THREE.Vector3();
    this.inverse=new THREE.Matrix4();
    const geometry=mesh.geometry, positions=geometry.getAttribute('position');
    CHEEK_CENTERS.forEach((center,side) => {
      const data=new Float32Array(positions.count*4);
      for(let i=0;i<positions.count;i++) {
        const point=[positions.getX(i),positions.getY(i),positions.getZ(i)];
        const weight=cheekWeight(point,center);
        if(weight===0)continue;
        const gradient=cheekGradient(point,center);
        data.set([...gradient,weight],i*4);this.gradients[side].push(gradient);
      }
      geometry.setAttribute(side===0?'cheekLeft':'cheekRight',new THREE.BufferAttribute(data,4));
    });
    geometry.computeBoundingSphere();geometry.boundingSphere.radius+=MAX_OFFSET;
    const material=mesh.material;
    material.onBeforeCompile=shader => {
      shader.uniforms.cheekOffsetLeft={value:this.offsets[0]};
      shader.uniforms.cheekOffsetRight={value:this.offsets[1]};
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
attribute vec4 cheekLeft;
attribute vec4 cheekRight;
uniform vec3 cheekOffsetLeft;
uniform vec3 cheekOffsetRight;`)
      .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
// The cheek masks are disjoint: apply each inverse-transpose Jacobian separately.
objectNormal -= cheekLeft.xyz * dot(cheekOffsetLeft, objectNormal) / max(.35, 1.0 + dot(cheekLeft.xyz, cheekOffsetLeft));
objectNormal -= cheekRight.xyz * dot(cheekOffsetRight, objectNormal) / max(.35, 1.0 + dot(cheekRight.xyz, cheekOffsetRight));`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
transformed += cheekLeft.w * cheekOffsetLeft + cheekRight.w * cheekOffsetRight;`);
    };
    material.customProgramCacheKey=() => 'salman-cheek-jiggle-v1';
    material.needsUpdate=true;
  }

  reset(azimuth,polar) {
    this.previous=Number.isFinite(azimuth)&&Number.isFinite(polar)?[azimuth,polar]:null;
    this.springs.forEach(spring => spring.reset());
    this.offsets.forEach(offset => offset.set(0,0,0));
  }

  update(elapsed,azimuth,polar,camera) {
    if(!this.previous || !(elapsed>0) || elapsed>.25) {this.reset(azimuth,polar);return;}
    const delta=azimuth-this.previous[0];
    const yaw=Math.atan2(Math.sin(delta),Math.cos(delta))/elapsed;
    const pitch=(polar-this.previous[1])/elapsed;
    this.previous=[azimuth,polar];
    this.mesh.updateWorldMatrix(true,false);this.inverse.copy(this.mesh.matrixWorld).invert();
    this.right.set(1,0,0).applyQuaternion(camera.quaternion).transformDirection(this.inverse);
    this.up.set(0,1,0).applyQuaternion(camera.quaternion).transformDirection(this.inverse);
    // Inverse view rotation gives the apparent movement of the face; dolly is excluded.
    this.horizontal.set(Math.sin(azimuth),0,Math.cos(azimuth));
    this.radial.set(Math.sin(polar)*Math.sin(azimuth),Math.cos(polar),Math.sin(polar)*Math.cos(azimuth));
    this.springs.forEach((spring,side) => {
      this.anchor.fromArray(CHEEK_CENTERS[side]).applyMatrix4(this.mesh.matrixWorld);
      const lateral=this.anchor.x*Math.cos(azimuth)-this.anchor.z*Math.sin(azimuth);
      this.motion.copy(this.right).multiplyScalar(-yaw*this.anchor.dot(this.horizontal))
        .addScaledVector(this.up,pitch*this.anchor.dot(this.radial)-yaw*Math.cos(polar)*lateral);
      const velocity=[this.motion.x,this.motion.y,this.motion.z];
      spring.update(elapsed,velocity);
      const offset=this.offsets[side].fromArray(spring.position);
      let scale=1;
      for(const gradient of this.gradients[side]) {
        const dot=gradient[0]*offset.x+gradient[1]*offset.y+gradient[2]*offset.z;
        if(dot<-.65)scale=Math.min(scale,-.65/dot);
      }
      offset.multiplyScalar(scale);
    });
  }
}
