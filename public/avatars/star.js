import * as THREE from 'three';
import { shinyMat } from './shared.js';

// Stern V2: zweistufiger "Medaillen"-Look (großer Stern + kleinerer, eingelassener
// Stern obendrauf), zentraler Edelstein und dünner Halo-Ring - dieselbe Detailtiefe
// wie bei der Krone.
export function build(colorHex) {
  const g = new THREE.Group();

  function starShape(outerR, innerR, points) {
    const shape = new THREE.Shape();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
  }

  const outerGeo = new THREE.ExtrudeGeometry(starShape(0.28, 0.115, 5), { depth: 0.11, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 3, curveSegments: 2 });
  outerGeo.center();
  outerGeo.rotateX(Math.PI / 2);
  const outerStar = new THREE.Mesh(outerGeo, shinyMat(colorHex, { emissiveIntensity: 0.3 }));
  outerStar.castShadow = true;
  g.add(outerStar);

  // Kleinerer, eingelassener Stern obenauf (zweite Ebene, wie ein Orden/Medaille)
  const innerGeo = new THREE.ExtrudeGeometry(starShape(0.17, 0.07, 5), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2, curveSegments: 2 });
  innerGeo.center();
  innerGeo.rotateX(Math.PI / 2);
  const innerStar = new THREE.Mesh(innerGeo, new THREE.MeshStandardMaterial({ color: '#F5C842', metalness: 0.6, roughness: 0.2 }));
  innerStar.position.y = 0.062;
  g.add(innerStar);

  // Zentraler Edelstein in der Mitte
  const centerGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), new THREE.MeshStandardMaterial({ color: '#e8547a', metalness: 0.3, roughness: 0.15 }));
  centerGem.position.y = 0.09;
  g.add(centerGem);

  // Dünner Halo-Ring um den Stern
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.008, 8, 32), shinyMat(colorHex, { emissiveIntensity: 0.4 }));
  halo.rotation.x = Math.PI / 2;
  g.add(halo);

  return g;
}

export default build;
