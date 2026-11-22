/** Appends two bounded acceleration/receiver tables and the live blockers
 * after the unchanged 3.1 wire offsets. One bufferSubData per present. */
export const SACR_BLOCK = `
layout(std140) uniform SACR_v40_UBO {
  uvec4 u_ColBins[40];         // 0..639
  uvec4 u_PrimPool[64];        // 640..1663
  uvec4 u_ArchProfile[32];     // 1664..2175
  vec4  u_FootAO[16];          // 2176..2431
  uvec4 u_ShadowBins[40];      // 2432..3071 (opaque-only, same PrimPool)
  vec4  u_DynamicBlockers[24]; // 3072..3455
  vec4  u_Supports[8];         // 3456..3583
};
`
