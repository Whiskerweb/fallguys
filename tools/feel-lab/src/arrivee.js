/**
 * LA PORTE D'ARRIVÉE — une seule, la même sur les quatre courses, les pieds au sol et
 * posée EXACTEMENT sur la ligne qui compte.
 *
 * Décision du directeur produit (6 septembre 2026) : « je ne veux plus de truc qui vole
 * on ne sait comment, je veux que ce soit propre, comme Fall Guys, de belles lignes
 * d'arrivée ». Avant, chaque carte avait la sienne : une arche Meshy blanche dont le dos
 * était un rectangle vide, une guirlande de fanions tendue EN L'AIR entre rien et rien
 * (c'est elle qui « volait »), un portique de jungle de dix-huit mètres à l'enseigne
 * muette, et sur Les Dalles l'arche était posée deux mètres derrière la ligne réelle.
 * Quatre vocabulaires pour un seul événement.
 *
 * Ce qu'on garde de la référence, et pourquoi :
 *
 *   - UNE PORTE RECONNAISSABLE, identique partout. Un joueur qui a fini une course sait
 *     lire l'arrivée des trois autres sans y penser. Seule la couleur des piliers prend
 *     l'accent de la carte ; l'enseigne « FINISH » (magenta, lettres jaunes, ampoules)
 *     est la même sur toutes.
 *   - RIEN NE FLOTTE. Chaque pièce est accrochée à une autre et la chaîne descend jusqu'au
 *     sol : fanion → mât → boule → pilier → pied → sol. L'enseigne est suspendue à deux
 *     poutres qui rejoignent les piliers. Pas de guirlande libre : `diag/arrivees.mjs`
 *     sonde le sol sous chaque pied.
 *   - LA LIGNE AU SOL EST LA LIGNE DU JEU. Le damier est centré sur `finishZ`, la cote
 *     que `main.js` compare à la position du joueur (`pos.z <= finishZ`). Sur Les Dalles
 *     l'arche était à −4 quand la course se gagnait à −2 : on franchissait la porte sans
 *     avoir gagné, ou l'inverse selon le sens où on regardait.
 *   - LES PILIERS SONT DANS L'EMPRISE DE LA PISTE, pas à côté. Sur La Course la piste
 *     vole à dix-neuf mètres au-dessus du relief et sur Les Dalles le palier finit dans
 *     le vide : un pilier posé « à côté » n'a rien sous lui. L'appelant donne
 *     l'ENTRAXE — la distance entre les axes des deux piliers — et se charge qu'il
 *     tienne sur sa surface.
 *
 * Aucun collider : la porte est un décor, ses piliers sont au bord de la piste et le
 * joueur passe dessous. Le serveur construit la même scène sans navigateur : tout ce qui
 * est ici est de la géométrie Three ordinaire, et les textures passent par `textures.js`
 * dont le canevas est doublé côté serveur.
 *
 * L'enseigne est une texture PEINTE (`public/textures/finish-sign.jpg`, générée par
 * OpenRouter puis choisie à l'œil parmi quatre) avec un repli dessiné au canevas — le
 * jeu n'attend jamais un fichier pour tourner. Une seule image pour les deux faces : la
 * face arrière est un second plan retourné, pour que « FINISH » se lise aussi à l'endroit
 * quand on se retourne après la ligne.
 */

import * as THREE from 'three';
import { toonMaterial, addOutline } from './world.js';
import { pill, flag } from './props.js';
import { finishChecker, finishSign, candyStripes } from './textures.js';

/** Le jaune des boules et des lettres, le magenta de l'enseigne : ceux de la texture. */
export const JAUNE_ARRIVEE = 0xffd83d;
export const MAGENTA_ARRIVEE = 0xff1a8c;
const MAGENTA_SOMBRE = 0xd9226f;

/** L'enseigne peinte fait 1376 × 768 : on garde ce rapport, sinon les lettres s'écrasent. */
const RAPPORT_ENSEIGNE = 1376 / 768;
/** Hauteur libre sous l'enseigne. Un saut culmine à 2,15 m ; on laisse de l'air. */
const PASSAGE = 3.4;
const RAYON_PILIER = 0.55;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Construit la porte, origine au SOL, au CENTRE de la ligne. L'axe Z est celui de la
 * course (le joueur arrive par +Z et sort par −Z) ; l'appelant tourne le groupe si sa
 * piste est en biais (`rotation.y = yaw`).
 *
 * @param {object} o
 * @param {number} o.entraxe   distance entre les axes des deux piliers, en mètres
 * @param {number} [o.accent]  couleur de la carte : pieds et fanions
 * @param {number} [o.bande]   couleur des bandes des piliers (sur fond blanc)
 * @param {{ largeur: number, profondeur?: number }} [o.sol]  le damier au sol ; par
 *        défaut aussi large que l'entraxe. `null` pour ne pas en poser.
 */
