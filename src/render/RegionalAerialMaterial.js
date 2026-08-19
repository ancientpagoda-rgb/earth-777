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
        `#include <common>\nvarying vec3 vAerialWorldPosition;\n\nfloat aerialHash(vec2 p) {\n  p = fract(p * vec2(123.34, 345.45));\n  p += dot(p, p + 34.345);\n  return fract(p.x * p.y);\n}\n\nfloat aerialNoise(vec2 p) {\n  vec2 i = floor(p);\n  vec2 f = fract(p);\n  f = f * f * (3.0 - 2.0 * f);\n  float a = aerialHash(i);\n  float b = aerialHash(i + vec2(1.0, 0.0));\n  float c = aerialHash(i + vec2(0.0, 1.0));\n  float d = aerialHash(i + vec2(1.0, 1.0));\n  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);\n}\n\nfloat aerialFbm(vec2 p) {\n  float value = 0.0;\n  float amplitude = 0.55;\n  mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);\n  for (int i = 0; i < 5; i++) {\n    value += aerialNoise(p) * amplitude;\n    p = rotation * p * 2.03 + 17.1;\n    amplitude *= 0.48;\n  }\n  return value;\n}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nvec3 aerialBase = diffuseColor.rgb;\nvec2 aerialXZ = vAerialWorldPosition.xz;\nfloat aerialMacro = aerialFbm(aerialXZ * 0.060);\nfloat aerialMeso = aerialFbm(aerialXZ * 0.19 + vec2(19.7, -8.4));\nfloat aerialFine = aerialFbm(aerialXZ * 0.82 + vec2(-31.2, 14.6));\nfloat aerialMicro = aerialFbm(aerialXZ * 2.35 + vec2(11.6, 37.1));\nfloat aerialRidge = abs(aerialFbm(aerialXZ * 0.13 + vec2(7.3, 22.1)) * 2.0 - 1.0);\n\nfloat waterSignal = smoothstep(0.035, 0.13, aerialBase.b - aerialBase.r)\n  * smoothstep(0.005, 0.075, aerialBase.b - aerialBase.g);\n\nfloat forestPatch = smoothstep(0.53, 0.74, aerialMacro * 0.66 + aerialMeso * 0.34);\nfloat woodlandPatch = smoothstep(0.42, 0.64, aerialMeso) * (1.0 - forestPatch * 0.65);\nfloat wetlandPatch = smoothstep(0.64, 0.84, aerialMacro * 0.48 + aerialFine * 0.52)\n  * (1.0 - smoothstep(0.38, 0.70, aerialRidge));\nfloat openingPatch = smoothstep(0.61, 0.83, 1.0 - aerialMeso)\n  * smoothstep(0.28, 0.62, aerialRidge);\nfloat exposedPatch = smoothstep(0.67, 0.86, 1.0 - aerialMacro)\n  * smoothstep(0.48, 0.78, aerialRidge);\n\nvec3 forestColor = aerialBase * vec3(0.42, 0.68, 0.46);\nvec3 woodlandColor = aerialBase * vec3(0.72, 0.91, 0.64);\nvec3 openingColor = aerialBase * vec3(1.12, 1.05, 0.72);\nvec3 wetlandColor = mix(aerialBase * vec3(0.48, 0.80, 0.70), vec3(0.075, 0.255, 0.225), 0.30);\nvec3 exposedColor = mix(aerialBase, vec3(0.47, 0.37, 0.22), 0.58);\n\nvec3 aerialLand = aerialBase;\naerialLand = mix(aerialLand, woodlandColor, woodlandPatch * 0.46);\naerialLand = mix(aerialLand, forestColor, forestPatch * 0.72);\naerialLand = mix(aerialLand, wetlandColor, wetlandPatch * 0.58);\naerialLand = mix(aerialLand, openingColor, openingPatch * 0.46);\naerialLand = mix(aerialLand, exposedColor, exposedPatch * 0.34);\n\nfloat aerialTexture = (aerialFine - 0.50) * 0.16 + (aerialMicro - 0.50) * 0.065;\naerialLand *= 1.0 + aerialTexture;\n\nvec3 dx = dFdx(vAerialWorldPosition);\nvec3 dy = dFdy(vAerialWorldPosition);\nvec3 aerialNormal = normalize(cross(dx, dy));\nif (aerialNormal.y < 0.0) aerialNormal = -aerialNormal;\nvec3 aerialSun = normalize(vec3(0.43, 0.82, 0.38));\nfloat aerialHillshade = clamp(0.68 + max(0.0, dot(aerialNormal, aerialSun)) * 0.48, 0.60, 1.13);\nfloat aerialSlope = clamp(1.0 - aerialNormal.y, 0.0, 1.0);\naerialLand *= aerialHillshade;\naerialLand = mix(aerialLand, aerialLand * vec3(0.78, 0.75, 0.69), aerialSlope * 0.24);\n\nvec3 aerialWater = aerialBase * (0.88 + (aerialFine - 0.5) * 0.12);\ndiffuseColor.rgb = clamp(mix(aerialLand, aerialWater, waterSignal), vec3(0.018), vec3(0.92));`
      );
  };

  material.customProgramCacheKey = () => "earth777-regional-aerial-mosaic-v3";
  material.userData.presentation = "science-colored-aerial-fragment-mosaic-v3";
  return material;
}
