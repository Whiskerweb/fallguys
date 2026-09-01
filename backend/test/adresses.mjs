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
import { dit, titre, bilan } from './aide.mjs';

process.env.GRAINE_DEPOTS = 'graine-de-test-jamais-utilisee-en-vrai';
const { adresseDepot, cleDepot } = await import('../src/solana/adresses.js');

const alice = '11111111-2222-3333-4444-555555555555';
const bob = '99999999-8888-7777-6666-555555555555';

titre('Derivation des adresses de depot');

const a1 = adresseDepot(alice);
const a2 = adresseDepot(alice);
dit(a1 === a2, `deterministe : deux appels donnent ${a1.slice(0, 12)}...`);
dit(a1 !== adresseDepot(bob), 'deux joueurs ont deux adresses distinctes');
dit(a1.length >= 32 && a1.length <= 44, `l'adresse est bien du base58 Solana (${a1.length} caracteres)`);

// La cle privee doit pouvoir signer : c'est elle qui balaie les depots vers la caisse.
const cle = cleDepot(alice);
dit(cle.publicKey.toBase58() === a1, 'la cle derivee correspond bien a l\'adresse publiee');
dit(cle.secretKey.length === 64, 'la cle privee est complete (64 octets), donc utilisable pour signer');

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
    `const { adresseDepot } = await import('./src/solana/adresses.js');
     process.stdout.write(adresseDepot('${alice}'));`],
  { env: { ...process.env, GRAINE_DEPOTS: graine }, encoding: 'utf8' },
);

dit(derive('une-autre-graine') !== a1,
  'changer la graine change l\'adresse — donc la graine ne se change JAMAIS une fois en service');

try {
  execFileSync(
    process.execPath,
    ['--input-type=module', '-e',
      `const { adresseDepot } = await import('./src/solana/adresses.js');
       adresseDepot('${alice}');`],
    { env: { ...process.env, GRAINE_DEPOTS: '' }, encoding: 'utf8', stdio: 'pipe' },
  );
  dit(false, 'sans graine, la derivation aurait du refuser');
} catch {
  dit(true, 'sans graine, la derivation refuse au lieu d\'inventer une adresse');
}

process.exit(bilan() === 0 ? 0 : 1);
