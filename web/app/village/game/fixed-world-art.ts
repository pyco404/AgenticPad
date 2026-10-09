import { worldPerformance } from "../../../lib/world/render-performance";
import type { ProjectionCamera } from "./projected-art";
import type { ArtFrame, ArtRef, WorldObject } from '../../../lib/world/model';
import { fixedObjectGeometry, projectedObjectFaces, TREE_VARIATION_COUNT } from '../../../lib/world/object-geometry';
import { cameraAngle, type Projection } from '../../../lib/world/projection';
import { VILLAGE_MATERIAL as M } from '../../../lib/world/object-materials';

export { fixedObjectGeometry, projectedObjectFaces } from '../../../lib/world/object-geometry';

/** Affine texture on a real vertical face: it narrows edge-on and disappears on its rear. */
function textureFace(ctx: CanvasRenderingContext2D, points: {x:number;y:number}[], frame: ArtFrame, flip=false, crop?: ArtFrame["content"]) {
  const [bl,br,tr,tl]=points, w=crop?.width ?? frame.width,h=crop?.height ?? frame.height;
  if(!bl||!br||!tr||!tl||w<=0||h<=0) return;
  ctx.save(); ctx.transform((tr.x-tl.x)/w,(tr.y-tl.y)/w,(bl.x-tl.x)/h,(bl.y-tl.y)/h,tl.x,tl.y);
  if(flip) {ctx.translate(w,0);ctx.scale(-1,1);}
  ctx.drawImage(frame.image as CanvasImageSource,frame.x+(crop?.x??0),frame.y+(crop?.y??0),w,h,0,0,w,h); ctx.restore();
}

