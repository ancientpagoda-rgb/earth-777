const chunks = 6;
const parts = await Promise.all(Array.from({ length: chunks }, (_, index) =>
  fetch(`./app-${index}.b64`, { cache: 'force-cache' }).then((response) => {
    if (!response.ok) throw new Error(`Lite app source ${index}: ${response.status}`);
    return response.text();
  })
));
const binary = atob(parts.join(''));
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

// The sharded app source is generated as one compact module. Keep the worker
// scheduler's one-in-flight-state contract explicit here: every successful
// worker state must release simBusy, otherwise the initial `init` response
// leaves playback permanently locked and no later `step` can be posted.
const sourceText = new TextDecoder().decode(bytes);
const workerReadyMarker = "document.body.dataset.worker='ready';";
if (!sourceText.includes(workerReadyMarker)) {
  throw new Error('Lite worker-ready contract missing from generated app source');
}
let source = sourceText.replace(
  workerReadyMarker,
  `simBusy=false;${workerReadyMarker}`,
);

// Surface mode is a direct-manipulation map: the terrain under the pointer must
// follow the mouse on both axes. Longitude already has that grab-and-pan sign,
// but the generated vertical formula used the opposite sign, so dragging up/down
// moved the terrain away from the pointer. Correct only that generated expression.
const surfacePanMarker = "surfaceLat=clamp(surfaceLat-(now.y-old.y)/innerHeight*surfaceSpanKm/111,-89,89);";
if (!source.includes(surfacePanMarker)) {
  throw new Error('Lite surface mouse-pan contract missing from generated app source');
}
source = source.replace(
  surfacePanMarker,
  "surfaceLat=clamp(surfaceLat+(now.y-old.y)/innerHeight*surfaceSpanKm/111,-89,89);",
);

