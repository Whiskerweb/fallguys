/**
 * L'environnement des tests — pose AVANT que `config.js` ne soit lu.
 *
 * `config.js` lit l'environnement a l'import, et les imports s'evaluent dans l'ordre :
 * ce module est donc le PREMIER import de `aide.mjs`, et rien de ce qu'il pose n'est un
 * secret. Une graine sans valeur, trois wallets deterministes qui ne detiennent rien, des
 * adresses de contrats imaginaires — de quoi deriver des adresses et faire tourner le
 * brulage factice.
 */
process.env.GRAINE_DEPOTS ??= 'graine-de-test-sans-valeur';
process.env.ROBINHOOD_RESEAU ??= 'factice';
const cleDeTest = (octet) => '0x' + Buffer.alloc(32, octet).toString('hex');
process.env.CAISSE_CLE ??= cleDeTest(1);
process.env.FRAIS_CLE ??= cleDeTest(2);
process.env.POOL_CLE ??= cleDeTest(3);
const adresseDeTest = (octet) => '0x' + Buffer.alloc(20, octet).toString('hex');
process.env.USDC_ADRESSE ??= adresseDeTest(0xaa);
process.env.BG_ADRESSE ??= adresseDeTest(0xbb);
process.env.LOT_ADRESSE ??= adresseDeTest(0xcc);
