import { worldPerformance } from "../../../lib/world/render-performance";
import type { WorldObject } from "../../../lib/world/model";
import { ORIENTATION_YAW } from "../../../lib/world/object-appearance";
import { cameraAngle, type Projection } from "../../../lib/world/projection";
import { SOLID_MATERIALS, TREE_KINDS, solidMesh, type SolidKind, type SolidMesh } from "../../../lib/world/solid-models";
import { buildSolidAtlas, type SolidAtlas } from "./solid-materials";
import type { ProjectedLayer, ProjectionCamera } from "./projected-art";

/**
 * Draws the solid prototypes (lib/world/solid-models.ts) with WebGL2 into one offscreen canvas, and
 * hands each to the 2D world as an ordinary painter layer, so agents and scenery still pass in front
 * of and behind it. The projection is project()'s own orthographic basis, so a solid sits exactly
 * where the 2D world expects. Meshes are uploaded once; the camera is only uniforms: turning it
 * never rebuilds geometry. Pixel look: nearest texel fetches, no antialiasing, a few light steps.
 */

/** Where the light comes from: the south-west and high, as the village's artwork is lit. */
const LIGHT = (() => { const v = [-0.55, 0.62, 0.9], l = Math.hypot(...v); return v.map((x) => x / l) as [number, number, number]; })();
/** Clip depth spans this many world units either side of the ground's centre. */
const DEPTH_RANGE = 40000;

const VERTEX = `#version 300 es
layout(location=0) in vec3 a_pos; layout(location=1) in vec3 a_nrm; layout(location=2) in vec2 a_uv; layout(location=3) in float a_mat;
uniform vec4 u_place;   // world x, y, elevation, orientation yaw
uniform vec4 u_cam;     // camera yaw, tilt, centre x, centre y (projected units)
uniform vec4 u_screen;  // scale, width, height (CSS px), depth range
uniform vec4 u_slot;    // where this instance's box lands in the atlas: shift x, y (device px), atlas width, height
uniform float u_ratio;  // device pixels per CSS pixel
uniform vec3 u_light;
uniform float u_shadow;
out vec2 v_uv; flat out int v_mat; out float v_lit;
void main() {
  float c = cos(u_place.w), s = sin(u_place.w);
  vec3 p = vec3(u_place.x + a_pos.x * c + a_pos.y * s, u_place.y - a_pos.x * s + a_pos.y * c, u_place.z + a_pos.z);
  vec3 n = vec3(a_nrm.x * c + a_nrm.y * s, -a_nrm.x * s + a_nrm.y * c, a_nrm.z);
  // The shadow pass lays every vertex on the ground along the light.
  if (u_shadow > 0.5) { p.xy -= u_light.xy / u_light.z * (p.z - u_place.z); p.z = u_place.z + 0.2; }
  float cy = cos(u_cam.x), sy = sin(u_cam.x), st = sin(u_cam.y), ct = cos(u_cam.y);
  float along = p.x * sy + p.y * cy;
  vec2 q = vec2(p.x * cy - p.y * sy, along * st - p.z * ct);
  vec2 screen = (q - u_cam.zw) * u_screen.x;
  float toward = along * ct + p.z * st;
  vec2 device = (screen + u_screen.yz * 0.5) * u_ratio + u_slot.xy;
  gl_Position = vec4(device.x / u_slot.z * 2.0 - 1.0, 1.0 - device.y / u_slot.w * 2.0, -toward / u_screen.w, 1.0);
  v_uv = a_uv; v_mat = int(a_mat + 0.5);
  // Four steps of light, so faces read as flat pixel-art planes, not smooth shading.
  float lit = 0.72 + 0.34 * max(dot(n, u_light), 0.0) + (n.z > 0.5 ? 0.04 : 0.0);
  v_lit = floor(lit * 8.0 + 0.5) / 8.0;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
uniform highp sampler2D u_atlas;
uniform vec4 u_rect[${SOLID_MATERIALS.length}];
uniform float u_mode[${SOLID_MATERIALS.length}];
uniform float u_shadow;
in vec2 v_uv; flat in int v_mat; in float v_lit;
out vec4 colour;
void main() {
  vec4 r = u_rect[v_mat];
  vec2 t;
  if (u_mode[v_mat] > 0.5) t = clamp(v_uv * r.zw, vec2(0.0), r.zw - 0.001);
  else { vec2 m = mod(v_uv, 2.0 * r.zw); t = mix(m, 2.0 * r.zw - m - 0.001, step(r.zw, m)); }
  vec4 texel = texelFetch(u_atlas, ivec2(r.xy + floor(t)), 0);
  if (texel.a < 0.5) discard;
  colour = u_shadow > 0.5 ? vec4(0.0, 0.0, 0.0, 0.3) : vec4(texel.rgb * v_lit, 1.0);
}`;