// Surface Naturalism keeps the existing one-instanced-mesh vegetation budget but
// gives the mesh a small family of biome-specific silhouettes. Geometry swaps are
// O(1), so rainforest crowns, boreal conifers, savanna trees and scrub can read
// differently without adding draw calls or raising the 220/520 population caps.
const plantMeshMarker = "const plantMax=lowQuality?220:520,plantMesh=new THREE.InstancedMesh(new THREE.ConeGeometry(.026,.13,5),new THREE.MeshLambertMaterial({color:0x4eaa62}),plantMax);plantMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);surfaceGroup.add(plantMesh);const plantDummy=new THREE.Object3D();";
if (!source.includes(plantMeshMarker)) {
  throw new Error('Lite surface plant geometry contract missing from generated app source');
}
source = source.replace(plantMeshMarker, [
  "function makeNaturalTreeGeometry(kind='temperate'){const specs={rainforest:{trunkH:.078,trunkR:.011,crownR:.049,crownY:.126,sx:1.18,sy:1.02,sz:1.1,trunk:0x5e432f,crown:0x39794a},temperate:{trunkH:.066,trunkR:.011,crownR:.041,crownY:.105,sx:1,sy:.9,sz:1,trunk:0x684831,crown:0x4f9858},boreal:{trunkH:.07,trunkR:.009,crownR:.041,crownY:.105,sx:1,sy:1,sz:1,trunk:0x5f4733,crown:0x376c4a},savanna:{trunkH:.085,trunkR:.009,crownR:.043,crownY:.125,sx:1.45,sy:.5,sz:1.25,trunk:0x775735,crown:0x768c47},scrub:{trunkH:.028,trunkR:.007,crownR:.031,crownY:.05,sx:1.35,sy:.58,sz:1.25,trunk:0x6d543a,crown:0x6f8452},tundra:{trunkH:.018,trunkR:.006,crownR:.024,crownY:.034,sx:1.3,sy:.48,sz:1.2,trunk:0x665849,crown:0x7e8e72}},s=specs[kind]||specs.temperate,trunkSource=new THREE.CylinderGeometry(s.trunkR*.72,s.trunkR,s.trunkH,5,1,false);trunkSource.translate(0,s.trunkH*.5,0);let crownSource;if(kind==='boreal'){crownSource=new THREE.ConeGeometry(s.crownR,s.crownR*2.7,7,1,false);crownSource.translate(0,s.crownY,0)}else{crownSource=new THREE.IcosahedronGeometry(s.crownR,0);crownSource.scale(s.sx,s.sy,s.sz);crownSource.translate(0,s.crownY,0)}const trunk=trunkSource.index?trunkSource.toNonIndexed():trunkSource,crown=crownSource.index?crownSource.toNonIndexed():crownSource,tp=trunk.attributes.position.array,cp=crown.attributes.position.array,p=new Float32Array(tp.length+cp.length),c=new Float32Array(tp.length+cp.length),trunkColor=new THREE.Color(s.trunk),crownColor=new THREE.Color(s.crown);p.set(tp);p.set(cp,tp.length);for(let i=0;i<tp.length;i+=3){c[i]=trunkColor.r;c[i+1]=trunkColor.g;c[i+2]=trunkColor.b}for(let i=tp.length;i<c.length;i+=3){c[i]=crownColor.r;c[i+1]=crownColor.g;c[i+2]=crownColor.b}const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(p,3));geometry.setAttribute('color',new THREE.BufferAttribute(c,3));geometry.computeVertexNormals();return geometry}",
  "const biomePlantGeometries={rainforest:makeNaturalTreeGeometry('rainforest'),temperate:makeNaturalTreeGeometry('temperate'),boreal:makeNaturalTreeGeometry('boreal'),savanna:makeNaturalTreeGeometry('savanna'),scrub:makeNaturalTreeGeometry('scrub'),tundra:makeNaturalTreeGeometry('tundra')};",
  "const BIOME_SURFACE_STYLES={ocean:{key:'ocean',plant:'scrub',density:0,ground:0xffffff,river:0x4f9fba,water:0x255f78,riverWidth:.5,riverOpacity:.62,waterOpacity:.52},ice:{key:'ice',plant:'tundra',density:0,ground:0xe8f1f2,river:0x9ed8ea,water:0x6fb4ce,riverWidth:.5,riverOpacity:.78,waterOpacity:.5},tundra:{key:'tundra',plant:'tundra',density:.24,ground:0xc5cbbd,river:0x74b4ca,water:0x3f7e99,riverWidth:.62,riverOpacity:.82,waterOpacity:.53},desert:{key:'desert',plant:'scrub',density:.12,ground:0xe1c597,river:0x78aeb4,water:0x3e7782,riverWidth:.48,riverOpacity:.7,waterOpacity:.48},grassland:{key:'grassland',plant:'savanna',density:.48,ground:0xd5c88c,river:0x5ca6bd,water:0x34758c,riverWidth:.78,riverOpacity:.84,waterOpacity:.54},shrubland:{key:'shrubland',plant:'scrub',density:.68,ground:0xc1b48e,river:0x58a7bf,water:0x347991,riverWidth:.72,riverOpacity:.84,waterOpacity:.54},'temperate forest':{key:'temperate-forest',plant:'temperate',density:.96,ground:0xb8c99f,river:0x4da4c4,water:0x2d718d,riverWidth:1,riverOpacity:.9,waterOpacity:.58},rainforest:{key:'rainforest',plant:'rainforest',density:1,ground:0x9fbe8d,river:0x45a9c2,water:0x266d83,riverWidth:1.22,riverOpacity:.94,waterOpacity:.6},'boreal forest':{key:'boreal-forest',plant:'boreal',density:.86,ground:0xaab9a1,river:0x62afc8,water:0x39798f,riverWidth:.92,riverOpacity:.9,waterOpacity:.56},alpine:{key:'alpine',plant:'tundra',density:.2,ground:0xd0d1c6,river:0x75bdd6,water:0x43859f,riverWidth:.68,riverOpacity:.88,waterOpacity:.52}};",
  "let activeBiomeSurfaceKey='',activeBiomeRiverOpacity=.92,activeBiomeWaterOpacity=.58;",
  "function surfaceBiomeStyle(){const name=BIOME_NAMES[biome[stateIndex(surfaceLat,surfaceLon)]]||'shrubland';return BIOME_SURFACE_STYLES[name]||BIOME_SURFACE_STYLES.shrubland}",
  "function applyBiomeSurfaceCharacter(adjustDensity=false){const style=surfaceBiomeStyle(),changed=style.key!==activeBiomeSurfaceKey;if(changed){activeBiomeSurfaceKey=style.key;plantMesh.geometry=biomePlantGeometries[style.plant]||biomePlantGeometries.temperate;activeBiomeRiverOpacity=style.riverOpacity;activeBiomeWaterOpacity=style.waterOpacity;riverLines.material.color.setHex(style.river);waterMesh.material.color?.setHex(style.water);document.body.dataset.surfaceBiomeStyle=style.key;document.body.dataset.surfaceTreeStyle=style.plant;document.body.dataset.surfaceRiverStyle=`ribbon-${style.key}`}if(surfaceMesh.material.color)surfaceMesh.material.color.setHex(activeLayer==='terrain'?style.ground:0xffffff);if(adjustDensity){plantMesh.count=Math.min(plantMesh.count,Math.floor(plantMesh.count*style.density));document.body.dataset.surfacePlantDensity=style.density.toFixed(2)}return style}",
  "const plantMax=lowQuality?220:520,plantMesh=new THREE.InstancedMesh(biomePlantGeometries.temperate,new THREE.MeshLambertMaterial({vertexColors:true}),plantMax);plantMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);surfaceGroup.add(plantMesh);const plantDummy=new THREE.Object3D();"
].join('\n  '));

