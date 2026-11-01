import type { AuthoritativeModelState, ModelRuntime, ModelRuntimeState, ModelSelectionSource, ModelSemanticAction } from "./model-contract.js";
import { applyPermittedTransform, validateAuthoritativeModelState, type ModelManifest } from "@medical-device/model-runtime";

type GlbNode = { name?: string; mesh?: number; extras?: { componentId?: string } };
type GlbPrimitive = { attributes?: { POSITION?: number }; indices?: number };
type GlbDocument = {
  nodes?: GlbNode[];
  meshes?: Array<{ primitives?: GlbPrimitive[] }>;
  accessors?: Array<{ bufferView?: number; byteOffset?: number; componentType?: number; count?: number; type?: string }>;
  bufferViews?: Array<{ byteOffset?: number; byteLength?: number; byteStride?: number }>;
};
type Vec3 = [number, number, number];
type Mat4 = Float32Array;
type ComponentGeometry = { componentId: string; positions: Float32Array; indices: Uint16Array | Uint32Array; indexType: number; color: Vec3; vao?: WebGLVertexArrayObject; positionBuffer?: WebGLBuffer; indexBuffer?: WebGLBuffer };
type BrowserManifest = {
  sourceHash: string;
  modelVersionId: string;
  releaseBindingId: string;
  normalizationStatus: string;
  unitSystem: string;
  upAxis: string;
  handedness: string;
  origin: string;
  forwardAxis: string;
  schemaVersion: string;
  format: string;
  scaleMeters: number;
  sceneNodeCount: number;
  meshCount: number;
  materialCount: number;
  triangleCount: number;
  textureCount: number;
  materials: unknown[];
  textures: unknown[];
  components: Array<{
    componentId: string;
    interactionCapabilities?: unknown;
    permittedTransforms?: {
      rotationY?: { min: number; max: number; step: number; snap?: number };
      translationX?: { min: number; max: number; step: number; snap?: number };
    };
  }>;
};

export interface WebGlModelRuntimeOptions {
  canvas: HTMLCanvasElement;
  manifestUrl: string;
  modelUrl: string;
  onStateChange?: (state: ModelRuntimeState) => void;
  onSemanticAction?: (action: ModelSemanticAction) => void;
}

export class BrowserModelRuntimeError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "BrowserModelRuntimeError"; }
}

const MODEL_COLORS: Vec3[] = [[0.16, 0.54, 0.58], [0.84, 0.51, 0.19], [0.42, 0.36, 0.66]];

function validateManifest(value: unknown): BrowserManifest {
  if (!value || typeof value !== "object") throw new BrowserModelRuntimeError("MODEL_MANIFEST_INVALID", "The model manifest is not an object.");
  const manifest = value as Partial<BrowserManifest>;
  if (manifest.schemaVersion !== "model-manifest.v1" || manifest.format !== "glb") throw new BrowserModelRuntimeError("MODEL_MANIFEST_VERSION_UNSUPPORTED", "The model manifest version is not supported.");
  if (typeof manifest.sourceHash !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.sourceHash) || typeof manifest.modelVersionId !== "string" || typeof manifest.releaseBindingId !== "string") throw new BrowserModelRuntimeError("MODEL_MANIFEST_BINDING_REQUIRED", "The model manifest must be bound to an approved model version and release.");
  if (!Array.isArray(manifest.materials) || !Array.isArray(manifest.textures) || typeof manifest.textureCount !== "number") throw new BrowserModelRuntimeError("MODEL_MATERIALS_INVALID", "The model manifest must declare materials and textures.");
  if (manifest.normalizationStatus !== "CANONICAL" || manifest.unitSystem !== "meter" || manifest.upAxis !== "Y" || manifest.handedness !== "right" || manifest.origin !== "bounding-box-center" || manifest.forwardAxis !== "-Z") throw new BrowserModelRuntimeError("MODEL_MANIFEST_NOT_CANONICAL", "The model must be canonicalized before browser loading.");
  if (!Array.isArray(manifest.components) || manifest.components.length === 0) throw new BrowserModelRuntimeError("MODEL_COMPONENTS_REQUIRED", "The model manifest has no stable components.");
  const ids = manifest.components.map((component) => component.componentId);
  if (ids.some((id) => typeof id !== "string" || id.length === 0) || new Set(ids).size !== ids.length) throw new BrowserModelRuntimeError("MODEL_COMPONENTS_INVALID", "The model manifest contains invalid or duplicate component IDs.");
  if (manifest.components.some((component) => !Array.isArray(component.interactionCapabilities) || Object.values(component.permittedTransforms ?? {}).some((policy) => policy.step <= 0 || policy.min > policy.max || (policy.snap !== undefined && (policy.snap < policy.min || policy.snap > policy.max))))) throw new BrowserModelRuntimeError("MODEL_INTERACTION_POLICY_INVALID", "The model manifest contains an invalid interaction policy.");
  return manifest as BrowserManifest;
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) for (let row = 0; row < 4; row += 1) {
    out[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
  }
  return out;
}

