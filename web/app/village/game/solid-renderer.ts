import { worldPerformance } from "../../../lib/world/render-performance";
import type { WorldObject } from "../../../lib/world/model";
import { ORIENTATION_YAW } from "../../../lib/world/object-appearance";
import { cameraAngle, type Projection } from "../../../lib/world/projection";
import { SOLID_MATERIALS, solidMesh, type SolidKind, type SolidMesh } from "../../../lib/world/solid-models";
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
  gl_Position = vec4(screen.x / (u_screen.y * 0.5), -screen.y / (u_screen.z * 0.5), -toward / u_screen.w, 1.0);
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
type Uniforms = Record<"place" | "cam" | "screen" | "light" | "shadow" | "atlas" | "rect" | "mode", WebGLUniformLocation | null>;

class SolidRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private u: Uniforms;
  private meshes = new Map<SolidKind, Uploaded>();
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
    this.u = { place: at("u_place"), cam: at("u_cam"), screen: at("u_screen"), light: at("u_light"), shadow: at("u_shadow"), atlas: at("u_atlas"), rect: at("u_rect"), mode: at("u_mode") };
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
    let known = this.meshes.get(mesh.kind);
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
    known = { vao, count: n }; this.meshes.set(mesh.kind, known);
    worldPerformance.count("solidUploads");
    return known;
  }

  /** The batch's pixels, copied off the GPU once per camera change; every layer draws from here. */
  private cache = document.createElement("canvas");

  /**
   * Renders every structure in `batch` at this camera in one pass, each into its own screen box,
   * and copies the whole canvas into the 2D cache once: one GPU read per camera change, however
   * many structures, and none at all while the camera is still.
   */
  flush(batch: Pending[], ratio: number, camera: ProjectionCamera, width: number, height: number) {
    const atlas = this.atlas; if (!atlas) return;
    const started = worldPerformance.start(), gl = this.gl;
    const pw = Math.max(1, Math.round(width * ratio)), ph = Math.max(1, Math.round(height * ratio));
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    if (this.cache.width !== pw || this.cache.height !== ph) { this.cache.width = pw; this.cache.height = ph; }
    gl.viewport(0, 0, pw, ph); gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform4f(this.u.screen, camera.scale, width, height, DEPTH_RANGE);
    gl.uniform3f(this.u.light, ...LIGHT);
    gl.uniform4fv(this.u.rect, atlas.rects); gl.uniform1fv(this.u.mode, atlas.modes);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture); gl.uniform1i(this.u.atlas, 0);
    gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.enable(gl.SCISSOR_TEST);
    for (const p of batch) {
      p.done = true;
      const box = screenBox(p.bounds, camera, width, height);
      p.box = box;
      if (!box) continue;
      const angle = cameraAngle(p.view), uploaded = this.upload(p.mesh);
      gl.scissor(Math.floor(box.x0 * ratio), Math.floor(ph - box.y1 * ratio), Math.ceil((box.x1 - box.x0) * ratio), Math.ceil((box.y1 - box.y0) * ratio));
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
    const g = this.cache.getContext("2d")!;
    g.clearRect(0, 0, pw, ph); g.drawImage(this.canvas, 0, 0);
    worldPerformance.count("solidReads");
    worldPerformance.endStage("solid", started);
  }

  /** One structure's box, from the cache onto the 2D target. */
  blit(ctx: CanvasRenderingContext2D, p: Pending, ratio: number) {
    const box = p.box; if (!box) return;
    const sx = Math.floor(box.x0 * ratio), sy = Math.floor(box.y0 * ratio), sw = Math.ceil((box.x1 - box.x0) * ratio), sh = Math.ceil((box.y1 - box.y0) * ratio);
    if (sw <= 0 || sh <= 0) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(this.cache, sx, sy, sw, sh, sx, sy, sw, sh); ctx.restore();
  }
}

/** A structure waiting in this camera change's batch. */
type Pending = { o: WorldObject; mesh: SolidMesh; origin: { x: number; y: number }; view: Projection; bounds: Box; done: boolean; box?: Box | null };
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
export function solidLayer(ctx: CanvasRenderingContext2D, view: Projection, o: WorldObject): ProjectedLayer | null {
  if (!o.solid) return null;
  const r = renderer();
  if (!r?.ready) return null;
  const mesh = solidMesh(o.solid), foot = o.metadata?.topAnchor ?? { x: o.x, y: o.y + o.depth / 2 };
  const yaw = ORIENTATION_YAW[o.orientation], c = Math.cos(yaw), s = Math.sin(yaw);
  const origin = { x: foot.x - mesh.max[1] * s, y: foot.y - mesh.max[1] * c };
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
  // A layer made after the last flush starts the next bake's batch.
  if (batch.some((p) => p.done)) batch = [];
  const pending: Pending = { o, mesh, origin, view, bounds, done: false }, mine = batch;
  mine.push(pending);
  const drawScreen = (camera: ProjectionCamera, width: number, height: number) => {
    const ratio = ctx.getTransform().a || 1;
    if (!pending.done) r.flush(mine, ratio, camera, width, height);
    r.blit(ctx, pending, ratio);
  };
  return { depth: depth * (view === "isometric" ? Math.SQRT2 : 1), bounds, drawScreen, draw: () => {} };
}
