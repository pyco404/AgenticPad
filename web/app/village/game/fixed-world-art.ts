import { worldPerformance } from "../../../lib/world/render-performance";
import type { ProjectedLayer, ProjectionCamera } from "./projected-art";
import { solidLayer, solidVegetationLayer } from "./solid-renderer";
import type { ArtFrame, ArtRef, WorldObject } from '../../../lib/world/model';
import { fixedObjectGeometry, projectedObjectFaces, TREE_VARIATION_COUNT } from '../../../lib/world/object-geometry';
import { cameraAngle, type Projection } from '../../../lib/world/projection';
import { VILLAGE_MATERIAL as M } from '../../../lib/world/object-materials';
import { applySolidAppearance } from '../../../lib/world/solid-appearance';

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
type FixedLayer=ProjectedLayer&{drawScreen:(camera:ProjectionCamera,width:number,height:number)=>void;bitmap?:Cached};
const raster = new WeakMap<WorldObject,Cached>();
// Forest instances share immutable geometry and one raster per canopy/shape/pose.
// The loaded image owns the cache, so replacing a scene or texture releases it.
const templateObjects=new WeakSet<WorldObject>();
const forestTemplates=new WeakMap<object,Map<string,WorldObject>>();
/** Each forest tree's template key, worked out once: it depends on the tree, never on the camera. */
const treeKeys=new WeakMap<WorldObject,string>();
function treeKey(o:WorldObject,ref:ArtRef):string {
  let key=treeKeys.get(o);
  if(key===undefined){
    const seed=[...o.id].reduce((n,char)=>(n*31+char.charCodeAt(0))>>>0,0);
    key=[o.solid??seed%TREE_VARIATION_COUNT,typeof ref.frame==='number'?ref.frame%2:ref.frame,o.orientation,(o.depth/o.width).toFixed(6),(o.height/o.width).toFixed(6)].join(':');
    treeKeys.set(o,key);
  }
  return key;
}

/** Paints projected faces: art faces as affine textures, the rest as outlined fills. */
function paintFaces(g:CanvasRenderingContext2D, faces:ReturnType<typeof projectedObjectFaces>, art?:(ref:ArtRef)=>ArtFrame|null) {
  for(const part of faces) {
    if(part.face.art) { const frame=art?.(part.face.art); if(frame) textureFace(g,part.points,frame,part.face.art.flipX,part.face.crop); continue; }
    g.beginPath();part.points.forEach((p,i)=>i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y));g.closePath();
    g.fillStyle=part.face.colour;g.fill();g.strokeStyle=M.outline;g.lineWidth=.7;g.stroke();
  }
}

/** Where the faces fall, in projected world units, padded by the outline. */
function faceBounds(faces:ReturnType<typeof projectedObjectFaces>) {
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const f of faces) for(const p of f.points){ if(p.x<x0)x0=p.x; if(p.x>x1)x1=p.x; if(p.y<y0)y0=p.y; if(p.y>y1)y1=p.y; }
  return {x0:x0-2,y0:y0-2,x1:x1+2,y1:y1+2};
}

/**
 * One standing object as a painter layer at this camera. Objects draw their faces straight onto the
 * target, with nothing kept per camera angle; only the shared forest templates are rasterised, a
 * bounded set, so a rotation never grows a canvas per object.
 */
