import * as THREE from 'three';

/**
 * Erstellt das Bedazzled-Masken-Icon als THREE.Group.
 *
 * Verwendung:
 * const mask = createBedazzledMask();
 * scene.add(mask);
 */
export function createBedazzledMask({
  scale = 1,
  blueColor = 0x429cff,
  yellowColor = 0xffc33d,
  faceColor = 0x241536,
  castShadow = true,
  receiveShadow = true,
} = {}) {
  const root = new THREE.Group();
  root.name = 'BedazzledMask';

  const blueMaterial = createGlossyMaterial(blueColor);
  const yellowMaterial = createGlossyMaterial(yellowColor);

  const faceMaterial = new THREE.MeshPhysicalMaterial({
    color: faceColor,
    roughness: 0.28,
    metalness: 0.02,
    clearcoat: 0.45,
    clearcoatRoughness: 0.25,
  });

  const blueMask = createMask({
    type: 'comedy',
    material: blueMaterial,
    faceMaterial,
    width: 1.65,
    height: 1.9,
    depth: 0.18,
  });

  blueMask.position.set(-0.33, 0.12, 0.2);
  blueMask.rotation.set(
    THREE.MathUtils.degToRad(-3),
    THREE.MathUtils.degToRad(10),
    THREE.MathUtils.degToRad(-16),
  );

  const yellowMask = createMask({
    type: 'tragedy',
    material: yellowMaterial,
    faceMaterial,
    width: 1.6,
    height: 1.86,
    depth: 0.17,
  });

  yellowMask.position.set(0.48, -0.13, -0.02);
  yellowMask.rotation.set(
    THREE.MathUtils.degToRad(3),
    THREE.MathUtils.degToRad(-11),
    THREE.MathUtils.degToRad(15),
  );

  root.add(yellowMask);
  root.add(blueMask);

  root.scale.setScalar(scale);

  root.traverse((object) => {
    if (!object.isMesh) return;

    object.castShadow = castShadow;
    object.receiveShadow = receiveShadow;
  });

  return root;
}

function createGlossyMaterial(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.23,
    metalness: 0.02,
    clearcoat: 0.85,
    clearcoatRoughness: 0.18,
    sheen: 0.18,
    sheenColor: new THREE.Color(0xffffff),
    sheenRoughness: 0.4,
  });
}

function createMask({
  type,
  material,
  faceMaterial,
  width,
  height,
  depth,
}) {
  const group = new THREE.Group();

  const bodyShape = createMaskBodyShape(width, height);

  const bodyGeometry = new THREE.ExtrudeGeometry(bodyShape, {
    depth,
    curveSegments: 32,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: 0.075,
    bevelSize: 0.065,
    bevelOffset: -0.018,
    bevelSegments: 7,
  });

  bodyGeometry.center();
  bodyGeometry.computeVertexNormals();

  const body = new THREE.Mesh(bodyGeometry, material);
  body.name = `${type}-mask-body`;

  /*
   * ExtrudeGeometry erzeugt zunächst eine relativ flache Form.
   * Die Skalierung der Tiefe und leichte Rotation erzeugen den
   * Eindruck eines kompakten, gewölbten Emoji-Icons.
   */
  body.scale.z = 1.18;
  group.add(body);

  // WICHTIG: body.scale.z = 1.18 (siehe unten) streckt den Maskenkörper NACH dem
  // Zentrieren zusätzlich in die Tiefe - die reine "depth * 0.73"-Rechnung hat das nicht
  // berücksichtigt, wodurch Augen/Mund effektiv HINTER der (gestreckten) Vorderseite der
  // Maske lagen und verdeckt wurden. Jetzt anhand der tatsächlichen Geometrie berechnet
  // (halbe Tiefe + Bevel-Dicke, mal Streckfaktor, plus Sicherheitsabstand).
  const bodyBevelThickness = 0.075;
  const bodyZStretch = 1.18;
  const faceZ = (depth / 2 + bodyBevelThickness) * bodyZStretch * 1.8;

  if (type === 'comedy') {
    addComedyFace(group, faceMaterial, faceZ, width, height);
  } else {
    addTragedyFace(group, faceMaterial, faceZ, width, height);
  }

  addCheekHighlights(group, type, faceZ, width, height);
  addSideSoftness(group, material, depth, width, height);

  return group;
}

