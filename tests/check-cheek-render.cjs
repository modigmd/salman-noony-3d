// Fixture server only. Use the approved browser tool to operate /tests/cheek-render.html.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const site = path.resolve(__dirname, '..');
const dist = path.join(site, 'dist');
const tests = path.join(site, 'tests');
const qa = path.join(site, 'qa');
const port = Number(process.env.CHEEK_QA_PORT || 8766);
const types = {'.html':'text/html;charset=utf-8', '.js':'text/javascript;charset=utf-8', '.mjs':'text/javascript;charset=utf-8', '.css':'text/css', '.glb':'model/gltf-binary', '.ttf':'font/ttf', '.svg':'image/svg+xml'};
let latestReport = null;
let productionReport = null;
let shakeReport = null;

const environmentPrelude = `<script>
  (() => {
    const errors = [], realMatchMedia = window.matchMedia.bind(window), originalError = console.error;
    const params = new URLSearchParams(location.search), realNow = performance.now.bind(performance);
    let reduced = params.get('reduced') === '1', hidden = false, clock = null, angle = 0;
    let permissionMode = params.get('permission'), permissionCalls = 0;
    Object.defineProperty(performance, 'now', {value:() => clock === null ? realNow() : clock, configurable:true});
    if(permissionMode) {
      Object.defineProperty(navigator, 'maxTouchPoints', {value:5, configurable:true});
      if(permissionMode === 'unsupported') Object.defineProperty(window, 'DeviceMotionEvent', {value:undefined, configurable:true});
      else {
        class MockDeviceMotionEvent extends Event {}
        if(permissionMode !== 'none') MockDeviceMotionEvent.requestPermission = () => {
          permissionCalls++;
          return permissionMode === 'reject' ? Promise.reject(new Error('Fixture permission failure')) : Promise.resolve(permissionMode === 'deny' ? 'denied' : 'granted');
        };
        Object.defineProperty(window, 'DeviceMotionEvent', {value:MockDeviceMotionEvent, configurable:true});
      }
      Object.defineProperty(window, 'orientation', {get:() => angle, configurable:true});
      if(screen.orientation) Object.defineProperty(screen.orientation, 'angle', {get:() => angle, configurable:true});
    }
    const media = new EventTarget();
    Object.defineProperty(media, 'matches', {get:() => reduced});
    media.media = '(prefers-reduced-motion: reduce)';
    window.matchMedia = query => query === media.media ? media : realMatchMedia(query);
    Object.defineProperty(document, 'hidden', {get:() => hidden, configurable:true});
    window.addEventListener('error', event => errors.push(event.message));
    window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
    console.error = (...args) => {errors.push(args.map(String).join(' ')); originalError(...args);};
    // Synthetic PointerEvents have no native pointer capture; only this fixture supplies it.
    const canvas = document.querySelector('canvas');
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    window.qaEnvironment = {
      errors,
      get permissionCalls() {return permissionCalls;},
      get permissionMode() {return permissionMode;},
      setPermissionMode(value) {permissionMode = value;},
      advance(milliseconds) {clock = (clock === null ? realNow() : clock)+milliseconds;},
      setAngle(value) {angle = value; window.dispatchEvent(new Event('orientationchange')); screen.orientation?.dispatchEvent(new Event('change'));},
      motion(acceleration = {x:0,y:0,z:0}, value = angle, gravity = null) {
        angle = value;
        const event = new Event('devicemotion');
        Object.defineProperties(event, {acceleration:{value:acceleration}, accelerationIncludingGravity:{value:gravity}, interval:{value:1000/60}});
        window.dispatchEvent(event);
      },
      setReduced(value) {reduced = value; media.dispatchEvent(new Event('change'));},
      setHidden(value) {hidden = value; document.dispatchEvent(new Event('visibilitychange'));}
    };
  })();
</script>`;
const appInstrumentation = `
window.qaDebug = {
  get state() {return {model, camera, controls, cheeks, active, renderer, scene, reducedMotion:reducedMotion.matches, lastTime,
    shake:typeof shake === 'undefined' ? null : shake, body:typeof body === 'undefined' ? null : body,
    jellies:typeof jellies === 'undefined' ? [] : jellies,
    motionEnabled:typeof motionEnabled === 'undefined' ? false : motionEnabled};},
  resetMotion, draw, fit,
  stop() {cancelAnimationFrame(frame);},
  step(elapsed = 1/60, render = true) {
    window.qaEnvironment.advance(elapsed*1000);
    lastTime = performance.now()-elapsed*1000;
    const originalRender = renderer.render;
    if(!render) renderer.render = () => {};
    try {draw();} finally {renderer.render = originalRender; cancelAnimationFrame(frame);}
  }
};
`;

