/**
 * Le protocole réseau — réexporté depuis LE JEU.
 *
 * Il vit dans `tools/feel-lab/src/enligne/protocole.js` parce que les deux bouts du fil
 * doivent l'écrire et le lire exactement pareil. Une copie côté serveur divergerait le jour
 * où quelqu'un ajoute un champ d'un seul côté — et la divergence ne se verrait pas : un
 * décodeur qui lit un octet de trop rend des positions plausibles mais fausses, ce qui est
 * la pire forme de panne.
 *
 * Même raison, même mécanique que `moteur.js` (Three et Rapier) et `economie.js` (la table
 * des gains) : une seule définition, importée des deux côtés.
 */
export * from '../../tools/feel-lab/src/enligne/protocole.js';
