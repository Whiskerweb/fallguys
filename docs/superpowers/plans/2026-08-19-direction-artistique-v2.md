# Direction artistique v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Amener le rendu du prototype au niveau visuel des références du genre, en corrigeant les huit écarts identifiés par comparaison directe de captures.

**Architecture:** Aucune refonte de code. Les changements portent sur la palette, la géométrie des sols, les textures et le décor de fond. Chaque tâche se vérifie par une capture d'écran automatisée comparée aux références — pas par un test unitaire : on juge un rendu, pas une valeur de retour.

**Tech Stack:** three.js, textures procédurales (`src/textures.js`), Nano Banana via OpenRouter (`tools/texture-pipeline`), Meshy (`tools/meshy-pipeline`), harnais Playwright (`tools/feel-lab/shoot.mjs`).

**Spec:** `docs/superpowers/specs/2026-08-19-party-game-mises-reelles-design.md` (section 6 — direction artistique cartoon haut de gamme)

## Global Constraints

- **Règle d'assets inchangée :** Meshy pour le décor et le personnage, géométrie procédurale pour tout ce qui porte un collider. Une hitbox qui ne correspond pas au visuel est disqualifiante dans un jeu où l'on mise.
- **Deux régimes de texture :** MOTIF (niveaux clairs neutres, la teinte vient du matériau) et SIGNAL (la texture porte les couleurs, le matériau reste blanc). Ne jamais les mélanger.
- **Aucune arête vive** sur une surface jouable : tout passe par `roundedBox`, `pill` ou `inflatableArch`.
- **Vérification obligatoire après chaque tâche :** `node shoot.mjs` puis lecture des images. Une tâche non regardée n'est pas terminée.
- **Le harnais tourne en `?lowfx`** (bloom et ombres coupés) : le rendu réel du joueur est toujours un cran plus éclatant que la capture.
- Palette de référence à respecter : sol froid **bleu** `#3aa8ee`, bordures chaudes **jaune** `#ffc93c`, accents **rose** `#ff3d8b`, herbe `#8ede6d`, montagnes `#ffb3c8`.

---

## File Structure

| Fichier | Responsabilité | Tâches |
|---|---|---|
| `tools/feel-lab/src/scenes/course.js` | Palette, sols, marquages, décor de fond | 1, 2, 3, 4, 6 |
| `tools/feel-lab/src/props.js` | Nouvelles primitives : dalle à tranche, montagne striée, nuage | 2, 4 |
| `tools/feel-lab/src/textures.js` | Marquages au sol, courbes de niveau | 3, 5 |
| `tools/feel-lab/src/world.js` | Ciel, brume, grading | 4, 8 |
| `tools/feel-lab/src/character.js` | Lisibilité du personnage | 7 |
| `tools/feel-lab/src/tuning.js` | Cadrage caméra | 7 |
| `tools/texture-pipeline/textures.json` | Prompts des nouvelles textures | 3, 5 |

---

### Task 1: Inverser la palette — sol froid, bordures chaudes

C'est le changement le plus important du plan. Sol rose + bordures violettes = deux teintes voisines, donc aucune lecture. Les références utilisent systématiquement un sol froid et des bordures chaudes opposées.

**Files:**
- Modify: `tools/feel-lab/src/scenes/course.js` (bloc `const C = {...}`)

**Interfaces:**
- Consumes: rien.
- Produces: la constante `C` avec les clés `ground`, `groundAlt`, `groundHigh`, `rail`, `railPost`, `hazard`, `roller`, `platform`, `finish`, `bumper`, `conveyor`, `hammer`, `edge`.

- [ ] **Step 1: Remplacer la palette**

```js
const C = {
  // Sols FROIDS : ils reculent et laissent les accents chauds ressortir.
  ground: 0x3aa8ee,        // bleu franc — la piste principale
  groundAlt: 0x6ec8f7,     // bleu clair — îlots et paliers
  groundHigh: 0x8f7bf0,    // violet — plateau haut, pour distinguer l'altitude
  edge: 0xffffff,          // tranche des dalles : blanc, contraste maximal

  // Bordures et obstacles CHAUDS : opposés au sol, donc lisibles instantanément.
  rail: 0xffc93c,          // jaune vif
  railPost: 0xff9a1f,      // orange, pour que les poteaux se détachent du rail
  hazard: 0xff8a3d,
  bumper: 0xff3d8b,
  hammer: 0xff5f3d,
  roller: 0xffd83d,
  platform: 0xff6fb0,
  conveyor: 0x9d64ff,
  finish: 0x2ecc71,
};
```