function createMaskBodyShape(width, height) {
  const w = width / 2;
  const h = height / 2;

  const shape = new THREE.Shape();

  shape.moveTo(-w * 0.64, h * 0.88);

  shape.bezierCurveTo(
    -w * 0.9,
    h * 0.72,
    -w * 1.02,
    h * 0.32,
    -w * 0.91,
    -h * 0.12,
  );

  shape.bezierCurveTo(
    -w * 0.83,
    -h * 0.5,
    -w * 0.55,
    -h * 0.82,
    -w * 0.2,
    -h * 0.95,
  );

  shape.bezierCurveTo(
    0,
    -h * 1.04,
    w * 0.23,
    -h * 0.97,
    w * 0.43,
    -h * 0.77,
  );

  shape.bezierCurveTo(
    w * 0.77,
    -h * 0.45,
    w * 0.97,
    -h * 0.05,
    w * 0.95,
    h * 0.4,
  );

  shape.bezierCurveTo(
    w * 0.93,
    h * 0.76,
    w * 0.68,
    h * 0.95,
    w * 0.35,
    h * 1.0,
  );

  shape.bezierCurveTo(
    w * 0.03,
    h * 1.05,
    -w * 0.34,
    h * 1.02,
    -w * 0.64,
    h * 0.88,
  );

  shape.closePath();
  return shape;
}

function addComedyFace(group, material, z, width, height) {
  const eyeY = height * 0.17;

  const leftEye = createCurvedFeature({
    width: width * 0.34,
    thickness: width * 0.08,
    curvature: 0.38,
    material,
  });

  leftEye.position.set(-width * 0.22, eyeY, z);
  leftEye.rotation.z = THREE.MathUtils.degToRad(-5);

  const rightEye = leftEye.clone();
  rightEye.position.x = width * 0.22;
  rightEye.rotation.z = THREE.MathUtils.degToRad(5);

  const mouth = createSmileMouth({
    width: width * 0.83,
    height: height * 0.39,
    thickness: width * 0.095,
    material,
  });

  mouth.position.set(0, -height * 0.19, z + 0.01);

  group.add(leftEye, rightEye, mouth);
}

function addTragedyFace(group, material, z, width, height) {
  const eyeY = height * 0.17;

  const leftEye = createSadEye({
    width: width * 0.35,
    thickness: width * 0.085,
    material,
    mirror: false,
  });

  leftEye.position.set(-width * 0.22, eyeY, z);

  const rightEye = createSadEye({
    width: width * 0.35,
    thickness: width * 0.085,
    material,
    mirror: true,
  });

  rightEye.position.set(width * 0.22, eyeY, z);

  const mouth = createSadMouth({
    width: width * 0.61,
    height: height * 0.3,
    thickness: width * 0.09,
    material,
  });

  mouth.position.set(0, -height * 0.31, z + 0.01);

  group.add(leftEye, rightEye, mouth);
}

function createCurvedFeature({
  width,
  thickness,
  curvature,
  material,
}) {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-width / 2, 0, 0),
    new THREE.Vector3(0, -curvature * width, 0),
    new THREE.Vector3(width / 2, 0, 0),
  );

  const geometry = new THREE.TubeGeometry(
    curve,
    28,
    thickness / 2,
    12,
    false,
  );

  return new THREE.Mesh(geometry, material);
}

function createSadEye({
  width,
  thickness,
  material,
  mirror,
}) {
  const direction = mirror ? -1 : 1;

  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-width / 2, -width * 0.06 * direction, 0),
    new THREE.Vector3(0, width * 0.25, 0),
    new THREE.Vector3(width / 2, width * 0.06 * direction, 0),
  );

  const geometry = new THREE.TubeGeometry(
    curve,
    24,
    thickness / 2,
    12,
    false,
  );

  return new THREE.Mesh(geometry, material);
}

function createSmileMouth({
  width,
  height,
  thickness,
  material,
}) {
  const shape = new THREE.Shape();

  shape.moveTo(-width / 2, height * 0.18);

  shape.bezierCurveTo(
    -width * 0.31,
    -height * 0.2,
    -width * 0.17,
    -height * 0.43,
    0,
    -height * 0.46,
  );

  shape.bezierCurveTo(
    width * 0.17,
    -height * 0.43,
    width * 0.31,
    -height * 0.2,
    width / 2,
    height * 0.18,
  );

  shape.bezierCurveTo(
    width * 0.29,
    height * 0.02,
    width * 0.15,
    -height * 0.08,
    0,
    -height * 0.1,
  );

  shape.bezierCurveTo(
    -width * 0.15,
    -height * 0.08,
    -width * 0.29,
    height * 0.02,
    -width / 2,
    height * 0.18,
  );

  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    curveSegments: 28,
    bevelEnabled: true,
    bevelThickness: thickness * 0.2,
    bevelSize: thickness * 0.18,
    bevelSegments: 4,
  });

  geometry.center();
  geometry.computeVertexNormals();

  return new THREE.Mesh(geometry, material);
}

