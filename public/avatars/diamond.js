import * as THREE from 'three';

// Diamant V6: KOMPLETTER Neuaufbau, nichts von den alten Versionen übernommen. Statt der
// symmetrischen Krone/Tafel/Pavillon-Kombination aus Zylindern & Kegeln jetzt ein
// unregelmäßiger, roher Kristall-Cluster aus mehreren facettierten Ikosaedern (flach
// schattiert, damit man die einzelnen Facetten wirklich sieht) - wirkt wie ein echtes,
// rau geschliffenes Rohkristall-Cluster statt einer geometrischen Diamant-Schliffform.
//
// TODO / Kandidat für Referenzbild-Umbau: Diese Figur war bisher am schwersten per
// Text-Beschreibung zu treffen. Wenn ein Referenzbild (JPEG/PNG) oder ein fertiges
// .glb-Modell vorliegt, hier `build()` durch einen GLTFLoader-Import ersetzen (siehe
// README.md im avatars/-Ordner für das Vorgehen).
export function build(colorHex) {
  const g = new THREE.Group();

  function crystalMat(hex, emissiveHex) {
    return new THREE.MeshPhysicalMaterial({
      color: hex, flatShading: true, metalness: 0.05, roughness: 0.1,
      transmission: 0.3, thickness: 0.35, ior: 1.55, clearcoat: 1, clearcoatRoughness: 0.08,
      emissive: emissiveHex || hex, emissiveIntensity: 0.2,
    });
  }

  // Hauptkristall: in die Länge gezogenes, leicht schräg gestelltes Ikosaeder
  const mainGeo = new THREE.IcosahedronGeometry(0.22, 0);
  mainGeo.scale(0.8, 1.5, 0.8);
  const main = new THREE.Mesh(mainGeo, crystalMat('#3D8FF2', '#1F6FE0'));
  main.rotation.set(0.12, 0.5, -0.08);
  main.position.y = 0.02;
  main.castShadow = true;
  g.add(main);

  // Zwei kleinere, versetzt angeordnete Begleitkristalle - typisch für ein Kristall-Cluster,
  // jeder mit eigenem Farbton (helleres Eisblau) und eigener Neigung
  const sideGeoA = new THREE.IcosahedronGeometry(0.1, 0);
  sideGeoA.scale(0.75, 1.6, 0.75);
  const sideA = new THREE.Mesh(sideGeoA, crystalMat('#BFE1FF', '#8ec9fb'));
  sideA.rotation.set(-0.3, 1.1, 0.4);
  sideA.position.set(0.16, -0.1, 0.09);
  sideA.castShadow = true;
  g.add(sideA);

  const sideGeoB = new THREE.IcosahedronGeometry(0.075, 0);
  sideGeoB.scale(0.7, 1.5, 0.7);
  const sideB = new THREE.Mesh(sideGeoB, crystalMat('#7EC8F7', '#5AA9F2'));
  sideB.rotation.set(0.5, -0.7, -0.2);
  sideB.position.set(-0.15, -0.14, -0.07);
  sideB.castShadow = true;
  g.add(sideB);

  // Kleiner, dunkler Sockel-Splitter unten, damit das Cluster nicht "schwebt", sondern
  // sichtbar aus einem Bruchstück herauswächst
  const baseGeo = new THREE.OctahedronGeometry(0.09, 0);
  baseGeo.scale(1, 0.4, 1);
  const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: '#12306b', metalness: 0.3, roughness: 0.5, flatShading: true }));
  base.position.y = -0.2;
  g.add(base);

  // Glanzpunkt für den typischen Kristall-Glitzer
  const sparkle = new THREE.Mesh(
    new THREE.PlaneGeometry(0.055, 0.055),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
  );
  sparkle.rotation.x = -Math.PI / 2;
  sparkle.position.set(-0.04, 0.28, 0.02);
  g.add(sparkle);

  return g;
}

export default build;
