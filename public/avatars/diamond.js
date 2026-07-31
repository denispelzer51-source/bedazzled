import * as THREE from 'three';
import { shinyMat, makeSparkleSprite } from './shared.js';

// Diamant V8: gleiche Grundform wie zuvor (Tafel/Krone/Gürtel/Pavillon, nach Referenzbild
// nachgebaut, Übergänge rechnerisch geprüft), aber drei konkrete Korrekturen:
// 1. Der Gürtel war ein 6-seitiger (facettierter) Torus, zusätzlich um 30° verdreht - dadurch
//    stand ein eigenes, schräg ausgerichtetes Sechseck sichtbar quer zu Krone/Pavillon im
//    Modell. Jetzt ein RUNDER, glatter Ring (viele Segmente) - liest sich als feine
//    Gürtelkante, nicht mehr als eigene schräge Form.
// 2. Farben insgesamt viel heller/durchsichtiger (echtes Eisblau statt sattem Dunkelblau),
//    mit deutlich mehr transmission/clearcoat für einen klaren, glasigen Diamant-Look.
// 3. Die Glanzpunkte sind jetzt echte Sprites (siehe makeSparkleSprite) - die drehen sich
//    bei der Eigenrotation der Figur NICHT mit weg, sondern zeigen immer zur Kamera und
//    funkeln dadurch durchgehend, statt nur aus einem Blickwinkel sichtbar zu sein.
export function build(colorHex) {
  const g = new THREE.Group();

  // Tafel (die große, flache Facette ganz oben) - fast weißes Eisblau, sehr hell/klar
  const tableMat = shinyMat('#F2FBFF', { metalness: 0.02, roughness: 0.04, transmission: 0.35, thickness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, emissive: '#F2FBFF', emissiveIntensity: 0.3 });
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.014, 6), tableMat);
  table.position.y = 0.147;
  g.add(table);

  // Krone (schräge Facetten zwischen Tafel und Gürtelkante) - helles, klares Himmelblau
  const crownMat = shinyMat('#BEE4FF', { flatShading: true, metalness: 0.03, roughness: 0.06, transmission: 0.3, thickness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#BEE4FF', emissiveIntensity: 0.22 });
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 0.14, 6), crownMat);
  crown.position.y = 0.07;
  crown.castShadow = true;
  g.add(crown);

  // Kein separater Gürtel-Ring mehr - der sah (auch glatt/rund) wie ein unpassender Kreis
  // um den Diamanten aus. Der Übergang zwischen Krone und Pavillon ergibt sich jetzt einfach
  // aus den direkt aneinanderstoßenden Facetten (wie im Referenzbild - dort ist auch kein
  // eigener Ring zu sehen, nur die Facetten-Kanten).

  // Pavillon (spitz zulaufender unterer Teil) - deutlich heller/klarer als vorher (war zu
  // dunkelblau), mit spürbar mehr Transparenz für einen echten, glasigen Diamant-Look.
  // WICHTIG: ConeGeometry hat die Spitze standardmäßig OBEN, die breite Grundfläche UNTEN -
  // mit rotation.x = Math.PI zeigt die Spitze jetzt korrekt nach unten (mit echter
  // Three.js-Geometrie geprüft, nicht geraten).
  const pavilionMat = shinyMat('#7EC8F7', { flatShading: true, metalness: 0.02, roughness: 0.05, transmission: 0.45, thickness: 0.3, ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#7EC8F7', emissiveIntensity: 0.18 });
  const pavilion = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.34, 6), pavilionMat);
  pavilion.rotation.x = Math.PI;
  pavilion.position.y = -0.17;
  pavilion.castShadow = true;
  g.add(pavilion);

  // Glanzpunkte als echte Sprites - funkeln durchgehend, unabhängig von der Blickrichtung
  const bigSparkle = makeSparkleSprite(0.13);
  bigSparkle.position.set(-0.09, 0.16, 0.06);
  g.add(bigSparkle);

  [[0.15, 0.05, 0.09], [-0.13, -0.15, -0.06], [0.1, -0.22, 0.1]].forEach(([x, y, z]) => {
    const tiny = makeSparkleSprite(0.045);
    tiny.position.set(x, y, z);
    g.add(tiny);
  });

  return g;
}

export default build;
