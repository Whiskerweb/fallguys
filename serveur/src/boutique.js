/**
 * La boutique — réexportée depuis LE JEU, comme `economie.js` : le serveur a besoin de
 * savoir quels personnages COÛTENT de l'argent, pour ne relayer un skin payant qu'à qui
 * l'a payé. La liste vit dans le jeu, le serveur la lit ; il n'y a pas deux catalogues.
 *
 * `boutique.js` lit la mémoire du navigateur à l'import, dans un `try` : sous Node elle
 * n'existe pas, et le module part à vide — ce qui est exactement ce qu'il faut ici.
 */
export { PAYANTS } from '../../tools/feel-lab/src/boutique.js';
