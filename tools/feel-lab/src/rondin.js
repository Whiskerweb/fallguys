import * as THREE from 'three';

/**
 * LE RONDIN — un tronc géant qui TOURNE, et sur lequel on court.
 *
 * Le module ne connaît qu'un tronçon. La scène en aligne plusieurs.
 *
 * ── LE CYLINDRE EST COMPLET, ET C'EST LA CONDITION DE LA ROTATION ───────────────
 * Une version intermédiaire n'engendrait que l'arc supérieur — 140° — pour économiser les
 * triangles de la moitié immergée. C'était une fausse économie : un arc n'a de sol
 * au-dessus POUR AUCUNE PHASE autre que la verticale. Il ne peut donc pas tourner, et la
 * map perdait ce qui lui donne son nom. On revient au cylindre fermé.
 *
 * L'économie est reprise ailleurs, et mieux : le pas des anneaux passe de 1,0 m à 1,6 m.
 * Un cylindre est LISSE le long de son axe — le raffiner dans cette direction ne change
 * rien à ce qu'on voit, alors que le raffiner autour de la circonférence change la
 * silhouette. Le tronçon complet coûte ainsi moins cher que l'arc qu'il remplace.
 *
 * ── POURQUOI PAS `track.js` ─────────────────────────────────────────────────────
 * Le module de piste balaie un profil transversal le long d'une ligne moyenne, mais ce
 * profil est TOUJOURS vertical dans le repère du monde : sa hauteur s'ajoute directement
 * à Y. Il ne sait pas s'enrouler. Ce qu'on lui emprunte reste l'essentiel : le collider
 * est un trimesh bâti sur LES MÊMES SOMMETS que le visuel, avec les mêmes drapeaux. Dans
 * un jeu où l'on mise, un collider qui approche le visuel n'est pas acceptable.
 *
 * LA PAROI EST UNE COQUE, sans épaisseur. Le trimesh de Rapier arrête des deux côtés : la
 * face que l'on voit est exactement celle qui porte. Les trous ne sont donc pas creusés,
 * ils sont des cellules absentes — et c'est la garantie la plus forte qu'on puisse donner,
 * puisqu'il n'existe aucune seconde surface qui pourrait diverger de la première.
 *
 * UN TROU EST DOUBLE. Chaque percement retire aussi les cellules diamétralement opposées.
 * Le joueur qui tombe dans le trou du dessus traverse l'intérieur, glisse au fond de la
 * coque — dont le point bas EST la seconde ouverture, puisqu'elle lui fait face — et
 * ressort dans le lagon. Un trou borgne l'aurait piégé à l'intérieur d'un tronc qui
 * tourne, vivant et immobile : le joueur n'aurait pas su s'il était mort ou coincé.
 */

/**
 * Colonnes autour de la circonférence. C'est le levier de silhouette : à R = 12 m, 72
 * colonnes donnent une facette de 1,05 m, invisible à hauteur de course.
 */
const COLS = 72;
/**
 * Pas des anneaux le long de l'axe, en mètres.
 *
 * 1,6 m et non 1,0 : le cylindre est lisse dans cette direction, donc le raffinement n'y
 * achète rien. Il faut seulement qu'un trou de 3,4 m garde deux cellules de large.
 */
const ROW_STEP = 1.6;
/** Période de texture, en mètres — pour que l'échelle du motif ne dépende pas du rayon. */
const UV = 8;
/** Profondeur du liseré qui borde chaque trou : sans lui, la paroi se lit comme du papier. */
const RIM = 0.5;

const AXE_Z = new THREE.Vector3(0, 0, 1);
/** Le sommet du cylindre, dans le repère local : θ = π/2 pointe vers +Y. */
const CRETE_TH = Math.PI / 2;

const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Écart angulaire signé le plus court entre deux angles. */
const dAngle = (a, b) => norm(a - b);

