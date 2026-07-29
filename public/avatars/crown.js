import * as THREE from 'three';
import { shinyMat } from './shared.js';

// Krone V2: geschlossene Basis-Bande, gebogene Bügel die sich oben treffen (wie bei
// einer echten Krone), Edelstein-Spitzen und ein kleiner Orb mit Kreuz ganz oben.
export function build(colorHex) {
  const g = new THREE.Group();
  const mat = shinyMat(colorHex, { metalness: 0.6, roughness: 0.2 });
  const gemMatA = new THREE.MeshStandardMaterial({ color: '#e8547a', metalness: 0.3, roughness: 0.15 });
  const gemMatB = new THREE.MeshStandardMaterial({ color: '#00E5A0', metalness: 0.3, roughness: 0.15 });

  // Geschlossene Basis-Bande (kein offener Zylinder mehr - wirkt massiver/edler)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.27, 0.15, 28), mat);
  base.castShadow = true;
  g.add(base);
  // Kleiner Zierrand oben/unten an der Bande
  [0.075, -0.075].forEach(y => {
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.015, 8, 28), gemMatB);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = y;
    g.add(trim);
  });
  // Kleine Edelsteine rundum in die Bande eingelassen
  const jewelCount = 6;
  for (let i = 0; i < jewelCount; i++) {
    const angle = (i / jewelCount) * Math.PI * 2;
    const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.032, 0), i % 2 === 0 ? gemMatA : gemMatB);
    jewel.position.set(Math.cos(angle) * 0.265, 0, Math.sin(angle) * 0.265);
    g.add(jewel);
  }

  // Gebogene Bügel, die sich oben in der Mitte treffen (typisches Kronen-Merkmal)
  const archCount = 4;
  for (let i = 0; i < archCount; i++) {
    const angle = (i / archCount) * Math.PI * 2;
    const startPt = new THREE.Vector3(Math.cos(angle) * 0.22, 0.08, Math.sin(angle) * 0.22);
    const midPt = new THREE.Vector3(Math.cos(angle) * 0.14, 0.32, Math.sin(angle) * 0.14);
    const endPt = new THREE.Vector3(0, 0.38, 0);
    const curve = new THREE.QuadraticBezierCurve3(startPt, midPt, endPt);
    const tubeGeo = new THREE.TubeGeometry(curve, 12, 0.02, 8, false);
    const arch = new THREE.Mesh(tubeGeo, mat);
    arch.castShadow = true;
    g.add(arch);
    // Kleine Spitze/Edelstein am Fuß jedes Bügels
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.09, 8), mat);
    spike.position.set(Math.cos(angle) * 0.22, 0.15, Math.sin(angle) * 0.22);
    g.add(spike);
  }

  // Orb + Kreuz ganz oben, wo sich die Bügel treffen
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 12), gemMatA);
  orb.position.y = 0.42;
  g.add(orb);
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.06, 0.014), mat);
  crossV.position.y = 0.475;
  g.add(crossV);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.014, 0.014), mat);
  crossH.position.y = 0.468;
  g.add(crossH);

  // Innenkappe (samtiges Rot, wie bei einer echten Krone) - knapp unterhalb der Bügel-Spitze
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
    new THREE.MeshStandardMaterial({ color: '#7a1f3d', roughness: 0.8 })
  );
  cap.position.y = 0.08;
  g.add(cap);

  return g;
}

export default build;