function normalize(value: Vec3): Vec3 { const length = Math.hypot(value[0], value[1], value[2]) || 1; return [value[0] / length, value[1] / length, value[2] / length]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
  const factor = 1 / Math.tan(fov / 2); const out = new Float32Array(16);
  out[0] = factor / aspect; out[5] = factor; out[10] = (far + near) / (near - far); out[11] = -1; out[14] = (2 * far * near) / (near - far); return out;
}

function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]); const x = normalize(cross(up, z)); const y = cross(z, x); const out = new Float32Array(16);
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[8] = x[2]; out[9] = y[2]; out[10] = z[2];
  out[12] = -dot(x, eye); out[13] = -dot(y, eye); out[14] = -dot(z, eye); out[15] = 1; return out;
}

function rotationX(angle: number): Mat4 { const c = Math.cos(angle); const s = Math.sin(angle); const out = new Float32Array(16); out[0] = 1; out[5] = c; out[6] = s; out[9] = -s; out[10] = c; out[15] = 1; return out; }
function rotationY(angle: number): Mat4 { const c = Math.cos(angle); const s = Math.sin(angle); const out = new Float32Array(16); out[0] = c; out[2] = -s; out[5] = 1; out[8] = s; out[10] = c; out[15] = 1; return out; }

function transform(matrix: Mat4, point: Vec3): [number, number, number, number] {
  return [matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12], matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13], matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14], matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15]];
}

function pointInTriangle(point: [number, number], a: [number, number], b: [number, number], c: [number, number]): boolean {
  const sign = (p1: [number, number], p2: [number, number], p3: [number, number]) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const one = sign(point, a, b); const two = sign(point, b, c); const three = sign(point, c, a);
  return (one >= 0 && two >= 0 && three >= 0) || (one <= 0 && two <= 0 && three <= 0);
}

function readUint32(bytes: Uint8Array, offset: number): number { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true); }

function parseGlb(bytes: Uint8Array): { document: GlbDocument; binary: Uint8Array } {
  if (bytes.byteLength < 20 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "glTF" || readUint32(bytes, 4) !== 2) throw new BrowserModelRuntimeError("INVALID_HEADER", "The model is not a glTF 2.0 binary.");
  if (readUint32(bytes, 8) !== bytes.byteLength) throw new BrowserModelRuntimeError("INVALID_LENGTH", "The model length does not match its GLB header.");
  let offset = 12; let document: GlbDocument | undefined; let binary: Uint8Array | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const length = readUint32(bytes, offset); const type = readUint32(bytes, offset + 4); const start = offset + 8; const end = start + length;
    if (end > bytes.byteLength) throw new BrowserModelRuntimeError("INVALID_LENGTH", "A GLB chunk exceeds the supplied bytes.");
    if (type === 0x4e4f534a) { try { document = JSON.parse(new TextDecoder().decode(bytes.subarray(start, end))) as GlbDocument; } catch { throw new BrowserModelRuntimeError("INVALID_JSON", "The model JSON chunk is invalid."); } }
    else if (type === 0x004e4942) binary = bytes.subarray(start, end);
    offset = end;
  }
  if (!document || !binary) throw new BrowserModelRuntimeError("MISSING_CHUNK", "The model must contain JSON and binary GLB chunks.");
  return { document, binary };
}