- [ ] **Step 2: Vérifier**

```bash
cd tools/feel-lab && npm run build && node shoot.mjs
```

Regarder `shots/3-course.png` et `shots/4-obstacles.png`. Attendu : la piste est bleue, les rails jaunes se détachent nettement, les bumpers roses ressortent sur le bleu. Si le bleu paraît délavé, ne pas toucher aux lumières — c'est la tâche 8 qui règle le grading.

- [ ] **Step 3: Commit**

```bash
git add tools/feel-lab/src/scenes/course.js
git commit -m "art: palette inversee, sol froid et bordures chaudes"
```

---

### Task 2: Dalles épaisses à tranche contrastée

Dans les références, un sol est un matelas de 40 à 50 cm dont la tranche est visible et d'une autre couleur. Nos dalles font 1,2 m mais leur tranche est de la même couleur que le dessus, donc l'épaisseur ne se lit pas.

**Files:**
- Modify: `tools/feel-lab/src/props.js` (ajout de `slabMesh`)
- Modify: `tools/feel-lab/src/scenes/course.js` (fonction `slab`)

**Interfaces:**
- Consumes: `roundedBox` de `props.js`, `C.edge` de la tâche 1.
- Produces: `slabMesh(w, h, d, topColor, edgeColor, { map, radius }) → THREE.Group`

- [ ] **Step 1: Ajouter la primitive**

Dans `tools/feel-lab/src/props.js`, à la fin du fichier :

```js
/**
 * Dalle de sol à tranche visible : un plateau coloré posé sur un socle d'une autre
 * couleur, légèrement plus large. C'est ce qui donne l'épaisseur de matelas du genre —
 * une dalle monochrome, même épaisse, se lit comme une surface plate.
 */
export function slabMesh(w, h, d, topColor, edgeColor, { map = null, radius = 0.5 } = {}) {
  const group = new THREE.Group();

  const base = roundedBox(w + 0.34, h, d + 0.34, edgeColor, { radius: radius * 0.9, outline: 0.006 });
  base.position.y = -0.06;
  group.add(base);

  const top = roundedBox(w, h * 0.72, d, topColor, { radius, map, outline: 0 });
  top.position.y = h * 0.2;
  group.add(top);

  return group;
}
```

- [ ] **Step 2: Employer la primitive dans `slab`**

Dans `tools/feel-lab/src/scenes/course.js`, remplacer le corps de `slab` (la ligne créant `mesh` et son `addBody`) par :

```js
    const mesh = slabMesh(width, 1.2, len, color, C.edge, { radius: 0.5, map });
    addBody(mesh, x, y - 0.6, zc, RAPIER.ColliderDesc.cuboid(width / 2, 0.6, len / 2).setFriction(0.62));
```

Ajouter `slabMesh` à la liste d'imports depuis `../props.js`.

- [ ] **Step 3: Vérifier**

```bash
cd tools/feel-lab && npm run build && node shoot.mjs
```

Regarder `shots/2-depart.png`. Attendu : un liseré blanc court le long de la piste au niveau du sol, et l'épaisseur de la dalle se lit sur les bords. Si le liseré n'apparaît pas, le socle est masqué par les rails : réduire l'élargissement de 0,34 à 0,22.

- [ ] **Step 4: Commit**

```bash
git add tools/feel-lab/src/props.js tools/feel-lab/src/scenes/course.js
git commit -m "art: dalles a tranche contrastee"
```

---

### Task 3: Marquages peints au sol

Les références peignent flèches, cercles concentriques et damiers directement sur la piste. Cela guide le joueur et supprime l'effet « nappe uniforme sur 152 mètres ».

**Files:**
- Modify: `tools/feel-lab/src/textures.js` (ajout de `floorMarkings`)
- Modify: `tools/feel-lab/src/scenes/course.js` (fonction `decal`, appels dans le tracé)