// Rivers become shallow lit ribbons instead of one-pixel line segments. Each old
// segment expands to two triangles with a tiny overlap at its ends, which hides
// most grid-joint gaps while keeping the amount of geometry proportional to the
// already-generated river network. Width scales with view span and center-biome
// hydrology while the number of river triangles remains unchanged.
const riverMeshMarker = "const riverGeom=new THREE.BufferGeometry(),riverLines=new THREE.LineSegments(riverGeom,new THREE.LineBasicMaterial({color:0x62c8ea,transparent:true,opacity:.92}));riverLines.renderOrder=3;surfaceGroup.add(riverLines);";
if (!source.includes(riverMeshMarker)) {
  throw new Error('Lite surface river geometry contract missing from generated app source');
}
source = source.replace(riverMeshMarker, [
  "function updateNaturalRiverRibbons(segments){const count=Math.floor(segments.length/6),expanded=new Float32Array(count*18),style=surfaceBiomeStyle(),halfWidth=clamp(.025*Math.sqrt(620/Math.max(70,surfaceSpanKm))*style.riverWidth,.005,.04);let o=0;for(let i=0;i+5<segments.length;i+=6){let ax=segments[i],ay=segments[i+1]+.004,az=segments[i+2],bx=segments[i+3],by=segments[i+4]+.004,bz=segments[i+5],dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz);if(len<1e-5)continue;const ux=dx/len,uz=dz/len,cap=Math.min(halfWidth*.7,len*.08),nx=-uz*halfWidth,nz=ux*halfWidth;ax-=ux*cap;az-=uz*cap;bx+=ux*cap;bz+=uz*cap;expanded.set([ax+nx,ay,az+nz,ax-nx,ay,az-nz,bx-nx,by,bz-nz,ax+nx,ay,az+nz,bx-nx,by,bz-nz,bx+nx,by,bz+nz],o);o+=18}const positions=o===expanded.length?expanded:expanded.slice(0,o);riverGeom.setAttribute('position',new THREE.BufferAttribute(positions,3));if(o){riverGeom.computeVertexNormals();riverGeom.computeBoundingSphere()}else riverGeom.boundingSphere=new THREE.Sphere(new THREE.Vector3(),0)}",
  "const riverGeom=new THREE.BufferGeometry(),riverLines=new THREE.Mesh(riverGeom,new THREE.MeshPhongMaterial({color:0x55b9d9,transparent:true,opacity:.92,shininess:90,depthWrite:false,side:THREE.DoubleSide}));riverLines.renderOrder=3;surfaceGroup.add(riverLines);"
].join('\n  '));
const riverUpdateMarker = "riverGeom.setAttribute('position',new THREE.Float32BufferAttribute(riverPositions,3));riverGeom.computeBoundingSphere();riverLines.visible=activeLayer==='terrain'||activeLayer==='moisture';";
if (!source.includes(riverUpdateMarker)) {
  throw new Error('Lite surface river update contract missing from generated app source');
}
source = source.replace(
  riverUpdateMarker,
  "updateNaturalRiverRibbons(riverPositions);riverLines.visible=activeLayer==='terrain'||activeLayer==='moisture';",
);
document.body.dataset.surfaceNaturalism = 'biome-character-v1';

