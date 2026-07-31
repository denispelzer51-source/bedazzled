import * as THREE from 'three';
import { shinyMat } from './shared.js';

// Maske V8: komplett neu mit robuster Kreisbogen-Technik statt Freihand-Bezier-Formen (die
// sahen platt/verzerrt aus). Sichel-Augen und Mund sind jetzt "dicke Kreisbögen" (zwei
// konzentrische Bögen unterschiedlichen Radius, dazwischen ausgeschnitten) - dieselbe
// Technik, mit der auch echte Emoji-Grafiken gebaut werden: garantiert saubere, glatte
// Kurven ohne Verzerrung. Farben satter, mehr Tiefe durch eine dunklere Rand-Schicht dahinter.
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

  // Ein "dicker Kreisbogen" (zwei konzentrische Bögen, außen minus innen) - robuste,
  // verzerrungsfreie Standard-Technik für Sichel-Augen/Mund-Formen.
  function thickArcPath(cx, cy, radius, thickness, startDeg, endDeg) {
    const start = (startDeg * Math.PI) / 180;
    const end = (endDeg * Math.PI) / 180;
    const rOuter = radius + thickness / 2;
    const rInner = Math.max(0.001, radius - thickness / 2);
    const path = new THREE.Path();
    path.absarc(cx, cy, rOuter, start, end, false);
    path.absarc(cx, cy, rInner, end, start, true);
    path.closePath();
    return path;
  }

  function buildOneMask(faceColorTop, faceColorBottom, smiling) {
    const shape = new THREE.Shape();
    outline(shape, 1);
    if (smiling) {
      // Schmale, nach oben geschwungene Lach-Augen (dünner Bogen, Bauch nach oben)
      shape.holes.push(thickArcPath(-0.095, 0.06, 0.09, 0.03, 200, 340));
      shape.holes.push(thickArcPath(0.095, 0.06, 0.09, 0.03, 200, 340));
      // Breiter, tiefer Grinse-Mund (dicker Bogen, Bauch nach unten)
      shape.holes.push(thickArcPath(0, 0.02, 0.24, 0.11, 25, 155));
    } else {
      // Schräg angesetzte, sorgenvolle Augen (dünne Bögen, leicht geneigt)
      shape.holes.push(thickArcPath(-0.1, 0.07, 0.11, 0.025, 165, 245));
      shape.holes.push(thickArcPath(0.1, 0.07, 0.11, 0.025, -65, 15));
      // Nach oben gewölbter Schmoll-/Frown-Mund (dicker Bogen, Bauch nach oben)
      shape.holes.push(thickArcPath(0, -0.26, 0.22, 0.1, 205, 335));
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.02, bevelSegments: 5, curveSegments: 24 });
    geo.center();
    const mat = shinyMat(faceColorTop, {
      side: THREE.DoubleSide, metalness: 0.1, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1,
      emissive: faceColorBottom, emissiveIntensity: 0.12,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  }

  // Dunklere Rand-Schicht knapp dahinter für mehr Tiefe/3D-Wirkung (wie ein Schlagschatten-
  // Rand), etwas größer als die eigentliche Maske
  function buildBacking(scaleFactor, color) {
    const shape = new THREE.Shape();
    outline(shape, scaleFactor);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 3, curveSegments: 20 });
    geo.center();
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.4 });
    return new THREE.Mesh(geo, mat);
  }

  // Blaue lachende Maske hinten-links - satteres, kräftigeres Blau
  const happyBack = buildBacking(1.08 * 0.62, '#0B5FA8');
  happyBack.position.set(-0.09, 0.02, -0.035);
  g.add(happyBack);
  const happy = buildOneMask('#3FA9F5', '#1565C0', true);
  happy.scale.setScalar(0.62);
  happy.position.set(-0.09, 0.02, -0.02);
  g.add(happy);

  // Gelbe traurige Maske vorne-rechts - satteres, kräftigeres Gelb/Orange
  const sadBack = buildBacking(1.08 * 0.56, '#C97F0A');
  sadBack.position.set(0.1, -0.06, 0.015);
  g.add(sadBack);
  const sad = buildOneMask('#FFC93C', '#F2932B', false);
  sad.scale.setScalar(0.56);
  sad.position.set(0.1, -0.06, 0.03);
  g.add(sad);

  return g;
}

export default build;
