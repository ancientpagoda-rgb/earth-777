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
        `#include <common>
varying vec3 vAerialWorldPosition;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vAerialWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vAerialWorldPosition;

float aerialHash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float aerialNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = aerialHash(i);
  float b = aerialHash(i + vec2(1.0, 0.0));
  float c = aerialHash(i + vec2(0.0, 1.0));
  float d = aerialHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float aerialFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.55;
  mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    value += aerialNoise(p) * amplitude;
    p = rotation * p * 2.03 + 17.1;
    amplitude *= 0.48;
  }
  return value;
}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec2 aerialXZ = vAerialWorldPosition.xz;
float aerialMacro = aerialFbm(aerialXZ * 0.085);
float aerialMeso = aerialFbm(aerialXZ * 0.31 + vec2(19.7, -8.4));
float aerialFine = aerialFbm(aerialXZ * 1.15 + vec2(-31.2, 14.6));
float aerialRidge = abs(aerialFbm(aerialXZ * 0.18 + vec2(7.3, 22.1)) * 2.0 - 1.0);
float aerialTone = (aerialMacro - 0.50) * 0.24 + (aerialMeso - 0.50) * 0.13 + (aerialFine - 0.50) * 0.045;
float aerialWet = smoothstep(0.70, 0.94, aerialMacro * 0.56 + aerialMeso * 0.44) * (1.0 - smoothstep(0.48, 0.82, aerialRidge));
float aerialDry = smoothstep(0.72, 0.96, 1.0 - aerialMeso) * smoothstep(0.34, 0.72, aerialRidge);
diffuseColor.rgb *= 1.0 + aerialTone;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.68, 0.90, 0.82), aerialWet * 0.30);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.16, 1.04, 0.78), aerialDry * 0.22);`
      );
  };

  material.customProgramCacheKey = () => "earth777-regional-aerial-mosaic-v2";
  material.userData.presentation = "science-colored-aerial-fragment-mosaic-v2";
  return material;
}
