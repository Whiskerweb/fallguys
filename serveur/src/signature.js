/**
 * Les signatures Ed25519 — reexportees depuis LE BACKEND, comme `economie.js` l'est du jeu.
 *
 * C'est le backend qui VERIFIE ; c'est ici qu'on SIGNE. La canonisation doit etre la meme
 * a l'octet pres des deux cotes, sinon une signature valide ne se verifie plus — et ca ne
 * se voit qu'au premier reglement refuse. Une seule implementation, importee des deux
 * cotes : voir `backend/src/signature.js`.
 */
export * from '../../backend/src/signature.js';