export function porteArrivee({ entraxe, accent = MAGENTA_ARRIVEE, bande = accent, sol = { largeur: entraxe } } = {}) {
  if (!Number.isFinite(entraxe) || entraxe < 4) throw new Error(`porteArrivee : entraxe invalide (${entraxe})`);
  const g = new THREE.Group();
  g.name = 'porte-arrivee';

  // ── L'enseigne : sa taille suit l'entraxe, bornée pour rester lisible ET passable.
  const largeurEnseigne = clamp(entraxe * 0.46, 5.4, 8.4);
  const hauteurEnseigne = largeurEnseigne / RAPPORT_ENSEIGNE;
  const yEnseigne = PASSAGE + hauteurEnseigne / 2;
  const hautPilier = yEnseigne + hauteurEnseigne / 2 + 0.45;

  const rayures = candyStripes({ a: '#ffffff', b: hex(bande), bands: 4, repeat: [1, 2] });

  for (const sx of [-1, 1]) {
    const x = sx * entraxe / 2;

    // Le pied : plus large que le fût, c'est lui qui dit « posé » et non « planté ».
    const pied = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.08, 0.5, 24), toonMaterial(accent));
    pied.position.set(x, 0.25, 0);
    pied.castShadow = true;
    pied.receiveShadow = true;
    addOutline(pied, 0.02, 0x2a1b45);
    g.add(pied);

    // Le fût : une capsule rayée, du pied à la boule.
    const longueurFut = hautPilier - 0.5;
    const fut = new THREE.Mesh(
      new THREE.CapsuleGeometry(RAYON_PILIER, Math.max(0.1, longueurFut - RAYON_PILIER * 2), 4, 18),
      toonMaterial(0xffffff));
    fut.material.map = rayures;
    fut.position.set(x, 0.5 + longueurFut / 2, 0);
    fut.castShadow = true;
    fut.receiveShadow = true;
    addOutline(fut, 0.03, 0x2a1b45);
    g.add(fut);

    // La boule, puis un mât et son fanion : la seule chose qui bouge, et elle est tenue.
    const boule = new THREE.Mesh(new THREE.SphereGeometry(0.66, 18, 14), toonMaterial(JAUNE_ARRIVEE));
    boule.position.set(x, hautPilier, 0);
    boule.castShadow = true;
    addOutline(boule, 0.03, 0x2a1b45);
    g.add(boule);

    const mat = pill(1.9, 0.06, 0xfff6e6, { outline: false });
    mat.position.set(x, hautPilier + 0.5 + 0.95, 0);
    g.add(mat);
    const fanion = flag(1.5, 0.95, accent, { amplitude: 0.14, speed: 3.0 });
    fanion.position.set(x + 0.08, hautPilier + 0.5 + 1.42, 0);
    g.add(fanion);

    // Deux poutres par côté, du pilier au bord de l'enseigne, au tiers et aux deux tiers
    // de sa hauteur : une seule, au milieu, se lisait comme une brochette à travers le
    // panneau. Deux font un cadre qui le TIENT.
    const portee = entraxe / 2 - largeurEnseigne / 2;
    if (portee > 0.2) {
      for (const dy of [-0.27, 0.27]) {
        const poutre = pill(portee + 0.3, 0.17, 0xfff6e6);
        poutre.rotation.z = Math.PI / 2;
        poutre.position.set(sx * (largeurEnseigne / 2 + portee / 2), yEnseigne + dy * hauteurEnseigne, 0);
        g.add(poutre);
      }
    }
  }

  // ── L'enseigne : un panneau épais, et la même image sur ses deux faces.
  const EPAISSEUR = 0.5;
  const dos = new THREE.Mesh(
    new THREE.BoxGeometry(largeurEnseigne - 0.1, hauteurEnseigne - 0.1, EPAISSEUR),
    toonMaterial(MAGENTA_SOMBRE));
  dos.position.set(0, yEnseigne, 0);
  dos.castShadow = true;
  addOutline(dos, 0.012, 0x2a1b45);
  g.add(dos);
  const image = finishSign();
  for (const sens of [1, -1]) {
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(largeurEnseigne, hauteurEnseigne),
      toonMaterial(0xffffff));
    face.material.map = image;
    face.position.set(0, yEnseigne, sens * (EPAISSEUR / 2 + 0.01));
    if (sens < 0) face.rotation.y = Math.PI;      // retourné, pas en miroir : ça se lit
    face.castShadow = true;
    g.add(face);
  }

  // ── Le damier au sol : LA ligne, centrée sur l'origine (donc sur finishZ).
  if (sol) {
    const largeur = sol.largeur, profondeur = sol.profondeur ?? 2.4;
    const damier = new THREE.Mesh(
      new THREE.PlaneGeometry(largeur, profondeur),
      new THREE.MeshBasicMaterial({
        map: finishChecker({ cells: 8, repeat: [largeur / 3.2, profondeur / 3.2] }),
        toneMapped: false,
      }));
    damier.rotation.x = -Math.PI / 2;
    damier.position.set(0, 0.03, 0);
    damier.name = 'damier-arrivee';
    g.add(damier);
  }

  // Lu par `diag/arrivees.mjs` : où sont les pieds, et combien d'air sous l'enseigne.
  g.userData.arrivee = { entraxe, hautPilier, largeurEnseigne, hauteurEnseigne, yEnseigne };
  return g;
}