function accessorData(document: GlbDocument, binary: Uint8Array, accessorIndex: number): { bytes: Uint8Array; componentType: number; count: number; stride: number } {
  const accessor = document.accessors?.[accessorIndex]; const view = accessor?.bufferView === undefined ? undefined : document.bufferViews?.[accessor.bufferView];
  if (!accessor || !view || accessor.count === undefined || accessor.componentType === undefined) throw new BrowserModelRuntimeError("ACCESSOR_INVALID", "The model accessor is incomplete.");
  const components = accessor.type === "VEC3" ? 3 : 1; const elementBytes = accessor.componentType === 5126 ? 4 * components : accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 1;
  const stride = view.byteStride ?? elementBytes; const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (start + stride * (accessor.count - 1) + elementBytes > binary.byteLength) throw new BrowserModelRuntimeError("ACCESSOR_OUT_OF_RANGE", "The model accessor exceeds its binary buffer.");
  return { bytes: binary.subarray(start), componentType: accessor.componentType, count: accessor.count, stride };
}

function geometryForNode(document: GlbDocument, binary: Uint8Array, node: GlbNode, componentId: string, color: Vec3): ComponentGeometry {
  const primitive = document.meshes?.[node.mesh ?? -1]?.primitives?.[0];
  if (primitive?.attributes?.POSITION === undefined) throw new BrowserModelRuntimeError("POSITION_REQUIRED", `Component ${componentId} has no position accessor.`);
  const position = accessorData(document, binary, primitive.attributes.POSITION);
  if (position.componentType !== 5126 || position.stride < 12) throw new BrowserModelRuntimeError("POSITION_UNSUPPORTED", `Component ${componentId} uses an unsupported position accessor.`);
  const positions = new Float32Array(position.count * 3); const positionView = new DataView(position.bytes.buffer, position.bytes.byteOffset, position.bytes.byteLength);
  for (let index = 0; index < position.count; index += 1) for (let axis = 0; axis < 3; axis += 1) positions[index * 3 + axis] = positionView.getFloat32(index * position.stride + axis * 4, true);
  if (primitive.indices === undefined) return { componentId, positions, indices: Uint16Array.from({ length: position.count }, (_, index) => index), indexType: 5123, color };
  const index = accessorData(document, binary, primitive.indices); const view = new DataView(index.bytes.buffer, index.bytes.byteOffset, index.bytes.byteLength);
  if (![5121, 5123, 5125].includes(index.componentType)) throw new BrowserModelRuntimeError("INDEX_UNSUPPORTED", `Component ${componentId} uses an unsupported index accessor.`);
  const indices = index.componentType === 5125 ? new Uint32Array(index.count) : new Uint16Array(index.count);
  for (let item = 0; item < index.count; item += 1) indices[item] = index.componentType === 5125 ? view.getUint32(item * index.stride, true) : index.componentType === 5123 ? view.getUint16(item * index.stride, true) : view.getUint8(item * index.stride);
  return { componentId, positions, indices, indexType: index.componentType === 5125 ? 5125 : index.componentType === 5123 ? 5123 : 5121, color };
}

