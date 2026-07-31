import * as THREE from 'three';
import { shinyMat } from './shared.js';

// Diamant V7: nachgebaut nach Referenzbild (klassisches Diamant-Symbol) - breite, flache
// Oberseite mit sichtbaren Facetten (Krone + Tafel), scharfe Gürtelkante, spitz zulaufender
// Pavillon unten. Sechseckige Grundform (6-seitige Zylinder/Kegel/Torus), damit die
// Facetten-Kanten wie im Referenzbild als klare gerade Linien erscheinen (kein Rundschliff).
export function build(colorHex) {
  const g = new THREE.Group();

  // Tafel (die große, flache Facette ganz oben) - hellstes Eisblau/Weißblau, wie die
  // aufleuchtende Mitte im Referenzbild
  const tableMat = shinyMat('#EAF7FF', { metalness: 0.05, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#EAF7FF', emissiveIntensity: 0.25 });
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.014, 6), tableMat);
  table.position.y = 0.147;
  g.add(table);

  // Krone (die schrägen Facetten zwischen Tafel und Gürtelkante) - mittleres, kräftiges
  // Himmelblau, flach schattiert damit jede der 6 Facetten als eigene ebene Fläche sichtbar ist
  const crownMat = shinyMat('#5AA9F2', { flatShading: true, metalness: 0.08, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, emissive: '#5AA9F2', emissiveIntensity: 0.2 });
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 0.14, 6), crownMat);
  crown.position.y = 0.07;
  crown.castShadow = true;
  g.add(crown);

  // Gürtelkante (Girdle) - schmaler, sechseckiger Ring als klare Trennlinie zwischen Krone
  // und Pavillon, wie die durchgehende Horizontlinie im Referenzbild
  const girdleMat = shinyMat('#2E6FD9', { metalness: 0.15, roughness: 0.12, emissive: '#2E6FD9', emissiveIntensity: 0.2 });
  const girdle = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.014, 4, 6), girdleMat);
  girdle.rotation.x = Math.PI / 2;
  girdle.rotation.y = Math.PI / 6;
  g.add(girdle);

  // Pavillon (der spitz zulaufende untere Teil) - kräftiges, dunkleres Saphirblau, wie die
  // tiefe Farbe im unteren/linken Bereich des Referenzbilds.
  // WICHTIG: ConeGeometry hat die Spitze standardmäßig OBEN und die breite Grundfläche
  // UNTEN (mit echter Three.js-Geometrie nachgerechnet, nicht geraten) - ohne die Drehung
  // hier stand der Pavillon auf dem Kopf: die Spitze berührte den Gürtel, die breite Seite
  // hing unten durch. Mit rotation.x = Math.PI liegt jetzt die breite Seite oben am Gürtel
  // und die Spitze zeigt nach unten - wie bei einem echten Diamant-Schliff.
  const pavilionMat = shinyMat('#1F5FCC', { flatShading: true, transmission: 0.12, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.08, emissive: '#1F5FCC', emissiveIntensity: 0.22 });
  const pavilion = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.34, 6), pavilionMat);
  pavilion.rotation.x = Math.PI;
  pavilion.position.y = -0.17;
  pavilion.castShadow = true;
  g.add(pavilion);

  // Glanzpunkt oben links, wie das große Funkeln im Referenzbild
  const sparkle = new THREE.Mesh(
    new THREE.PlaneGeometry(0.075, 0.075),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
  );
  sparkle.rotation.x = -Math.PI / 2;
  sparkle.position.set(-0.09, 0.155, 0.06);
  g.add(sparkle);

  // Zwei winzige Funkel-Punkte drumherum, wie die kleinen Sternchen im Referenzbild
  const tinySparkleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
  [[0.16, 0.02, 0.08], [-0.14, -0.16, -0.05]].forEach(([x, y, z]) => {
    const tiny = new THREE.Mesh(new THREE.PlaneGeometry(0.025, 0.025), tinySparkleMat);
    tiny.rotation.x = -Math.PI / 2;
    tiny.position.set(x, y, z);
    g.add(tiny);
  });

  return g;
}

export default build;
