export function triangleCount(document) {
  return (document.meshes ?? []).reduce((total, mesh) => total + (mesh.primitives ?? []).reduce((meshTotal, primitive) => {
    const accessor = primitive.indices === undefined ? undefined : document.accessors?.[primitive.indices];
    return meshTotal + (accessor?.count ? Math.floor(accessor.count / 3) : 0);
  }, 0), 0);
}

/**
 * Retains whole triangles and never removes the final triangle of a mesh.
 * Stable component identity is represented by the mesh/node, so each mesh
 * remains renderable and selectable after reduction.
 */
export function reduceTriangles(document, ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) throw new Error("MODEL_VARIANT_RATIO_INVALID");
  for (const mesh of document.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    if (primitive.indices === undefined) continue;
    const accessor = document.accessors?.[primitive.indices];
    if (!accessor || typeof accessor.count !== "number" || accessor.count < 3) continue;
    const fullTriangles = Math.floor(accessor.count / 3);
    const retainedTriangles = Math.max(1, Math.floor(fullTriangles * ratio));
    accessor.count = retainedTriangles * 3;
  }
  return triangleCount(document);
}