function hex(bytes: ArrayBuffer): string { return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join(""); }

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const value = gl.createShader(type); if (!value) throw new BrowserModelRuntimeError("WEBGL_SHADER", "The browser could not create a WebGL shader.");
  gl.shaderSource(value, source); gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new BrowserModelRuntimeError("WEBGL_SHADER", gl.getShaderInfoLog(value) ?? "The WebGL shader failed to compile.");
  return value;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const value = gl.createProgram(); if (!value) throw new BrowserModelRuntimeError("WEBGL_PROGRAM", "The browser could not create a WebGL program.");
  gl.attachShader(value, shader(gl, gl.VERTEX_SHADER, "#version 300 es\nlayout(location=0) in vec3 a_position; uniform mat4 u_mvp; uniform vec3 u_center; uniform float u_rotation_y; uniform float u_translation_x; void main(){ float c=cos(u_rotation_y); float s=sin(u_rotation_y); vec3 p=a_position-u_center; p=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z); p.x+=u_translation_x; gl_Position = u_mvp * vec4(p, 1.0); }"));
  gl.attachShader(value, shader(gl, gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float; uniform vec3 u_color; out vec4 outColor; void main(){ outColor = vec4(u_color, 1.0); }"));
  gl.linkProgram(value); if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new BrowserModelRuntimeError("WEBGL_PROGRAM", gl.getProgramInfoLog(value) ?? "The WebGL program failed to link.");
  return value;
}

function modelBounds(components: ComponentGeometry[]): { center: Vec3; radius: number } {
  const min: Vec3 = [Infinity, Infinity, Infinity]; const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const component of components) for (let index = 0; index < component.positions.length; index += 3) for (let axis = 0; axis < 3; axis += 1) { min[axis] = Math.min(min[axis], component.positions[index + axis]); max[axis] = Math.max(max[axis], component.positions[index + axis]); }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]; let radius = 0;
  for (const component of components) for (let index = 0; index < component.positions.length; index += 3) radius = Math.max(radius, Math.hypot(component.positions[index] - center[0], component.positions[index + 1] - center[1], component.positions[index + 2] - center[2]));
  return { center, radius: Math.max(radius, 0.1) };
}