type Uploaded = { vao: WebGLVertexArrayObject; count: number };
type Uniforms = Record<"place" | "cam" | "screen" | "slot" | "ratio" | "light" | "shadow" | "atlas" | "rect" | "mode", WebGLUniformLocation | null>;

class SolidRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private u: Uniforms;
  private meshes = new Map<string, Uploaded>();
  private atlas: SolidAtlas | null = null;
  private atlasTexture: WebGLTexture | null = null;
  /** Bumped when the atlas arrives, so the world bakes again with solids in place of pictures. */
  revision = 0;

  constructor(readonly canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.gl = gl;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "program");
    this.program = program;
    const at = (n: string) => gl.getUniformLocation(program, n);
    this.u = { place: at("u_place"), cam: at("u_cam"), screen: at("u_screen"), slot: at("u_slot"), ratio: at("u_ratio"), light: at("u_light"), shadow: at("u_shadow"), atlas: at("u_atlas"), rect: at("u_rect"), mode: at("u_mode") };
    buildSolidAtlas().then((atlas) => {
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
      this.atlas = atlas; this.atlasTexture = texture; this.revision++;
    }).catch(() => { /* Pictures stay in place without the atlas. */ });
  }

  get ready() { return this.atlas !== null; }

  private upload(mesh: SolidMesh): Uploaded {
    let known = this.meshes.get(mesh.key);
    if (known) return known;
    const gl = this.gl, vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const n = mesh.positions.length / 3, data = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      data.set(mesh.positions.subarray(i * 3, i * 3 + 3), i * 9); data.set(mesh.normals.subarray(i * 3, i * 3 + 3), i * 9 + 3);
      data.set(mesh.uvs.subarray(i * 2, i * 2 + 2), i * 9 + 6); data[i * 9 + 8] = mesh.materials[i]!;
    }
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (const [loc, size, offset] of [[0, 3, 0], [1, 3, 3], [2, 2, 6], [3, 1, 8]] as const) {
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 36, offset * 4);
    }
    gl.bindVertexArray(null);
    known = { vao, count: n }; this.meshes.set(mesh.key, known);
    worldPerformance.count("solidUploads");
    return known;
  }

  /** Each round's pixels, copied off the GPU once per camera change; every layer draws from its slot. */
  private caches: HTMLCanvasElement[] = [];

  /**
   * Renders every structure in `batch` at this camera, each alone in its own slot of an offscreen
   * atlas, and copies the atlas into a 2D cache once: one GPU read per camera change however many
   * structures (another only if they overflow 4096 pixels), none while the camera is still. A slot
   * holds one structure only, so its layer never carries a neighbour's pixels.
   */
  flush(batch: Pending[], ratio: number, camera: ProjectionCamera, width: number, height: number, caches = this.caches) {
    const atlas = this.atlas; if (!atlas) return;
    const started = worldPerformance.start(), gl = this.gl;
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    const LIMIT = Math.min(4096, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), viewport[0]!, viewport[1]!);
    // A screen-filling structure must fit too, including the gutter. On very large or high-DPI
    // screens render at a lower resolution and scale back when blitting, rather than dropping it.
    // Reserve a second pixel for floating-point rounding before ceil() adds the gutter.
    const renderRatio = Math.min(ratio, (LIMIT - 2) / width, (LIMIT - 2) / height);
    for (const p of batch) { p.done = true; p.box = screenBox(p.bounds, camera, width, height); }
    let queue = batch.filter((p) => p.box), round = 0;
    while (queue.length) {
      // Shelf-pack this round's boxes, device pixels, a pixel apart.
      const across = Math.min(LIMIT, Math.max(256, Math.ceil(width * renderRatio) + 1));
      let x = 0, y = 0, shelf = 0; const placed: Pending[] = [], later: Pending[] = [];
      for (const p of queue) {
        const w = Math.ceil((p.box!.x1 - p.box!.x0) * renderRatio) + 1, h = Math.ceil((p.box!.y1 - p.box!.y0) * renderRatio) + 1;
        if (x + w > across) { x = 0; y += shelf; shelf = 0; }
        if (w > across || y + h > LIMIT) { later.push(p); continue; }
        p.slot = { x, y, w: w - 1, h: h - 1, cache: round, ratio: renderRatio }; x += w; shelf = Math.max(shelf, h); placed.push(p);
      }
      if (!placed.length) break;
      const aw = across, ah = Math.max(1, y + shelf);
      if (this.canvas.width !== aw || this.canvas.height < ah) { this.canvas.width = aw; this.canvas.height = Math.min(LIMIT, Math.ceil(ah / 256) * 256); }
      const ch = this.canvas.height;
      gl.viewport(0, 0, aw, ch); gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.program);
      gl.uniform4f(this.u.screen, camera.scale, width, height, DEPTH_RANGE); gl.uniform1f(this.u.ratio, renderRatio);
      gl.uniform3f(this.u.light, ...LIGHT);
      gl.uniform4fv(this.u.rect, atlas.rects); gl.uniform1fv(this.u.mode, atlas.modes);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture); gl.uniform1i(this.u.atlas, 0);
      gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.enable(gl.SCISSOR_TEST);
      for (const p of placed) {
        const box = p.box!, slot = p.slot!, angle = cameraAngle(p.view), uploaded = this.upload(p.mesh);
        gl.scissor(slot.x, ch - slot.y - slot.h, slot.w, slot.h);
        gl.uniform4f(this.u.slot, slot.x - box.x0 * renderRatio, slot.y - box.y0 * renderRatio, aw, ch);
        gl.uniform4f(this.u.place, p.origin.x, p.origin.y, p.o.elevation, ORIENTATION_YAW[p.o.orientation]);
        gl.uniform4f(this.u.cam, angle.yaw, angle.tilt, camera.x, camera.y);
        gl.bindVertexArray(uploaded.vao);
        // The shadow first, flat, written once per pixel however its triangles overlap; then the
        // structure, depth tested against itself.
        gl.disable(gl.DEPTH_TEST); gl.uniform1f(this.u.shadow, 1); gl.drawArrays(gl.TRIANGLES, 0, uploaded.count);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.uniform1f(this.u.shadow, 0); gl.drawArrays(gl.TRIANGLES, 0, uploaded.count);
        worldPerformance.count("solidDraws", 2);
      }
      gl.bindVertexArray(null); gl.disable(gl.SCISSOR_TEST);
      const cache = caches[round] ??= document.createElement("canvas");
      if (cache.width !== aw || cache.height < ah) { cache.width = aw; cache.height = ch; }
      const g = cache.getContext("2d")!;
      g.clearRect(0, 0, aw, ah); g.drawImage(this.canvas, 0, 0, aw, ah, 0, 0, aw, ah);
      worldPerformance.count("solidReads");
      queue = later; round++;
    }
    worldPerformance.endStage("solid", started);
  }

  /** One structure's slot, from its cache onto the 2D target at its screen box. */
  blit(ctx: CanvasRenderingContext2D, p: Pending, ratio: number) {
    const box = p.box, slot = p.slot; if (!box || !slot) return;
    const cache = this.caches[slot.cache]; if (!cache) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cache, slot.x, slot.y, slot.w, slot.h, box.x0 * ratio, box.y0 * ratio, slot.w * ratio / slot.ratio, slot.h * ratio / slot.ratio);
    ctx.restore();
  }
}

