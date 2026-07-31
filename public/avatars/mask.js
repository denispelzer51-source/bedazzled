import * as THREE from 'three';
import { shinyMat } from './shared.js';

// Maske V9: Augen/Mund sind jetzt KEINE echten Löcher mehr in der Form (das hat offenbar
// nicht zuverlässig gerendert - die Aussparungen waren praktisch unsichtbar). Stattdessen:
// solide, dunkle Formen, die direkt VOR das Gesicht gesetzt werden - optisch identisch zum
// "Ausschnitt"-Look im Referenzbild, aber ohne die Fehleranfälligkeit von Extrude-Löchern.
export function build(colorHex) {
  const g = new THREE.Group();

  // Grundform: Theatermasken-Schild mit gewelltem Doppel-Buckel oben, runde Spitze unten
  function outline(shape, s) {
    shape.moveTo(-0.26 * s, 0.08 * s);
    shape.bezierCurveTo(-0.28 * s, 0.25 * s, -0.14 * s, 0.33 * s, 0, 0.2 * s);
    shape.bezierCurveTo(0.14 * s, 0.33 * s, 0.28 * s, 0.25 * s, 0.26 * s, 0.08 * s);
    shape.bezierCurveTo(0.29 * s, -0.1 * s, 0.2 * s, -0.28 * s, 0, -0.34 * s);
    shape.bezierCurveTo(-0.2 * s, -0.28 * s, -0.29 * s, -0.1 * s, -0.26 * s, 0.08 * s);
    shape.closePath();
  }

  // Ein "dicker Kreisbogen" ALS EIGENE, GEFÜLLTE FORM (kein Loch) - zwei konzentrische
  // Bögen (außen vorwärts, innen rückwärts) ergeben eine Sichel-/Bananen-Form.
  function thickArcShape(cx, cy, radius, thickness, startDeg, endDeg) {
    const start = (startDeg * Math.PI) / 180;
    const end = (endDeg * Math.PI) / 180;
    const rOuter = radius + thickness / 2;
    const rInner = Math.max(0.001, radius - thickness / 2);
    const shape = new THREE.Shape();
    shape.absarc(cx, cy, rOuter, start, end, false);
    shape.absarc(cx, cy, rInner, end, start, true);
    shape.closePath();
    return shape;
  }

  function buildFeature(arcShape, depth, z) {
    const geo = new THREE.ExtrudeGeometry(arcShape, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 24 });
    const mat = new THREE.MeshStandardMaterial({ color: '#1a0f33', roughness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = z;
    return mesh;
  }

  function buildOneMask(faceColorTop, faceColorBottom, smiling) {
    const group = new THREE.Group();

    // Solides Gesicht OHNE Löcher - zuverlässig und einfach
    const shape = new THREE.Shape();
    outline(shape, 1);
    const faceGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.02, bevelSegments: 5, curveSegments: 24 });
    faceGeo.center();
    const faceMat = shinyMat(faceColorTop, {
      side: THREE.DoubleSide, metalness: 0.1, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1,
      emissive: faceColorBottom, emissiveIntensity: 0.12,
    });
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.castShadow = true;
    group.add(face);

    // WICHTIG: Bei einem abgeschrägten (bevelEnabled) Extrude kommt die Bevel-Dicke NOCH
    // OBEN AUF die reine "depth" drauf - die echte Vorderseite liegt also bei
    // (depth/2 + bevelThickness), nicht nur bei depth/2. Das war der eigentliche Fehler:
    // die Augen/Mund-Formen lagen dadurch effektiv HINTER der gewölbten Vorderseite des
    // Gesichts und wurden komplett verdeckt. Jetzt mit deutlichem Sicherheitsabstand davor.
    const frontZ = 0.045 / 2 + 0.018 + 0.012; // = echte Vorderseite + Sicherheitsabstand
    if (smiling) {
      group.add(buildFeature(thickArcShape(-0.095, 0.06, 0.09, 0.03, 200, 340), 0.01, frontZ));
      group.add(buildFeature(thickArcShape(0.095, 0.06, 0.09, 0.03, 200, 340), 0.01, frontZ));
      group.add(buildFeature(thickArcShape(0, 0.02, 0.24, 0.11, 25, 155), 0.012, frontZ));
    } else {
      group.add(buildFeature(thickArcShape(-0.1, 0.07, 0.11, 0.025, 165, 245), 0.01, frontZ));
      group.add(buildFeature(thickArcShape(0.1, 0.07, 0.11, 0.025, -65, 15), 0.01, frontZ));
      group.add(buildFeature(thickArcShape(0, -0.26, 0.22, 0.1, 205, 335), 0.012, frontZ));
    }

    return group;
  }

  // Blaue lachende Maske hinten-links - kräftiges Blau
  const happy = buildOneMask('#3FA9F5', '#1565C0', true);
  happy.scale.setScalar(0.62);
  happy.position.set(-0.09, 0.02, -0.02);
  g.add(happy);

  // Gelbe traurige Maske vorne-rechts - kräftiges Gelb/Orange
  const sad = buildOneMask('#FFC93C', '#F2932B', false);
  sad.scale.setScalar(0.56);
  sad.position.set(0.1, -0.06, 0.03);
  g.add(sad);

  return g;
}

export default build;