function createSadMouth({
  width,
  height,
  thickness,
  material,
}) {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-width / 2, -height * 0.22, 0),
    new THREE.Vector3(0, height * 0.5, 0),
    new THREE.Vector3(width / 2, -height * 0.22, 0),
  );

  const geometry = new THREE.TubeGeometry(
    curve,
    32,
    thickness / 2,
    14,
    false,
  );

  return new THREE.Mesh(geometry, material);
}

function addCheekHighlights(group, type, z, width, height) {
  const highlightMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: type === 'comedy' ? 0.11 : 0.08,
    depthWrite: false,
  });

  const geometry = new THREE.SphereGeometry(
    width * 0.16,
    24,
    16,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.52,
  );

  const highlight = new THREE.Mesh(geometry, highlightMaterial);

  highlight.scale.set(1.35, 0.42, 0.18);
  highlight.position.set(
    -width * 0.23,
    height * 0.37,
    z + 0.07,
  );

  highlight.rotation.z = THREE.MathUtils.degToRad(-22);
  group.add(highlight);
}

function addSideSoftness(group, material, depth, width, height) {
  const sideGeometry = new THREE.SphereGeometry(1, 28, 18);

  const side = new THREE.Mesh(sideGeometry, material);
  side.scale.set(
    width * 0.49,
    height * 0.47,
    depth * 0.68,
  );

  side.position.z = -depth * 0.2;
  side.renderOrder = -1;

  group.add(side);
}

/**
 * Optionale Beleuchtung, passend zum Icon-Look.
 */
export function addBedazzledMaskLighting(scene) {
  const lighting = new THREE.Group();
  lighting.name = 'BedazzledMaskLighting';

  const ambient = new THREE.HemisphereLight(
    0xd6c8ff,
    0x190d2b,
    1.65,
  );

  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(-3.5, 5, 5);

  const purpleRim = new THREE.PointLight(
    0xa355ff,
    5,
    10,
    1.8,
  );

  purpleRim.position.set(3.2, 1.2, -1.5);

  const blueFill = new THREE.PointLight(
    0x54caff,
    2.8,
    8,
    2,
  );

  blueFill.position.set(-3, -1.5, 3);

  lighting.add(ambient, key, purpleRim, blueFill);
  scene.add(lighting);

  return lighting;
}

/**
 * Kleine Idle-Animation.
 *
 * In der Renderloop:
 * animateBedazzledMask(mask, clock.getElapsedTime());
 */
export function animateBedazzledMask(mask, elapsedTime) {
  mask.rotation.y =
    Math.sin(elapsedTime * 0.65) * 0.13;

  mask.rotation.x =
    Math.sin(elapsedTime * 0.42) * 0.035;

  mask.position.y =
    Math.sin(elapsedTime * 1.05) * 0.045;
}

/**
 * Gibt alle Geometrien und Materialien wieder frei.
 */
export function disposeBedazzledMask(mask) {
  const geometries = new Set();
  const materials = new Set();

  mask.traverse((object) => {
    if (!object.isMesh) return;

    if (object.geometry) {
      geometries.add(object.geometry);
    }

    if (Array.isArray(object.material)) {
      object.material.forEach((material) => materials.add(material));
    } else if (object.material) {
      materials.add(object.material);
    }
  });

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

// ---------- Anbindung an unsere Avatar-Registry ----------
// Die anderen Figuren exportieren eine build(colorHex)-Funktion, die eine fertige
// THREE.Group zurückgibt (siehe avatars/README.md). Das Maskenicon nutzt bewusst zwei feste
// Farben (Blau+Gelb, wie im Original-Emoji/Referenzbild) statt der generischen
// Avatar-Akzentfarbe - genau wie Krone/Stern auch feste Edelstein-Farben statt der
// Akzentfarbe verwenden. Zusätzlich auf die in diesem Projekt übliche Figurengröße
// herunterskaliert (das Original ist in deutlich größeren Einheiten gebaut).
export function build(colorHex) {
  return createBedazzledMask({ scale: 0.19 });
}

export default build;
