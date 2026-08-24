import * as THREE from "three";
import { EARTH_MEAN_RADIUS_KM } from "./SurfacePlanetCurvature.js";

export function createRegionalAerialMaterial() {
  const curvature = {
    centerX: 0,
    centerZ: 0,
    strength: 0,
    radiusKm: EARTH_MEAN_RADIUS_KM,
    shader: null
  };

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.FrontSide,
    fog: true,
    transparent: true,
    depthWrite: true,
    alphaTest: 0.01,
    toneMapped: false
  });

  material.onBeforeCompile = (shader) => {
    curvature.shader = shader;
    shader.uniforms.uAerialCurvatureCenter = { value: new THREE.Vector2(curvature.centerX, curvature.centerZ) };
    shader.uniforms.uAerialCurvatureStrength = { value: curvature.strength };
    shader.uniforms.uAerialEarthRadiusKm = { value: curvature.radiusKm };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vAerialWorldPosition;\nuniform vec2 uAerialCurvatureCenter;\nuniform float uAerialCurvatureStrength;\nuniform float uAerialEarthRadiusKm;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n// At ordinary regional distances the local tangent plane stays unchanged.\n// As the camera pulls far back, bend that plane onto a sphere with Earth's\n// mean radius. This is presentation-only: science and tile coordinates remain\n// in their stable local tangent frame.\nvec2 aerialCurvatureDelta = transformed.xz - uAerialCurvatureCenter;\nfloat aerialCurvatureRadiusSq = uAerialEarthRadiusKm * uAerialEarthRadiusKm;\nfloat aerialCurvaturePlanarSq = min(dot(aerialCurvatureDelta, aerialCurvatureDelta), aerialCurvatureRadiusSq * 0.999999);\nfloat aerialCurvatureDrop = uAerialEarthRadiusKm - sqrt(max(0.0, aerialCurvatureRadiusSq - aerialCurvaturePlanarSq));\ntransformed.y -= aerialCurvatureDrop * uAerialCurvatureStrength;\nvAerialWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      )
      .replace(
        "#include <uv_pars_vertex>",
        "#include <uv_pars_vertex>\nvarying float vAerialDistanceKm;"
      )
      .replace(
        "transformed.y -= aerialCurvatureDrop * uAerialCurvatureStrength;",
        "float aerialCurvatureBlend = smoothstep(110.0, 300.0, length(aerialCurvatureDelta));\ntransformed.y -= aerialCurvatureDrop * aerialCurvatureBlend * uAerialCurvatureStrength;"
      )
      .replace(
        "vAerialWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        "vAerialDistanceKm = length(transformed.xz - uAerialCurvatureCenter);\nvAerialWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vAerialWorldPosition;\n\nfloat aerialHash(vec2 p) {\n  p = fract(p * vec2(123.34, 345.45));\n  p += dot(p, p + 34.345);\n  return fract(p.x * p.y);\n}\n\nfloat aerialNoise(vec2 p) {\n  vec2 i = floor(p);\n  vec2 f = fract(p);\n  f = f * f * (3.0 - 2.0 * f);\n  float a = aerialHash(i);\n  float b = aerialHash(i + vec2(1.0, 0.0));\n  float c = aerialHash(i + vec2(0.0, 1.0));\n  float d = aerialHash(i + vec2(1.0, 1.0));\n  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);\n}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nvec3 aerialBase = diffuseColor.rgb;\nvec2 aerialXZ = vAerialWorldPosition.xz;\n\n// Three seamless world-space noise samples replace the previous five 5-octave\n// FBM evaluations. The science-driven vertex color remains the dominant signal;\n// procedural noise only breaks it into readable natural aerial structure.\nfloat aerialMacro = aerialNoise(aerialXZ * 0.055);\nfloat aerialMeso = aerialNoise(aerialXZ * 0.19 + vec2(19.7, -8.4));\nfloat aerialFine = aerialNoise(aerialXZ * 0.82 + vec2(-31.2, 14.6));\nfloat aerialMicro = aerialHash(floor(aerialXZ * 2.6));\n\nfloat waterSignal = smoothstep(0.035, 0.13, aerialBase.b - aerialBase.r)\n  * smoothstep(0.005, 0.075, aerialBase.b - aerialBase.g);\n\nfloat forestPatch = smoothstep(0.58, 0.80, aerialMacro * 0.68 + aerialMeso * 0.32);\nfloat woodlandPatch = smoothstep(0.43, 0.67, aerialMeso) * (1.0 - forestPatch * 0.70);\nfloat wetlandPatch = smoothstep(0.68, 0.86, aerialMacro * 0.56 + aerialFine * 0.44);\nfloat openingPatch = smoothstep(0.63, 0.84, 1.0 - aerialMeso);\nfloat exposedPatch = smoothstep(0.72, 0.90, 1.0 - aerialMacro) * smoothstep(0.52, 0.82, aerialFine);\n\nvec3 forestColor = aerialBase * vec3(0.38, 0.64, 0.40);\nvec3 woodlandColor = aerialBase * vec3(0.69, 0.89, 0.60);\nvec3 openingColor = aerialBase * vec3(1.14, 1.06, 0.72);\nvec3 wetlandColor = mix(aerialBase * vec3(0.46, 0.78, 0.68), vec3(0.060, 0.235, 0.205), 0.31);\nvec3 exposedColor = mix(aerialBase, vec3(0.49, 0.37, 0.20), 0.57);\n\nvec3 aerialLand = aerialBase;\naerialLand = mix(aerialLand, woodlandColor, woodlandPatch * 0.48);\naerialLand = mix(aerialLand, forestColor, forestPatch * 0.76);\naerialLand = mix(aerialLand, wetlandColor, wetlandPatch * 0.56);\naerialLand = mix(aerialLand, openingColor, openingPatch * 0.48);\naerialLand = mix(aerialLand, exposedColor, exposedPatch * 0.34);\n\nfloat aerialTexture = (aerialFine - 0.50) * 0.17 + (aerialMicro - 0.50) * 0.040;\naerialLand *= 1.0 + aerialTexture;\n\nvec3 dx = dFdx(vAerialWorldPosition);\nvec3 dy = dFdy(vAerialWorldPosition);\nvec3 aerialNormal = normalize(cross(dx, dy));\nif (aerialNormal.y < 0.0) aerialNormal = -aerialNormal;\nvec3 aerialSun = normalize(vec3(0.43, 0.82, 0.38));\nfloat aerialHillshade = clamp(0.69 + max(0.0, dot(aerialNormal, aerialSun)) * 0.47, 0.60, 1.13);\nfloat aerialSlope = clamp(1.0 - aerialNormal.y, 0.0, 1.0);\naerialLand *= aerialHillshade;\naerialLand = mix(aerialLand, aerialLand * vec3(0.77, 0.74, 0.67), aerialSlope * 0.24);\n\n// Cheap photographic-style finishing: expand tonal range and chroma without\n// adding another procedural octave. This counteracts the washed-out look of the\n// large streamed regional footprint while preserving deterministic science color.\nfloat aerialLuma = dot(aerialLand, vec3(0.2126, 0.7152, 0.0722));\naerialLand = mix(vec3(aerialLuma), aerialLand, 1.16);\naerialLand = (aerialLand - vec3(0.34)) * 1.12 + vec3(0.34);\n\nvec3 aerialWater = aerialBase * (0.90 + (aerialFine - 0.5) * 0.10);\ndiffuseColor.rgb = clamp(mix(aerialLand, aerialWater, waterSignal), vec3(0.018), vec3(0.92));`
      )
      .replace(
        `vec3 aerialSun = normalize(vec3(0.43, 0.82, 0.38));
float aerialHillshade = clamp(0.69 + max(0.0, dot(aerialNormal, aerialSun)) * 0.47, 0.60, 1.13);
float aerialSlope = clamp(1.0 - aerialNormal.y, 0.0, 1.0);
aerialLand *= aerialHillshade;
aerialLand = mix(aerialLand, aerialLand * vec3(0.77, 0.74, 0.67), aerialSlope * 0.24);`,
        `vec3 aerialSun = normalize(vec3(0.43, 0.82, 0.38));
// Center the relief light on a flat surface. Faces turned toward the sun become
// brighter and opposing faces darker, while level ground retains its original
// science color instead of being uniformly washed brighter.
float aerialDirectionalRelief = dot(aerialNormal, aerialSun) - aerialSun.y;
float aerialHillshade = clamp(1.0 + aerialDirectionalRelief * 1.72, 0.52, 1.30);
float aerialSlope = sqrt(max(0.0, 1.0 - aerialNormal.y * aerialNormal.y));
float aerialSlopeEmphasis = smoothstep(0.018, 0.34, aerialSlope);
aerialLand *= aerialHillshade;
aerialLand = mix(aerialLand, aerialLand * vec3(0.64, 0.67, 0.58), aerialSlopeEmphasis * 0.30);`
      )
      .replace(
        "#include <clipping_planes_pars_fragment>",
        "#include <clipping_planes_pars_fragment>\nvarying float vAerialDistanceKm;"
      )
      .replace(
        "#include <alphatest_fragment>",
        `// Circularly blend the finite high-detail mesh into the real Earth
// sphere underneath it. A continuous alpha ramp avoids the conspicuous dark
// checkerboard that screen-door dithering creates after mobile downsampling.
// Apply coverage before alpha test/output; changing diffuseColor after
// opaque_fragment has already written gl_FragColor cannot affect the image.
float aerialDetailCoverage = 1.0 - smoothstep(285.0, 365.0, vAerialDistanceKm);
diffuseColor.a *= aerialDetailCoverage;
#include <alphatest_fragment>`
      );
  };

  material.userData.setPlanetCurvature = ({ centerX = 0, centerZ = 0, strength = 0, radiusKm = EARTH_MEAN_RADIUS_KM } = {}) => {
    curvature.centerX = Number(centerX) || 0;
    curvature.centerZ = Number(centerZ) || 0;
    curvature.strength = Math.min(1, Math.max(0, Number(strength) || 0));
    curvature.radiusKm = Math.max(1, Number(radiusKm) || EARTH_MEAN_RADIUS_KM);
    const shader = curvature.shader;
    if (shader) {
      shader.uniforms.uAerialCurvatureCenter.value.set(curvature.centerX, curvature.centerZ);
      shader.uniforms.uAerialCurvatureStrength.value = curvature.strength;
      shader.uniforms.uAerialEarthRadiusKm.value = curvature.radiusKm;
    }
  };
  material.userData.planetCurvature = curvature;
  material.customProgramCacheKey = () => "earth777-regional-aerial-mosaic-v10-topographic-relief";
  material.userData.presentation = "science-colored-aerial-fragment-mosaic-v10-topographic-relief";
  return material;
}
