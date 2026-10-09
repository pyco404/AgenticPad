import type { ArtFrame, ArtRef, WorldObject } from './model';
import { directionalArt, localSize, objectVertex, ORIENTATION_YAW, physicalKind, type ObjectSide } from './object-appearance';
import { cameraAngle, type Projection } from './projection';
import { buildingMaterial, VILLAGE_MATERIAL as M } from './object-materials';
import { darker } from '../../app/village/game/palette';

export const TREE_VARIATION_COUNT=7;

type Vertex = { x: number; y: number; z: number };
export type PhysicalFace = { vertices: Vertex[]; colour: string; normal: Vertex; art?: ArtRef | undefined; side?: ObjectSide | undefined; crop?: ArtFrame["content"] | undefined };
const meshes = new WeakMap<WorldObject, { frame: ArtFrame | undefined; faces: PhysicalFace[] }>();

/** Object-specific volumes on fixed local axes. No camera data enters mesh construction. */
export function fixedObjectGeometry(o: WorldObject, frame?: ArtFrame): PhysicalFace[] {
  const known = meshes.get(o); if (known && known.frame === frame) return known.faces;
  const kind = physicalKind(o), size = localSize(o), bounds = frame?.content;
  // The source canvas can have wide transparent borders. Match its own visible silhouette,
  // keeping the model footprint and south/front threshold in the original world location.
  const w = size.width * (bounds ? bounds.width / frame!.width : 1);
  const h = size.height * (bounds ? bounds.height / frame!.height : 1);
  const d = Math.min(size.depth, w * .65), faces: PhysicalFace[] = [];
  const offset = (size.depth - d) / 2;
  const horizontal = bounds ? ((bounds.x + bounds.width / 2) / frame!.width - .5) * size.width * ((o.directionalAssets?.front ?? o.metadata?.art)?.flipX ? -1 : 1) : 0;
  const yaw = ORIENTATION_YAW[o.orientation], c = Math.cos(yaw), s = Math.sin(yaw);
  const v = (x: number, y: number, z: number) => objectVertex(o, x + horizontal, y + offset, z);
  const face = (points: number[][], colour: string, normal: number[], side?: ObjectSide, art?: ArtRef) => faces.push({
    vertices: points.map(p => v(p[0]!, p[1]!, p[2]!)), colour,
    normal: { x: normal[0]! * c + normal[1]! * s, y: -normal[0]! * s + normal[1]! * c, z: normal[2]! }, side, art, crop: side === "front" ? bounds : undefined,
  });
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, colour: string, top = colour) => {
    face([[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]],colour,[0,1,0]);
    face([[x1,y0,z0],[x0,y0,z0],[x0,y0,z1],[x1,y0,z1]],darker(colour,.22),[0,-1,0]);
    face([[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],[x0,y0,z1]],darker(colour,.3),[-1,0,0]);
    face([[x1,y1,z0],[x1,y0,z0],[x1,y0,z1],[x1,y1,z1]],darker(colour,.1),[1,0,0]);
    face([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],top,[0,0,1]);
  };
  const gable = (x0: number, y0: number, x1: number, y1: number, eave: number, peak: number, wall: string, roof: string) => {
    const middle = (x0+x1)/2, slope = (peak-eave)/Math.max(1,(x1-x0)/2);
    face([[x0,y1,eave],[x1,y1,eave],[middle,y1,peak]],wall,[0,1,0]);
    face([[x1,y0,eave],[x0,y0,eave],[middle,y0,peak]],darker(wall,.22),[0,-1,0]);
    face([[x0,y0,eave],[middle,y0,peak],[middle,y1,peak],[x0,y1,eave]],darker(roof,.16),[-slope,0,1]);
    face([[middle,y0,peak],[x1,y0,eave],[x1,y1,eave],[middle,y1,peak]],roof,[slope,0,1]);
  };
  const cylinder = (x: number, y: number, radiusX: number, radiusY: number, z0: number, z1: number, colour: string, top: string) => {
    const n=12, rim=Array.from({length:n},(_,i)=>[x+Math.cos(i*Math.PI*2/n)*radiusX,y+Math.sin(i*Math.PI*2/n)*radiusY]);
    for(let i=0;i<n;i++) { const a=rim[i]!, b=rim[(i+1)%n]!, angle=(i+.5)*Math.PI*2/n;
      face([[a[0]!,a[1]!,z0],[b[0]!,b[1]!,z0],[b[0]!,b[1]!,z1],[a[0]!,a[1]!,z1]],darker(colour,(1-Math.cos(angle))*.12),[Math.cos(angle),Math.sin(angle),0]); }
    face(rim.map(p=>[p[0]!,p[1]!,z1]),top,[0,0,1]);
  };
  const key=o.metadata?.art?.key ?? o.metadata?.texture ?? o.id;
  const material=buildingMaterial(o);
  const facade = (side: ObjectSide, inset=0) => {
    const art=directionalArt(o,side); if(!art) return;
    if(side==='front') face([[-w/2,d/2+inset,0],[w/2,d/2+inset,0],[w/2,d/2+inset,h],[-w/2,d/2+inset,h]],M.plaster,[0,1,0],side,art);
    if(side==='back') face([[w/2,-d/2-inset,0],[-w/2,-d/2-inset,0],[-w/2,-d/2-inset,h],[w/2,-d/2-inset,h]],M.plaster,[0,-1,0],side,art);
    if(side==='left') face([[-w/2-inset,-d/2,0],[-w/2-inset,d/2,0],[-w/2-inset,d/2,h],[-w/2-inset,-d/2,h]],M.plaster,[-1,0,0],side,art);
    if(side==='right') face([[w/2+inset,d/2,0],[w/2+inset,-d/2,0],[w/2+inset,-d/2,h],[w/2+inset,d/2,h]],M.plaster,[1,0,0],side,art);
  };
  if(kind==='house' || kind==='major-building' || kind==='shop') {
    const modern=/modern-/.test(key), eave=h*(modern ? .88 : .67);
    box(-w/2,-d/2,0,w/2,d/2,eave,material.wall,material.roof);
    if(modern) box(-w/2-2,-d/2-2,eave,w/2+2,d/2+2,h,material.roof,material.roofLight);
    else gable(-w/2-2,-d/2-2,w/2+2,d/2+2,eave,h,material.wall,material.roof);
    // Timber framing and roof seams use the same material family as the source artwork.
    const beam=Math.max(1.2,w*.025);
    for(const x of [-w/2,w/2]) for(const y of [-d/2,d/2]) box(x-beam/2,y-beam/2,0,x+beam/2,y+beam/2,eave,M.timber);
    for(const z of [eave*.12,eave*.46,eave*.96]) {
      for(const y of [-d/2,d/2]) box(-w/2,y-beam/2,z,w/2,y+beam/2,z+beam,M.timber);
      for(const x of [-w/2,w/2]) box(x-beam/2,-d/2,z,x+beam/2,d/2,z+beam,M.timber);
    }
    // Rear service door belongs to a shop; homes have rear windows. Never borrow a house texture.
    box(-w*.1,-d/2-1,4,w*.1,-d/2,eave*.55,kind==='shop'?M.woodDark:M.window);
    for(const x of [-.32,.32]) box(w*x-w*.055,-d/2-1,eave*.5,w*x+w*.055,-d/2,eave*.72,M.glass);
    for(const side of [-1,1]) for(const y of [-.23,.23]) box(side*w/2-1,d*y-d*.06,eave*.48,side*w/2+1,d*y+d*.06,eave*.72,M.glass);
    if(kind==='shop') { // Fixed counter/awning, with a distinct service side behind it.
      box(-w*.45,d/2,h*.38,w*.45,d*.8,h*.48,M.wood,M.gold);
      box(-w*.52,d/2,h*.7,w*.52,d*.85,h*.76,material.roof,material.roofLight);
    }
    if(kind==='major-building') {
      if(/library|hall-of-fame/.test(key)) for(const side of [-1,1]) {
        box(side*w*.32-w*.09,-d*.2,0,side*w*.32+w*.09,d*.28,h*.85,M.stoneLight);
        gable(side*w*.32-w*.12,-d*.23,side*w*.32+w*.12,d*.31,h*.85,h*1.02,M.stoneLight,M.redRoof);
      }
      if(/chapel|treasury/.test(key)) { box(-w*.22,-d*.25,0,w*.22,d*.25,h*.9,M.stone); gable(-w*.24,-d*.28,w*.24,d*.28,h*.9,h*1.03,M.stone,material.roof); }
      if(/castle|strategy-lab/.test(key)) { box(-w*.68,-d*.3,0,-w*.25,d*.25,h*.4,M.stone); box(-w*.68,-d*.3,h*.4,-w*.25,d*.25,h*.45,M.window,M.glass); }
      if(/tavern|hiring-hall/.test(key)) box(-w*.4,d*.5,0,w*.4,d*.7,8,M.stoneLight);
      if(/forge|game-hall/.test(key)) box(w*.3,-d*.2,h*.68,w*.42,d*.05,h*.9,M.stoneShade);
    }
    for(const side of ['front','back','left','right'] as const) facade(side,2);
  } else if(kind==='market') {
    // Counter, open frame, striped canopy and storage crates, rather than house walls.
    for(const x of [-.43,.43]) for(const y of [-.4,.4]) box(w*x-2,d*y-2,0,w*x+2,d*y+2,h*.75,M.woodDark);
    box(-w*.45,d*.14,0,w*.45,d*.5,h*.34,M.wood,M.woodLight);
    box(-w*.4,-d*.43,0,w*.05,-d*.06,h*.23,M.woodDark,M.wood);
    gable(-w/2,-d/2,w/2,d/2,h*.73,h,M.wood, /blue/.test(key)?M.greenRoof:M.redRoof);
    for(let i=0;i<8;i++) { const x0=-w/2+i*w/8; box(x0,-d*.51,h*.73,x0+w/16,d*.51,h*.75,i%2?M.thatchLight:M.plaster); }
    for(const side of ['front','back','left','right'] as const) facade(side,2);
  } else if(kind==='sign') {
    const thickness=Math.min(d,6);
    for(const x of [-.38,.38]) box(w*x-2,-thickness/2,0,w*x+2,thickness/2,h*.8,M.woodDark);
    // The original sign face is mounted only on the front. The rear has timber braces.
    box(-w/2,-thickness/2,h*.22,w/2,thickness/2,h,M.woodDark,M.gold);
    box(-w*.45,-thickness/2-1,h*.35,w*.45,-thickness/2,h*.4,M.wood);
    box(-w*.45,-thickness/2-1,h*.76,w*.45,-thickness/2,h*.81,M.wood);
    const art=directionalArt(o,'front'); if(art) face([[-w/2,thickness/2+1,0],[w/2,thickness/2+1,0],[w/2,thickness/2+1,h],[-w/2,thickness/2+1,h]],M.wood,[0,1,0],'front',art);
    for(const side of ['back','left','right'] as const) facade(side,1);
  } else if(kind==='tower') {
    const eave=h*.82;
    for(const x of [-.28,.28]) for(const y of [-.3,.3]) box(w*x-3,d*y-3,0,w*x+3,d*y+3,eave,M.woodDark);
    box(-w*.38,-d*.42,h*.57,w*.38,d*.42,h*.62,M.wood,M.woodLight);
    box(-w*.36,-d*.4,h*.64,w*.36,d*.4,h*.72,M.woodDark);
    gable(-w/2,-d/2,w/2,d/2,eave,h,M.wood,material.roof);
    // Ladder remains on the tower's south face.
    for(let z=5;z<h*.6;z+=9) box(-w*.14,d*.42,z,w*.14,d*.45,z+2,M.woodLight);
    for(const side of ['front','back','left','right'] as const) facade(side,1);
  } else if(kind==='tent') {
    face([[-w/2,d/2,0],[w/2,d/2,0],[0,d/2,h]],M.greenRoof,[0,1,0]);
    face([[w/2,-d/2,0],[-w/2,-d/2,0],[0,-d/2,h]],M.crestDark,[0,-1,0]);
    face([[-w/2,-d/2,0],[0,-d/2,h],[0,d/2,h],[-w/2,d/2,0]],M.greenRoof,[-h/(w/2),0,1]);
    face([[0,-d/2,h],[w/2,-d/2,0],[w/2,d/2,0],[0,d/2,h]],M.crest,[h/(w/2),0,1]);
    face([[-w*.17,d/2+1,0],[w*.17,d/2+1,0],[0,d/2+1,h*.64]],M.woodDark,[0,1,0]);
    for(const side of ['front','back','left','right'] as const) facade(side,1);
  } else if(kind==='tree' || kind==='shrub') {
    // Vegetation is radially irregular rather than a building facade. Two fixed,
    // double-sided planes use its own pixel foliage, with a crown surface for high
    // camera tilts. Their local axes never follow camera yaw (no billboarding).
    const seed=[...o.id].reduce((n,char)=>(n*31+char.charCodeAt(0))>>>0,0);
    const source=directionalArt(o,'front');
    const art:ArtRef=kind==='tree'
      ? {key:'resources-trees-tree',frame:typeof source?.frame==='number' ? source.frame%4 : seed%2}
      : source ?? {key:o.metadata?.texture ?? 'bush-1',frame:0};
    const turn=((seed%7)-3)*Math.PI/90, ca=Math.cos(turn),sa=Math.sin(turn);
    const plane=(x:number,y:number,z:number)=>[x*ca-y*sa,y*ca+x*sa,z];
    const normal=(x:number,y:number,z:number)=>[x*ca-y*sa,y*ca+x*sa,z];
    face([plane(-w/2,0,0),plane(w/2,0,0),plane(w/2,0,h),plane(-w/2,0,h)],M.crest,normal(0,1,0),'front',art);
    face([plane(w/2,0,0),plane(-w/2,0,0),plane(-w/2,0,h),plane(w/2,0,h)],M.crest,normal(0,-1,0),'back',art);
    face([plane(0,w/2,0),plane(0,-w/2,0),plane(0,-w/2,h),plane(0,w/2,h)],M.crest,normal(1,0,0),'right',art);
    face([plane(0,-w/2,0),plane(0,w/2,0),plane(0,w/2,h),plane(0,-w/2,h)],M.crest,normal(-1,0,0),'left',art);
    for(const f of faces) f.crop=bounds;
    // Only foliage goes on the horizontal crown: the source trunk stays vertical.
    const crown=w*.44;
    face([plane(-crown,crown,h*.72),plane(crown,crown,h*.72),plane(crown,-crown,h*.72),plane(-crown,-crown,h*.72)],M.crest,[0,0,1],undefined,art);
    faces[faces.length-1]!.crop={x:bounds?.x??0,y:bounds?.y??0,width:bounds?.width??frame?.width??192,height:Math.max(1,Math.round((bounds?.height??frame?.height??192)*.64))};
  } else if(kind==='bench') {
    box(-w/2,-d/2,h*.34,w/2,d/2,h*.44,M.wood,M.woodLight);
    box(-w/2,-d/2,h*.44,w/2,-d*.32,h,M.wood,M.woodLight);
    for(const x of [-.36,.36]) for(const y of [-.3,.3]) box(w*x-2,d*y-2,0,w*x+2,d*y+2,h*.34,M.woodDark);
  } else if(kind==='flag' || kind==='lamp' || kind==='fire') {
    box(-2,-2,0,2,2,h,M.woodDark,M.gold);
    if(kind==='flag') {
      // Both faces of cloth are physically the same flag, not borrowed directional art.
      const art=directionalArt(o,'front');
      face([[0,0,h*.45],[w*.48,0,h*.55],[w*.48,0,h],[0,0,h]],M.crest,[0,1,0],'front',art);
      face([[w*.48,-1,h*.55],[0,-1,h*.45],[0,-1,h],[w*.48,-1,h]],M.crestDark,[0,-1,0]);
    } else if(kind==='lamp') { box(-w*.35,-d*.35,h*.65,w*.35,d*.35,h*.92,M.glow,M.stoneShade); }
    else cylinder(0,0,w*.35,d*.35,h*.7,h,M.glow,M.goldLight);
  } else if(kind==='fountain') {
    cylinder(0,0,w*.48,d*.48,0,h*.2,M.stone,M.glass);
    cylinder(0,0,w*.43,d*.43,h*.2,h*.22,M.stoneLight,'#75bed5');
    cylinder(0,0,w*.06,d*.08,h*.2,h*.88,M.stoneLight,M.glass);
    cylinder(0,0,w*.23,d*.23,h*.55,h*.62,M.stone,'#a8d6d6');
    cylinder(0,0,w*.1,d*.1,h*.82,h,M.stoneLight,M.glass);
  } else if(kind==='launch-pad') {
    cylinder(0,0,w*.48,d*.48,0,h*.12,M.stoneShade,M.stoneLight);
    cylinder(0,0,w*.11,d*.13,h*.12,h*.76,M.plaster,M.goldLight);
    gable(-w*.12,-d*.14,w*.12,d*.14,h*.76,h,M.plaster,M.redRoof);
    for(const side of [-1,1]) box(side*w*.12-4,-d*.1,h*.1,side*w*.12+4,d*.1,h*.32,M.redRoof);
    box(w*.22,-d*.24,0,w*.26,d*.24,h*.72,M.stoneShade,M.stone);
    for(const side of ['front','back','left','right'] as const) facade(side,1);
  } else if(kind==='fence') {
    for(const z of [h*.3,h*.7]) box(-w/2,-2,z,w/2,2,z+3,M.wood);
    for(let x=-w/2;x<=w/2;x+=Math.max(16,w/6)) box(x-2,-3,0,x+2,3,h,M.woodDark);
  } else if(kind==='chest') {
    box(-w/2,-d/2,0,w/2,d/2,h*.75,M.woodDark,M.wood);
    gable(-w/2,-d/2,w/2,d/2,h*.75,h,M.wood,M.woodLight);
    for(const side of ['front','back','left','right'] as const) facade(side,1);
  } else if(kind==='table') {
    for(const x of [-.35,.35]) for(const y of [-.35,.35]) box(w*x-2,d*y-2,0,w*x+2,d*y+2,h*.8,M.woodDark);
    box(-w/2,-d/2,h*.8,w/2,d/2,h,M.wood,M.woodLight);
  } else if(kind==='statue' || kind==='animal') {
    const colour=kind==='animal'?M.plaster:M.gold;
    box(-w*.3,-d*.3,0,w*.3,d*.3,h*.15,M.stoneShade,M.stone);
    box(-w*.18,-d*.18,h*.15,w*.18,d*.18,h*.7,colour);
    cylinder(0,0,w*.22,d*.22,h*.7,h,colour,M.thatchLight);
    for(const side of ['front','back','left','right'] as const) facade(side,1);
  } else if(kind==='rock' || kind==='mountain') {
    const colour=kind==='mountain'?M.stone:/gold|coins/.test(key)?M.gold:M.wood;
    for(let i=0;i<8;i++) { const a=i*Math.PI/4,b=(i+1)*Math.PI/4;
      face([[Math.cos(a)*w/2,Math.sin(a)*d/2,0],[Math.cos(b)*w/2,Math.sin(b)*d/2,0],[0,0,h]],darker(colour,i%3*.12),[Math.cos((a+b)/2),Math.sin((a+b)/2),.5]); }
  } else if (/stump/.test(key)) {
    cylinder(0,0,w*.43,d*.43,0,h*.85,M.woodDark,M.woodLight);
    cylinder(0,0,w*.29,d*.29,h*.85,h,M.wood,M.woodLight);
  } else if (/dummy/.test(key)) {
    box(-w*.3,-d*.3,0,w*.3,d*.3,h*.08,M.woodDark);
    box(-2,-2,h*.08,2,2,h*.68,M.wood);
    box(-w*.42,-2,h*.55,w*.42,2,h*.61,M.woodDark);
    cylinder(0,0,w*.2,d*.24,h*.5,h*.8,M.thatchLight,M.woodLight);
    cylinder(0,0,w*.12,d*.15,h*.8,h,M.thatchLight,M.woodLight);
  } else {
    // Unknown decorative silhouettes keep their own fixed front art on a neutral support.
    // They are reported for bespoke geometry, never replaced with a house/shop asset.
    box(-w/2,-Math.min(d/2,3),0,w/2,Math.min(d/2,3),h,M.woodDark,M.wood);
    for(const side of ['front','back','left','right'] as const) facade(side,1);
  }
  // Explicit directional artwork wins on its own face for every physical category.
  // Tree sprites supplied by the forest are source silhouettes, not directional sets.
  for (const side of ['front','back','left','right'] as const) {
    if (kind!=='tree' && kind!=='shrub' && o.directionalAssets?.[side] && !faces.some(f=>f.side===side && f.art)) facade(side,1);
  }
  meshes.set(o,{frame,faces}); return faces;
}

export function projectedObjectFaces(view: Projection, o: WorldObject, frame?: ArtFrame) {
  const angle=cameraAngle(view), vector={x:Math.sin(angle.yaw)*Math.cos(angle.tilt),y:Math.cos(angle.yaw)*Math.cos(angle.tilt),z:Math.sin(angle.tilt)};
  const c=Math.cos(angle.yaw),s=Math.sin(angle.yaw),st=Math.sin(angle.tilt),ct=Math.cos(angle.tilt);
  const depthScale=view==='isometric'?Math.SQRT2:1;
  const transform=(p:Vertex)=>{ const along=p.x*s+p.y*c;return {x:p.x*c-p.y*s,y:along*st-p.z*ct,depth:along*depthScale}; };
  return fixedObjectGeometry(o,frame).filter(f=>f.normal.x*vector.x+f.normal.y*vector.y+f.normal.z*vector.z>1e-6).map(face=>{
    const points=face.vertices.map(transform);
    return { face, points, depth:points.reduce((sum,p)=>sum+p.depth,0)/points.length+(face.art ? .001 : 0) };
  }).sort((a,b)=>a.depth-b.depth);
}

