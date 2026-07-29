import * as THREE from 'three';
import { shinyMat } from './shared.js';

// Maske V6: KOMPLETTER Neuaufbau, nichts von der alten Zwei-Gesichter-Version übernommen.
// Statt zweier überlappender Kugel-Gesichter (Komödie/Tragödie) jetzt eine einzelne, echte
// venezianische Maskerade-Maske: eine flache, extrudierte Form mit ECHTEN ausgeschnittenen
// Löchern für die Augen (statt aufgesetzter dunkler Scheiben), goldener Zierkante, einer
// Feder und einem Haltestab - komplett andere Silhouette und Bautechnik als vorher.
//
// TODO / Kandidat für Referenzbild-Umbau: siehe diamond.js - auch diese Figur eignet sich
// gut für ein fertiges Modell/Icon statt weiterer Text-geratener Iterationen.
export function build(colorHex) {
  const g = new THREE.Group();

  // Umriss der Maske als Funktion definiert, damit dieselbe Form in zwei Größen (Goldrand
  // dahinter etwas größer, eigentliche Maske normal groß) erzeugt werden kann
  function outline(shape, s) {
    shape.moveTo(-0.27 * s, 0.03 * s);
    shape.bezierCurveTo(-0.31 * s, -0.17 * s, -0.14 * s, -0.3 * s, 0, -0.25 * s);
    shape.bezierCurveTo(0.14 * s, -0.3 * s, 0.31 * s, -0.17 * s, 0.27 * s, 0.03 * s);
    shape.bezierCurveTo(0.21 * s, 0.17 * s, 0.13 * s, 0.1 * s, 0.08 * s, 0.21 * s);
    shape.bezierCurveTo(0.04 * s, 0.29 * s, -0.04 * s, 0.29 * s, -0.08 * s, 0.21 * s);
    shape.bezierCurveTo(-0.13 * s, 0.1 * s, -0.21 * s, 0.17 * s, -0.27 * s, 0.03 * s);
    shape.closePath();
  }

  // Goldene Unterlage - 8% größer, schimmert als dünner Zierrand rings um die Maske hervor
  const trimShape = new THREE.Shape();
  outline(trimShape, 1.08);
  const trimGeo = new THREE.ExtrudeGeometry(trimShape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 16 });
  trimGeo.center();
  const trim = new THREE.Mesh(trimGeo, new THREE.MeshStandardMaterial({ color: '#F5C842', metalness: 0.65, roughness: 0.25 }));
  trim.position.z = -0.006;
  trim.castShadow = true;
  g.add(trim);

  // Maskenkörper mit echten Augen-Löchern (statt aufgesetzter Scheiben)
  const maskShape = new THREE.Shape();
  outline(maskShape, 1);
  const eyeL = new THREE.Path();
  eyeL.absellipse(-0.105, -0.02, 0.065, 0.042, 0, Math.PI * 2, false, -0.18);
  const eyeR = new THREE.Path();
  eyeR.absellipse(0.105, -0.02, 0.065, 0.042, 0, Math.PI * 2, false, 0.18);
  maskShape.holes.push(eyeL, eyeR);
  const maskGeo = new THREE.ExtrudeGeometry(maskShape, { depth: 0.034, bevelEnabled: true, bevelThickness: 0.009, bevelSize: 0.01, bevelSegments: 3, curveSegments: 20 });
  maskGeo.center();
  const maskMat = shinyMat('#C57BFB', { side: THREE.DoubleSide, emissive: '#C57BFB', emissiveIntensity: 0.14 });
  const mask = new THREE.Mesh(maskGeo, maskMat);
  mask.castShadow = true;
  g.add(mask);

  // Haltestab, wie man ihn von einer klassischen Maskerade-Maske kennt
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.013, 0.013, 0.26, 10),
    new THREE.MeshStandardMaterial({ color: '#3a1a5c', metalness: 0.3, roughness: 0.4 })
  );
  stick.position.set(0, -0.33, 0.03);
  g.add(stick);

  // Geschwungene Feder oben rechts, typisches Maskerade-Accessoire
  const featherCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0.15, 0.22, 0.02),
    new THREE.Vector3(0.32, 0.4, 0.03),
    new THREE.Vector3(0.26, 0.6, 0.02)
  );
  const featherGeo = new THREE.TubeGeometry(featherCurve, 14, 0.022, 8, false);
  const feather = new THREE.Mesh(featherGeo, new THREE.MeshStandardMaterial({ color: '#F7B8D2', roughness: 0.5 }));
  feather.castShadow = true;
  g.add(feather);

  return g;
}

export default build;
