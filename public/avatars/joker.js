import * as THREE from 'three';
import { shinyMat } from './shared.js';

// Narrenkappe V2: geschwungene, hängende Zipfel (statt starrer Kegel) mit
// zweifarbigem Wechsel, Glöckchen an den Spitzen, gewelltem Kragen-Rand.
export function build(colorHex) {
  const g = new THREE.Group();
  const capMatA = shinyMat(colorHex);
  const capMatB = shinyMat('#F5C842', { metalness: 0.4, roughness: 0.25 });
  const bellMat = new THREE.MeshStandardMaterial({ color: '#F2B705', metalness: 0.7, roughness: 0.25 });

  const tips = [
    { angle: 0, mat: capMatA },
    { angle: -0.68, mat: capMatB },
    { angle: 0.68, mat: capMatA },
  ];
  tips.forEach(tip => {
    const baseX = Math.sin(tip.angle) * 0.1;
    const start = new THREE.Vector3(baseX, 0.05, 0);
    const mid = new THREE.Vector3(baseX + Math.sin(tip.angle) * 0.16, 0.28, 0);
    const end = new THREE.Vector3(baseX + Math.sin(tip.angle) * 0.34, 0.34, 0);
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const tubeGeo = new THREE.TubeGeometry(curve, 14, 0.075, 10, false);
    const tipMesh = new THREE.Mesh(tubeGeo, tip.mat);
    tipMesh.castShadow = true;
    g.add(tipMesh);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), bellMat);
    bell.position.copy(end);
    g.add(bell);
  });

  // Gewellter Kragen-Rand statt schlichtem Torus - kleine abwechselnde Zacken
  const scallopCount = 8;
  for (let i = 0; i < scallopCount; i++) {
    const angle = (i / scallopCount) * Math.PI * 2;
    const scallop = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), i % 2 === 0 ? capMatA : capMatB);
    scallop.position.set(Math.cos(angle) * 0.17, -0.08, Math.sin(angle) * 0.17);
    g.add(scallop);
  }
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 10, 20), capMatA);
  brim.rotation.x = Math.PI / 2;
  brim.position.y = -0.08;
  g.add(brim);
  // Insgesamt minimal verkleinert, damit die Größe besser zu den anderen Figuren passt
  g.scale.setScalar(0.9);
  return g;
}

export default build;