// Seamless Planetary Zoom keeps the user in surface mode while the presentation
// continuously hands off from the local tangent reconstruction to the existing
// globe. The geographic center stays authoritative throughout the handoff, so
// zooming back in reconstructs the same location instead of teleporting or
// switching to a second navigation state.
const surfaceModeStateMarker = "let mode='globe',surfaceLat=selectedLat??0,surfaceLon=selectedLon??0,surfaceSpanKm=620,surfaceDirty=true;";
if (!source.includes(surfaceModeStateMarker)) {
  throw new Error('Lite surface-mode state contract missing from generated app source');
}
source = source.replace(surfaceModeStateMarker, [
  surfaceModeStateMarker,
  "const PLANETARY_BLEND_START_KM=5200,PLANETARY_BLEND_END_KM=12000,PLANETARY_GLOBE_REVEAL_KM=5200,PLANETARY_DETAIL_CUTOFF_KM=12000,PLANETARY_MAX_SPAN_KM=40000,PLANETARY_DRAG_SPAN_KM=20000;",
  "const planetaryMaterialState=[],planetaryMaterialSeen=new Set(),planetaryPoint=new THREE.Vector3(),planetaryNorth=new THREE.Vector3(),planetaryFace=new THREE.Vector3(0,0,1),planetaryAxisZ=new THREE.Vector3(0,0,1),planetaryCenterQ=new THREE.Quaternion(),planetaryRollQ=new THREE.Quaternion();",
  "globeRoot.traverse(object=>{const list=Array.isArray(object.material)?object.material:[object.material];for(const material of list){if(!material||planetaryMaterialSeen.has(material))continue;planetaryMaterialSeen.add(material);planetaryMaterialState.push({material,opacity:material.opacity,transparent:material.transparent,depthWrite:material.depthWrite})}});",
  "function planetaryZoomBlend(){const raw=clamp((Math.log(surfaceSpanKm)-Math.log(PLANETARY_BLEND_START_KM))/(Math.log(PLANETARY_BLEND_END_KM)-Math.log(PLANETARY_BLEND_START_KM)),0,1);return raw*raw*(3-2*raw)}",
  "function planetaryFarZoom(){const raw=clamp((Math.log(surfaceSpanKm)-Math.log(PLANETARY_BLEND_END_KM))/(Math.log(PLANETARY_MAX_SPAN_KM)-Math.log(PLANETARY_BLEND_END_KM)),0,1);return raw*raw*(3-2*raw)}",
  "function surfaceDragSpanKm(){return Math.min(surfaceSpanKm,PLANETARY_DRAG_SPAN_KM)}",
  "function centerGlobeOnSurface(){const lat=surfaceLat*Math.PI/180,lon=surfaceLon*Math.PI/180,sinLat=Math.sin(lat),cosLat=Math.cos(lat),sinLon=Math.sin(lon),cosLon=Math.cos(lon);planetaryPoint.set(cosLat*cosLon,FY*sinLat,-cosLat*sinLon).normalize();planetaryCenterQ.setFromUnitVectors(planetaryPoint,planetaryFace);planetaryNorth.set(-sinLat*cosLon,FY*cosLat,sinLat*sinLon).normalize().applyQuaternion(planetaryCenterQ);planetaryRollQ.setFromAxisAngle(planetaryAxisZ,Math.atan2(planetaryNorth.x,planetaryNorth.y));globeRoot.quaternion.copy(planetaryRollQ).multiply(planetaryCenterQ).normalize()}",
  "function setPlanetaryGlobeOpacity(alpha){if(surfaceSpanKm<PLANETARY_GLOBE_REVEAL_KM){globeRoot.visible=false;for(const state of planetaryMaterialState){state.material.opacity=0;state.material.transparent=true;state.material.depthWrite=false}return}const value=clamp(alpha,0,1);globeRoot.visible=value>.002;for(const state of planetaryMaterialState){const transparent=value<.999?true:state.transparent;if(state.material.transparent!==transparent){state.material.transparent=transparent;state.material.needsUpdate=true}state.material.opacity=state.opacity*value;state.material.depthWrite=value>.92?state.depthWrite:false}}",
  "function restorePlanetaryPresentation(){for(const state of planetaryMaterialState){if(state.material.transparent!==state.transparent){state.material.transparent=state.transparent;state.material.needsUpdate=true}state.material.opacity=state.opacity;state.material.depthWrite=state.depthWrite}surfaceMesh.material.opacity=1;surfaceMesh.material.transparent=false;surfaceMesh.material.needsUpdate=true;waterMesh.material.opacity=activeBiomeWaterOpacity;plantMesh.material.opacity=1;animalMesh.material.opacity=1;riverLines.material.opacity=activeBiomeRiverOpacity;delete document.body.dataset.surfaceSpanKm;delete document.body.dataset.surfaceZoomBlend;delete document.body.dataset.planetaryZoom}",
  "function applySurfaceZoomPresentation(){if(mode!=='surface')return;applyBiomeSurfaceCharacter(false);const t=planetaryZoomBlend(),far=planetaryFarZoom(),local=1-t;selectionMarker.visible=false;if(t>.001)centerGlobeOnSurface();setPlanetaryGlobeOpacity(t);surfaceGroup.visible=t<.999;surfaceMesh.material.transparent=true;surfaceMesh.material.opacity=local;waterMesh.material.opacity=activeBiomeWaterOpacity*local;plantMesh.material.transparent=true;plantMesh.material.opacity=local;animalMesh.material.transparent=true;animalMesh.material.opacity=local;riverLines.material.opacity=activeBiomeRiverOpacity*local;if(surfaceSpanKm>1800){plantMesh.visible=false;animalMesh.visible=false}if(surfaceSpanKm>6000)riverLines.visible=false;const cameraZ=t<.999?mix(6.8,3.25,t):mix(3.25,5.5,far);camera.position.set(0,mix(4.25,.12,t),cameraZ);camera.lookAt(0,mix(-.25,0,t),0);document.body.dataset.surfaceSpanKm=surfaceSpanKm.toFixed(1);document.body.dataset.surfaceZoomBlend=t.toFixed(4);document.body.dataset.planetaryZoom=t>=.999?'globe':t>.001?'transition':'surface'}"
].join('\n  '));