/** A structure waiting in this camera change's batch. */
type Pending = { o: WorldObject; mesh: SolidMesh; origin: { x: number; y: number }; view: Projection; bounds: Box; done: boolean; box?: Box | null;
  depth: number;
  slot?: { x: number; y: number; w: number; h: number; cache: number; ratio: number } };
const screenBox = (b: Box, camera: ProjectionCamera, width: number, height: number): Box | null => {
  const x0 = Math.max(0, Math.floor(width / 2 + (b.x0 - camera.x) * camera.scale)), y0 = Math.max(0, Math.floor(height / 2 + (b.y0 - camera.y) * camera.scale));
  const x1 = Math.min(width, Math.ceil(width / 2 + (b.x1 - camera.x) * camera.scale)), y1 = Math.min(height, Math.ceil(height / 2 + (b.y1 - camera.y) * camera.scale));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
};
/** Structures made into layers since the last flush: the layers of the bake under way. */
let batch: Pending[] = [];

type Box = { x0: number; y0: number; x1: number; y1: number };

let shared: SolidRenderer | null | undefined;
/** The one renderer, or null where WebGL2 is unavailable (the pictures then stay). */
function renderer(): SolidRenderer | null {
  if (shared !== undefined) return shared;
  if (typeof document === "undefined") return (shared = null);
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: false });
    if (!gl) return (shared = null);
    shared = new SolidRenderer(canvas, gl);
  } catch { shared = null; }
  return shared;
}