export async function createWebGlModelRuntime(options: WebGlModelRuntimeOptions): Promise<ModelRuntime> {
  const started = performance.now(); const emit = (state: ModelRuntimeState) => options.onStateChange?.(state); emit({ phase: "LOADING", componentIds: [], transforms: {} });
  try {
    const [manifestResponse, modelResponse] = await Promise.all([fetch(options.manifestUrl), fetch(options.modelUrl)]);
    if (!manifestResponse.ok || !modelResponse.ok) throw new BrowserModelRuntimeError("MODEL_FETCH_FAILED", "The approved model or manifest could not be loaded.");
    const manifest = validateManifest(await manifestResponse.json()); const bytes = new Uint8Array(await modelResponse.arrayBuffer());
    if (manifest.sourceHash && hex(await crypto.subtle.digest("SHA-256", bytes)) !== manifest.sourceHash.toLowerCase()) throw new BrowserModelRuntimeError("MODEL_HASH_MISMATCH", "The model bytes do not match the approved manifest hash.");
    const parsed = parseGlb(bytes); const colors = new Map(manifest.components.map((component, index) => [component.componentId, MODEL_COLORS[index % MODEL_COLORS.length]]));
    const components = (parsed.document.nodes ?? []).flatMap((node) => node.extras?.componentId ? [geometryForNode(parsed.document, parsed.binary, node, node.extras.componentId, colors.get(node.extras.componentId) ?? MODEL_COLORS[0])] : []);
    const expected = new Set(manifest.components.map((component) => component.componentId));
    if (components.length !== expected.size || components.some((component) => !expected.has(component.componentId))) throw new BrowserModelRuntimeError("MODEL_COMPONENT_MISMATCH", "The loaded model does not match the approved component manifest.");
    const canvas = options.canvas; const gl = canvas.getContext("webgl2", { antialias: true, alpha: false }); if (!gl) throw new BrowserModelRuntimeError("WEBGL2_UNAVAILABLE", "This browser does not provide the required WebGL2 baseline.");
    const bounds = modelBounds(components); let yaw = 0.35; let pitch = -0.15; let distance = bounds.radius * 2.8; let selectedComponentId: string | undefined; let disposed = false; let raf = 0; let program = createProgram(gl);
    const transforms = Object.fromEntries(manifest.components.map((component) => [component.componentId, { rotationY: 0, translationX: 0 }]));
    const state: ModelRuntimeState = { phase: "READY", componentIds: manifest.components.map((component) => component.componentId), transforms, loadDurationMs: Math.round(performance.now() - started) };
    const resize = () => { const ratio = Math.min(window.devicePixelRatio || 1, 2); const width = Math.max(1, Math.floor(canvas.clientWidth * ratio)); const height = Math.max(1, Math.floor(canvas.clientHeight * ratio)); if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; } };
    const matrices = () => { resize(); const projection = perspective(Math.PI / 4, canvas.width / canvas.height, 0.01, Math.max(100, distance * 8)); const view = lookAt([0, 0, distance], [0, 0, 0], [0, 1, 0]); return { viewProjection: multiply(projection, view), model: multiply(rotationY(yaw), rotationX(pitch)) }; };
    const buffers = () => { for (const component of components) { if (component.vao) gl.deleteVertexArray(component.vao); if (component.positionBuffer) gl.deleteBuffer(component.positionBuffer); if (component.indexBuffer) gl.deleteBuffer(component.indexBuffer); component.vao = gl.createVertexArray() ?? undefined; component.positionBuffer = gl.createBuffer() ?? undefined; component.indexBuffer = gl.createBuffer() ?? undefined; if (!component.vao || !component.positionBuffer || !component.indexBuffer) throw new BrowserModelRuntimeError("WEBGL_BUFFER", "The browser could not create a model buffer."); gl.bindVertexArray(component.vao); gl.bindBuffer(gl.ARRAY_BUFFER, component.positionBuffer); gl.bufferData(gl.ARRAY_BUFFER, component.positions, gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, component.indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, component.indices, gl.STATIC_DRAW); } gl.bindVertexArray(null); };
    const render = () => { if (disposed) return; const { viewProjection, model } = matrices(); gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0.035, 0.09, 0.11, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.useProgram(program); const mvp = multiply(viewProjection, model); gl.uniformMatrix4fv(gl.getUniformLocation(program, "u_mvp"), false, mvp); gl.uniform3fv(gl.getUniformLocation(program, "u_center"), bounds.center); for (const component of components) { const transform = state.transforms[component.componentId] ?? { rotationY: 0, translationX: 0 }; gl.bindVertexArray(component.vao ?? null); gl.uniform1f(gl.getUniformLocation(program, "u_rotation_y"), transform.rotationY); gl.uniform1f(gl.getUniformLocation(program, "u_translation_x"), transform.translationX); gl.uniform3fv(gl.getUniformLocation(program, "u_color"), component.componentId === selectedComponentId ? [0.95, 0.72, 0.2] : component.color); gl.drawElements(gl.TRIANGLES, component.indices.length, component.indexType, 0); } gl.bindVertexArray(null); };
    const project = (point: Vec3): [number, number] => { const { viewProjection, model } = matrices(); const clip = transform(multiply(viewProjection, model), [point[0] - bounds.center[0], point[1] - bounds.center[1], point[2] - bounds.center[2]]); return [(clip[0] / clip[3] * 0.5 + 0.5) * canvas.clientWidth, (1 - (clip[1] / clip[3] * 0.5 + 0.5)) * canvas.clientHeight]; };
    const selectComponent = (componentId: string, source: ModelSelectionSource = "COMPONENT_LIST") => { if (!expected.has(componentId)) return; selectedComponentId = componentId; state.selectedComponentId = componentId; emit({ ...state }); render(); options.onSemanticAction?.({ type: "select_component", componentId, source }); };
    const selectAt = (clientX: number, clientY: number) => { const rect = canvas.getBoundingClientRect(); const point: [number, number] = [clientX - rect.left, clientY - rect.top]; for (const component of [...components].reverse()) for (let index = 0; index + 2 < component.indices.length; index += 3) { const triangle = [component.indices[index], component.indices[index + 1], component.indices[index + 2]].map((item) => project([component.positions[item * 3], component.positions[item * 3 + 1], component.positions[item * 3 + 2]]) as [number, number]); if (pointInTriangle(point, triangle[0], triangle[1], triangle[2])) { selectComponent(component.componentId, "CANVAS"); return; } } };
    buffers();
    const handleContextLost = (event: Event) => { event.preventDefault(); state.phase = "CONTEXT_LOST"; state.fallbackReason = "WebGL context was lost; reload or use the text-equivalent path."; emit({ ...state }); };
    const handleContextRestored = () => { gl.deleteProgram(program); program = createProgram(gl); buffers(); state.phase = "READY"; state.fallbackReason = undefined; emit({ ...state }); render(); };
    const handleClick = (event: MouseEvent) => selectAt(event.clientX, event.clientY);
    const handleWheel = (event: WheelEvent) => { event.preventDefault(); distance = Math.max(bounds.radius * 1.3, Math.min(bounds.radius * 8, distance * (event.deltaY > 0 ? 1.08 : 0.92))); render(); };
    canvas.addEventListener("webglcontextlost", handleContextLost); canvas.addEventListener("webglcontextrestored", handleContextRestored); canvas.addEventListener("click", handleClick);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    let dragging = false; let lastX = 0; let lastY = 0;
    const handlePointerDown = (event: PointerEvent) => { dragging = true; lastX = event.clientX; lastY = event.clientY; canvas.setPointerCapture(event.pointerId); };
    const handlePointerMove = (event: PointerEvent) => { if (!dragging) return; yaw += (event.clientX - lastX) * 0.01; pitch = Math.max(-1.3, Math.min(1.3, pitch + (event.clientY - lastY) * 0.01)); lastX = event.clientX; lastY = event.clientY; render(); };
    const handlePointerUp = (event: PointerEvent) => { dragging = false; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); };
    canvas.addEventListener("pointerdown", handlePointerDown); canvas.addEventListener("pointermove", handlePointerMove); canvas.addEventListener("pointerup", handlePointerUp); canvas.addEventListener("pointercancel", handlePointerUp);
    const resetView = () => { yaw = 0.35; pitch = -0.15; distance = bounds.radius * 2.8; render(); };
    const observer = new ResizeObserver(render); observer.observe(canvas); const sampleStart = performance.now(); let frames = 0;
    const sample = () => { if (disposed) return; render(); frames += 1; if (performance.now() - sampleStart < 1000) raf = requestAnimationFrame(sample); else { state.measuredFps = Math.round(frames / Math.max(1, (performance.now() - sampleStart) / 1000)); emit({ ...state }); } };
    raf = requestAnimationFrame(sample); emit({ ...state }); render();
    const applyAuthoritativeState = (nextState: AuthoritativeModelState) => {
      if (!validateAuthoritativeModelState(manifest as unknown as ModelManifest, nextState)) return;
      if (state.authoritative && nextState.sequence < state.authoritative.sequence) return;
      const safeTransforms: Record<string, { rotationY: number; translationX: number }> = {};
      for (const component of manifest.components) {
        const transform = nextState.transforms[component.componentId];
        if (!transform) return;
        const normalized = applyPermittedTransform(component, { rotationY: 0, translationX: 0 }, transform);
        if (!normalized || normalized.rotationY !== transform.rotationY || normalized.translationX !== transform.translationX) return;
        safeTransforms[component.componentId] = normalized;
      }
      state.authoritative = nextState;
      state.transforms = safeTransforms;
      if (nextState.selectedComponentId && manifest.components.some((component) => component.componentId === nextState.selectedComponentId)) { selectedComponentId = nextState.selectedComponentId; state.selectedComponentId = nextState.selectedComponentId; }
      else if (!nextState.selectedComponentId) { selectedComponentId = undefined; state.selectedComponentId = undefined; }
      emit({ ...state }); render();
    };
    return { getState: () => ({ ...state, transforms: { ...state.transforms } }), selectComponent, applyAuthoritativeState, resetView, dispose: () => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); canvas.removeEventListener("webglcontextlost", handleContextLost); canvas.removeEventListener("webglcontextrestored", handleContextRestored); canvas.removeEventListener("click", handleClick); canvas.removeEventListener("wheel", handleWheel); canvas.removeEventListener("pointerdown", handlePointerDown); canvas.removeEventListener("pointermove", handlePointerMove); canvas.removeEventListener("pointerup", handlePointerUp); canvas.removeEventListener("pointercancel", handlePointerUp); gl.deleteProgram(program); for (const component of components) { if (component.vao) gl.deleteVertexArray(component.vao); if (component.positionBuffer) gl.deleteBuffer(component.positionBuffer); if (component.indexBuffer) gl.deleteBuffer(component.indexBuffer); } } };
  } catch (error) {
    const failure = error instanceof BrowserModelRuntimeError ? error : new BrowserModelRuntimeError("MODEL_RUNTIME_FAILED", error instanceof Error ? error.message : "The model runtime failed.");
    emit({ phase: "ERROR", componentIds: [], transforms: {}, errorCode: failure.code, errorMessage: failure.message }); throw failure;
  }
}
