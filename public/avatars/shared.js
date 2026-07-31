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
