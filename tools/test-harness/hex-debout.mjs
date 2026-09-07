/**
 * L'HEXAGONE : ON RESTE DEBOUT SUR LES TUILES. Deux verdicts, sans navigateur.
 *
 * « Des fois on prend des collisions en marchant sur les plaques, on tombe, alors qu'on
 * doit rester debout » (directeur produit, 6 septembre 2026). Rien sur cette carte n'est
 * fait pour déstabiliser ; les seules secousses viennent du TERRAIN — la marche entre une
 * tuile enfoncée et sa voisine, le flanc d'une voisine qu'on frôle en tombant dans un
 * trou. Mesuré avant correctif : 57 culbutes sur 168 essais en zigzaguant, et un joueur
 * ralenti à 3,9 m/s en quittant une tuile enfoncée de 12 cm.
 *
 *   1. posé sur l'étage du haut, on court droit ou en zigzag dans douze directions après
 *      une attente variable : AUCUNE culbute, sur l'étage comme dans un trou ;
 *   2. on attend une demi-seconde sur une tuile (enfoncement maximal) puis on en sort à la
 *      course : on garde au moins 5,5 m/s (6,6 sans aucun enfoncement, l'accélération du
 *      joueur lui-même ; 3,9 à 12 cm d'enfoncement).
 *
 * Le marcheur est posé LÀ OÙ le joueur se plaint. Le premier probe partait du socle de
 * départ, et comptait la culbute contre le flanc d'un socle voisin — une autre question.
 *
 * Usage : node hex-debout.mjs
 */
import { preparer, construire, creerPerso, liberer } from '../../serveur/src/monde.js';
import { avancerTick } from '../../serveur/src/tick.js';

const DT = 1 / 30;
const HAUT = 30;                       // cote du sommet de la tour (hexagone.js)
const IDLE = { x: 0, z: 0, jump: false, dive: false };
let ok = 0, ko = 0;
const dit = (cond, msg) => { if (cond) ok++; else ko++; console.log(`${cond ? 'OK   ' : 'ECHEC'} ${msg}`); };

await preparer();

// ── 1. Zigzag sur les tuiles : aucune culbute ────────────────────────────────────────
{
  let culbutes = 0, essais = 0;
  for (const zig of [false, true]) {
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * Math.PI * 2;
      for (let attente = 0; attente <= 0.9; attente += 0.15) {
        essais++;
        const monde = construire('hexagone', 7);
        const perso = creerPerso(monde, 0, 2);
        perso.respawn({ x: 0, y: HAUT + 1.0, z: 0 });
        let t = 0;
        for (let tick = 0; tick < 30 * 3; tick++) {
          const courir = t >= attente;
          let a = a0;
          if (zig && courir) a += (Math.floor((t - attente) / 0.35) % 2 ? 1 : -1) * Math.PI / 3;
          const e = courir ? { x: Math.cos(a), z: Math.sin(a), jump: false, dive: false } : IDLE;
          avancerTick(monde, [{ perso, entrees: [e, e] }], t, DT, true);
          t += DT;
          if (perso.state === 'tumbling') { culbutes++; break; }
          if (perso.position.y < HAUT - 3) break;   // tombé de l'étage : c'est le jeu
        }
        liberer(monde);
      }
    }
  }
  dit(culbutes === 0, `aucune culbute en courant sur les tuiles — ${culbutes} sur ${essais} essais (droit et zigzag, douze directions)`);
}

// ── 2. Quitter une tuile enfoncée à fond ne freine presque pas ───────────────────────
{
  let vMin = Infinity, marcheMax = 0;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const monde = construire('hexagone', 7);
    const perso = creerPerso(monde, 0, 2);
    perso.respawn({ x: 0, y: HAUT + 1.0, z: 0 });
    let t = 0, prev = null;
    for (let tick = 0; tick < 30 * 1.2; tick++) {
      const courir = t >= 0.5;
      const e = courir ? { x: Math.cos(a), z: Math.sin(a), jump: false, dive: false } : IDLE;
      avancerTick(monde, [{ perso, entrees: [e, e] }], t, DT, true);
      t += DT;
      const p = perso.position, v = perso.body.linvel();
      if (courir && t > 0.75 && perso.grounded) vMin = Math.min(vMin, Math.hypot(v.x, v.z));
      if (prev !== null && courir && p.y - prev > 0.03) marcheMax = Math.max(marcheMax, p.y - prev);
      prev = p.y;
    }
    liberer(monde);
  }
  dit(vMin >= 5.5, `quitter une tuile enfoncée garde au moins 5,5 m/s — ${vMin.toFixed(1)} m/s conservés, marche de ${Math.round(marcheMax * 100)} cm au plus`);
}

console.log(`\n--- ${ok + ko} verdicts, ${ko ? `${ko} ECHEC(S)` : 'aucun écart'} ---`);
process.exit(ko ? 1 : 0);
