# Spielfiguren (`avatars/`)

Jede Spielfigur ist eine eigene Datei mit genau einer Funktion `build(colorHex)`,
die eine fertige `THREE.Group` zurückgibt (die Figur, zentriert um ihren eigenen
Ursprung, ca. 0.3–0.5 Einheiten groß - orientiert an den bestehenden Figuren).

```
avatars/
  shared.js        gemeinsame Helfer (z.B. shinyMat) - hier NEUE gemeinsame Bausteine ablegen
  diamond.js
  mask.js
  crystalball.js
  joker.js
  crown.js
  star.js
  registry.js      <- zentrale Liste aller Figuren (Emoji, Farbe, key -> build-Funktion)
  README.md        <- diese Datei
```

## Neue Figur hinzufügen

1. Neue Datei anlegen, z.B. `avatars/dragon.js`:
   ```js
   import * as THREE from 'three';

   export function build(colorHex) {
     const g = new THREE.Group();
     // ... Geometrie/Materialien bauen, alles an g.add(...) hängen ...
     return g;
   }

   export default build;
   ```
2. In `registry.js`:
   - Import ergänzen: `import { build as buildDragon } from './dragon.js';`
   - In `AVATAR_SET` einen Eintrag hinzufügen: `{ emoji: '🐉', key: 'dragon', color: '#...' }`
   - In `FIGURE_BUILDERS` ergänzen: `dragon: buildDragon,`
3. Fertig - nirgendwo sonst im Projekt muss etwas geändert werden.

## Figur ersetzen/überarbeiten

Einfach die Datei der jeweiligen Figur (z.B. `diamond.js`) austauschen/bearbeiten -
die restliche Struktur bleibt unberührt.

## Wenn eine Figur schwer aus Grundformen zu treffen ist (z.B. Diamant, Maske)

Statt weiter mit reinem Code zu raten, ist es oft zuverlässiger, ein fertiges 3D-Modell
zu laden (z.B. eine `.glb`-Datei, erstellt/gekauft z.B. über Sketchfab oder ein
KI-3D-Tool). Vorgehen dafür:

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

export function build(colorHex) {
  const g = new THREE.Group();
  loader.load('/models/diamond.glb', (gltf) => {
    gltf.scene.scale.setScalar(0.3); // an die Größe der anderen Figuren anpassen
    g.add(gltf.scene);
  });
  return g; // Achtung: Modell lädt asynchron nach, g ist anfangs leer
}
```

Modell-Dateien gehören dann z.B. nach `public/models/`. Wichtig: das Laden ist
asynchron - `g` ist beim Zurückgeben zunächst noch leer und füllt sich, sobald das
Modell geladen ist (reicht für dieses Projekt, da die Figuren ohnehin erst nach dem
Laden sichtbar werden müssen).
