import * as THREE from 'three';

// Kristallkugel V2: Glaskugel mit magischem Kern, Zier-Band mit kleinen Edelsteinen,
// dreibeinigem Krallen-Sockel und umkreisenden Mystik-Sternchen - dieselbe Detailtiefe
// wie bei der Krone.
export function build(colorHex) {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 32, 24),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.05, transmission: 0.9, thickness: 0.5,
      ior: 1.4, clearcoat: 1, envMapIntensity: 1.2,
    })
  );
  ball.position.y = 0.1;
  ball.castShadow = true;
  g.add(ball);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 16, 12),
    new THREE.MeshBasicMaterial({ color: colorHex })
  );
  core.position.y = 0.1;
  g.add(core);

  // Zier-Band mit kleinen Edelsteinen um den Äquator der Kugel
  const jewelMat = new THREE.MeshStandardMaterial({ color: '#F5C842', metalness: 0.6, roughness: 0.25 });
  const bandCount = 6;
  for (let i = 0; i < bandCount; i++) {
    const angle = (i / bandCount) * Math.PI * 2;
    const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.024, 0), jewelMat);
    jewel.position.set(Math.cos(angle) * 0.285, 0.1, Math.sin(angle) * 0.285);
    g.add(jewel);
  }

  // Dreibeiniger Krallen-Sockel statt einfachem Zylinder
  const standMat = new THREE.MeshStandardMaterial({ color: '#2a1a4a', metalness: 0.65, roughness: 0.3 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.05, 20), standMat);
  base.position.y = -0.19;
  base.castShadow = true;
  g.add(base);
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.13, 8), standMat);
    leg.position.set(Math.cos(angle) * 0.12, -0.13, Math.sin(angle) * 0.12);
    leg.rotation.x = Math.PI;
    leg.rotation.z = Math.cos(angle) * 0.3;
    leg.rotation.x += Math.sin(angle) * 0.3;
    g.add(leg);
  }

  // Kleine umkreisende Mystik-Sternchen für den magischen Touch
  const starMat = new THREE.MeshBasicMaterial({ color: colorHex });
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const tinyStar = new THREE.Mesh(new THREE.OctahedronGeometry(0.02, 0), starMat);
    tinyStar.position.set(Math.cos(angle) * 0.37, 0.1 + Math.sin(i) * 0.08, Math.sin(angle) * 0.37);
    g.add(tinyStar);
  }

  // Insgesamt etwas kleiner als vorher - eine volle Kugel wirkt bei gleichem Radius optisch
  // "größer"/wuchtiger als flache Formen wie Stern/Krone, deshalb hier gezielt verkleinert,
  // damit sich alle Spielfiguren in der Größe besser aneinander angleichen.
  g.scale.setScalar(0.78);

  return g;
}

export default build;
