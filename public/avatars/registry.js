// Zentrale Anlaufstelle für alle Spielfiguren. Neue Figur hinzufügen = neue Datei
// nach dem Muster der bestehenden anlegen (siehe README.md) und hier 2 Zeilen ergänzen -
// sonst muss nirgendwo etwas anderes im Projekt angefasst werden.

import { build as buildDiamond } from './diamond.js';
import { build as buildMask } from './mask.js';
import { build as buildCrystalBall } from './crystalball.js';
import { build as buildJoker } from './joker.js';
import { build as buildCrown } from './crown.js';
import { build as buildStar } from './star.js';

// Emoji + Akzentfarbe pro Figur (Emoji wird u.a. in der 2D-Oberfläche/Avatar-Auswahl
// verwendet, `color` färbt den Boden-Glow und ggf. Teile des 3D-Modells ein).
export const AVATAR_SET = [
  { emoji: '💎', key: 'diamond', color: '#D5A1FB' },
  { emoji: '🎭', key: 'mask', color: '#C577FB' },
  { emoji: '🔮', key: 'crystalball', color: '#8C39F7' },
  { emoji: '🃏', key: 'joker', color: '#AC58F9' },
  { emoji: '👑', key: 'crown', color: '#F2B705' },
  { emoji: '⭐', key: 'star', color: '#FFE066' },
];

export function avatarSetByKey(key) {
  return AVATAR_SET.find(a => a.key === key) || AVATAR_SET[0];
}

// key -> build(colorHex)-Funktion, die eine fertige THREE.Group liefert
export const FIGURE_BUILDERS = {
  diamond: buildDiamond,
  mask: buildMask,
  crystalball: buildCrystalBall,
  joker: buildJoker,
  crown: buildCrown,
  star: buildStar,
};
