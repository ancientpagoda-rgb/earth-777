import * as THREE from "three";

export function createRegionalAerialMaterial() {
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.FrontSide,
    fog: true,
    toneMapped: false
  });

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vAerialWorldPosition;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvAerialWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vAerialWorldPosition;\n\nfloat aerialHash(vec2 p) {\n  p = fract(p * vec2(123.34, 345.45));\n  p += dot(p, p + 34.345);\n  return fract(p.x * p.y);\n}\n\nfloat aerialNoise(vec2 p) {\n  vec2 i = floor(p);\n  vec2 f = fract(p);\n  f = f * f * (3.0 - 2.0 * f);\n  float a = aerialHash(i);\n  float b = aerialHash(i + vec2(1.0, 0.0));\n  float c = aerialHash(i + vec2(0.0, 1.0));\n  float d = aerialHash(i + vec2(1.0, 1.0));\n  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);\n}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nvec3 aerialBase = diffuseColor.rgb;\nvec2 aerialXZ = vAerialWorldPosition.xz;\n\n// Three seamless world-space noise samples replace the previous five 5-octave\n// FBM evaluations. The science-driven vertex color remains the dominant signal;\n// procedural noise only breaks it into readable natural aerial structure.\nfloat aerialMacro = aerialNoise(aerialXZ * 0.055);\nfloat aerialMeso = aerialNoise(aerialXZ * 0.19 + vec2(19.7, -8.4));\nfloat aerialFine = aerialNoise(aerialXZ * 0.82 + vec2(-31.2, 14.6));\nfloat aerialMicro = aerialHash(floor(aerialXZ * 2.6));\n\nfloat waterSignal = smoothstep(0.035, 0.13, aerialBase.b - aerialBase.r)\n  * smoothstep(0.005, 0.075, aerialBase.b - aerialBase.g);\n\nfloat forestPatch = smoothstep(0.58, 0.80, aerialMacro * 0.68 + aerialMeso * 0.32);\nfloat woodlandPatch = smoothstep(0.43, 0.67, aerialMeso) * (1.0 - forestPatch * 0.70);\nfloat wetlandPatch = smoothstep(0.68, 0.86, aerialMacro * 0.56 + aerialFine * 0.44);\nfloat openingPatch = smoothstep(0.63, 0.84, 1.0 - aerialMeso);\nfloat exposedPatch = smoothstep(0.72, 0.90, 1.0 - aerialMacro) * smoothstep(0.52, 0.82, aerialFine);\n\nvec3 forestColor = aerialBase * vec3(0.38, 0.64, 0.40);\nvec3 woodlandColor = aerialBase * vec3(0.69, 0.89, 0.60);\nvec3 openingColor = aerialBase * vec3(1.14, 1.06, 0.72);\nvec3 wetlandColor = mix(aerialBase * vec3(0.46, 0.78, 0.68), vec3(0.060, 0.235, 0.205), 0.31);\nvec3 exposedColor = mix(aerialBase, vec3(0.49, 0.37, 0.20), 0.57);\n\nvec3 aerialLand = aerialBase;\naerialLand = mix(aerialLand, woodlandColor, woodlandPatch * 0.48);\naerialLand = mix(aerialLand, forestColor, forestPatch * 0.76);\naerialLand = mix(aerialLand, wetlandColor, wetlandPatch * 0.56);\naerialLand = mix(aerialLand, openingColor, openingPatch * 0.48);\naerialLand = mix(aerialLand, exposedColor, exposedPatch * 0.34);\n\nfloat aerialTexture = (aerialFine - 0.50) * 0.17 + (aerialMicro - 0.50) * 0.040;\naerialLand *= 1.0 + aerialTexture;\n\nvec3 dx = dFdx(vAerialWorldPosition);\nvec3 dy = dFdy(vAerialWorldPosition);\nvec3 aerialNormal = normalize(cross(dx, dy));\nif (aerialNormal.y < 0.0) aerialNormal = -aerialNormal;\nvec3 aerialSun = normalize(vec3(0.43, 0.82, 0.38));\nfloat aerialHillshade = clamp(0.69 + max(0.0, dot(aerialNormal, aerialSun)) * 0.47, 0.60, 1.13);\nfloat aerialSlope = clamp(1.0 - aerialNormal.y, 0.0, 1.0);\naerialLand *= aerialHillshade;\naerialLand = mix(aerialLand, aerialLand * vec3(0.77, 0.74, 0.67), aerialSlope * 0.24);\n\n// Cheap photographic-style finishing: expand tonal range and chroma without\n// adding another procedural octave. This counteracts the washed-out look of the\n// large streamed regional footprint while preserving deterministic science color.\nfloat aerialLuma = dot(aerialLand, vec3(0.2126, 0.7152, 0.0722));\naerialLand = mix(vec3(aerialLuma), aerialLand, 1.16);\naerialLand = (aerialLand - vec3(0.34)) * 1.12 + vec3(0.34);\n\nvec3 aerialWater = aerialBase * (0.90 + (aerialFine - 0.5) * 0.10);\ndiffuseColor.rgb = clamp(mix(aerialLand, aerialWater, waterSignal), vec3(0.018), vec3(0.92));`
      );
  };

  material.customProgramCacheKey = () => "earth777-regional-aerial-mosaic-v5-crisp";
  material.userData.presentation = "science-colored-aerial-fragment-mosaic-v5-crisp";
  return material;
}