// Once the globe has fully taken over, stop spending time rebuilding the local
// terrain/ecology mesh. Zooming back below the handoff threshold marks the
// surface dirty again through the normal wheel/pinch path and reconstructs it.
const rebuildMarker = "if(mode!=='surface')return;\n    const scale=12/surfaceSpanKm";
if (!source.includes(rebuildMarker)) {
  throw new Error('Lite surface rebuild contract missing from generated app source');
}
source = source.replace(
  rebuildMarker,
  "if(mode!=='surface')return;\n    if(surfaceSpanKm>=PLANETARY_DETAIL_CUTOFF_KM){surfaceDirty=false;applySurfaceZoomPresentation();return;}\n    const scale=12/surfaceSpanKm",
);

// Re-apply biome character and the planetary handoff after each local rebuild.
// The density multiplier is applied only here, after the base vegetation count is
// regenerated from the actual evolving green field, so repeated zoom callbacks
// cannot progressively erase the vegetation.
const rebuildEndMarker = "  }\n  const ray=new THREE.Raycaster();";
if (!source.includes(rebuildEndMarker)) {
  throw new Error('Lite surface rebuild-end contract missing from generated app source');
}
source = source.replace(
  rebuildEndMarker,
  "    applyBiomeSurfaceCharacter(true);applySurfaceZoomPresentation();\n  }\n  const ray=new THREE.Raycaster();",
);