**Interfaces:**
- Consumes: `wrap`, `make` internes de `textures.js`.
- Produces:
  - `floorMarkings(kind, { color, repeat }) → THREE.CanvasTexture` avec `kind ∈ {'arrow', 'rings', 'chevrons', 'grid'}`
  - `decal(kind, x, y, z, size, rotation)` dans `course.js`

- [ ] **Step 1: Ajouter les marquages**

Dans `tools/feel-lab/src/textures.js` :

```js
/**
 * Marquages peints au sol, en blanc sur fond transparent : flèches de direction,
 * cercles concentriques, chevrons. Posés à plat au-dessus de la piste, ils donnent
 * de l'information au joueur et cassent l'uniformité d'un long couloir.
 */
export function floorMarkings(kind, { color = '#ffffff', alpha = 0.55 } = {}) {
  return make(`mark-${kind}-${color}`, 512, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (kind === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.16);
      ctx.lineTo(s * 0.80, s * 0.52);
      ctx.lineTo(s * 0.64, s * 0.52);
      ctx.lineTo(s * 0.64, s * 0.84);
      ctx.lineTo(s * 0.36, s * 0.84);
      ctx.lineTo(s * 0.36, s * 0.52);
      ctx.lineTo(s * 0.20, s * 0.52);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'rings') {
      for (const [r, w] of [[0.42, 0.07], [0.28, 0.055], [0.13, 0.11]]) {
        ctx.lineWidth = s * w;
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s * r, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (kind === 'chevrons') {
      ctx.lineWidth = s * 0.075;
      for (let i = 0; i < 3; i++) {
        const y = s * (0.24 + i * 0.26);
        ctx.beginPath();
        ctx.moveTo(s * 0.2, y + s * 0.12);
        ctx.lineTo(s * 0.5, y - s * 0.09);
        ctx.lineTo(s * 0.8, y + s * 0.12);
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = s * 0.035;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo((s / 4) * i, 0); ctx.lineTo((s / 4) * i, s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (s / 4) * i); ctx.lineTo(s, (s / 4) * i); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }, [1, 1]);
}
```

- [ ] **Step 2: Poser les marquages sur la piste**

Dans `tools/feel-lab/src/scenes/course.js`, ajouter après la fonction `slab` :

```js
  /**
   * Applique un marquage à plat, très légèrement au-dessus du sol.
   * `depthWrite: false` évite le combat de profondeur avec la dalle ;
   * `polygonOffset` garantit qu'il passe devant même en vue rasante.
   */
  function decal(kind, x, y, z, size, rotation = 0) {
    const tex = floorMarkings(kind);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rotation;
    mesh.position.set(x, y + 0.045, z);
    group.add(mesh);
    return mesh;
  }
```

Ajouter `floorMarkings` aux imports depuis `../textures.js`, puis poser les marquages après la construction du tracé :

```js
  // Marquages : ils jalonnent la piste et indiquent la direction.
  decal('grid', 0, 0, 12, 9);
  decal('arrow', 0, 0, -8, 4.5);
  decal('rings', 0, 0, -19, 6);
  decal('chevrons', 0, 4, -38, 5.5);
  decal('arrow', 0, 4, -50, 4.5);
  decal('rings', 0, 1, -66, 5);
  decal('chevrons', 0, 1, -78, 5);
  decal('arrow', 0, 1, -90, 4.5);
  decal('rings', 0, 1, -99, 5.5);
  decal('arrow', 0, 0, -136, 4.5);
  decal('grid', 0, 0, -145, 9);
```

- [ ] **Step 3: Vérifier**

```bash
cd tools/feel-lab && npm run build && node shoot.mjs
```

Regarder `shots/2-depart.png` et `shots/3-course.png`. Attendu : flèches et cercles blancs visibles sur la piste bleue, sans scintillement de profondeur. Si un marquage clignote selon l'angle, augmenter `polygonOffsetFactor` à -4.

- [ ] **Step 4: Commit**

```bash
git add tools/feel-lab/src/textures.js tools/feel-lab/src/scenes/course.js
git commit -m "art: marquages peints au sol"
```

---