/** Changes when solids become drawable, so a camera that baked pictures bakes again. */
export const solidRevision = () => renderer()?.revision ?? 0;

/**
 * A solid prototype as a painter layer at this camera, or null to keep its picture. Its origin is
 * its picture's foot, moved back so the structure's front stands on the picture's front line.
 */
function pendingFor(view: Projection, o: WorldObject, centred = false): Pending {
  const mesh = solidMesh(o.solid!, o.solidVariant), foot = o.metadata?.topAnchor ?? { x: o.x, y: o.y + o.depth / 2 };
  const yaw = ORIENTATION_YAW[o.orientation], c = Math.cos(yaw), s = Math.sin(yaw);
  const origin = centred ? foot : { x: foot.x - mesh.max[1] * s, y: foot.y - mesh.max[1] * c };
  const angle = cameraAngle(view), cy = Math.cos(angle.yaw), sy = Math.sin(angle.yaw), st = Math.sin(angle.tilt), ct = Math.cos(angle.tilt);
  // The box's corners, and where each falls in shadow, in projected world units.
  let depth = -Infinity, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const lx of [mesh.min[0], mesh.max[0]]) for (const ly of [mesh.min[1], mesh.max[1]]) for (const lz of [mesh.min[2], mesh.max[2]]) {
    const wx = origin.x + lx * c + ly * s, wy = origin.y - lx * s + ly * c;
    for (const [px, py, pz] of [[wx, wy, o.elevation + lz], [wx - LIGHT[0] / LIGHT[2] * lz, wy - LIGHT[1] / LIGHT[2] * lz, o.elevation]] as const) {
      const along = px * sy + py * cy, qx = px * cy - py * sy, qy = along * st - pz * ct;
      x0 = Math.min(x0, qx); x1 = Math.max(x1, qx); y0 = Math.min(y0, qy); y1 = Math.max(y1, qy);
    }
    depth = Math.max(depth, wx * sy + wy * cy);
  }
  const bounds = { x0: x0 - 2, y0: y0 - 2, x1: x1 + 2, y1: y1 + 2 };
  return { o, mesh, origin, view, bounds, done: false, depth };
}

export function solidLayer(ctx: CanvasRenderingContext2D, view: Projection, o: WorldObject): ProjectedLayer | null {
  if (!o.solid) return null;
  const r = renderer();
  if (!r?.ready) return null;
  const pending = pendingFor(view, o);
  // A layer made after the last flush starts the next bake's batch.
  if (batch.some((p) => p.done)) batch = [];
  const mine = batch;
  mine.push(pending);
  const drawScreen = (camera: ProjectionCamera, width: number, height: number) => {
    const ratio = ctx.getTransform().a || 1;
    if (!pending.done) r.flush(mine, ratio, camera, width, height);
    r.blit(ctx, pending, ratio);
  };
  return { depth: pending.depth * (view === "isometric" ? Math.SQRT2 : 1), bounds: pending.bounds, drawScreen, draw: () => {} };
}