/**
 * Construit un tronçon.
 *
 * @param {object} ctx `{ RAPIER, world, group }`
 * @param {object} o
 *   `z0` / `z1`  cotes de début et de fin (on progresse vers −Z, donc `z1 < z0`)
 *   `radius`     rayon de la paroi
 *   `centerY`    hauteur de l'axe — la crête est donc à `centerY + radius`
 *   `omega`      vitesse de rotation, en rad/s, signée
 *   `phase`      angle à t = 0
 *   `trous`      `[{ z, angle, arc, long }]` — cote, angle LOCAL, ouverture angulaire, longueur
 *   `matEcorce` / `matChemin`  matériaux de la paroi et de la bande de crête
 *   `arcChemin`  demi-ouverture angulaire de la bande de terre battue
 */
export function buildEchine({ RAPIER, world, group }, o) {
  const R = o.radius;
  const L = o.z0 - o.z1;                  // longueur, positive
  const zMid = (o.z0 + o.z1) / 2;
  const rows = Math.max(2, Math.round(L / ROW_STEP));
  const trous = o.trous ?? [];
  /**
   * Demi-largeur du sentier, en radians.
   *
   * 0,13 rad = 7,4°, soit un sentier de 3,1 m sur une crête praticable de 9 m. Il doit
   * rester MINORITAIRE : plus large, l'écorce ne se voit plus que sur les flancs et le
   * tronc se lit comme une plage. Un tronc doit d'abord ressembler à du bois — le sentier
   * n'est qu'une usure par-dessus.
   */
  const arcChemin = o.arcChemin ?? 0.13;
  // Angle LOCAL du sentier. La scène le cale pour qu'il soit en haut à t = 0.
  const angleChemin = o.angleChemin ?? CRETE_TH;

  // ── Sommets de la paroi ────────────────────────────────────────────────────────────
  // Repère LOCAL : axe du tronçon sur Z, origine au milieu. Le corps porte la translation
  // et la rotation, donc la géométrie n'a jamais à les connaître.
  const pos = [], uv = [], nrm = [];
  const idx = (i, j) => i * COLS + (j % COLS);
  for (let i = 0; i <= rows; i++) {
    const zl = -L / 2 + (i / rows) * L;
    for (let j = 0; j < COLS; j++) {
      const th = (j / COLS) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      pos.push(R * c, R * s, zl);
      nrm.push(c, s, 0);
      // u suit la circonférence, v suit l'axe : le motif garde son échelle en mètres.
      uv.push((th * R) / UV, zl / UV);
    }
  }

  /**
   * Une cellule est-elle percée ?
   *
   * Le test porte sur le CENTRE de la cellule, et il vaut aussi pour son antipode : un
   * trou traverse toujours. `arc` est une ouverture angulaire — à rayon constant, elle
   * correspond à une largeur d'arc de `arc * R`.
   */
  function perce(thCell, zCell) {
    for (const t of trous) {
      if (Math.abs(zCell - t.z) > t.long / 2) continue;
      const d = Math.abs(dAngle(thCell, t.angle));
      const dOppose = Math.abs(dAngle(thCell, t.angle + Math.PI));
      if (d < t.arc / 2 || dOppose < t.arc / 2) return true;
    }
    return false;
  }

  // ── Faces, réparties en deux groupes de matériau ────────────────────────────────────
  // Le sentier de terre battue est une BANDE D'ANGLE LOCAL : il tourne donc avec le tronc.
  // Voir le sentier dériver, c'est voir de combien le rondin a tourné, et de quel côté —
  // la rotation devient lisible sans aucune indication à l'écran.
  const facesEcorce = [], facesChemin = [];
  const cellules = [];   // pour construire les liserés : on garde l'état de chaque cellule
  for (let i = 0; i < rows; i++) {
    const zCell = -L / 2 + ((i + 0.5) / rows) * L;
    for (let j = 0; j < COLS; j++) {
      const thCell = ((j + 0.5) / COLS) * Math.PI * 2;
      const trouee = perce(thCell, zCell);
      cellules.push(trouee);
      if (trouee) continue;
      const a = idx(i, j), b = idx(i, j + 1), c = idx(i + 1, j + 1), d = idx(i + 1, j);
      const cible = Math.abs(dAngle(thCell, angleChemin)) < arcChemin ? facesChemin : facesEcorce;
      cible.push(a, b, c, a, c, d);
    }
  }
  const percee = (i, j) => (i < 0 || i >= rows ? true : cellules[i * COLS + ((j + COLS) % COLS)]);

  // ── Liserés de trou ────────────────────────────────────────────────────────────────
  // Une arête entre une cellule pleine et une cellule absente reçoit une jupe qui plonge
  // vers l'intérieur. La paroi cesse d'avoir l'épaisseur d'une feuille là où on la regarde
  // le plus : au bord du trou.
  const interieur = new Map();
  function sommetInterieur(i, j) {
    const k = i * COLS + (j % COLS);
    if (interieur.has(k)) return interieur.get(k);
    const zl = -L / 2 + (i / rows) * L;
    const th = ((j % COLS) / COLS) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    const n = pos.length / 3;
    pos.push((R - RIM) * c, (R - RIM) * s, zl);
    nrm.push(-c, -s, 0);
    uv.push((th * R) / UV, zl / UV);
    interieur.set(k, n);
    return n;
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < COLS; j++) {
      if (percee(i, j)) continue;
      // Arête « avant » et arête « arrière » en Z, puis les deux arêtes angulaires.
      const bords = [
        [percee(i - 1, j), idx(i, j), idx(i, j + 1)],
        [percee(i + 1, j), idx(i + 1, j + 1), idx(i + 1, j)],
        [percee(i, j - 1), idx(i + 1, j), idx(i, j)],
        [percee(i, j + 1), idx(i, j + 1), idx(i + 1, j + 1)],
      ];
      const paires = [
        [[i, j], [i, j + 1]],
        [[i + 1, j + 1], [i + 1, j]],
        [[i + 1, j], [i, j]],
        [[i, j + 1], [i + 1, j + 1]],
      ];
      for (let k = 0; k < 4; k++) {
        if (!bords[k][0]) continue;
        const a = bords[k][1], b = bords[k][2];
        const ai = sommetInterieur(paires[k][0][0], paires[k][0][1]);
        const bi = sommetInterieur(paires[k][1][0], paires[k][1][1]);
        facesEcorce.push(a, b, bi, a, bi, ai);
      }
    }
  }

  // ── Couronnes des deux bouts ───────────────────────────────────────────────────────
  // Le tronc est creux : sans elles, on verrait la tranche disparaître dans le vide.
  for (const i of [0, rows]) {
    for (let j = 0; j < COLS; j++) {
      const a = idx(i, j), b = idx(i, j + 1);
      const ai = sommetInterieur(i, j), bi = sommetInterieur(i, j + 1);
      if (i === 0) facesEcorce.push(a, ai, bi, a, bi, b);
      else facesEcorce.push(a, b, bi, a, bi, ai);
    }
  }

  // ── Maillage ───────────────────────────────────────────────────────────────────────
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const indices = facesEcorce.concat(facesChemin);
  geo.setIndex(indices);
  geo.addGroup(0, facesEcorce.length, 0);
  geo.addGroup(facesEcorce.length, facesChemin.length, 1);
  const mesh = new THREE.Mesh(geo, [o.matEcorce, o.matChemin]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const visuel = new THREE.Group();
  visuel.position.set(0, o.centerY, zMid);
  visuel.add(mesh);

  // ── Anneaux de coupe ───────────────────────────────────────────────────────────────
  // Un disque plein à chaque bout, posé sur la couronne. Décor pur, aucun collider : une
  // tranche verticale au bout d'un tronçon n'est jamais foulée.
  if (o.matAnneaux) {
    const disque = new THREE.CircleGeometry(R * 0.995, 40);
    for (const bout of [0, 1]) {
      const d = new THREE.Mesh(disque, o.matAnneaux);
      d.position.z = bout === 0 ? L / 2 + 0.02 : -L / 2 - 0.02;
      if (bout === 1) d.rotation.y = Math.PI;
      d.receiveShadow = true;
      visuel.add(d);
    }
  }

  group.add(visuel);

  // ── Corps cinématique et collider ──────────────────────────────────────────────────
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, o.centerY, zMid),
  );
  const F = RAPIER.TriMeshFlags;
  const desc = RAPIER.ColliderDesc.trimesh(
    new Float32Array(pos), new Uint32Array(indices),
    F ? F.MERGE_DUPLICATE_VERTICES | F.FIX_INTERNAL_EDGES : undefined,
  ).setFriction(0.62);
  world.createCollider(desc, body);

  // ── Rotation ───────────────────────────────────────────────────────────────────────
  // Fonction PURE du temps écoulé et de la phase. Jamais de `dt` accumulé : la scène reçoit
  // `dt = 0` en pause, et deux clients qui divergeraient d'une image finiraient par voir
  // deux rondins différents. La spec l'exige — aucun aléa dans le monde du jeu.
  const q = new THREE.Quaternion();
  function angleA(elapsed) { return o.phase + o.omega * elapsed; }
  function setAngle(elapsed) {
    const a = angleA(elapsed);
    q.setFromAxisAngle(AXE_Z, a);
    visuel.quaternion.copy(q);
    body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    return a;
  }
  setAngle(0);

  /**
   * Inclinaison du terrain sous un point, en radians, comptée depuis la crête.
   *
   * C'est la grandeur que lit la scène pour doser la glisse : à 0 on est sur le plat, et
   * elle croît vers les flancs. Elle ne dépend pas de la rotation, seulement de la position
   * du joueur autour de l'axe — et c'est bien ce qu'on veut, puisque c'est la PENTE qui
   * fait déraper, pas le fait que le tronc tourne.
   */
  function penteAt(p) {
    if (p.z > o.z0 + 1 || p.z < o.z1 - 1) return null;
    const dx = p.x, dy = p.y - o.centerY;
    if (Math.hypot(dx, dy) < 1e-3) return null;
    return Math.abs(dAngle(Math.atan2(dy, dx), CRETE_TH));
  }

  /**
   * Vitesse de la surface sous un point, en repère monde.
   *
   * Aucune boîte, aucune zone : pour une rotation ω autour de l'axe Z, la vitesse d'un
   * point de la paroi vaut ω × r, soit une poussée purement latérale de ω·R à la crête,
   * qui s'annule sur les flancs. La formule EST la physique.
   *
   * On la calcule au rayon de la PAROI et non à celui du joueur : son centre est 0,80 m
   * au-dessus du contact, ce qui surestimerait la vitesse de 15 %.
   */
  function surfaceAt(p) {
    if (p.z > o.z0 + 1 || p.z < o.z1 - 1) return null;
    const dx = p.x, dy = p.y - o.centerY;
    const r = Math.hypot(dx, dy);
    if (r < R - 0.6 || r > R + 2.2) return null;
    return { vx: -o.omega * R * (dy / r), vz: 0 };
  }

  /**
   * Angle actuel du tronçon, lu sur le CORPS et non recalculé.
   *
   * Un diagnostic qui sonde une géométrie en rotation doit connaître l'angle exact au
   * moment du tir, pas celui qu'il croit. Recalculer `phase + ω·t` supposerait que le
   * harnais et le jeu partagent la même horloge à l'image près — ils ne la partagent pas.
   */
  function angleCourant() {
    const r = body.rotation();
    return 2 * Math.atan2(r.z, r.w);
  }

  return {
    body, visuel, mesh, geo, setAngle, surfaceAt, penteAt, angleA, angleCourant,
    R, z0: o.z0, z1: o.z1, centerY: o.centerY, omega: o.omega, trous,
    /** Position monde d'un point de la paroi donné en (cote Z, angle LOCAL). */
    pointSurface(z, angleLocal, elapsed = 0, hauteur = 0) {
      const a = angleA(elapsed) + angleLocal;
      return new THREE.Vector3(
        (R + hauteur) * Math.cos(a),
        o.centerY + (R + hauteur) * Math.sin(a),
        z,
      );
    },
  };
}

export const ECHINE_COLS = COLS;
export const ECHINE_RIM = RIM;
export const ECHINE_CRETE_TH = CRETE_TH;