### Task 4: Fermer l'horizon — montagnes striées et nuages volumétriques

Nos collines sont des demi-sphères vertes aplaties, et le ciel est vide. Les références ferment l'horizon avec de hautes montagnes roses striées de bandes horizontales, devant lesquelles flottent de gros nuages cotonneux.

**Files:**
- Modify: `tools/feel-lab/src/props.js` (ajout de `stripedPeak`)
- Modify: `tools/feel-lab/src/scenes/course.js` (remplacement des collines)
- Modify: `tools/feel-lab/src/world.js` (ajout de `puffyCloud`, nuages plus gros)

**Interfaces:**
- Consumes: `toonMaterial`, `addOutline` de `world.js`.
- Produces:
  - `stripedPeak(radius, height, baseColor, bandColor, bands) → THREE.Group` — dans `props.js`
  - `puffyCloud(scale, seed) → THREE.Group` — dans `world.js` (module privé, non exporté)

- [ ] **Step 1: Ajouter les primitives**

Dans `tools/feel-lab/src/props.js` :

```js
/**
 * Sommet strié : un cône aux bandes horizontales, comme les montagnes des références.
 * Les stries se lisent de très loin et donnent une échelle au décor — une colline
 * unie de même taille paraît deux fois plus petite.
 */
export function stripedPeak(radius, height, baseColor, bandColor, bands = 5) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 18, 1), toonMaterial(baseColor));
  body.position.y = height / 2;
  group.add(body);

  // Anneaux plaqués : plus lisibles qu'une texture, et gratuits en mémoire.
  for (let i = 1; i <= bands; i++) {
    const t = i / (bands + 1);
    const r = radius * (1 - t) * 1.012;
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.97, r, height * 0.055, 18, 1, true),
      toonMaterial(i % 2 ? bandColor : baseColor)
    );
    ring.position.y = height * t;
    group.add(ring);
  }

  const cap = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.22, 12, 8), toonMaterial(0xffffff));
  cap.position.y = height * 0.97;
  cap.scale.y = 0.6;
  group.add(cap);
  return group;
}
```