type Cached = { key:string; images:unknown[]; canvas:HTMLCanvasElement; x:number;y:number;width:number;height:number; pixelsWide:number; pixelsHigh:number };
type FixedLayer={depth:number;draw:()=>void;drawScreen:(camera:ProjectionCamera,width:number,height:number)=>void;bitmap?:Cached};
const raster = new WeakMap<WorldObject,Cached>();
// Forest instances share immutable geometry and one raster per canopy/shape/pose.
// The loaded image owns the cache, so replacing a scene or texture releases it.
const templateObjects=new WeakSet<WorldObject>();
const forestTemplates=new WeakMap<object,Map<string,WorldObject>>();
/** Static mesh rasterization keeps agent compositing inexpensive; cache stays bounded to one pose/object. */
export function fixedObjectLayer(ctx: CanvasRenderingContext2D, view: Projection, o: WorldObject, scale:number, art?: (ref:ArtRef)=>ArtFrame|null): FixedLayer {
  const angle=cameraAngle(view), key=`${angle.yaw},${angle.tilt},${scale}`;
  const frontRef=o.directionalAssets?.front ?? o.metadata?.art;
  const front=frontRef ? art?.(frontRef) ?? undefined : undefined;
  if(o.type==='tree' && o.id.startsWith('forest:') && !templateObjects.has(o) && front) {
    const factor=o.width/192;
    const seed=[...o.id].reduce((n,char)=>(n*31+char.charCodeAt(0))>>>0,0);
    const ref=frontRef!;
    const key=[seed%TREE_VARIATION_COUNT,typeof ref.frame==='number'?ref.frame%2:ref.frame,o.orientation,(o.depth/o.width).toFixed(6),(o.height/o.width).toFixed(6)].join(':');
    let templates=forestTemplates.get(front.image as object);
    if(!templates){templates=new Map();forestTemplates.set(front.image as object,templates);}
    let template=templates.get(key);
    if(!template){template={...o,x:0,y:0,elevation:0,width:192,depth:o.depth/factor,height:o.height/factor};templates.set(key,template);templateObjects.add(template);worldPerformance.count('treeTemplates');}
    const part=fixedObjectLayer(ctx,view,template,1/Math.min(2,typeof window==='undefined'?1:window.devicePixelRatio||1),art);
    const originX=o.x*Math.cos(angle.yaw)-o.y*Math.sin(angle.yaw);
    const along=o.x*Math.sin(angle.yaw)+o.y*Math.cos(angle.yaw);
    const originY=along*Math.sin(angle.tilt)-o.elevation*Math.cos(angle.tilt);
    worldPerformance.count('treeInstances');
    const image=part.bitmap!;
    return {depth:along*(view==='isometric'?Math.SQRT2:1)+part.depth*factor,
      draw:()=>{ctx.save();ctx.translate(originX,originY);ctx.scale(factor,factor);part.draw();ctx.restore();},
      drawScreen:(camera,width,height)=>ctx.drawImage(image.canvas,0,0,image.pixelsWide,image.pixelsHigh,
        width/2+(originX+image.x*factor-camera.x)*camera.scale,height/2+(originY+image.y*factor-camera.y)*camera.scale,
        image.width*factor*camera.scale,image.height*factor*camera.scale)};
  }
  const mesh=fixedObjectGeometry(o,front);
  const resolved=mesh.filter(f=>f.art).map(f=>art?.(f.art!)??null), images=resolved.map(f=>f?.image);
  let cached=raster.get(o);
  if(!cached || cached.key!==key || images.some((image,i)=>image!==cached!.images[i])) {
    const rasterStarted=worldPerformance.start();
    worldPerformance.count('rasterBuilds');
    const faces=projectedObjectFaces(view,o,front), points=faces.flatMap(f=>f.points);
    const x=Math.min(...points.map(p=>p.x))-2,y=Math.min(...points.map(p=>p.y))-2;
    const width=Math.max(1,Math.max(...points.map(p=>p.x))-x+2),height=Math.max(1,Math.max(...points.map(p=>p.y))-y+2);
    const density=Math.min(scale*(typeof window==='undefined'?1:Math.min(2,window.devicePixelRatio||1)),2048/Math.max(width,height));
    const pixelsWide=Math.max(1,Math.ceil(width*density)),pixelsHigh=Math.max(1,Math.ceil(height*density));
    const canvas=cached?.canvas??document.createElement('canvas');
    if(!cached)worldPerformance.count('canvasCreates');
    // Reuse backing stores through a drag; capacity grows in small buckets, not every yaw delta.
    if(canvas.width<pixelsWide||canvas.height<pixelsHigh||!cached){canvas.width=cached?Math.max(canvas.width,Math.ceil(pixelsWide/32)*32):Math.ceil(pixelsWide/32)*32;canvas.height=cached?Math.max(canvas.height,Math.ceil(pixelsHigh/32)*32):Math.ceil(pixelsHigh/32)*32;worldPerformance.count('canvasResizes');}
    const paint=canvas.getContext('2d')!;paint.setTransform(1,0,0,1,0,0);paint.clearRect(0,0,canvas.width,canvas.height);
    paint.imageSmoothingEnabled=false;paint.scale(density,density);paint.translate(-x,-y);
    for(const part of faces) {
      if(part.face.art) { const frame=art?.(part.face.art); if(frame) textureFace(paint,part.points,frame,part.face.art.flipX,part.face.crop); continue; }
      paint.beginPath();part.points.forEach((p,i)=>i?paint.lineTo(p.x,p.y):paint.moveTo(p.x,p.y));paint.closePath();
      paint.fillStyle=part.face.colour;paint.fill();paint.strokeStyle=M.outline;paint.lineWidth=.7;paint.stroke();
    }
    cached={key,images,canvas,x,y,width,height,pixelsWide,pixelsHigh};raster.set(o,cached);
    worldPerformance.endStage(o.type==='tree'?'treeRaster':'objectRaster',rasterStarted);
  }
  const image=cached;
  const s=Math.sin(angle.yaw),c=Math.cos(angle.yaw),depthScale=view==='isometric'?Math.SQRT2:1;
  let depth=-Infinity;
  for(const face of mesh) for(const p of face.vertices) depth=Math.max(depth,(p.x*s+p.y*c)*depthScale);
  return {depth,bitmap:image,
    draw:()=>ctx.drawImage(image.canvas,0,0,image.pixelsWide,image.pixelsHigh,image.x,image.y,image.width,image.height),
    drawScreen:(camera,width,height)=>ctx.drawImage(image.canvas,0,0,image.pixelsWide,image.pixelsHigh,
      width/2+(image.x-camera.x)*camera.scale,height/2+(image.y-camera.y)*camera.scale,image.width*camera.scale,image.height*camera.scale)};
}