// At planetary scale, dragging still changes the authoritative geographic center,
// which is then used to rotate the globe. Cap the physical span used by drag so a
// full-width gesture remains about a half-turn instead of becoming hypersensitive.
const surfaceLonPanMarker = "surfaceLon=wrapLon(surfaceLon-(now.x-old.x)/innerWidth*surfaceSpanKm/(111*cos));";
if (!source.includes(surfaceLonPanMarker)) {
  throw new Error('Lite surface longitude-pan contract missing from generated app source');
}
source = source.replace(
  surfaceLonPanMarker,
  "surfaceLon=wrapLon(surfaceLon-(now.x-old.x)/innerWidth*surfaceDragSpanKm()/(111*cos));",
);
const correctedSurfaceLatPanMarker = "surfaceLat=clamp(surfaceLat+(now.y-old.y)/innerHeight*surfaceSpanKm/111,-89,89);";
if (!source.includes(correctedSurfaceLatPanMarker)) {
  throw new Error('Lite corrected surface latitude-pan contract missing from generated app source');
}
source = source.replace(
  correctedSurfaceLatPanMarker,
  "surfaceLat=clamp(surfaceLat+(now.y-old.y)/innerHeight*surfaceDragSpanKm()/111,-89,89);applySurfaceZoomPresentation();",
);

// Wheel and pinch can now traverse the whole local->planet range without changing
// mode. Every input update immediately refreshes camera, crossfade and diagnostics.
const pinchZoomMarker = "surfaceSpanKm=clamp(surfaceSpanKm*factor,70,1800);surfaceDirty=true";
if (!source.includes(pinchZoomMarker)) {
  throw new Error('Lite surface pinch-zoom contract missing from generated app source');
}
source = source.replace(
  pinchZoomMarker,
  "surfaceSpanKm=clamp(surfaceSpanKm*factor,70,PLANETARY_MAX_SPAN_KM);surfaceDirty=true;applySurfaceZoomPresentation()",
);
const wheelZoomMarker = "surfaceSpanKm=clamp(surfaceSpanKm*Math.exp(e.deltaY*.0012),70,1800);surfaceDirty=true";
if (!source.includes(wheelZoomMarker)) {
  throw new Error('Lite surface wheel-zoom contract missing from generated app source');
}
source = source.replace(
  wheelZoomMarker,
  "surfaceSpanKm=clamp(surfaceSpanKm*Math.exp(e.deltaY*.0012),70,PLANETARY_MAX_SPAN_KM);surfaceDirty=true;applySurfaceZoomPresentation()",
);

// Surface reset must also restore the local presentation immediately, while an
// explicit Return to Globe restores the globe materials before leaving surface mode.
const surfaceResetMarker = "else{surfaceSpanKm=620;surfaceDirty=true}";
if (!source.includes(surfaceResetMarker)) {
  throw new Error('Lite surface reset contract missing from generated app source');
}
source = source.replace(
  surfaceResetMarker,
  "else{surfaceSpanKm=620;surfaceDirty=true;applySurfaceZoomPresentation()}",
);
const exitSurfaceMarker = "function exitSurface(){mode='globe';";
if (!source.includes(exitSurfaceMarker)) {
  throw new Error('Lite surface exit contract missing from generated app source');
}
source = source.replace(
  exitSurfaceMarker,
  "function exitSurface(){restorePlanetaryPresentation();mode='globe';",
);

const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
try {
  await import(url);
} finally {
  URL.revokeObjectURL(url);
}
