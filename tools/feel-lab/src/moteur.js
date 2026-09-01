/**
 * Le moteur du jeu, réexporté sous un nom.
 *
 * Deux lignes, et elles servent au SERVEUR. `serveur/` exécute les mêmes modules que le
 * navigateur, et doit donc manipuler exactement les mêmes classes : s'il résolvait `three`
 * depuis son propre dossier, il en chargerait une seconde copie. Les `Vector3` des deux
 * côtés se ressembleraient assez pour fonctionner par canard-typage, et assez peu pour
 * qu'un `instanceof` échoue un jour sans rien expliquer.
 *
 * En important CE fichier par son chemin, le serveur obtient l'instance que les cartes
 * utilisent — Node met les modules ES en cache par URL résolue, et cette URL est la même.
 *
 * Le client n'en a pas l'usage : il importe `three` directement, comme avant.
 */
export * as THREE from 'three';
export { default as RAPIER } from '@dimforge/rapier3d-compat';
