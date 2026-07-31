import * as THREE from 'three';

// Gemeinsamer "edler" Standard-Materialtyp, den mehrere Figuren als Basis nutzen
// (Krone, Joker, Maske, Stern, ...). Einzelne Figuren können über `extra` beliebige
// Eigenschaften überschreiben/ergänzen (z.B. transmission, metalness, emissiveIntensity).
export function shinyMat(colorHex, extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: colorHex, metalness: 0.15, roughness: 0.18, clearcoat: 0.7, clearcoatRoughness: 0.2,
    emissive: colorHex, emissiveIntensity: 0.16, ...extra,
  });
}

// Ein echter Glitzer-Punkt als Sprite (dreht sich NIE mit weg, zeigt immer zur Kamera -
// anders als eine flache PlaneGeometry, die bei der Eigendrehung der Figur irgendwann von
// der Seite/Kante zu sehen ist und dann kaum noch funkelt). Vierzackiger Stern mit weichem
// Glüh-Kern, per Canvas-Textur erzeugt.
export function makeSparkleSprite(size = 0.09) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  ctx.save();
  ctx.translate(64, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(0, -60); ctx.quadraticCurveTo(7, -7, 60, 0);
  ctx.quadraticCurveTo(7, 7, 0, 60);
  ctx.quadraticCurveTo(-7, 7, -60, 0);
  ctx.quadraticCurveTo(-7, -7, 0, -60);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  return sprite;
}