*(`puffyCloud` ne va PAS ici — voir Step 3 : elle vit dans `world.js`, parce que
`props.js` importe déjà `world.js` et que l'import inverse créerait un cycle.)*

```js
/** Nuage cotonneux : amas de sphères, volumineux et opaque, pas un voile. */
function puffyCloud(scale = 1, seed = 0) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const geo = new THREE.SphereGeometry(1, 12, 10);
  let a = seed * 9301 + 49297;
  const rnd = () => { a = (a * 9301 + 49297) % 233280; return a / 233280; };
  const puffs = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < puffs; i++) {
    const r = (1.6 + rnd() * 1.5) * scale;
    const puff = new THREE.Mesh(geo, mat);
    puff.position.set((i - puffs / 2) * 1.9 * scale + rnd() * scale, rnd() * 0.9 * scale, rnd() * 1.6 * scale);
    puff.scale.set(r, r * 0.74, r);
    group.add(puff);
  }
  return group;
}
```

- [ ] **Step 2: Remplacer les collines**

Dans `tools/feel-lab/src/scenes/course.js`, remplacer la boucle qui crée les collines (`const hillGeo = ...` et sa boucle) par :

```js
    // Montagnes : hautes, striées, roses. Elles ferment l'horizon et donnent l'échelle.
    for (const [hx, hz, r, h] of [
      [-86, -186, 40, 54], [70, -206, 48, 66], [12, -244, 58, 78],
      [-124, -120, 34, 44], [112, -78, 36, 48], [-136, -12, 30, 40],
      [100, -164, 32, 42], [-104, -228, 38, 50],
    ]) {
      const peak = stripedPeak(r, h, 0xffb3c8, 0xfff0f5, 5);
      peak.position.set(hx, -3.2, hz);
      group.add(peak);
    }

    // Collines vertes basses au premier plan : elles font la transition avec l'herbe.
    const mound = new THREE.SphereGeometry(1, 14, 10);
    for (const [hx, hz, r] of [[-52, -60, 22], [56, -110, 26], [-60, -160, 20], [48, -20, 18]]) {
      const m = new THREE.Mesh(mound, toonMaterial(0x7fd45e));
      m.position.set(hx, -3.2, hz);
      m.scale.set(r, r * 0.3, r);
      group.add(m);
    }
```

Ajouter `stripedPeak` aux imports depuis `../props.js`.

- [ ] **Step 3: Grossir les nuages**

Dans `tools/feel-lab/src/world.js`, remplacer le corps de `buildClouds` par :

```js
function buildClouds() {
  const group = new THREE.Group();
  for (let i = 0; i < 22; i++) {
    const seed = i * 37 + 11;
    const cloud = puffyCloud(1.6 + ((seed % 7) / 7) * 1.4, seed);
    cloud.position.set(
      -140 + ((seed * 13) % 300),
      42 + ((seed * 7) % 30),
      -180 + ((seed * 23) % 320)
    );
    group.add(cloud);
  }
  return group;
}
```

Coller la fonction `puffyCloud` (donnée au Step 1) **dans `world.js`**, juste au-dessus de `buildClouds`, sans l'exporter. Ne pas l'importer depuis `props.js` : ce module importe déjà `world.js`, et l'import inverse créerait un cycle qui casse l'initialisation.

- [ ] **Step 4: Vérifier**

```bash
cd tools/feel-lab && npm run build && node shoot.mjs
```

Regarder `shots/3-course.png`. Attendu : montagnes roses striées visibles au-dessus des gradins, gros nuages blancs dans le ciel. Vérifier la console : aucune erreur d'import circulaire (`Cannot access before initialization`).

- [ ] **Step 5: Commit**

```bash
git add tools/feel-lab/src/props.js tools/feel-lab/src/world.js tools/feel-lab/src/scenes/course.js
git commit -m "art: horizon ferme par des montagnes striees et des nuages volumineux"
```

---

### Task 5: Herbe à courbes de niveau

L'herbe des références porte de longues courbes claires façon carte topographique. La nôtre est un aplat, ce qui aplatit tout le décor.

**Files:**
- Modify: `tools/texture-pipeline/textures.json` (prompt du slot `grass`)
- Modify: `tools/feel-lab/src/textures.js` (repli procédural de `grassTufts`)

**Interfaces:**
- Consumes: pipeline OpenRouter existant.
- Produces: `public/textures/grass.png` remplacé.

- [ ] **Step 1: Réécrire le prompt**

Dans `tools/texture-pipeline/textures.json`, remplacer le `prompt` du slot `grass` par :

```
Subject: a smooth grassy field seen from directly above, decorated with long flowing contour lines like a topographic map, the lines soft and slightly wavy, widely spaced, drawn in a lighter tone. Near-white background with light grey contour lines so it can be tinted green afterwards. No blades, no flowers, no rocks, no path.
```

- [ ] **Step 2: Régénérer**

```bash
cd "/Users/lucasroncey/Desktop/Projets/Projet Saas/Avance/Fallguys"
set -a && source .env && set +a
cd tools/texture-pipeline && node generate.mjs grass
node ../meshy-pipeline/seamless.mjs raw/grass.png grass 1024 0.55
```

Attendu : `ecart moyen aux bords` inférieur à 8/255.

- [ ] **Step 3: Aligner le repli procédural**

Dans `tools/feel-lab/src/textures.js`, remplacer le corps de dessin de `grassTufts` par des courbes plutôt que des brins :

```js
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = tuft;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, s / 190);
    // Sinusoïdes de période entière : elles se raccordent d'un bord à l'autre.
    for (let i = 0; i < 7; i++) {
      const yBase = (s / 7) * i;
      const amp = s * 0.035 * (1 + (i % 3) * 0.4);
      for (const dy of [-s, 0, s]) {
        ctx.beginPath();
        for (let x = 0; x <= s; x += 4) {
          const y = yBase + dy + Math.sin((x / s) * Math.PI * 2 * 2 + i) * amp;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    grain(ctx, s, 41, 0.025, 100);
```

- [ ] **Step 4: Vérifier**

```bash
cd tools/feel-lab && npm run build && node shoot.mjs
```

Regarder `shots/3-course.png`, puis relancer avec `node shoot.mjs "http://127.0.0.1:5273/?noassets"` pour contrôler le repli procédural. Attendu dans les deux cas : de longues courbes claires sur l'herbe, sans couture visible.

- [ ] **Step 5: Commit**

```bash
git add tools/texture-pipeline/textures.json tools/feel-lab/src/textures.js
git commit -m "art: herbe a courbes de niveau"
```

---

### Task 6: Hiérarchie d'échelle

Chez nous tout fait la même taille moyenne, donc l'œil n'a pas de point d'accroche. Les références posent deux ou trois objets énormes au milieu d'une nuée de petits.

**Files:**
- Modify: `tools/feel-lab/src/scenes/course.js` (fonction `dressScenery`)

**Interfaces:**
- Consumes: `prop()` et `inflatableArch` existants.
- Produces: rien de nouveau.

- [ ] **Step 1: Poser trois masses dominantes**

Dans `dressScenery`, après les arches existantes :

```js
    // Trois masses dominantes : sans elles, tout le décor fait la même taille et
    // l'œil n'a nulle part où se poser. Elles servent aussi de repères de distance.
    const bigArch = inflatableArch(46, 26, 1.9, 0xff3d8b);
    bigArch.position.set(0, -3.2, -66);
    group.add(bigArch);

    prop('bounce-castle', 34, 46, -104, { rot: -0.9 });
    prop('windmill', 30, -50, -34, { rot: 0.6 });
```

- [ ] **Step 2: Réduire les petits éléments pour creuser l'écart**

Dans la même fonction, remplacer les tailles des arches jalons :

```js
    for (const [az, ay, color] of [[-24, 0, 0x4fd1c5], [-54, 4, 0xffd83d], [-96, 1, 0xff5f7e], [-127, 1, 0x8b7bff]]) {
      const a = inflatableArch(13, 6, 0.45, color);
      a.position.set(0, ay, az);
      group.add(a);
    }
```

- [ ] **Step 3: Vérifier**

```bash
cd tools/feel-lab && npm run build && node shoot.mjs
```

Regarder `shots/3-course.png`. Attendu : une grande arche rose domine le fond de la piste, un château gonflable et un moulin surdimensionnés encadrent le parcours. Vérifier que la grande arche ne coupe pas la piste : elle doit enjamber la course sans que ses pieds tombent dessus.

- [ ] **Step 4: Commit**

```bash
git add tools/feel-lab/src/scenes/course.js
git commit -m "art: hierarchie d'echelle, trois masses dominantes"
```

---

### Task 7: Rendre le personnage lisible

Sur fond rose, notre personnage bleu-gris disparaissait. Sur fond bleu (tâche 1) il disparaîtra encore plus. Il faut à la fois une couleur par défaut chaude, un cadrage plus serré et une ombre nette.

**Files:**
- Modify: `tools/feel-lab/src/cosmetics.js` (ordre des skins)
- Modify: `tools/feel-lab/src/tuning.js` (cadrage)
- Modify: `tools/feel-lab/src/character.js` (ombre de contact)

**Interfaces:**
- Consumes: `SKINS` de `cosmetics.js`.
- Produces: rien de nouveau.

- [ ] **Step 1: Skin par défaut chaud**

Dans `tools/feel-lab/src/cosmetics.js`, placer un skin chaud en tête de `SKINS` (c'est lui que prend un nouveau joueur) :

```js
export const SKINS = [
  { name: 'Mandarine', hex: 0xff7a2f },
  { name: 'Fraise', hex: 0xff5f7e },
  { name: 'Citron', hex: 0xffd83d },
  { name: 'Menthe', hex: 0x4fd1c5 },
  { name: 'Myrtille', hex: 0x8b7bff },
  { name: 'Pêche', hex: 0xffa36b },
  { name: 'Pistache', hex: 0x9ede6a },
  { name: 'Bubblegum', hex: 0xff8bd0 },
];
```

- [ ] **Step 2: Cadrage plus serré**

Dans `tools/feel-lab/src/tuning.js` :

```js
  camDistance: 6.2,
  camHeight: 2.7,
  camFov: 54,
```

- [ ] **Step 3: Ombre de contact**

Dans `tools/feel-lab/src/character.js`, dans le constructeur juste après `this.container.add(this.root);` :

```js
    // Tache d'ombre sous les pieds : une ombre portée douce ne suffit pas à ancrer
    // un personnage au sol, et sans ancrage il a l'air de flotter.
    this.contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(RADIUS * 1.25, 20),
      new THREE.MeshBasicMaterial({ color: 0x1a2b45, transparent: true, opacity: 0.28, depthWrite: false })
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.container.add(this.contactShadow);
```

Puis dans `updateVisual`, juste avant `this.dust.update(dt);` :

```js
    // L'ombre reste au sol et s'estompe avec la hauteur de saut.
    const groundY = this.grounded ? t.y - FOOT : this.lastGroundY ?? (t.y - FOOT);
    if (this.grounded) this.lastGroundY = t.y - FOOT;
    this.contactShadow.position.set(t.x, groundY + 0.03, t.z);
    const height = Math.max(0, t.y - FOOT - groundY);
    this.contactShadow.material.opacity = Math.max(0, 0.3 - height * 0.05);
    this.contactShadow.scale.setScalar(1 + height * 0.06);
```

- [ ] **Step 4: Vérifier**

```bash
cd tools/feel-lab && npm run build && node shoot.mjs
```

Regarder `shots/2-depart.png`. Attendu : le personnage est orange, occupe visiblement plus de place, et une tache d'ombre le colle au sol. Vider le `localStorage` si le skin reste violet : le harnais démarre avec un profil vierge, donc la capture montrera bien Mandarine.

- [ ] **Step 5: Commit**

```bash
git add tools/feel-lab/src/cosmetics.js tools/feel-lab/src/tuning.js tools/feel-lab/src/character.js
git commit -m "art: personnage plus lisible, cadrage serre et ombre de contact"
```

---

### Task 8: Passe finale de grading et comparaison

Les sept tâches précédentes changent la répartition des valeurs dans l'image. Le grading doit être rejugé une fois l'ensemble en place — pas avant.

**Files:**
- Modify: `tools/feel-lab/src/world.js` (constante `GRADE`, ciel)

**Interfaces:**
- Consumes: `GRADE` existant.
- Produces: rien de nouveau.

- [ ] **Step 1: Ciel plus franc**

Dans `tools/feel-lab/src/world.js`, dans `buildSky` :

```js
      topColor: { value: new THREE.Color(0x2f95e8) },
      midColor: { value: new THREE.Color(0x7fd4ff) },
      botColor: { value: new THREE.Color(0xdff3ff) },
```

Et la brume : `scene.fog = new THREE.Fog(0xdff3ff, 210, 500);`

- [ ] **Step 2: Régler le grading**

```js
export const GRADE = { saturation: 1.30, brightness: 1.05, lift: 0.05, contrast: 1.06, warmth: 0.015 };
```

- [ ] **Step 3: Vérifier en comparant**

```bash
cd tools/feel-lab && npm run build && node shoot.mjs
```

Ouvrir côte à côte `shots/3-course.png` et les captures de référence, et contrôler les huit points du diagnostic :
1. la piste bleue et les rails jaunes se distinguent au premier coup d'œil ;
2. le sol froid ne sature plus l'œil ;
3. des marquages blancs jalonnent la piste ;
4. l'épaisseur des dalles se lit sur les bords ;
5. des montagnes striées ferment l'horizon ;
6. l'herbe porte des courbes ;
7. deux ou trois objets dominent nettement en taille ;
8. le personnage se détache et paraît posé au sol.

Tout point non satisfait renvoie à sa tâche, il ne se rattrape pas au grading.

- [ ] **Step 4: Commit**

```bash
git add tools/feel-lab/src/world.js
git commit -m "art: passe finale de grading et ciel"
```

---

## Ce que ce plan ne fait pas

- Il ne touche ni à la physique, ni au parcours, ni aux règles : uniquement à l'apparence.
- Il ne régénère pas les modèles Meshy existants (seule la texture d'herbe est refaite).
- Il n'ajoute pas d'adversaires — c'est le manque n°1 identifié plus tôt, mais c'est un autre chantier.
- Il ne traite pas les nuages du lobby, dont le fond à anneaux est déjà conforme.
