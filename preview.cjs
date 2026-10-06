const http=require('node:http'), fs=require('node:fs'),path=require('node:path');
const root=path.resolve('dist');
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css','.glb':'model/gltf-binary','.ttf':'font/ttf','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':data.length});res.end(data);});
}).listen(8765,'127.0.0.1',()=>console.log('Local URL: http://127.0.0.1:8765/'));
