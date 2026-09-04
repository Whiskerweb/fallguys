/**
 * LES PLOTS DE DÉPART — seize disques au sol, un par siège.
 *
 * Ils dessinent ce que `placement.js` calcule : la grille fixe des seize places, la même
 * sur le serveur et chez chaque client. Sans eux, la zone de départ n'existait que dans
 * un calcul, et deux joueurs côte à côte se lisaient comme « spawnés au même endroit ».
 * Un plot par place dit au joueur qu'il a SA place, et que les quatorze autres attendent
 * quelqu'un.
 *
 * ─── POURQUOI ON ATTEND UN PAS DE PHYSIQUE ──────────────────────────────────
 *
 * Les scènes déclarent leur aire de départ en largeur et profondeur, pas en altitude :
 * `spawn.y` est la hauteur d'apparition, souvent un ou deux mètres AU-DESSUS du sol, d'où
 * le personnage tombe. Le plot, lui, doit être POSÉ. On sonde donc le sol au rayon — et
 * un rayon Rapier ne touche rien tant que le monde n'a pas fait un pas (CLAUDE.md). Les
 * plots naissent donc invisibles à `spawn.y` et se posent au premier `poser()` réussi,
 * que `main.js` appelle après la physique. Purement visuel : aucun collider, rien que le
 * serveur puisse voir.
 */

import * as THREE from 'three';
import { places } from './placement.js';

const RAYON = 0.62;
/** Deux couleurs en damier : on distingue une place de sa voisine d'un coup d'œil. */
const TEINTES = [0xffe066, 0x31c7f0];

/**
 * @param {object} arene  l'arène construite (on y lit `spawn`, `depart`, `group`, `world`)
 * @returns {{poser: (RAPIER: object) => boolean, retirer: () => void}}
 */
export function creerPlotsDeDepart(arene) {
  const groupe = new THREE.Group();
  groupe.name = 'plots-depart';
  const geo = new THREE.CylinderGeometry(RAYON, RAYON, 0.06, 28);
  const anneau = new THREE.RingGeometry(RAYON * 0.72, RAYON * 0.88, 28);
  const plots = [];

  let liste;
  try { liste = places(arene); } catch { liste = []; }   // scène sans `depart` : rien à dessiner

  liste.forEach((p, i) => {
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: TEINTES[i % 2] }));
    m.position.set(p.x, p.y, p.z);
    m.visible = false;
    const r = new THREE.Mesh(anneau, new THREE.MeshBasicMaterial({ color: 0x1b1030, side: THREE.DoubleSide }));
    r.rotation.x = -Math.PI / 2;
    r.position.y = 0.035;
    m.add(r);
    groupe.add(m);
    plots.push({ mesh: m, x: p.x, y: p.y, z: p.z });
  });

  arene.group?.add(groupe);
  let poses = plots.length === 0;

  return {
    /**
     * Pose chaque plot sur le sol qu'il trouve sous lui. Rend `true` une fois fait ; tant
     * que le monde n'a pas fait de pas, aucun rayon ne touche et on réessaie plus tard.
     */
    poser(RAPIER) {
      if (poses || !arene.world || !RAPIER) return poses;
      let touches = 0;
      for (const p of plots) {
        const origine = { x: p.x, y: p.y + 3, z: p.z };
        const coup = arene.world.castRay(new RAPIER.Ray(origine, { x: 0, y: -1, z: 0 }), 40, true);
        if (!coup) continue;
        p.mesh.position.y = origine.y - coup.timeOfImpact + 0.03;
        p.mesh.visible = true;
        touches++;
      }
      // Tout ou rien : un rayon qui ne touche rien nulle part, c'est un monde sans pas.
      if (touches > 0) poses = true;
      return poses;
    },
    retirer() {
      groupe.removeFromParent();
      geo.dispose();
      anneau.dispose();
      for (const p of plots) p.mesh.material.dispose();
    },
  };
}
