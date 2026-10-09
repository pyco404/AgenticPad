import type { ArtFrame, ArtRef, WorldObject } from '../../../lib/world/model';
import { fixedObjectGeometry, projectedObjectFaces } from '../../../lib/world/object-geometry';
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

type Cached = { key:string; images:unknown[]; canvas:HTMLCanvasElement; x:number;y:number;width:number;height:number };
const raster = new WeakMap<WorldObject,Cached>();
/** Static mesh rasterization keeps agent compositing inexpensive; cache stays bounded to one pose/object. */
export function fixedObjectLayer(ctx: CanvasRenderingContext2D, view: Projection, o: WorldObject, scale:number, art?: (ref:ArtRef)=>ArtFrame|null) {
  const angle=cameraAngle(view), key=`${angle.yaw},${angle.tilt},${scale}`;
  const frontRef=o.directionalAssets?.front ?? o.metadata?.art;
  const front=frontRef ? art?.(frontRef) ?? undefined : undefined;
  const mesh=fixedObjectGeometry(o,front);
  const resolved=mesh.filter(f=>f.art).map(f=>art?.(f.art!)??null), images=resolved.map(f=>f?.image);
  let cached=raster.get(o);
  if(!cached || cached.key!==key || images.some((image,i)=>image!==cached!.images[i])) {
    const faces=projectedObjectFaces(view,o,front), points=faces.flatMap(f=>f.points);
    const x=Math.min(...points.map(p=>p.x))-2,y=Math.min(...points.map(p=>p.y))-2;
    const width=Math.max(1,Math.max(...points.map(p=>p.x))-x+2),height=Math.max(1,Math.max(...points.map(p=>p.y))-y+2);
    const density=Math.min(scale*(typeof window==='undefined'?1:Math.min(2,window.devicePixelRatio||1)),2048/Math.max(width,height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(width*density));canvas.height=Math.max(1,Math.ceil(height*density));
    const paint=canvas.getContext('2d')!;paint.imageSmoothingEnabled=false;paint.scale(density,density);paint.translate(-x,-y);
    for(const part of faces) {
      if(part.face.art) { const frame=art?.(part.face.art); if(frame) textureFace(paint,part.points,frame,part.face.art.flipX,part.face.crop); continue; }
      paint.beginPath();part.points.forEach((p,i)=>i?paint.lineTo(p.x,p.y):paint.moveTo(p.x,p.y));paint.closePath();
      paint.fillStyle=part.face.colour;paint.fill();paint.strokeStyle=M.outline;paint.lineWidth=.7;paint.stroke();
    }
    cached={key,images,canvas,x,y,width,height};raster.set(o,cached);
  }
  const image=cached;
  const s=Math.sin(angle.yaw),c=Math.cos(angle.yaw),depthScale=view==='isometric'?Math.SQRT2:1;
  let depth=-Infinity;
  for(const face of mesh) for(const p of face.vertices) depth=Math.max(depth,(p.x*s+p.y*c)*depthScale);
  return {depth,draw:()=>ctx.drawImage(image.canvas,image.x,image.y,image.width,image.height)};
}
