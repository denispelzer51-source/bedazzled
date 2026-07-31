import * as THREE from 'three';
import { shinyMat } from './shared.js';

// Maske V7: KOMPLETT neu nach Referenzbild gebaut (zwei Theatermasken-Schilde, blau
// lachend + gelb traurig, überlappend) - nichts von der alten venezianischen Maske mit
// Haltestab/Feder übernommen, das war ein anderes Konzept.
export function build(colorHex) {
  const g = new THREE.Group();

  // Grundform: der typische Theatermasken-Schild mit gewelltem Doppel-Buckel oben und
  // runder Spitze unten (wie im Referenzbild) - als Funktion, damit beide Masken (in
  // unterschiedlicher Größe/Position) dieselbe Silhouette teilen.
  function outline(shape, s) {
    shape.moveTo(-0.26 * s, 0.08 * s);
    shape.bezierCurveTo(-0.28 * s, 0.25 * s, -0.14 * s, 0.33 * s, 0, 0.2 * s);
    shape.bezierCurveTo(0.14 * s, 0.33 * s, 0.28 * s, 0.25 * s, 0.26 * s, 0.08 * s);
    shape.bezierCurveTo(0.29 * s, -0.1 * s, 0.2 * s, -0.28 * s, 0, -0.34 * s);
    shape.bezierCurveTo(-0.2 * s, -0.28 * s, -0.29 * s, -0.1 * s, -0.26 * s, 0.08 * s);
    shape.closePath();
  }

  // Eine "Linsen"-Form (zwei Bögen, die sich an beiden Enden treffen) - ergibt schmale
  // Sichel-Augen bzw. einen breiten Lach-/Frown-Mund, je nach Wölbung, plus optionaler
  // Drehung für die schräg angesetzten traurigen Augen.
  function lensPath(cx, cy, halfWidth, topBulge, bottomBulge, rotation = 0) {
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const toWorld = (x, y) => [cx + x * cos - y * sin, cy + x * sin + y * cos];
    const path = new THREE.Path();
    const [x0, y0] = toWorld(-halfWidth, 0);
    const [x1, y1] = toWorld(halfWidth, 0);
    const [cxA, cyA] = toWorld(0, topBulge);
    const [cxB, cyB] = toWorld(0, bottomBulge);
    path.moveTo(x0, y0);
    path.quadraticCurveTo(cxA, cyA, x1, y1);
    path.quadraticCurveTo(cxB, cyB, x0, y0);
    path.closePath();
    return path;
  }

  // Baut eine einzelne Maske: Grundfarbe + passende Augen/Mund-Löcher (lachend oder traurig)
  function buildOneMask(faceColor, smiling) {
    const shape = new THREE.Shape();
    outline(shape, 1);
    if (smiling) {
      // Schmale, nach oben gewölbte Sichel-Augen (wie ein entspanntes Lächel-Auge)
      shape.holes.push(lensPath(-0.095, 0.08, 0.075, 0.05, 0.025));
      shape.holes.push(lensPath(0.095, 0.08, 0.075, 0.05, 0.025));
      // Breiter, weit unten geöffneter Grinse-Mund
      shape.holes.push(lensPath(0, -0.12, 0.16, 0.02, -0.13));
    } else {
      // Schräg angesetzte, sorgenvolle Augen (leicht nach innen-unten geneigt)
      shape.holes.push(lensPath(-0.095, 0.08, 0.07, 0.035, 0.01, 0.25));
      shape.holes.push(lensPath(0.095, 0.08, 0.07, 0.035, 0.01, -0.25));
      // Nach oben gewölbter Schmoll-/Frown-Mund
      shape.holes.push(lensPath(0, -0.14, 0.13, -0.01, 0.11));
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.009, bevelSegments: 3, curveSegments: 20 });
    geo.center();
    const mat = shinyMat(faceColor, { side: THREE.DoubleSide, emissive: faceColor, emissiveIntensity: 0.16, metalness: 0.05, roughness: 0.25 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  }

  // Blaue lachende Maske hinten-links (Verlauf hell- zu kräftigerem Blau, wie im Bild)
  const happy = buildOneMask('#4FB4F7', true);
  happy.scale.setScalar(0.62);
  happy.position.set(-0.09, 0.02, -0.02);
  g.add(happy);

  // Gelbe traurige Maske vorne-rechts, etwas kleiner und tiefer versetzt wie im Referenzbild
  const sad = buildOneMask('#F7C948', false);
  sad.scale.setScalar(0.56);
  sad.position.set(0.1, -0.06, 0.03);
  g.add(sad);

  return g;
}

export default build;
