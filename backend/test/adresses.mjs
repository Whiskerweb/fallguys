/**
 * Verdicts sur la derivation des adresses de depot.
 *
 * Aucun reseau : la derivation est un calcul pur, et c'est justement ce qu'on veut
 * prouver. Trois proprietes, dont deux ont des consequences directes sur l'argent :
 *
 *   - DETERMINISTE : la meme graine et le meme joueur redonnent la meme adresse. C'est
 *     ce qui permet de ne stocker aucune cle privee. Si ce verdict tombe, tous les depots
 *     en transit deviennent inaccessibles.
 *   - SEPAREE : deux joueurs n'ont jamais la meme adresse, sans quoi leurs depots
 *     seraient indiscernables — exactement le probleme qu'on voulait eviter.
 *   - LIEE A LA GRAINE : changer la graine change toutes les adresses. Le corollaire est
 *     desagreable et il vaut mieux le savoir : la graine ne se change pas.
 *
 * Usage : node test/adresses.mjs
 */
import { isAddress, getAddress } from 'ethers';
import { dit, titre, bilan } from './aide.mjs';

process.env.GRAINE_DEPOTS = 'graine-de-test-jamais-utilisee-en-vrai';
const { adresseDepot, cleDepot } = await import('../src/robinhood/adresses.js');
const { tresorerie } = await import('../src/robinhood/tresorerie.js');

const alice = '11111111-2222-3333-4444-555555555555';
const bob = '99999999-8888-7777-6666-555555555555';

titre('Derivation des adresses de depot');

const a1 = adresseDepot(alice);
const a2 = adresseDepot(alice);
dit(a1 === a2, `deterministe : deux appels donnent ${a1.slice(0, 12)}...`);
dit(a1 !== adresseDepot(bob), 'deux joueurs ont deux adresses distinctes');
dit(isAddress(a1) && a1 === getAddress(a1), `l'adresse est une adresse EVM avec sa somme de controle (${a1.length} caracteres)`);

// La cle privee doit pouvoir signer : c'est elle qui autorise les mises et les retraits.
const cle = cleDepot(alice);
dit(cle.address === a1, 'la cle derivee correspond bien a l\'adresse publiee');
dit(/^0x[0-9a-f]{64}$/.test(cle.privateKey), 'la cle privee est complete (32 octets), donc utilisable pour signer');
const signature = await cle.signMessage('preuve');
dit(typeof signature === 'string' && signature.length === 132, 'et elle signe un message (65 octets de signature)');

dit(tresorerie.pot('partie-1').address !== tresorerie.pot('partie-2').address, 'deux parties ont deux pots distincts');
dit(tresorerie.pot(alice).address !== a1, 'l\'espace des pots ne croise pas celui des joueurs, meme identifiant');

/*
 * Les deux verdicts suivants demandent un AUTRE processus.
 *
 * `config.js` lit l'environnement une seule fois, a son chargement — ce qui est le bon
 * comportement pour un serveur, mais rend inoperant tout `process.env.X = ...` ecrit
 * apres coup, y compris avec un `import()` reidentifie. Plutot que d'affaiblir le module
 * pour le rendre testable, on relance Node avec l'environnement voulu : c'est la
 * situation reelle qu'on veut eprouver, pas une version arrangee.
 */
const { execFileSync } = await import('node:child_process');

const derive = (graine) => execFileSync(
  process.execPath,
  ['--input-type=module', '-e',
    `const { adresseDepot } = await import('./src/robinhood/adresses.js');
     process.stdout.write(adresseDepot('${alice}'));`],
  { env: { ...process.env, GRAINE_DEPOTS: graine }, encoding: 'utf8' },
);

dit(derive('une-autre-graine') !== a1,
  'changer la graine change l\'adresse — donc la graine ne se change JAMAIS une fois en service');

try {
  execFileSync(
    process.execPath,
    ['--input-type=module', '-e',
      `const { adresseDepot } = await import('./src/robinhood/adresses.js');
       adresseDepot('${alice}');`],
    { env: { ...process.env, GRAINE_DEPOTS: '' }, encoding: 'utf8', stdio: 'pipe' },
  );
  dit(false, 'sans graine, la derivation aurait du refuser');
} catch {
  dit(true, 'sans graine, la derivation refuse au lieu d\'inventer une adresse');
}

process.exit(bilan() === 0 ? 0 : 1);