function json(res, code, data) {
  res.writeHead(code, {'Content-Type':'application/json;charset=utf-8', 'Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
}
function post(req, res, callback) {
  let body = '';
  req.on('data', chunk => {body += chunk; if(body.length > 16*1024*1024) req.destroy();});
  req.on('end', () => {
    try {callback(JSON.parse(body));} catch(error) {json(res, 400, {error:error.message});}
  });
}
const server = http.createServer((req, res) => {
  let pathname;
  try {pathname = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${port}`).pathname);} catch {res.writeHead(400).end(); return;}
  if(pathname === '/tests/production-viewer.html' || pathname === '/tests/production-app.js') {
    const html = pathname.endsWith('.html');
    fs.readFile(path.join(dist, html ? 'index.html' : 'app.js'), 'utf8', (error, source) => {
      if(error) {res.writeHead(404).end(); return;}
      const data = html
        ? source.replace('<head>', '<head><base href="/">').replace(/<script type="module" src="\.\/app\.js(\?[^\"]*)?"><\/script>/, (_, query = '') => environmentPrelude + '<script type="module" src="/tests/production-app.js' + query + '"></script>')
        : source.replaceAll("from './", "from '/") + appInstrumentation;
      res.writeHead(200, {'Content-Type':html ? types['.html'] : types['.js'], 'Cache-Control':'no-store'});
      res.end(data);
    });
    return;
  }
  if(pathname === '/tests/production-report') {
    if(req.method === 'GET') {json(res, 200, productionReport); return;}
    if(req.method === 'POST') {post(req, res, data => {productionReport = data; console.log(JSON.stringify(data)); json(res, 200, {received:true});}); return;}
  }
  if(pathname === '/tests/shake-report') {
    if(req.method === 'GET') {json(res, 200, shakeReport); return;}
    if(req.method === 'POST') {post(req, res, data => {shakeReport = data; console.log(JSON.stringify(data)); json(res, 200, {received:true});}); return;}
  }
  if(pathname === '/tests/report') {
    if(req.method === 'GET') {json(res, 200, latestReport); return;}
    if(req.method === 'POST') {post(req, res, data => {latestReport = data; console.log(JSON.stringify(data)); json(res, 200, {received:true});}); return;}
  }
  if(pathname === '/tests/image' && req.method === 'POST') {
    post(req, res, data => {
      if(typeof data.name !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.name) || typeof data.png !== 'string' || !data.png.startsWith('data:image/png;base64,')) throw Error('Invalid image request');
      const bytes = Buffer.from(data.png.slice('data:image/png;base64,'.length), 'base64');
      if(bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('Invalid PNG');
      fs.mkdirSync(qa, {recursive:true});
      const filename = path.join(qa, `${data.name}.png`);
      fs.writeFileSync(filename, bytes);
      json(res, 200, {path:filename});
    });
    return;
  }
  if(req.method !== 'GET' && req.method !== 'HEAD') {res.writeHead(405).end(); return;}
  const root = pathname.startsWith('/tests/') ? tests : dist;
  const relative = pathname.startsWith('/tests/') ? pathname.slice('/tests'.length) : (pathname === '/' ? '/index.html' : pathname);
  const filename = path.resolve(root, '.' + relative);
  if(!filename.startsWith(root + path.sep)) {res.writeHead(403).end(); return;}
  fs.readFile(filename, (error, bytes) => {
    if(error) {res.writeHead(404).end(); return;}
    res.writeHead(200, {'Content-Type':types[path.extname(filename)] || 'application/octet-stream', 'Content-Length':bytes.length, 'Cache-Control':'no-store'});
    res.end(req.method === 'HEAD' ? undefined : bytes);
  });
});
server.listen(port, '127.0.0.1', () => console.log(`Cheek QA fixture: http://127.0.0.1:${port}/tests/cheek-render.html\nLatest report: http://127.0.0.1:${port}/tests/report`));
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
