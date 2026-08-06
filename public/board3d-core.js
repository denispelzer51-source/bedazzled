import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AVATAR_SET, avatarSetByKey, FIGURE_BUILDERS } from './avatars/registry.js';

// ---------- Marken-Farben ----------
const COLORS = {
  void: 0x04000A,
  royal: 0x330D98,
  amethyst: 0x8C39F7,
  primary: 0xAC58F9,
  glow: 0xC577FB,
  lilac: 0xD5A1FB,
};

// ---------- Grundgerüst ----------
const holder = document.getElementById('canvas-holder');
const scene = new THREE.Scene();
// Der restliche Raum außerhalb des Bretts war bisher reines Schwarz (0x000000) - jetzt in
// ein dunkles Marken-Lila getaucht (COLORS.void), damit auch die Umgebung zur restlichen
// Farbwelt des Spiels passt statt neutral schwarz zu wirken.
scene.background = new THREE.Color(COLORS.void);
scene.fog = new THREE.FogExp2(COLORS.void, 0.008);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
// Deutlich näher am Brett und im 45°-Winkel von vorne (statt vorher fast senkrecht von oben
// und weit entfernt) - so lassen sich die Figuren viel leichter unterscheiden.
camera.position.set(0, 6.5, 6.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Kontrastreicheres, satteres Bild statt des flachen linearen Standard-Looks
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
holder.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Freie Kamera (zum Testen, wie viel Freiheit echtes 3D bringt) ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 4;
controls.maxDistance = 26;
controls.maxPolarAngle = Math.PI * 0.49; // nicht ganz unter die Tischplatte schauen können

// ---------- Licht (ECHTES Licht - reagiert wirklich auf die Kamera-/Objektposition) ----------
const ambient = new THREE.AmbientLight(0xffffff, 0.16);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
keyLight.position.set(6, 10, 4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -12;
keyLight.shadow.camera.right = 12;
keyLight.shadow.camera.top = 12;
keyLight.shadow.camera.bottom = -12;
scene.add(keyLight);

const glowLight = new THREE.PointLight(COLORS.glow, 1.6, 20);
glowLight.position.set(0, 3, 0);
scene.add(glowLight);

// ---------- Tisch / Untergrund ----------
const tableGeo = new THREE.CylinderGeometry(10, 10.5, 1, 48);
const tableMat = new THREE.MeshStandardMaterial({ color: 0x02000A, roughness: 0.9, metalness: 0.05 });
const table = new THREE.Mesh(tableGeo, tableMat);
table.position.y = -0.8; // Tisch tiefer gelegt, damit Oberfläche bei y=-0.3 liegt
table.receiveShadow = true;
scene.add(table);

// ---------- Textur-Erzeugung (Zahlen, Farben, Start-/Zielfeld) per Canvas ----------
const REGULAR_PALETTE = ['#BB00FF', '#DD00FF', '#8800EE', '#CC11FF'];

// ---------- Feld-Typen: normale Frage (lila), Fremdwort (blau), Schätzfrage (grün/teal),
// Zeichnen (gelb) - dieselben vier Kategorien wie im 2D-Brett (siehe style.css: .key-purple/
// .key-blue/.key-green/.key-yellow und die entsprechenden Trigger-Felder in server.js).
// Startwerte hier entsprechen den Standard-Trigger-Feldern aus server.js, werden aber sofort
// überschrieben, sobald echte Spieldaten ankommen (siehe 'setFieldTypes' Nachricht unten) -
// damit stimmt die Zuordnung auch dann, falls sich die Trigger-Felder mal ändern sollten.
let TRIGGER_FIELDS = {
  estimate: [5, 8, 13, 18],
  foreignword: [2, 10, 16, 22],
  drawing: [4, 12, 19, 24],
};
function fieldTypeOf(i) {
  if (i === FINISH_INDEX) return 'finish';
  if (TRIGGER_FIELDS.estimate.includes(i)) return 'estimate';
  if (TRIGGER_FIELDS.foreignword.includes(i)) return 'foreignword';
  if (TRIGGER_FIELDS.drawing.includes(i)) return 'drawing';
  return 'normal';
}
// Farben 1:1 aus style.css übernommen (--primary/--teal/--gold + das feste Fremdwort-Blau),
// damit 2D- und 3D-Brett optisch exakt dieselbe Farbsprache sprechen.
const FIELD_TYPE_COLORS = {
  estimate: '#3FBFA0',
  foreignword: '#5895F9',
  drawing: '#F5C842',
};

function makeFieldTexture({ number, isFinish, fieldType, paletteIndex }) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (isFinish) {
    // Klassisches Ziel-Karo-Muster (schwarz/weiß) statt der alten, unauffälligen
    // Diagonal-Teilung - deutlich klarer als "Ziel" erkennbar, dazu mit den
    // Marken-Farben (Gold-Glanz + goldener Rahmen) statt neutralem Schwarz/Weiß pur.
    const checks = 8;
    const cell = size / checks;
    for (let r = 0; r < checks; r++) {
      for (let c = 0; c < checks; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#FFFFFF' : '#0A0612';
        ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }
    // Warmer Gold-Glanz aus der Mitte, damit es nach "besonderes Feld", nicht nach
    // neutralem Schachbrett aussieht
    const glow = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.68);
    glow.addColorStop(0, 'rgba(245,200,66,0.45)');
    glow.addColorStop(1, 'rgba(245,200,66,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    // Kräftiger goldener Rahmen statt dunkler Kontur - hebt das Zielfeld klar von den
    // normalen Feldern ab
    ctx.strokeStyle = '#F5C842';
    ctx.lineWidth = 16;
    ctx.strokeRect(8, 8, size - 16, size - 16);
    // Ziel-Flagge zentral und groß, mit weißem Untergrund-Kreis für Lesbarkeit
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(size / 2, size / 2, 58, 0, Math.PI * 2); ctx.fill();
    ctx.font = '92px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🏁', size / 2, size / 2 + 6);
  } else {
    const baseColor = FIELD_TYPE_COLORS[fieldType] || REGULAR_PALETTE[paletteIndex % REGULAR_PALETTE.length];
    // Vollflächig gesättigte Grundfarbe – kein weißer Verlauf mehr der die Farbe verwäscht
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, size, size);
    // Nur kleiner Highlight-Glanz oben-links (nicht das ganze Feld aufhellen)
    const shine = ctx.createLinearGradient(0, 0, size * 0.5, size * 0.5);
    shine.addColorStop(0, 'rgba(255,255,255,0.28)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, size, size);

    // Kräftige dunkle Kontur, wie im Logo (dicker schwarzer Rand statt zartem weißen Strich)
    ctx.strokeStyle = '#04000A';
    ctx.lineWidth = 14;
    const pad = 7;
    ctx.strokeRect(pad, pad, size - pad * 2, size - pad * 2);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 84px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(number), size / 2, size / 2 + 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

// ---------- Spielfelder: ECHTE erhöhte 3D-Objekte mit echten Zahlen-Texturen ----------
const BOARD_SLOTS = 28;
const FINISH_INDEX = 0;
const RING_W = 3.48, RING_H = 5.62; // eng beieinander, kleiner Abstand (~0.07) zwischen Feldern
// Die Frage, die gleich im 2D-Overlay angezeigt wird - dieselbe steht jetzt auch schon
// auf der Kartenvorderseite, damit beides nahtlos zusammenpasst.
const DEMO_QUESTION_TEXT = 'Wie viele Stufen hat der Eiffelturm bis zur obersten Plattform?';

const FIELD_POSITIONS = buildFieldPositions(BOARD_SLOTS, RING_W, RING_H);
function fieldPosition(i) {
  return FIELD_POSITIONS[((i % BOARD_SLOTS) + BOARD_SLOTS) % BOARD_SLOTS];
}

function buildFieldPositions(total, W, H) {
  const perimeter = 2 * (W + H);
  const edges = [
    { len: W, from: { x: -W / 2, z: -H / 2 }, to: { x: W / 2, z: -H / 2 }, axis: 'x' },
    { len: H, from: { x: W / 2, z: -H / 2 }, to: { x: W / 2, z: H / 2 }, axis: 'z' },
    { len: W, from: { x: W / 2, z: H / 2 }, to: { x: -W / 2, z: H / 2 }, axis: 'x' },
    { len: H, from: { x: -W / 2, z: H / 2 }, to: { x: -W / 2, z: -H / 2 }, axis: 'z' },
  ];
  const positions = [];
  let remaining = total;
  edges.forEach((edge, idx) => {
    const isLast = idx === edges.length - 1;
    const share = isLast ? remaining : Math.round(total * (edge.len / perimeter));
    for (let k = 0; k < share; k++) {
      const t = k / share;
      positions.push({
        x: edge.from.x + (edge.to.x - edge.from.x) * t,
        z: edge.from.z + (edge.to.z - edge.from.z) * t,
        axis: edge.axis,
      });
    }
    remaining -= share;
  });
  return positions;
}

const sideMat = new THREE.MeshStandardMaterial({ color: COLORS.royal, roughness: 0.5, metalness: 0.2 });

const fieldsGroup = new THREE.Group();
const fieldMeshes = [];
for (let i = 0; i < BOARD_SLOTS; i++) {
  const pos = fieldPosition(i);
  const isFinish = i === FINISH_INDEX;
  const fieldType = fieldTypeOf(i);

  const height = isFinish ? 0.50 : 0.30;
  const fw = isFinish ? 0.66 : 0.58;   // Breite
  const fd = isFinish ? 0.58 : 0.52;   // Tiefe (leicht schmaler -> leicht rechteckig)
  const geo = new THREE.BoxGeometry(fw, height, fd);

  const topTex = makeFieldTexture({ number: i, isFinish, fieldType, paletteIndex: i });
  const topMat = new THREE.MeshBasicMaterial({ map: topTex });
  // WICHTIG gegen "ausgeblichene" Farben: das ACESFilmicToneMapping (siehe renderer weiter
  // oben) ist für die stimmungsvolle, kinoartige Beleuchtung der Szene gedacht - es
  // komprimiert/entsättigt dabei aber auch kräftige, flache UI-Farben wie diese
  // Feld-Texturen. toneMapped=false lässt DIESES Material an der Kamera vorbei exakt in
  // seinen echten, vollen Canvas-Farben rendern.
  topMat.toneMapped = false;
  // BoxGeometry-Flächen-Reihenfolge: [+x, -x, +y (oben), -y (unten), +z, -z]
  const materials = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];

  const mesh = new THREE.Mesh(geo, materials);
  mesh.position.set(pos.x, height / 2, pos.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.fieldType = fieldType;
  fieldsGroup.add(mesh);
  fieldMeshes.push(mesh);
}
scene.add(fieldsGroup);

// Wird aufgerufen, sobald die echten Trigger-Felder aus dem laufenden Spiel ankommen (siehe
// 'setFieldTypes'-Nachricht unten) - texturiert alle Felder neu, ohne die Geometrie/Position
// anzufassen (nur die oben aufliegende Textur wird ausgetauscht).
function rebuildFieldTextures() {
  fieldMeshes.forEach((mesh, i) => {
    const isFinish = i === FINISH_INDEX;
    const fieldType = fieldTypeOf(i);
    mesh.userData.fieldType = fieldType;
    const newTex = makeFieldTexture({ number: i, isFinish, fieldType, paletteIndex: i });
    const topMat = mesh.material[2];
    if (topMat.map) topMat.map.dispose();
    topMat.map = newTex;
    topMat.needsUpdate = true;
  });
}

// ---------- Spielbrett-Fläche (rechteckig, liegt auf dem Tisch, Felder stehen drauf) ----------
function makeBoardTexture() {
  const W = 1024, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Tiefschwarzer Grund
  ctx.fillStyle = '#020008';
  ctx.fillRect(0, 0, W, H);

  // Subtiles Sechseck-Muster für Tiefe
  ctx.strokeStyle = 'rgba(140,57,247,0.12)';
  ctx.lineWidth = 1;
  const hex = 36;
  for (let row = 0; row < H / hex + 2; row++) {
    for (let col = 0; col < W / hex + 2; col++) {
      const ox = col * hex * 1.5 - hex;
      const oy = row * hex * Math.sqrt(3) - hex + (col % 2) * hex * 0.866;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * i;
        const px = ox + hex * 0.5 * Math.cos(a);
        const py = oy + hex * 0.5 * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  // Lila Rand-Glühen (stark gesättigt)
  const glow = ctx.createRadialGradient(W/2, H/2, H*0.05, W/2, H/2, H*0.72);
  glow.addColorStop(0,   'rgba(80,0,180,0)');
  glow.addColorStop(0.5, 'rgba(140,57,247,0.08)');
  glow.addColorStop(1,   'rgba(176,38,255,0.55)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Ecken-Glüh-Punkte (intensiv)
  [[0.05,0.05],[0.95,0.05],[0.05,0.95],[0.95,0.95]].forEach(([cx,cy]) => {
    const g = ctx.createRadialGradient(cx*W, cy*H, 0, cx*W, cy*H, W*0.18);
    g.addColorStop(0,   'rgba(197,119,251,0.6)');
    g.addColorStop(0.5, 'rgba(140,57,247,0.2)');
    g.addColorStop(1,   'rgba(140,57,247,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  });

  // Kräftiger lila Außenrahmen (Doppelrahmen)
  ctx.strokeStyle = '#BB00FF';
  ctx.lineWidth = 28;
  ctx.strokeRect(14, 14, W-28, H-28);
  ctx.strokeStyle = 'rgba(213,161,251,0.9)';
  ctx.lineWidth = 6;
  ctx.strokeRect(32, 32, W-64, H-64);
  // Innenrahmen als Track-Markierung
  ctx.strokeStyle = 'rgba(176,38,255,0.5)';
  ctx.lineWidth = 4;
  ctx.strokeRect(72, 72, W-144, H-144);

  return new THREE.CanvasTexture(canvas);
}
const BOARD_MARGIN = 0.85;
const boardGeo = new THREE.BoxGeometry(RING_W + BOARD_MARGIN * 2, 0.18, RING_H + BOARD_MARGIN * 2);
const boardMat = new THREE.MeshStandardMaterial({
  map: makeBoardTexture(),
  roughness: 0.45,
  metalness: 0.18,
  // polygonOffset verhindert Z-Fighting als doppelte Absicherung,
  // falls zwei Flächen versehentlich auf derselben Tiefe landen
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
const boardMesh = new THREE.Mesh(boardGeo, boardMat);
boardMesh.position.y = 0.02; // Brett-Oberfläche bei y=0.11, weit über Tisch (y=-0.3)
boardMesh.receiveShadow = true;
boardMesh.castShadow = true;
scene.add(boardMesh);

// ---------- Logo in der Brett-Mitte (echte Textur, dein tatsächliches Logo) ----------
const textureLoader = new THREE.TextureLoader();
const logoTexture = textureLoader.load('data:image/webp;base64,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');
logoTexture.colorSpace = THREE.SRGBColorSpace;
const LOGO_ASPECT = 1322 / 706; // echtes Seitenverhältnis des rechteckigen Logos
const logoWidth = 2.6;
const logoGeo = new THREE.PlaneGeometry(logoWidth, logoWidth / LOGO_ASPECT);
// WICHTIG gegen den "Schleier"/abgedunkelten Look: MeshStandardMaterial ist ein
// beleuchtetes Material - bei der eher schwachen Umgebungshelligkeit (ambient=0.16) plus
// Schatten, die auf receiveShadow=true fallen können, wirkte das Logo merklich dunkler als
// seine echten Bild-Farben. Jetzt unlit (MeshBasicMaterial, wie schon die Feld-Texturen)
// und zusätzlich toneMapped=false, damit es unabhängig von Licht/Kamera-Winkel immer in
// seinen echten, vollen Marken-Farben erscheint.
const logoMat = new THREE.MeshBasicMaterial({
  map: logoTexture,
  transparent: true,
  side: THREE.DoubleSide,
});
logoMat.toneMapped = false;
const logoMesh = new THREE.Mesh(logoGeo, logoMat);
logoMesh.rotation.x = -Math.PI / 2;
// WICHTIG: Die Brett-Oberfläche liegt bei y=0.11 (0.18 hohe Box, zentriert bei y=0.02 ->
// Oberseite bei 0.02+0.09=0.11). Das Logo lag bisher bei y=0.011 - tief VERSTECKT INNERHALB
// des massiven Brett-Körpers, komplett unsichtbar von außen. Jetzt knapp oberhalb der
// echten Brett-Oberfläche platziert, damit es sichtbar auf dem Brett liegt.
logoMesh.position.y = 0.113;
// receiveShadow entfernt: ein unlit-Material profitiert davon ohnehin nicht (Schatten
// werden nur bei beleuchteten Materialien berücksichtigt), stand hier nur als Rest von der
// vorherigen MeshStandardMaterial-Variante.
scene.add(logoMesh);

// ---------- Kartenstapel auf dem Brett (echte Kartenrückseite als Textur) ----------
const cardBackTexture = textureLoader.load('data:image/webp;base64,UklGRkRqAQBXRUJQVlA4WAoAAAAQAAAAgQIAgwMAQUxQSNwDAAABFLVt2zD2/3fb6WsQEROA/Zku+CTE5ZRu2zptO3N93977WbFt2yg6qdu2nZJt5we8Wmq2bSfPtq/2/ta3ZnjuPqe4ooiYAKBA/P1HEZFoOQLA0Ree+z0z/WfmE+cfBwCloHcFiEd98D49afrwtt1GAKFHJAaMOuktkkzJnIgmknzzsW1QROkBAfDIMlKzGh2pac5k/8MApGsR5VHvk6Z0qNqQ7x9VInZHIsa+TqrRqZqSr49FlC4IcP4SZqVj1cwl5wPSWsTE80mlc1Xy/ImILUVsOYVqdK+mnLIlYisRG01jootNnLYRYgsFNp3FRCebOGtTFMMK2HwKE91s4pTNEYYhcfNpVDpa5bTNo3RW4SkO0dUO8SlUHRU4OymdraazUXRQ4EAm8zaWeCCKvwpjXjSlu1V7cUz4i1JuZU2HW/NWKf9E4rqLk3kcS4vXjfKHiFupdLnKWxEBhLDRPM0+J+u8TUKASPk9M51uw5tjAcG4PjOvY7YKkBK3akO3k9ccJEG2XWDmdljzSVTYjpl+N9unG4dwqnkeZm4PfEH1PJqfxT4zs7kefoUrmOh608BJ55n34SVn0/2ctpDme5T30wGb/8n83//++++///7777///vvvv//++++///7777///vvvv//++++///7777///vvvv//++++///7777///vvvv//++++///7777///vvvv//++++///7777///vvvv//++++///7777///vvvv//++++///7777///vvvv//++++///7777///vvvv//++++///7777///vvvv//++++///7777///v/Tp6n/8b/Ghc8x+57Es06w5H0uvpreZ+ikfWbn7HmU7wEfUH3PtwgvmevJPAXYk9n3bAvZanY2v5M4eVRR4RnWfqfJd6CMOJHqdsxWj4VA8Dmz12l4MwqgCMc3tdPJOm+TEADE8kuqz1HeiggAAYcvzuZxLC1eN8ofUOJWrT1OzVulxJ+HsQM0f6N8cUzAX+H8vsbf1H0HovgrlHiFjbdp+ApKdCjFNjOYfU3mjG2idIKADX5I6mks/bABAjovcSSZ/YwN8UiUGG4x5o5ZTF7GyIdHlWhzo2lsfIxy5WMQaaPCFlOpHqbmlK0QBa1GbPYyTb2L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');
cardBackTexture.colorSpace = THREE.SRGBColorSpace;

const deckGroup = new THREE.Group();
const CARD_W = 0.95, CARD_D = 1.33; // Seitenverhältnis passend zur echten Kartenrückseite (3:4.2), deutlich größer für gute Sichtbarkeit
const CARD_RADIUS = 0.16; // Eckenradius, deutlich sichtbar passend zur runden Kartenrückseiten-Grafik

// Abgerundete Kartenform (statt scharfkantiger Box), damit die Ecken zur bereits
// abgerundeten Kartenrückseiten-Textur passen und nicht mehr eckig darunter hervorschauen.
function roundedRectShape(w, h, r) {
  const shape = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}
function createRoundedCardGeometry(w, h, thickness, radius) {
  const shape = roundedRectShape(w, h, radius);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 8 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, thickness / 2, 0);
  return geo;
}
// Die Rückseiten-/Vorderseiten-Textur saß bisher auf einer schlicht RECHTECKIGEN Ebene, die
// über die abgerundeten Ecken der Karte hinausragte - genau DORT hat man an den 4 Ecken
// jeweils ein kleines Dreieck des (meist weißen) Textur-Hintergrunds gesehen. Diese Ebene
// bekommt jetzt exakt dieselbe abgerundete Form wie die Karte selbst (inkl. korrekt
// berechneter UVs, da THREE.ShapeGeometry von sich aus KEINE auf 0..1 normalisierten UVs
// liefert) - damit ist die Ecke der Textur-Ebene immer exakt deckungsgleich mit der Karte.
function createRoundedPlaneGeometry(w, h, radius) {
  const shape = roundedRectShape(w, h, radius);
  const geo = new THREE.ShapeGeometry(shape, 12);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  }
  uv.needsUpdate = true;
  return geo;
}
const deckBackMat = new THREE.MeshStandardMaterial({ color: COLORS.royal, roughness: 0.5, metalness: 0.2 });

let topCardMesh = null;
let topCardOriginalY = 0;
let topCardFrontPlaneMat = null;
const DECK_CARD_COUNT = 50; // echter, dicker Stapel statt nur 16 dünner Karten - Layout je Karte unverändert
// Echte Spielkarten-Proportion (Dicke ca. 1.3% der Kartenbreite) statt der bisherigen ~3.2%,
// die wie "ein halbes Buch pro Karte" wirkten. Auch der Abstand zwischen den Karten im
// Stapel wurde proportional mitverkleinert.
const DECK_CARD_H = CARD_W * 0.008;
const DECK_CARD_GAP = 0.001;
for (let i = 0; i < DECK_CARD_COUNT; i++) {
  const isTop = i === DECK_CARD_COUNT - 1;
  const geo = createRoundedCardGeometry(CARD_W, CARD_D, DECK_CARD_H, CARD_RADIUS);
  const card = new THREE.Mesh(geo, deckBackMat);
  card.position.set(0, DECK_CARD_H / 2 + i * (DECK_CARD_H + DECK_CARD_GAP), 0);
  card.castShadow = true;
  card.receiveShadow = true;
  deckGroup.add(card);

  // Robusterer Weg für die Textur: eine eigene, einfache Ebene direkt auf die Karte gelegt,
  // statt BoxGeometry-Flächen-Materialien (die je nach UV-Zuordnung Probleme machen können).
  // JEDE Karte im Stapel bekommt das Logo auf der sichtbaren Oberseite - nicht nur die
  // oberste -, damit auch die Karte, die nach dem Abheben zum Vorschein kommt, sofort
  // wieder mit Logo daliegt statt einfarbig.
  const backPlaneGeo = createRoundedPlaneGeometry(CARD_W * 0.995, CARD_D * 0.995, CARD_RADIUS * 0.995);
  const backPlaneMat = new THREE.MeshBasicMaterial({ map: cardBackTexture, side: THREE.DoubleSide });
  const backPlane = new THREE.Mesh(backPlaneGeo, backPlaneMat);
  backPlane.rotation.x = -Math.PI / 2;
  backPlane.position.y = DECK_CARD_H / 2 + 0.0006;
  card.add(backPlane);

  if (isTop) {
    topCardMesh = card;
    topCardOriginalY = card.position.y;

    // Vorderseite (Frage-Seite) an der Unterseite der obersten Karte - liegt anfangs
    // verdeckt zum Stapel hin, wird erst nach dem ersten Flip sichtbar.
    // WICHTIG: Rotation ist bewusst das GEGENTEIL der backPlane-Rotation (+PI/2 statt -PI/2),
    // weil diese Ebene auf der GEGENÜBERLIEGENDEN Seite der Karte sitzt. Rechnerisch geprüft
    // (drei.js-Quaternionen exakt nachgerechnet): mit -PI/2 kommt die Frage am Ende der
    // Zieh-Animation exakt kopfüber (dot=-1 zur aufrechten Referenz) UND von der Kamera
    // weggedreht (dot=-1) an - mit +PI/2 stimmt beides exakt (dot=+1, aufrecht & zur Kamera).
    const frontPlaneGeo = createRoundedPlaneGeometry(CARD_W * 0.995, CARD_D * 0.995, CARD_RADIUS * 0.995);
    const frontPlaneMat = new THREE.MeshBasicMaterial({ map: makeCardFrontTexture(DEMO_QUESTION_TEXT), side: THREE.DoubleSide });
    topCardFrontPlaneMat = frontPlaneMat; // für dynamisches Aktualisieren des Fragetexts (Live-Spiel)
    const frontPlane = new THREE.Mesh(frontPlaneGeo, frontPlaneMat);
    // WICHTIG: Diese Rotation ist an die Endausrichtung der Karte gekoppelt (siehe
    // drawCardAnimation weiter unten, kamera-abhängiges "lookAt"-System). Mit reinem
    // rotation.x = +PI/2 (kein zusätzlicher Roll) steht die Frage am Ende exakt aufrecht
    // UND zur Kamera gedreht (mit drei.js-Quaternionen exakt nachgerechnet: beide Werte
    // ergeben Dot-Produkt +1,0 - unabhängig von der aktuellen Kamera-Position/dem -winkel).
    // WICHTIG: Diese Rotation gehört fest zur "öffnet nach rechts + Reveal-Kamera schaut
    // von oben drauf"-Kombination in drawCardAnimation weiter unten. Mit drei.js-
    // Quaternionen exakt nachgerechnet: Dot-Produkt +1,0 für "aufrecht" UND "zur
    // Reveal-Kamera zeigend".
    frontPlane.rotation.set(Math.PI / 2, 0, Math.PI);
    frontPlane.position.y = -DECK_CARD_H / 2 - 0.0006;
    card.add(frontPlane);
  }
}
// Dezenter Glüh-Rand rund um den Stapel, damit er auf dem Brett klar auffindbar ist
const deckGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(CARD_W + 0.3, CARD_D + 0.3),
  new THREE.MeshBasicMaterial({ map: makeGlowTexture('#C577FB'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
);
deckGlow.rotation.x = -Math.PI / 2;
deckGlow.position.y = 0.005;
deckGroup.add(deckGlow);

deckGroup.position.set(0, 0, RING_H / 2 - 1.1); // deutlich sichtbar auf dem Brett, unterhalb des Logos
scene.add(deckGroup);

// ---------- Spielfigur: ECHTE 3D-Form (kein CSS-Trick) - Sockel + Kopf ----------
function makeEmojiSprite(emoji, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.font = Math.floor(size * 0.75) + 'px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.05);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  return new THREE.Sprite(mat);
}

function makeGlowTexture(hexColor) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, hexColor + 'AA');
  grad.addColorStop(0.6, hexColor + '55');
  grad.addColorStop(1, hexColor + '00');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function wrapCanvasText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  words.forEach(word => {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  return lines;
}

// Vorderseite der Karte (Frage-Seite) - zeigt die tatsächliche Frage, damit man sie schon
// auf der Karte lesen kann, bevor sie nahtlos ins 2D-Overlay übergeht.
function makeCardFrontTexture(questionText) {
  const w = 512, h = 716;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const r = 46;
  ctx.fillStyle = '#F7F1FA';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#AC58F9';
  ctx.lineWidth = 10;
  ctx.stroke();

  ctx.fillStyle = '#8C39F7';
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FRAGE', w / 2, 90);

  ctx.fillStyle = '#2a1740';
  ctx.font = '600 44px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapCanvasText(ctx, questionText, w - 90);
  const lineHeight = 58;
  const startY = h / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, w / 2, startY + i * lineHeight));

  return new THREE.CanvasTexture(canvas);
}

// Alle sechs echten Avatare aus dem Spiel - als reine, leicht schwebende Symbol-Objekte
// (kein Sockel/Kegel/Kugel-Körper mehr, wie gewünscht) mit einem sanften Glüh-Untergrund
// AVATAR_SET, avatarSetByKey und FIGURE_BUILDERS kommen jetzt aus ./avatars/registry.js
// (siehe avatars/README.md fuer die Struktur und wie man eine neue Figur ergaenzt)

function createToken(avatarKey, colorHex) {
  const group = new THREE.Group();
  group.userData.bobPhase = Math.random() * Math.PI * 2;
  // Sanfte, konstante Eigenrotation - unabhängig von der Kamera, rein zur Belebung der Figur
  group.userData.spinSpeed = 0.25 + Math.random() * 0.15;
  group.userData.avatarKey = avatarKey;

  // Weicher Glüh-Kreis knapp über dem Feld - verstärkt den "Schweben"-Eindruck
  const glowGeo = new THREE.PlaneGeometry(0.7, 0.7);
  const glowMat = new THREE.MeshBasicMaterial({
    map: makeGlowTexture(colorHex),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.03;
  group.add(glow);

  // Echtes 3D-Objekt statt flachem Kamera-Sprite: räumlich fest ausgerichtet, dreht sich
  // NICHT mit der Kamera mit. Je nach Avatar ein komplett anderes, detailliertes Modell.
  const builder = FIGURE_BUILDERS[avatarKey] || FIGURE_BUILDERS.diamond;
  const figure = builder(colorHex);
  figure.position.y = 0.5;
  group.add(figure);
  group.userData.gem = figure; // Referenz für die Eigenrotation pro Frame

  // Feiner Bodenschatten, damit der Höhen-Abstand zum Feld sichtbar bleibt
  const shadowGeo = new THREE.CircleGeometry(0.22, 24);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = 0.02;
  group.add(shadowMesh);

  return group;
}

const tokensData = [
  { ...AVATAR_SET[0], pos: 2 },   // 💎 Diamant
  { ...AVATAR_SET[4], pos: 6 },   // 👑 Krone
  { ...AVATAR_SET[1], pos: 10 },  // 🎭 Maske
  { ...AVATAR_SET[2], pos: 14 },  // 🔮 Kristallkugel
  { ...AVATAR_SET[3], pos: 18 },  // 🃏 Joker
  { ...AVATAR_SET[5], pos: 22 },  // ⭐ Stern
];
const tokenMeshes = tokensData.map(t => {
  const mesh = createToken(t.key, t.color);
  scene.add(mesh);
  return mesh;
});
// Diese sechs Tokens oben sind reine Platzhalter-Demodaten für die eigenständige
// Werkstatt-Seite (board-threejs-demo.html). Im eingebetteten Spiel (board-threejs-embed.html,
// per iframe im echten Spiel) sind sie NIE echte Spieler und sollen daher niemals sichtbar
// aufblitzen, bevor kurz danach die echten Spieler per syncPlayersFromExternal ankommen -
// deshalb hier sofort ausblenden, sobald erkannt wird, dass wir eingebettet laufen.
if (window.parent && window.parent !== window) {
  tokenMeshes.forEach(mesh => { mesh.visible = false; });
}

// Verhindert, dass mehrere Figuren auf demselben Feld exakt ineinander stehen (war bei 2-3
// Figuren auf einem Feld praktisch nicht mehr unterscheidbar, weil die Figuren dafür zu groß
// sind): Figuren, die sich ein Feld teilen, werden in einer kleinen Formation versetzt UND
// etwas verkleinert, damit alle nebeneinander auf das Feld passen.
function formationOffsets(n, r) {
  if (n <= 1) return [{ x: 0, z: 0 }];
  if (n === 2) return [{ x: -r, z: 0 }, { x: r, z: 0 }];
  if (n === 3) return [{ x: 0, z: -r * 0.95 }, { x: -r * 0.95, z: r * 0.55 }, { x: r * 0.95, z: r * 0.55 }];
  const arr = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    arr.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  return arr;
}
function updateTokenLayout(excludeIdx = -1) {
  const groups = {};
  tokensData.forEach((t, idx) => {
    if (idx === excludeIdx) return;
    (groups[t.pos] = groups[t.pos] || []).push(idx);
  });
  Object.values(groups).forEach(idxList => {
    const n = idxList.length;
    // Weniger extrem als vorher (0.48 bei 4-6 Spielern wirkte aus der Kamera-Distanz winzig) -
    // die Formation übernimmt jetzt einen größeren Teil der Auflockerung, die Skalierung
    // bleibt moderater. Der eigentliche Größen-WECHSEL passiert außerdem nicht mehr
    // schlagartig, sondern weich (siehe smoothScale in tick()).
    const scale = n === 1 ? 1 : n === 2 ? 0.8 : n === 3 ? 0.72 : 0.65;
    const offsets = formationOffsets(n, 0.16);
    idxList.forEach((tokenIdx, i) => {
      const mesh = tokenMeshes[tokenIdx];
      mesh.userData.slotOffset = offsets[i];
      mesh.userData.slotScale = scale;
      // KEIN mesh.scale.setScalar(scale) mehr hier - nur das Ziel setzen, der eigentliche
      // Übergang läuft weich in der tick()-Schleife, statt schlagartig zu "springen".
    });
  });
}

// Lässt Figuren, die schon auf dem ZIELFELD eines Zuges stehen, direkt beim Start des Zuges
// beginnen, sanft Platz zu machen - statt erst im Moment der tatsächlichen Ankunft abrupt
// zusammenzurücken. Die ankommende Figur selbst bekommt ihren Platz erst bei der Ankunft
// (siehe updateTokenLayout() am Zug-Ende) - hier geht es nur um die schon wartenden Figuren.
function preRegroupDestinationField(movingIdx, destPos) {
  const occupantIdx = tokensData
    .map((t, idx) => idx)
    .filter(idx => idx !== movingIdx && tokensData[idx].pos === destPos);
  if (occupantIdx.length === 0) return; // Zielfeld ist noch frei - nichts zu tun
  const n = occupantIdx.length + 1; // +1 für die ankommende Figur, die gleich dazustößt
  const scale = n === 1 ? 1 : n === 2 ? 0.8 : n === 3 ? 0.72 : 0.65;
  const offsets = formationOffsets(n, 0.16);
  occupantIdx.forEach((tokenIdx, i) => {
    const mesh = tokenMeshes[tokenIdx];
    mesh.userData.slotOffset = offsets[i];
    mesh.userData.slotScale = scale;
  });
}
function setTokenWorldPos(tokenIdx, wx, wz) {
  const mesh = tokenMeshes[tokenIdx];
  const off = mesh.userData.slotOffset || { x: 0, z: 0 };
  mesh.position.x = wx + off.x;
  mesh.position.z = wz + off.z;
}

function placeTokens() {
  updateTokenLayout();
  tokensData.forEach((t, idx) => {
    const mesh = tokenMeshes[idx];
    mesh.userData.isMoving = false;
    const offset = mesh.userData.slotOffset || { x: 0, z: 0 };
    mesh.userData.currentOffset = { x: offset.x, z: offset.z };
    mesh.scale.setScalar(mesh.userData.slotScale !== undefined ? mesh.userData.slotScale : 1);
    const pos = fieldPosition(t.pos);
    setTokenWorldPos(idx, pos.x, pos.z);
  });
}
placeTokens();

// ---------- Live-Integration: echte Spieler-Daten von einer einbettenden Seite empfangen
// (postMessage), z.B. von client-3d.js. Ohne eine solche einbettende Seite passiert hier
// einfach nichts - die eigenständige Demo-Nutzung dieser Datei bleibt unverändert. ----------
function syncPlayersFromExternal(players) {
  tokenMeshes.forEach(m => scene.remove(m));
  tokenMeshes.length = 0;
  tokensData.length = 0;
  (players || []).slice(0, 6).forEach(p => {
    const set = avatarSetByKey(p.avatarKey);
    tokensData.push({ ...set, pos: p.position || 0, playerId: p.id, name: p.name });
    const mesh = createToken(set.key, set.color);
    scene.add(mesh);
    tokenMeshes.push(mesh);
  });
  placeTokens();
  if (typeof renderFigurePicker === 'function') renderFigurePicker();
}
function movePlayerByIdExternal(playerId, steps) {
  const idx = tokensData.findIndex(t => t.playerId === playerId);
  if (idx === -1 || !steps) return;
  animateMove(idx, steps);
}

// ---------- Einführungs-Animation: einmalig ganz zu Beginn eines neuen Spiels ----------
// Kamera zoomt zum Startfeld, die Spielfiguren "poppen" dort sanft/verspielt auf (nutzt die
// bereits vorhandene weiche Skalierungs-Angleichung aus tick() - Start bei winziger Größe,
// die dann von selbst zur Normalgröße hochwächst), danach zoomt die Kamera wieder zurück
// zur gewohnten Übersicht.
function playIntroPlacement(players) {
  syncPlayersFromExternal(players);
  // Figuren bleiben zunächst KOMPLETT unsichtbar (nicht nur winzig skaliert) - sie dürfen
  // erst auftauchen, NACHDEM die Kamera fertig auf das Start-/Zielfeld gezoomt ist, nicht
  // schon während des Zoomens.
  tokenMeshes.forEach(mesh => {
    mesh.visible = false;
    mesh.scale.setScalar(0.001);
  });

  const startWorld = fieldPosition(0);
  const dir = dirForEdge(classifyEdge(startWorld));
  const camPos = insideCamPos(startWorld, dir, INSIDE_RADIUS);
  const camTarget = new THREE.Vector3(startWorld.x, 0.3, startWorld.z);
  const overviewCamPos = camera.position.clone();
  const overviewCamTarget = controls.target.clone();

  controls.enabled = false;
  const zoomInMs = 1100;
  // Figuren erscheinen NACHEINANDER (nicht alle gleichzeitig) - ein deutlicher zeitlicher
  // Versatz pro Figur, plus etwas Zeit am Ende, damit die zuletzt aufgetauchte Figur noch in
  // Ruhe fertig herabschweben/hineinwachsen kann (siehe introDrop-Handling in tick()), BEVOR
  // wieder rausgezoomt wird. Insgesamt bewusst etwas gemächlicher als vorher.
  const revealStaggerMs = 480;
  const introDropHeight = 2.2; // wie weit "von oben" jede Figur sichtbar herabschwebt
  const introDropDurationMs = 1300;
  const revealPhaseMs = Math.max(1, tokenMeshes.length - 1) * revealStaggerMs + introDropDurationMs;
  const zoomOutMs = 1100;
  const totalMs = zoomInMs + revealPhaseMs + zoomOutMs;

  let revealedCount = 0;
  const start = performance.now();
  function frame(now) {
    const el = now - start;
    if (el < zoomInMs) {
      // P1: nur die Kamera zoomt heran - alle Figuren bleiben unsichtbar
      const p = easeInOutCubic(el / zoomInMs);
      camera.position.lerpVectors(overviewCamPos, camPos, p);
      controls.target.lerpVectors(overviewCamTarget, camTarget, p);
    } else if (el < zoomInMs + revealPhaseMs) {
      // P2: Kamera steht fest auf dem Feld - Figuren werden nacheinander sichtbar
      // geschaltet, schweben dabei sichtbar von oben herab und wachsen gleichzeitig weich
      // auf ihre Zielgröße (siehe tick())
      camera.position.copy(camPos);
      controls.target.copy(camTarget);
      const elapsedInReveal = el - zoomInMs;
      const shouldBeRevealed = Math.min(tokenMeshes.length, Math.floor(elapsedInReveal / revealStaggerMs) + 1);
      while (revealedCount < shouldBeRevealed) {
        const mesh = tokenMeshes[revealedCount];
        if (mesh) {
          mesh.visible = true;
          mesh.userData.introDropStart = performance.now();
          mesh.userData.introDropDurationMs = introDropDurationMs;
          mesh.userData.introDropHeight = introDropHeight;
        }
        revealedCount++;
      }
    } else if (el < totalMs) {
      // P3: alle Figuren stehen, Kamera zoomt zurück zur gewohnten Übersicht
      const p = easeInOutCubic((el - zoomInMs - revealPhaseMs) / zoomOutMs);
      camera.position.lerpVectors(camPos, overviewCamPos, p);
      controls.target.lerpVectors(camTarget, overviewCamTarget, p);
    } else {
      camera.position.copy(overviewCamPos);
      controls.target.copy(overviewCamTarget);
    }
    if (el < totalMs) {
      requestAnimationFrame(frame);
    } else {
      // Sicherheitsnetz: falls durch eine Framerate-Schwankung ein Reveal-Schritt
      // übersprungen wurde, müssen am Ende garantiert alle Figuren sichtbar sein und exakt
      // auf ihrer Ruheposition stehen (kein Rest-Versatz vom Herabschweben)
      tokenMeshes.forEach(mesh => { mesh.visible = true; delete mesh.userData.introDropStart; });
      controls.enabled = orbitEnabled;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'introPlacementComplete' }, '*');
      }
    }
  }
  requestAnimationFrame(frame);
}
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'syncPlayers') {
    syncPlayersFromExternal(data.players);
  } else if (data.type === 'movePlayer') {
    movePlayerByIdExternal(data.playerId, data.steps);
  } else if (data.type === 'drawCard') {
    resetCardPosition();
    drawCardAnimation(data.questionText || '❓');
  } else if (data.type === 'introPlacement') {
    playIntroPlacement(data.players);
  } else if (data.type === 'setFieldTypes') {
    // Echte Trigger-Felder aus dem laufenden Spiel (server.js) - stellt sicher, dass z.B.
    // ein Zeichnen-Feld im 3D-Brett auch wirklich dieselbe Position hat wie im 2D-Brett,
    // statt eines davon unabhängigen, fest einprogrammierten Werts.
    TRIGGER_FIELDS = {
      estimate: data.estimateFields || TRIGGER_FIELDS.estimate,
      foreignword: data.foreignwordFields || TRIGGER_FIELDS.foreignword,
      drawing: data.drawingFields || TRIGGER_FIELDS.drawing,
    };
    rebuildFieldTextures();
  }
});
// Der einbettenden Seite mitteilen, dass die 3D-Szene bereit ist, Daten zu empfangen
if (window.parent && window.parent !== window) {
  window.parent.postMessage({ type: 'board3dReady' }, '*');
}

// ---------- Figuren-Auswahl: jede Test-Figur kann live gegen jede der 6 echten
// Spielfiguren getauscht werden, um zu prüfen, wie alle im Brett aussehen ----------
function rebuildTokenMesh(idx, avatarKey) {
  const set = avatarSetByKey(avatarKey);
  tokensData[idx] = { ...set, pos: tokensData[idx].pos };
  scene.remove(tokenMeshes[idx]);
  const mesh = createToken(set.key, set.color);
  scene.add(mesh);
  tokenMeshes[idx] = mesh;
  placeTokens();
}

function renderFigurePicker() {
  const row = document.getElementById('figure-picker-row');
  row.innerHTML = '';
  tokensData.forEach((t, idx) => {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '4px';
    const label = document.createElement('label');
    label.textContent = `Figur ${idx + 1}`;
    label.style.fontSize = '12px';
    label.style.opacity = '0.8';
    const select = document.createElement('select');
    select.className = 'btn';
    AVATAR_SET.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.key;
      opt.textContent = `${a.emoji} ${a.key}`;
      if (a.key === t.key) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => rebuildTokenMesh(idx, select.value));
    wrap.appendChild(label);
    wrap.appendChild(select);
    row.appendChild(wrap);
  });
}
renderFigurePicker();

// ---------- Animation: Zug simulieren (echte Kamera-Bewegung, kein Trick) ----------
let activeTurn = 1;
let animating = false;
// Statt einen Zug einfach zu verwerfen, während schon eine andere Figur zieht (das war der
// Grund, warum nach einer Runde mit mehreren Punkte-Empfänger:innen nur EINE Figur zu ziehen
// schien) - jetzt werden weitere Züge in eine Warteschlange gestellt und automatisch
// nacheinander abgespielt, sobald die aktuell laufende Figur fertig gezogen ist.
const pendingMoveQueue = [];

function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// Kamera-Hilfsfunktionen (auf Modul-Ebene, damit sowohl animateMove als auch die
// Einführungs-Animation beim allerersten Rundenstart sie nutzen können):
// Feste Regel: die Kamera agiert IMMER von vorne aufs Brett - auch bei der hinteren
// Reihe wird von vorne rübergeschaut, nie von hinten. Bei der linken Reihe kommt die
// Kamera von vorne-rechts, bei der rechten Reihe von vorne-links - nie eine reine
// Seiten- oder Rückansicht.
// WICHTIG: muss spürbar NÄHER sein als die Übersichts-Kamera (Distanz ~9.2), sonst ist der
// Zoom-Effekt beim Ranfahren an eine ziehende Figur nicht wahrnehmbar.
const INSIDE_HEIGHT = 2.3;
const INSIDE_RADIUS = 3.6;
const halfW = RING_W / 2, halfH = RING_H / 2;
function classifyEdge(world) {
  const distFront = Math.abs(world.z - halfH);
  const distBack = Math.abs(world.z + halfH);
  const distRight = Math.abs(world.x - halfW);
  const distLeft = Math.abs(world.x + halfW);
  const minDist = Math.min(distFront, distBack, distRight, distLeft);
  if (minDist === distLeft) return 'left';
  if (minDist === distRight) return 'right';
  if (minDist === distBack) return 'back'; // eigener Wert (statt wie bisher unter "front" mitzulaufen), damit wir speziell für die hintere Reihe geringer heranzoomen können
  return 'front';
}
function dirForEdge(edge) {
  let dirX = 0, dirZ = 1; // Standard: immer von vorne (gilt auch für die hintere Reihe)
  if (edge === 'left') { dirX = 0.75; dirZ = 0.66; }        // linke Reihe -> von vorne-rechts
  else if (edge === 'right') { dirX = -0.75; dirZ = 0.66; } // rechte Reihe -> von vorne-links
  // 'back' bleibt bewusst bei dirX=0, dirZ=1 - weiterhin IMMER von vorne gefilmt, nie von hinten
  const len = Math.hypot(dirX, dirZ);
  return { x: dirX / len, z: dirZ / len };
}
function insideCamPos(world, dir, radius) {
  return new THREE.Vector3(
    world.x * 0.15 + dir.x * radius,
    INSIDE_HEIGHT,
    dir.z * radius
  );
}

function animateMove(tokenIdx, steps, onComplete) {
  if (animating) {
    pendingMoveQueue.push({ tokenIdx, steps, onComplete });
    return;
  }
  animating = true;
  controls.enabled = false;

  const startPos = tokensData[tokenIdx].pos;
  const endPos = (startPos + steps) % BOARD_SLOTS;
  const startWorld = fieldPosition(startPos);
  const endWorld = fieldPosition(endPos);

  const overviewCamPos = camera.position.clone();
  const overviewCamTarget = controls.target.clone();

  // Kompletter Feld-für-Feld-Weg dieses Zuges (statt nur Start-/Zielfeld), damit die Figur
  // bei einem Zug über eine Brettecke hinweg (z.B. rechte Reihe -> vordere Reihe) wirklich
  // die Ecke abläuft statt schräg quer über die Mitte des Bretts zu schneiden.
  const pathPoints = [];
  for (let s = 0; s <= steps; s++) pathPoints.push(fieldPosition(startPos + s));
  const segLengths = [];
  let totalLen = 0;
  for (let s = 0; s < pathPoints.length - 1; s++) {
    const dx = pathPoints[s + 1].x - pathPoints[s].x;
    const dz = pathPoints[s + 1].z - pathPoints[s].z;
    const segLen = Math.hypot(dx, dz);
    segLengths.push(segLen);
    totalLen += segLen;
  }
  function pointAtProgress(p) {
    if (pathPoints.length === 1 || totalLen < 1e-6) return pathPoints[0];
    let remaining = p * totalLen;
    for (let s = 0; s < segLengths.length; s++) {
      const segLen = segLengths[s];
      if (remaining <= segLen || s === segLengths.length - 1) {
        const segT = segLen > 1e-9 ? Math.min(1, remaining / segLen) : 1;
        return {
          x: lerp(pathPoints[s].x, pathPoints[s + 1].x, segT),
          z: lerp(pathPoints[s].z, pathPoints[s + 1].z, segT),
        };
      }
      remaining -= segLen;
    }
    return pathPoints[pathPoints.length - 1];
  }

  // WICHTIG: Die Blickrichtung wird nur EINMAL bestimmt und für die komplette Zug-Bewegung
  // beibehalten (verhindert hektisches Hin-und-Herspringen der Kamera). Sie richtet sich
  // dabei aber nach der MEHRHEIT der durchlaufenen Felder, nicht mehr nur nach dem Startfeld:
  // ein Zug, der z.B. auf der rechten Reihe startet, aber überwiegend über die vordere Reihe
  // läuft, wird also korrekt von vorne gefilmt statt fälschlich von der Seite.
  const edgeCounts = {};
  pathPoints.forEach(pt => {
    const e = classifyEdge(pt);
    edgeCounts[e] = (edgeCounts[e] || 0) + 1;
  });
  let majorityEdge = 'front', majorityCount = -1;
  Object.keys(edgeCounts).forEach(e => {
    if (edgeCounts[e] > majorityCount) { majorityCount = edgeCounts[e]; majorityEdge = e; }
  });
  const moveDir = dirForEdge(majorityEdge);
  // Kleiner Zoom für die hintere Reihe (Startfeld, Felder 1-5): die Kamera bleibt weiterhin
  // fest auf der Vorderseite des Bretts, rückt für diesen Fall aber ein Stück näher heran,
  // weil die hintere Reihe sonst spürbar weiter weg wirkt als die vordere.
  const camRadius = majorityEdge === 'back' ? INSIDE_RADIUS * 0.78 : INSIDE_RADIUS;
  const camAtStart = insideCamPos(startWorld, moveDir, camRadius);
  const targetAtStart = new THREE.Vector3(startWorld.x, 0.3, startWorld.z);
  const camAtEnd = insideCamPos(endWorld, moveDir, camRadius);
  const targetAtEnd = new THREE.Vector3(endWorld.x, 0.3, endWorld.z);

  // Die ziehende Figur bekommt für die Dauer des Zuges volle Größe & keinen Formations-
  // Versatz (sie soll beim Fliegen nicht plötzlich verkleinert wirken). Die übrigen Figuren,
  // die auf dem verlassenen Feld zurückbleiben, rücken sofort in die neue, kleinere Formation
  // nach, statt bis zum Zug-Ende in der alten (jetzt zu großen) Anordnung stehen zu bleiben.
  tokenMeshes[tokenIdx].userData.slotOffset = { x: 0, z: 0 };
  tokenMeshes[tokenIdx].userData.slotScale = 1;
  tokenMeshes[tokenIdx].scale.setScalar(1);
  tokenMeshes[tokenIdx].userData.isMoving = true;
  updateTokenLayout(tokenIdx);
  preRegroupDestinationField(tokenIdx, endPos);

  const zoomInMs = 700, trackMs = 900 + steps * 90, zoomOutMs = 700;
  const totalMs = zoomInMs + trackMs + zoomOutMs;
  const start = performance.now();

  function frame(now) {
    const elapsed = now - start;
    let wx = startWorld.x, wz = startWorld.z;

    if (elapsed < zoomInMs) {
      // Phase 1: Kamera zoomt an die Figur heran - die Figur steht dabei noch still
      const p = easeInOutCubic(elapsed / zoomInMs);
      camera.position.lerpVectors(overviewCamPos, camAtStart, p);
      controls.target.lerpVectors(overviewCamTarget, targetAtStart, p);
    } else if (elapsed < zoomInMs + trackMs) {
      // Phase 2: Figur zieht ihre Felder ENTLANG DES ECHTEN BRETT-WEGES (Polyline über alle
      // Zwischenfelder), nicht mehr als gerade Luftlinie von Start- zu Zielfeld. Die
      // Kamera-POSITION wird weiterhin zwischen zwei fest berechneten Punkten (Start/Ziel)
      // interpoliert - NICHT jeden Frame neu aus der aktuellen Figur-Position berechnet.
      // Das war die Ursache des Rucklers/Zitterns: nahe der Brettmitte kippt die
      // Blickrichtung sonst sprunghaft um.
      const p = easeInOutCubic((elapsed - zoomInMs) / trackMs);
      const pt = pointAtProgress(p);
      wx = pt.x; wz = pt.z;
      camera.position.lerpVectors(camAtStart, camAtEnd, p);
      controls.target.set(wx, 0.3, wz);
    } else if (elapsed < totalMs) {
      // Phase 3: Figur ist angekommen, Kamera zoomt wieder zur Gesamtübersicht heraus
      const p = easeInOutCubic((elapsed - zoomInMs - trackMs) / zoomOutMs);
      wx = endWorld.x; wz = endWorld.z;
      camera.position.lerpVectors(camAtEnd, overviewCamPos, p);
      controls.target.lerpVectors(targetAtEnd, overviewCamTarget, p);
    } else {
      wx = endWorld.x; wz = endWorld.z;
    }

    setTokenWorldPos(tokenIdx, wx, wz);

    if (elapsed < totalMs) {
      requestAnimationFrame(frame);
    } else {
      tokensData[tokenIdx].pos = endPos;
      tokenMeshes[tokenIdx].userData.isMoving = false;
      tokenMeshes[tokenIdx].userData.currentOffset = { x: 0, z: 0 };
      // Neu ankommende Figur wird jetzt wieder Teil der ganz normalen Feld-Formation -
      // gemeinsam mit allen anderen Figuren neu einsortieren (auch das Zielfeld kann ja
      // bereits andere Figuren tragen). Die tatsächliche Bewegung in die neue Formation
      // passiert danach weich in tick() - kein hartes "Reinpressen" mehr.
      updateTokenLayout();
      animating = false;
      controls.enabled = orbitEnabled;
      if (onComplete) onComplete();
      // Nächsten wartenden Zug (falls vorhanden) automatisch starten - so ziehen am Ende
      // einer Runde nacheinander wirklich ALLE Figuren, die Punkte bekommen haben, statt
      // dass nur die erste zieht und der Rest verworfen wird.
      if (pendingMoveQueue.length > 0) {
        const next = pendingMoveQueue.shift();
        animateMove(next.tokenIdx, next.steps, next.onComplete);
      }
    }
  }
  requestAnimationFrame(frame);
}

document.getElementById('btnMove').addEventListener('click', () => {
  activeTurn = activeTurn === 0 ? 1 : 0;
  const steps = activeTurn === 0 ? 3 : 5;
  animateMove(activeTurn, steps);
});

// Lässt alle 4 Spielfiguren nacheinander (nicht gleichzeitig) je 2-5 Felder ziehen -
// simuliert, wie eine komplette Runde am Ende aussehen würde
let movingAll = false;
document.getElementById('btnMoveAll').addEventListener('click', () => {
  if (movingAll || animating) return;
  movingAll = true;
  const btn = document.getElementById('btnMoveAll');
  btn.disabled = true;
  let i = 0;
  function next() {
    if (i >= tokensData.length) {
      movingAll = false;
      btn.disabled = false;
      return;
    }
    const idx = i;
    i++;
    const steps = 2 + Math.floor(Math.random() * 4); // 2 bis 5 Felder
    animateMove(idx, steps, next);
  }
  next();
});

// ---------- Karte ziehen: hebt vom Stapel ab, dreht sich, fliegt zur Kamera, zeigt Frage ----------
let cardDrawing = false;
function drawCardAnimation(questionText) {
  if (cardDrawing || !topCardMesh) return;
  cardDrawing = true;
  controls.enabled = false;

  // Echten Fragetext auf die Karten-Vorderseite setzen (Live-Spiel) - ohne Angabe bleibt
  // der bisherige Demo-Text erhalten (Werkstatt-Button "Karte ziehen").
  if (questionText && topCardFrontPlaneMat) {
    topCardFrontPlaneMat.map = makeCardFrontTexture(questionText);
    topCardFrontPlaneMat.needsUpdate = true;
  }

  // Karte aus dem Stapel lösen, in Welt-Raum hängen (Position/Rotation bleibt erhalten)
  scene.attach(topCardMesh);
  const startPos = topCardMesh.position.clone();
  topCardMesh.quaternion.identity();
  topCardMesh.visible = true;

  // WICHTIG (neue Variante): Die Haupt-Kamera bewegt/dreht sich waehrend der gesamten
  // Animation NICHT mehr - weder Position noch Blickwinkel aendern sich. Stattdessen dreht
  // sich die KARTE selbst in genau den Winkel, in dem die (fest stehende) Kamera ohnehin auf
  // das Spielbrett schaut, und bewegt sich dabei auf die Kamera/den Bildschirm zu.
  //
  // Geometrischer Trick dafuer: die Karte liegt anfangs flach auf dem Stapel. Damit ihre
  // Vorderseite (Frage-Text) am Ende GENAU zur Kamera zeigt (= "im selben Winkel wie der
  // Bildschirm aufs Brett schaut"), muss ihre Normale am Ende auf "faceDir" zeigen (die
  // Richtung von der Karten-Endposition zur Kamera). Eine 180°-Drehung um die Achse "Mitte
  // zwischen Ruhe-Normale und faceDir" bildet die Ruhe-Normale exakt auf faceDir ab
  // (Standard-Eigenschaft von 180°-Drehungen um eine Winkelhalbierende) - UND liest sich
  // dabei weiterhin wie ein normales Aufklappen (kein Kamera-Sprung nötig). Welche Richtung
  // die Ruhe-Normale tatsächlich hat, steht weiter unten (restingFaceNormal).
  const mainCamPos = camera.position.clone();
  const mainCamTarget = controls.target.clone();
  const viewDir = mainCamPos.clone().sub(mainCamTarget).normalize(); // von Brettmitte zur Kamera

  // Endposition der Karte: exakt auf der Sichtachse der Kamera (also garantiert mittig im
  // Bild), aber deutlich naeher an der Kamera als der Kartenstapel - die Karte bewegt sich
  // dadurch sichtbar auf den Bildschirm/die Kamera zu, statt dass die Kamera zu ihr fährt.
  const distFromCam = 2.6;
  const cardEndPos = mainCamPos.clone().addScaledVector(viewDir, -distFromCam);
  const faceDir = viewDir.clone(); // Richtung von der Karten-Endposition zur Kamera

  // KORREKTUR: die Frage-Textur sitzt in Ruhelage an der UNTERSEITE der Karte (deswegen
  // "Rückseite oben, Frage unten" beim Abheben vom Stapel, siehe Kartenaufbau weiter oben:
  // die Front-Plane hat eine negative Y-Position). Die Vorderseiten-Normale bei Identität
  // zeigt also nach UNTEN (0,-1,0), NICHT nach oben - eine frühere Version dieser Funktion
  // ging fälschlich von "Normale zeigt nach oben" aus, wodurch die Drehachse fast senkrecht
  // wurde und die Karte wie ein Kreisel um die eigene Hochachse rotierte, statt sich wie eine
  // Tür/Buchseite zur Seite zu öffnen.
  const restingFaceNormal = new THREE.Vector3(0, -1, 0);
  const flipAxis = restingFaceNormal.clone().add(faceDir).normalize();
  // 540° (= 1,5 volle Umdrehungen) statt nur 180° - endet bei EXAKT derselben Ausrichtung
  // wie eine einfache 180°-Drehung (540° mod 360° = 180°), sieht dabei aber deutlich
  // dynamischer aus (Karte dreht sich sichtbar mehrfach, statt nur einmal aufzuklappen).
  // WICHTIG: dafür darf NICHT slerp() zwischen zwei Quaternions verwendet werden (das würde
  // immer nur den kürzesten Weg - also wieder nur 180° - nehmen, egal wie der Zielwinkel
  // benannt ist), sondern der Drehwinkel wird jeden Frame direkt neu aus dem Fortschritt p
  // berechnet und per setFromAxisAngle gesetzt.
  const FLIP_TURNS = 1.5;
  const flipAngleTotal = FLIP_TURNS * Math.PI * 2; // 540° in Radiant

  const liftTarget = new THREE.Vector3(startPos.x, startPos.y + 0.9, startPos.z);
  // Skalierung so berechnet, dass die Karte am Ende bildschirmfüllend ist - unabhängig
  // davon, wo genau die (jetzt fest stehende) Kamera positioniert ist.
  const vFOV = camera.fov * Math.PI / 180;
  const visibleHeightAtEnd = 2 * Math.tan(vFOV / 2) * distFromCam;
  const fillFactor = 0.82; // etwas Rand lassen, damit nichts über den Bildschirmrand hinausragt
  const endScale = (visibleHeightAtEnd / CARD_D) * fillFactor;
  const startTime = performance.now();

  const liftMs = 600;  // P1: senkrecht über den Stapel heben, Karte bleibt flach liegen
  const openMs = 2300; // P2: Karte klappt auf, dreht sich in den Kamera-Blickwinkel und
                        // bewegt sich dabei auf die (fest stehende) Kamera zu
  const totalMs = liftMs + openMs;

  let overlayShown = false;

  function frame(now) {
    const el = now - startTime;

    if (el < liftMs) {
      // P1: nur senkrecht abheben, Karte bleibt flach liegen (Rückseite oben, Frage unten)
      const p = easeInOutCubic(el / liftMs);
      topCardMesh.position.lerpVectors(startPos, liftTarget, p);
      topCardMesh.quaternion.identity();
      topCardMesh.scale.setScalar(1);

    } else if (el < totalMs) {
      // P2: Karte klappt auf UND bewegt sich zur Kamera - die Kamera selbst bleibt die
      // ganze Zeit exakt an ihrer Position/ihrem Blickwinkel stehen.
      const p = easeInOutCubic((el - liftMs) / openMs);
      topCardMesh.position.lerpVectors(liftTarget, cardEndPos, p);
      topCardMesh.quaternion.setFromAxisAngle(flipAxis, flipAngleTotal * p);
      topCardMesh.scale.setScalar(lerp(1, endScale, p));

      // 2D-Frage-Overlay schon knapp VOR dem völligen Abschluss der Animation einblenden
      // (nicht erst exakt am Ende) - durch die vorhandene CSS-Fade-Transition wirkt der
      // Übergang dadurch spürbar smoother statt eines harten Schnitts.
      if (!overlayShown && p >= 0.92) {
        overlayShown = true;
        document.getElementById('question-overlay').classList.remove('hidden');
      }
    }

    if (el < totalMs) {
      requestAnimationFrame(frame);
    } else {
      if (!overlayShown) document.getElementById('question-overlay').classList.remove('hidden');
      topCardMesh.visible = false; // 2D-Overlay übernimmt jetzt die Anzeige der echten Frage
      cardDrawing = false;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'cardDrawComplete' }, '*');
      }
    }
  }
  requestAnimationFrame(frame);
}

function resetCardPosition() {
  if (!topCardMesh) return;
  deckGroup.attach(topCardMesh);
  topCardMesh.position.set(0, topCardOriginalY, 0);
  topCardMesh.rotation.set(0, 0, 0);
  topCardMesh.quaternion.identity();
  topCardMesh.scale.setScalar(1);
  topCardMesh.visible = true;
  controls.enabled = orbitEnabled;
}

document.getElementById('btnDrawCard').addEventListener('click', () => drawCardAnimation());
document.getElementById('btnSubmitDemo').addEventListener('click', () => {
  document.getElementById('question-overlay').classList.add('hidden');
  resetCardPosition();
});
document.getElementById('btnCloseQuestion').addEventListener('click', () => {
  document.getElementById('question-overlay').classList.add('hidden');
  resetCardPosition();
});

document.getElementById('btnReset').addEventListener('click', () => {
  tokensData[0].pos = 2;
  tokensData[1].pos = 6;
  tokensData[2].pos = 10;
  tokensData[3].pos = 14;
  tokensData[4].pos = 18;
  tokensData[5].pos = 22;
  placeTokens();
  camera.position.set(0, 6.5, 6.5);
  controls.target.set(0, 0.5, 0);
});

// Manuelles Drehen per Finger/Maus ist NUR in der Werkstatt-Datei (board-threejs-demo.html)
// standardmäßig an - dort ist das zum Testen sinnvoll. In der eingebetteten Spielversion
// (board-threejs-embed.html, per iframe im echten Spiel) bleibt die Kamera von Anfang an
// fest/statisch, wie gewünscht - der Spieler soll die Kamera nicht selbst justieren müssen.
// Erkennung: läuft die Datei in einem iframe (window.parent !== window), ist es die
// eingebettete Version.
let orbitEnabled = (window.parent === window);
controls.enabled = orbitEnabled;
document.getElementById('btnOrbitToggle').addEventListener('click', (e) => {
  orbitEnabled = !orbitEnabled;
  controls.enabled = orbitEnabled;
  e.target.textContent = orbitEnabled ? '🖱️ Freie Kamera: AN' : '🖱️ Freie Kamera: AUS';
});

// Höhe der Feld-Oberfläche an einem Slot (Zielfeld ist höher als normale Felder) -
// die Figuren müssen darüber schweben, sonst tauchen sie ins (höhere) Zielfeld ein.
function fieldTopY(slotIndex) {
  const isFinish = (((slotIndex % BOARD_SLOTS) + BOARD_SLOTS) % BOARD_SLOTS) === FINISH_INDEX;
  return isFinish ? 0.50 : 0.30;
}
const TOKEN_HOVER_GAP = 0.06; // Mindestabstand zwischen Feldoberfläche und Figuren-Unterkante

// ---------- Render-Loop ----------
function tick() {
  controls.update();
  const t = performance.now() * 0.001;
  tokenMeshes.forEach((mesh, idx) => {
    const base = fieldTopY(tokensData[idx].pos) + TOKEN_HOVER_GAP;
    mesh.position.y = base + Math.sin(t * 1.6 + mesh.userData.bobPhase) * 0.05;

    // Weicher Positions-Übergang statt hartem "Reinpressen": wenn sich die Formation eines
    // Feldes ändert (eine Figur kommt dazu oder verlässt es), wird der neue Versatz nur als
    // ZIEL gesetzt (siehe updateTokenLayout) - hier nähert sich jede stehende Figur (die
    // gerade NICHT selbst mitten im Zug ist) Frame für Frame sanft daran an, statt sofort
    // dorthin zu springen.
    if (!mesh.userData.isMoving) {
      const fieldPos = fieldPosition(tokensData[idx].pos);
      const targetOffset = mesh.userData.slotOffset || { x: 0, z: 0 };
      if (!mesh.userData.currentOffset) mesh.userData.currentOffset = { x: targetOffset.x, z: targetOffset.z };
      const cur = mesh.userData.currentOffset;
      cur.x += (targetOffset.x - cur.x) * 0.045;
      cur.z += (targetOffset.z - cur.z) * 0.045;
      mesh.position.x = fieldPos.x + cur.x;
      mesh.position.z = fieldPos.z + cur.z;
    }

    // Herabsenken "von oben" beim Auftauchen in der Einführungs-Animation (siehe
    // playIntroPlacement): sobald eine Figur sichtbar geschaltet wird, bekommt sie kurz einen
    // hohen Startversatz nach oben, der hier weich auf 0 abgebaut wird - dadurch sieht man sie
    // sichtbar von oben herabschweben, statt einfach nur an Ort und Stelle zu wachsen.
    let introDrop = 0;
    if (mesh.userData.introDropStart !== undefined) {
      const dropElapsed = performance.now() - mesh.userData.introDropStart;
      const dropP = Math.min(1, Math.max(0, dropElapsed / mesh.userData.introDropDurationMs));
      introDrop = (1 - easeInOutCubic(dropP)) * mesh.userData.introDropHeight;
      if (dropP >= 1) delete mesh.userData.introDropStart;
    }
    mesh.position.y += introDrop;

    // Weicher Größen-Übergang statt hartem Sprung: wenn sich die Formation ändert (z.B.
    // eine weitere Figur zieht auf dasselbe Feld oder verlässt es), wird die Zielgröße nur
    // gesetzt (siehe updateTokenLayout) - hier wird jeden Frame ein Stück in Richtung
    // dieses Ziels angenähert, statt sofort dorthin zu springen.
    const targetScale = mesh.userData.slotScale !== undefined ? mesh.userData.slotScale : 1;
    if (Math.abs(mesh.scale.x - targetScale) > 0.002) {
      mesh.scale.setScalar(mesh.scale.x + (targetScale - mesh.scale.x) * 0.045);
    }
    if (mesh.userData.gem) {
      // Rein kosmetische, langsame Eigendrehung des Edelstein-Körpers - unabhängig von
      // der Kamera-Position, damit die Figur weiterhin lebendig wirkt, aber ihre
      // Ausrichtung im Raum (von oben, von der Seite) stabil erkennbar bleibt.
      mesh.userData.gem.rotation.y = t * mesh.userData.spinSpeed;
    }
  });
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

document.getElementById('loading').style.display = 'none';