type TreeRaster = { canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number; depth: number };
const vegetationCaches: HTMLCanvasElement[] = [];
const treeRasters = new Map<SolidKind, TreeRaster>();
let treePose = '';

/** Eight shared model renders per pose: seven trees and one shrub, regardless of forest size.
 * The pixels are a cache of fixed 3D geometry at this exact yaw/tilt, not camera-facing sprites.
 * Separate atlas pages keep tree refreshes from overwriting the buildings' painter caches.
 */
export function solidVegetationLayer(ctx: CanvasRenderingContext2D, view: Projection, o: WorldObject): ProjectedLayer | null {
  if (!o.solid || (!o.solid.startsWith('tree') && o.solid !== 'shrub')) return null;
  const r = renderer(); if (!r?.ready) return null;
  const angle = cameraAngle(view), pose = `${angle.yaw}:${angle.tilt}`;
  if (pose !== treePose) {
    const pending = [...TREE_KINDS, 'shrub' as const].map(kind => pendingFor(view, {
      id: `template:${kind}`, type: 'tree', category: 'vegetation', orientation: 'south',
      x: 0, y: 0, elevation: 0, width: 192, depth: 96, height: 192, solid: kind, metadata: { topAnchor: { x: 0, y: 0 } },
    }, true));
    const camera = { x: 0, y: -70, scale: 1 }, extent = 512;
    r.flush(pending, 1, camera, extent, extent, vegetationCaches);
    for (const p of pending) {
      const slot = p.slot!, box = p.box!, kind = p.o.solid!;
      const canvas = treeRasters.get(kind)?.canvas ?? document.createElement('canvas');
      // Bounded, retained canvases; changing the pose never accumulates cached camera angles.
      const wide = Math.ceil(slot.w / 32) * 32, high = Math.ceil(slot.h / 32) * 32;
      if (canvas.width < wide || canvas.height < high || canvas.width > wide * 2 || canvas.height > high * 2) {
        canvas.width = wide; canvas.height = high;
      }
      const g = canvas.getContext('2d')!; g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(vegetationCaches[slot.cache]!, slot.x, slot.y, slot.w, slot.h, 0, 0, slot.w, slot.h);
      treeRasters.set(kind, { canvas, x: camera.x + box.x0 - extent / 2, y: camera.y + box.y0 - extent / 2,
        width: slot.w, height: slot.h, depth: p.depth });
    }
    treePose = pose;
    worldPerformance.count('treeTemplateRenders', pending.length);
  }
  const image = treeRasters.get(o.solid)!;
  const factor = o.width / (o.solid === 'shrub' && !o.id.startsWith('forest:') ? 64 : 192);
  const foot = o.metadata?.topAnchor ?? o;
  const along = foot.x * Math.sin(angle.yaw) + foot.y * Math.cos(angle.yaw);
  const x = foot.x * Math.cos(angle.yaw) - foot.y * Math.sin(angle.yaw);
  const y = along * Math.sin(angle.tilt) - o.elevation * Math.cos(angle.tilt);
  const bounds = { x0: x + image.x * factor, y0: y + image.y * factor,
    x1: x + (image.x + image.width) * factor, y1: y + (image.y + image.height) * factor };
  worldPerformance.count('treeInstances');
  const draw = () => ctx.drawImage(image.canvas, 0, 0, image.width, image.height, bounds.x0, bounds.y0, image.width * factor, image.height * factor);
  return { depth: (along + image.depth * factor) * (view === 'isometric' ? Math.SQRT2 : 1), bounds, draw,
    drawScreen: (camera, width, height) => ctx.drawImage(image.canvas, 0, 0, image.width, image.height,
      width / 2 + (bounds.x0 - camera.x) * camera.scale, height / 2 + (bounds.y0 - camera.y) * camera.scale,
      image.width * factor * camera.scale, image.height * factor * camera.scale) };
}
