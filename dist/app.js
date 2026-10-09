import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {CheekJiggle} from './cheek-jiggle.js';
import {ShakeSpring} from './shake-physics.mjs?v=shake-1';

const canvas = document.querySelector('canvas');
const viewer = document.querySelector('#viewer');
const soon = document.querySelector('#soon');
const tabs = [...document.querySelectorAll('[role=tab]')];
let renderer, controls, camera, scene, model, frame;
let cheeks=[], lastTime=null;
let viewportWidth=0;
let body, motionEnabled=false, motionPending=false, motionReceived=false, motionTimer;
const shake=new ShakeSpring();
const shakeTools=document.querySelector('#shake-tools'), shakeToggle=document.querySelector('#shake-toggle');
const shakeStatus=document.querySelector('#shake-status');
const motionSupported=isSecureContext && typeof DeviceMotionEvent!=='undefined' && navigator.maxTouchPoints>0;
const shakeRotation=new THREE.Quaternion(), shakeInverse=new THREE.Quaternion(), shakeEuler=new THREE.Euler();
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let active = true;
const select = (index) => {
  active = index === 0;
  tabs.forEach((tab,i) => {tab.setAttribute('aria-selected',i===index);tab.tabIndex=i===index?0:-1;});
  viewer.hidden = !active; soon.hidden = active;
  resetMotion();
  if (active && renderer) {if(resize() && model)fit();draw();}
  else cancelAnimationFrame(frame);
};
tabs.forEach((tab,index) => {
  tab.addEventListener('click',() => select(index));
  tab.addEventListener('keydown',event => {
    if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault(); const next = event.key==='Home'?0:event.key==='End'?1:1-index;
      select(next);tabs[next].focus();
    }
  });
});
function resize() {
  if (!active) return;
  const width = viewer.clientWidth, height = viewer.clientHeight;
  const widthChanged=width!==viewportWidth;viewportWidth=width;
  camera.aspect = width/height;camera.updateProjectionMatrix();
  renderer.setSize(width,height,false);
  return widthChanged;
}
function draw() {
  cancelAnimationFrame(frame);
  if (!active || document.hidden) return;
  const now=performance.now(), elapsed=lastTime===null?0:(now-lastTime)/1000;
  lastTime=now;controls.update();
  if(body && motionEnabled && !reducedMotion.matches) {
    const p=shake.update(elapsed,now/1000);
    body.position.fromArray(p).applyQuaternion(camera.quaternion);
    shakeRotation.setFromEuler(shakeEuler.set(p[1]*1.5,-p[0]*1.3,-p[0]*1.5));
    shakeInverse.copy(camera.quaternion).invert();
    body.quaternion.copy(camera.quaternion).multiply(shakeRotation).multiply(shakeInverse).normalize();
    const stretch=THREE.MathUtils.clamp((p[1]+p[2]*.3)*.5,-.04,.04);
    body.scale.set(1+stretch/2,1-stretch,1+stretch/2);
  }
  const azimuth=controls.getAzimuthalAngle(), polar=controls.getPolarAngle();
  cheeks.forEach(cheek => {
    if(reducedMotion.matches)cheek.reset(azimuth,polar);
    else cheek.update(elapsed,azimuth,polar,camera);
  });
  renderer.render(scene,camera);frame=requestAnimationFrame(draw);
}
function resetMotion() {
  lastTime=null;
  shake.reset();
  if(body) {
    body.position.set(0,0,0);body.quaternion.identity();body.scale.set(1,1,1);
    body.updateWorldMatrix(true,true);
  }
  clearTimeout(motionTimer);
  if(motionEnabled && !motionReceived && model && active && !document.hidden && !reducedMotion.matches)
    motionTimer=setTimeout(() => {
      if(motionEnabled && !motionReceived)shakeStatus.textContent='لم تصل بيانات الحركة. تأكد من السماح بها في المتصفح.';
    },3000);
  if(!controls)return;
  // Consume pending orbit damping without moving the displayed camera on resume.
  const position=camera.position.clone(), target=controls.target.clone(), damping=controls.enableDamping;
  controls.enableDamping=false;controls.update();
  camera.position.copy(position);controls.target.copy(target);controls.enableDamping=damping;controls.update();
  cheeks.forEach(cheek => cheek.reset(controls.getAzimuthalAngle(),controls.getPolarAngle()));
}
function fit() {
  resetMotion();
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = Math.max(size.y/(2*Math.tan(fov/2)),size.x/(2*Math.tan(fov/2)*camera.aspect))*1.17+size.z/2;
  camera.position.set(0,size.y*.04,distance);
  controls.target.set(0,0,0);controls.minDistance=distance*.48;controls.maxDistance=distance*2.4;
  controls.update();controls.saveState();
  resetMotion();
}
function updateShakeButton() {
  shakeToggle.disabled=motionPending || reducedMotion.matches;
  shakeToggle.setAttribute('aria-pressed',String(motionEnabled));
  shakeToggle.textContent=motionPending?'جارٍ التفعيل…':motionEnabled?'إيقاف الاهتزاز':'تفعيل الاهتزاز';
  if(reducedMotion.matches)shakeStatus.textContent='الاهتزاز متوقف بسبب إعداد تقليل الحركة.';
  else if(!motionPending)shakeStatus.textContent=motionEnabled?'هزّ الهاتف بلطف لتحريك سلمان.':'';
}
function onMotion(event) {
  if(!motionEnabled || !model || !active || document.hidden || reducedMotion.matches)return;
  const angle=screen.orientation?.angle ?? window.orientation ?? 0;
  if(shake.sample(event,angle,performance.now()/1000) && !motionReceived) {
    motionReceived=true;clearTimeout(motionTimer);
    shakeStatus.textContent='هزّ الهاتف بلطف لتحريك سلمان.';
  }
}
shakeToggle.addEventListener('click',async () => {
  if(motionPending || reducedMotion.matches || !motionSupported)return;
  if(motionEnabled) {
    motionEnabled=false;window.removeEventListener('devicemotion',onMotion);clearTimeout(motionTimer);
    resetMotion();updateShakeButton();return;
  }
  motionPending=true;updateShakeButton();
  try {
    // Safari requires this call directly inside the user's tap, before any await.
    const permission=typeof DeviceMotionEvent.requestPermission==='function'
      ? await DeviceMotionEvent.requestPermission() : 'granted';
    if(permission!=='granted') {
      shakeStatus.textContent='اسمح بالوصول إلى الحركة في Safari ثم جرّب مجددًا.';return;
    }
    motionEnabled=true;motionReceived=false;resetMotion();
    window.addEventListener('devicemotion',onMotion);
  } catch(error) {
    shakeStatus.textContent='تعذّر تفعيل الحركة. اسمح بها في Safari ثم جرّب مجددًا.';
  } finally {
    motionPending=false;
    // Keep permission errors visible; successful activation shows the shake hint.
    const status=shakeStatus.textContent;updateShakeButton();
    if(!motionEnabled && !reducedMotion.matches)shakeStatus.textContent=status;
  }
});
updateShakeButton();
try {
  renderer = new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(34,1,.01,100);
  scene.add(new THREE.HemisphereLight(0xfff5e8,0x555b70,2.1));
  const light=new THREE.DirectionalLight(0xffefde,3.1);light.position.set(-3,4,5);scene.add(light);
  const fill=new THREE.DirectionalLight(0xc7d8ff,1.2);fill.position.set(4,2,-3);scene.add(fill);
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.07;
  controls.enablePan=false;controls.rotateSpeed=.65;controls.zoomSpeed=.7;
  controls.minPolarAngle=.12;controls.maxPolarAngle=Math.PI-.12;
  controls.touches.ONE=THREE.TOUCH.ROTATE;controls.touches.TWO=THREE.TOUCH.DOLLY_ROTATE;
  resize();
  new GLTFLoader().load('./assets/salman.glb',gltf => {
    model=gltf.scene;
    const box=new THREE.Box3().setFromObject(model);
    model.position.sub(box.getCenter(new THREE.Vector3()));
    body=new THREE.Group();body.add(model);scene.add(body);
    model.traverse(object => {if(object.isMesh)cheeks.push(new CheekJiggle(object));});
    fit();document.querySelector('#loading').hidden=true;canvas.classList.add('ready');
    shakeTools.hidden=!motionSupported;draw();
  },undefined,failed);
  // Safari's toolbar changes only the height; keep the current orbit and jiggle.
  window.addEventListener('resize',() => {if(resize() && model && active)fit();});
  document.addEventListener('visibilitychange',() => {resetMotion();draw();});
  reducedMotion.addEventListener('change',() => {resetMotion();updateShakeButton();});
  window.addEventListener('orientationchange',resetMotion);
  screen.orientation?.addEventListener('change',resetMotion);
  canvas.addEventListener('keydown',event => {
    if (!model) return;
    const offset=camera.position.clone().sub(controls.target);
    const spherical=new THREE.Spherical().setFromVector3(offset);
    if(event.key==='ArrowLeft')spherical.theta+=.12;
    else if(event.key==='ArrowRight')spherical.theta-=.12;
    else if(event.key==='ArrowUp')spherical.phi=Math.max(.12,spherical.phi-.12);
    else if(event.key==='ArrowDown')spherical.phi=Math.min(Math.PI-.12,spherical.phi+.12);
    else if(event.key==='+' || event.key==='=')spherical.radius=Math.max(controls.minDistance,spherical.radius*.9);
    else if(event.key==='-')spherical.radius=Math.min(controls.maxDistance,spherical.radius*1.1);
    else return;
    event.preventDefault();camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));controls.update();
  });
} catch(error) {failed(error);}
function failed(error) {
  console.error(error);document.querySelector('#loading').hidden=true;document.querySelector('#error').hidden=false;
}