export function fixedObjectLayer(ctx: CanvasRenderingContext2D, view: Projection, o: WorldObject, scale:number, art?: (ref:ArtRef)=>ArtFrame|null): FixedLayer {
  applySolidAppearance(o);
  const vegetation = o.solid?.startsWith('tree') || o.solid === 'shrub';
  const solid=o.solid ? vegetation ? solidVegetationLayer(ctx,view,o) : solidLayer(ctx,view,o) : null;
  if(solid) return solid as FixedLayer;
  const angle=cameraAngle(view);
  const frontRef=o.directionalAssets?.front ?? o.metadata?.art;
  const front=frontRef ? art?.(frontRef) ?? undefined : undefined;
  if(o.type==='tree' && o.id.startsWith('forest:') && !templateObjects.has(o) && front) {
    const factor=o.width/192;
    const key=treeKey(o,frontRef!);
    let templates=forestTemplates.get(front.image as object);
    if(!templates){templates=new Map();forestTemplates.set(front.image as object,templates);}
    let template=templates.get(key);
    if(!template){template={...o,x:0,y:0,elevation:0,width:192,depth:o.depth/factor,height:o.height/factor,
      metadata:{...o.metadata,topAnchor:{x:0,y:0}}};templates.set(key,template);templateObjects.add(template);worldPerformance.count('treeTemplates');}
    const part=fixedObjectLayer(ctx,view,template,1/Math.min(2,typeof window==='undefined'?1:window.devicePixelRatio||1),art);
    const originX=o.x*Math.cos(angle.yaw)-o.y*Math.sin(angle.yaw);
    const along=o.x*Math.sin(angle.yaw)+o.y*Math.cos(angle.yaw);
    const originY=along*Math.sin(angle.tilt)-o.elevation*Math.cos(angle.tilt);
    worldPerformance.count('treeInstances');
    const image=part.bitmap!;
    return {depth:along*(view==='isometric'?Math.SQRT2:1)+part.depth*factor,
      bounds:{x0:originX+image.x*factor,y0:originY+image.y*factor,x1:originX+(image.x+image.width)*factor,y1:originY+(image.y+image.height)*factor},
      draw:()=>{ctx.save();ctx.translate(originX,originY);ctx.scale(factor,factor);part.draw();ctx.restore();},
      drawScreen:(camera,width,height)=>ctx.drawImage(image.canvas,0,0,image.pixelsWide,image.pixelsHigh,
        width/2+(originX+image.x*factor-camera.x)*camera.scale,height/2+(originY+image.y*factor-camera.y)*camera.scale,
        image.width*factor*camera.scale,image.height*factor*camera.scale)};
  }
  const mesh=fixedObjectGeometry(o,front);
  const s=Math.sin(angle.yaw),c=Math.cos(angle.yaw),depthScale=view==='isometric'?Math.SQRT2:1;
  let depth=-Infinity;
  for(const face of mesh) for(const p of face.vertices) depth=Math.max(depth,(p.x*s+p.y*c)*depthScale);
  if(!templateObjects.has(o)) {
    const faces=projectedObjectFaces(view,o,front);
    return {depth,bounds:faceBounds(faces),
      draw:()=>paintFaces(ctx,faces,art),
      drawScreen:(camera,width,height)=>{
        ctx.save();ctx.translate(width/2,height/2);ctx.scale(camera.scale,camera.scale);ctx.translate(-camera.x,-camera.y);
        paintFaces(ctx,faces,art);ctx.restore();
      }};
  }
  const key=`${angle.yaw},${angle.tilt},${scale}`;
  const images=mesh.filter(f=>f.art).map(f=>art?.(f.art!)?.image);
  let cached=raster.get(o);
  if(!cached || cached.key!==key || images.some((image,i)=>image!==cached!.images[i])) {
    const rasterStarted=worldPerformance.start();
    worldPerformance.count('rasterBuilds');
    const faces=projectedObjectFaces(view,o,front), {x0:x,y0:y,x1,y1}=faceBounds(faces);
    const width=Math.max(1,x1-x),height=Math.max(1,y1-y);
    const density=Math.min(scale*(typeof window==='undefined'?1:Math.min(2,window.devicePixelRatio||1)),2048/Math.max(width,height));
    const pixelsWide=Math.max(1,Math.ceil(width*density)),pixelsHigh=Math.max(1,Math.ceil(height*density));
    const canvas=cached?.canvas??document.createElement('canvas');
    if(!cached)worldPerformance.count('canvasCreates');
    const wide=Math.ceil(pixelsWide/32)*32,high=Math.ceil(pixelsHigh/32)*32;
    // Grow when a pose needs more; shrink only when it needs under half, so turning does not thrash.
    if(canvas.width<wide||canvas.height<high||canvas.width>wide*2||canvas.height>high*2){canvas.width=wide;canvas.height=high;worldPerformance.count('canvasResizes');}
    const paint=canvas.getContext('2d')!;paint.setTransform(1,0,0,1,0,0);paint.clearRect(0,0,canvas.width,canvas.height);
    paint.imageSmoothingEnabled=false;paint.scale(density,density);paint.translate(-x,-y);
    paintFaces(paint,faces,art);
    cached={key,images,canvas,x,y,width,height,pixelsWide,pixelsHigh};raster.set(o,cached);
    worldPerformance.endStage('treeRaster',rasterStarted);
  }
  const image=cached;
  return {depth,bitmap:image,bounds:{x0:image.x,y0:image.y,x1:image.x+image.width,y1:image.y+image.height},
    draw:()=>ctx.drawImage(image.canvas,0,0,image.pixelsWide,image.pixelsHigh,image.x,image.y,image.width,image.height),
    drawScreen:(camera,width,height)=>ctx.drawImage(image.canvas,0,0,image.pixelsWide,image.pixelsHigh,
      width/2+(image.x-camera.x)*camera.scale,height/2+(image.y-camera.y)*camera.scale,image.width*camera.scale,image.height*camera.scale)};
}
