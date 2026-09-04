/**
 * L'économie — réexportée depuis LE JEU, exactement comme `reseau.js` le fait du protocole.
 *
 * Le salon a besoin de deux choses avant qu'une partie existe : la forme du mode choisi, et
 * LA VARIANTE que la roue tire pour ce salon-là. Les deux doivent être identiques à ce que
 * le lobby affiche et à ce que le backend paiera, donc elles viennent de la même définition.
 *
 * POURQUOI PAS PAR `monde.js`. Celui-ci charge aussi l'économie, mais après `preparer()` —
 * c'est-à-dire après Rapier, Three, les cartes et les textures. Un salon qui se remplit n'a
 * besoin d'aucun moteur physique, et faire dépendre l'affichage d'un pot du chargement d'un
 * moteur 3D coûterait cher pour rien. Ce module-ci est un import statique ordinaire :
 * `economie.js` ne touche au navigateur que DANS ses fonctions de mémorisation, jamais à
 * l'import, donc il se charge sous Node sans doublure.
 *
 * Les deux chemins rendent le même module ; il n'y a pas deux tables des gains.
 */
export * from '../../tools/feel-lab/src/economie.js';
