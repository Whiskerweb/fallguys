# Feel Lab — prototype jouable

**Jetable.** Sert à régler le game feel et à valider la boucle lobby → course → résultat
avant de transposer dans Unity. Rien ici n'est destiné à la production.

## Lancer

```bash
npm install
npm run dev          # http://127.0.0.1:5273/
```

`?noassets` désactive les modèles Meshy et fait tourner la scène en formes procédurales —
utile pour isoler un problème d'asset.

## Une partie, pas une épreuve

Le bouton JOUER lance une **partie** : trois manches tirées au sort, jouées d'affilée
jusqu'à la finale, qui donne la couronne. Le joueur ne choisit pas son terrain — un joueur
fort à la course mais faible aux portes ne peut pas éviter les portes. C'est ce qui fait
qu'une couronne veut dire quelque chose.

Une seule arène vit à la fois : elle est construite au départ de la manche et **libérée**
au passage à la suivante, pour ne pas faire tourner plusieurs mondes physiques en
parallèle.

| Épreuve | Principe |
|---|---|
| **La Course** | Parcours d'obstacles serpentant, avec embranchement et ballons déterministes. |
| **Les Portes** | Sept murs percés de portes en papier : certaines cèdent, les autres sont condamnées. |
| **Block Dash** | Une passerelle néon au-dessus du vide : barrières à sauter, piliers à contourner, fossés à franchir avec de l'élan, balayeuses à esquiver. |

### La graine de manche

Chaque manche tire une **graine au sort** : deux parties ne se ressemblent pas, et un
parcours appris par cœur ne vaut plus rien. Le point important est qu'il n'y a qu'une
graine **par manche**, et non une par joueur : en multijoueur, le serveur la tire et
l'impose aux seize joueurs, qui affrontent alors la même disposition, aux mêmes
emplacements, au même instant. Le hasard décide du terrain, jamais du vainqueur.

### La Course — un tracé, pas des dalles posées

Le sol du parcours était construit tronçon par tronçon : un rectangle par section, posé à
une position et une largeur choisies à la main. Vu de dessus, ça ne se lisait pas comme
une piste. Les rectangles se chevauchaient dans les virages, leurs coins arrondis
laissaient des encoches à chaque raccord, deux largeurs voisines ne coïncidaient jamais,
et les rambardes se croisaient en corde au lieu de suivre la courbe. Personne ne dessine
une route ainsi.

`src/track.js` prend le problème par l'autre bout. On décrit une **ligne moyenne** — une
suite de points portant chacun sa largeur et son altitude — et le module en tire tout le
reste :

* des virages **circulaires**, tangents aux deux droites qu'ils relient. Aucun angle vif,
  aucune encoche ;
* un **ruban continu**, obtenu en balayant un profil transversal (surface, épaulement,
  socle) le long de cette ligne. La largeur et la pente varient sans rupture : les
  jonctions n'existent plus, il n'y a plus qu'une surface ;
* un collider **trimesh bâti sur les mêmes sommets**. Le collider n'approche plus le
  visuel, c'est le même maillage. Dans un jeu où l'on mise, c'est la seule garantie
  acceptable ;
* des **rambardes d'un seul tenant**, courbées avec la piste.

Deux conséquences valent d'être notées. Le raccord entre deux pentes est **lissé** : la
tangente est nulle à chaque nœud, donc le pied et le sommet d'une rampe n'ont plus d'arête
— une pente raccordée brutalement se sent à la manette, le personnage y décolle ou s'y
accroche. Et un virage dont le rayon descendrait sous la demi-largeur replierait le bord
intérieur sur lui-même : le module le **signale en console** plutôt que de produire une
géométrie retournée qu'on ne verrait qu'à l'ombrage.

Les obstacles ne sont plus placés en coordonnées du monde mais **sur le tracé** — une cote
Z, un déport latéral. Ils suivent donc la piste quand elle tourne, au lieu de rester
alignés sur les axes : un rouleau balaie vraiment toute la largeur, un pendule bat en
travers du couloir et non de biais. Le réglage historique de chaque obstacle est conservé,
puisque c'est toujours sa cote Z qui le situe.

Les harnais de diagnostic lisent la même source : `course.trajectoires` renvoie la ligne
moyenne échantillonnée de chaque ruban, avec largeur et normale. `diag/continuite.mjs`
sonde ainsi l'axe **et les deux bords** — un collider plus étroit que le ruban visible
ferait tomber le joueur à travers un sol qu'il a sous les pieds, et le seul axe ne le
dirait jamais.

Une fente reste plus dangereuse qu'un vide. À la fusion des deux voies, elles convergeaient
jusqu'à se frôler et le ruban commun ne prenait le relais qu'après : il restait, sur les
six derniers mètres, une fente d'un à trois mètres entre elles. Un vide se voit et se
contourne ; une fente se lit comme du sol et se traverse par le fond. Les voies gardent
maintenant un écart franc de trois mètres jusqu'au bout, et le ruban commun les recouvre
toutes les deux d'un coup. `continuite.mjs` ne voyait rien : il sonde chaque voie, et la
fente n'était sur aucune — c'est une grille de rayons tirée sur toute la zone qui l'a
montrée.

### La Course — la grande côte, la patinoire et le toboggan

Le dernier tiers du parcours ne demandait plus rien : une petite bosse, deux plateformes,
une descente, un sprint. Il porte maintenant les trois morceaux les plus retors.

**La grande côte aux ballons** fait vingt-deux mètres pour huit de dénivelé, et les
ballons y sont plus gros (1,7 m de rayon) et plus nombreux (sept). Une côte courte se
franchit d'un élan ; c'est la longueur qui oblige à lire la descente et à choisir sa
ligne. Trois plots au milieu de la pente s'y ajoutent : se faire renvoyer de côté pendant
qu'on lit les ballons, c'est là que la côte se gagne ou se perd.

Voie et instant de lâcher sont **tirés au sort** — le couloir appris par cœur ne vaut plus
rien. Le tirage vient toutefois du PRNG semé par la **graine de manche**, jamais de
`Math.random` : la séquence est identique pour les seize joueurs d'une même manche et
reproductible d'un bout à l'autre. Le calendrier des lâchers ne dépend que du temps et de
la graine — un ballon sorti de la côte est remis au sommet *sans* toucher à son horaire ni
tirer de nouvelle voie, donc deux simulations qui divergent d'un cheveu voient quand même
la même séquence. Le hasard choisit le terrain, jamais le vainqueur.

**La patinoire et le toboggan** ferment le parcours. Sur la glace on ne freine plus et on
part de côté ; la glissade qui suit descend neuf mètres. Les deux surfaces **annoncent**
leur nature — glace bleue rayée de traces de patins, puis filets de vitesse dans le sens
de la pente. Un sol glissant qui ressemble à un sol normal n'est pas une difficulté, c'est
une trahison : le joueur perd sans avoir eu la moindre chance de lire le piège.

La scène décrit ce qu'il y a sous les pieds (`course.glisseAt`), le personnage n'en connaît
qu'un chiffre entre 0 et 1. Les zones sont testées **sur le tracé**, pas dans une boîte
alignée sur les axes : la glissade descend en biais, et une boîte droite aurait laissé
glisser au-dessus du vide tout en gardant de l'adhérence au bord intérieur du virage.

Ce chiffre agit à deux endroits, et il a fallu les deux :

* dans le **contrôleur** — l'accélération au sol et le freinage sont divisés, jamais la
  vitesse maximale. Sur la glace on met du temps à se lancer et bien plus à s'arrêter,
  mais on finit par aller aussi vite qu'ailleurs. Baisser la vitesse maximale aurait donné
  une zone lente, pas une zone glissante ;
* dans le **contact** — le frottement du collider du personnage passe en règle *Min* et
  tombe à zéro. Sans cette seconde moitié, la glace ne rendait pas glissant : elle rendait
  **immobile**. Avec 31 m/s² de gravité, le frottement pèse à lui seul 13 m/s² de
  freinage, soit davantage que l'accélération déjà divisée d'une patinoire — touche
  enfoncée, le personnage ne démarrait pas du tout.

`diag/finparcours.mjs` mesure les trois surfaces en pilotant vraiment le personnage :
lâcher les touches fait dériver de 0,4 m sur sol normal, 1,3 m sur la glace, et sur le
toboggan la vitesse **monte** de 7,9 à 9,4 m/s — au-delà de la vitesse de course.

### Pourquoi les portes ne se distinguent pas

Rien ne permet de voir depuis l'avant si une porte cède. Les portes d'un même mur sont
désormais **rigoureusement identiques** : même teinte, même emblème, même motif à chevrons,
même respiration. C'est la garantie la plus forte qu'on puisse donner sur ce mini-jeu —
quand deux portes ne diffèrent en rien, aucune observation ne peut trahir la donne, et il
n'y a plus à démontrer que la variation n'est pas corrélée à l'état.

La variété passe d'un mur à l'autre : chaque mur a sa couleur et son emblème, tirés sur sa
position dans le parcours. « Le mur turquoise » désigne donc un endroit du parcours, jamais
une porte.

`diag/verdict.mjs` le vérifie en rejouant deux donnes différentes et en comparant
l'apparence de chaque emplacement : si des portes changent d'état sans qu'aucune ne change
d'apparence, aucune information ne peut fuir par le rendu.

Une version antérieure marquait les portes condamnées d'une croix de renfort et de rivets.
La distinction se lisait à trente mètres, et le mur cessait d'être un mur.

**Plus de demi-portes sur les côtés.** Sur un mur dont la grille glisse d'une demi-case,
les deux cases de bord étaient amputées par le muret : elles donnaient une porte étroite
d'un mètre et demi, collée au bord, qu'on ne pouvait ni lire de face ni franchir
proprement — et qui, condamnée par construction, était la seule pièce du mur dont l'état
était **devinable**. On y pose maintenant un jambage plein, de la même matière que les
montants. Le mur ferme toujours toute la largeur, et tout ce qui ressemble à une porte en
est une.

**Le panneau.** Chevrons blancs sur couleur vive, couronne festonnée en haut, plinthe en
bas, emblème du mur au centre — tout peint dans une seule texture, donc un seul appel de
dessin par porte, et une seule texture par mur. Les montants sont bleu ciel : sur un mur
de portes vives, un montant violet se lisait comme une porte de plus.

**Quand une porte cède**, elle éclate en neuf morceaux qui emportent chacun la portion du
motif qu'ils occupaient — avant, chaque morceau montrait la porte entière en réduction —,
partent vers l'avant dans le sens de la course, freinent comme du papier et ne s'effacent
qu'aux deux tiers de leur vol. Une gerbe d'éclats teintés comme la porte accompagne la
rupture, et les panneaux voisins du même mur frémissent une demi-seconde : le mur est une
structure, pas une collection de plans.

Ce qu'il reste à jouer n'est donc pas une lecture individuelle, mais l'exploitation de ce
que le peloton révèle : celui qui passe devant ouvre une porte pour tous ceux qui suivent,
et savoir quand suivre plutôt que mener est une compétence à part entière.

La disposition dérive de la graine de manche (voir plus haut) : tirée au sort à chaque
partie, mais unique pour tous les joueurs d'une même manche.

### Block Dash

Une passerelle néon suspendue au-dessus du vide, sans garde-corps. **Quatre mécaniques**,
qui appellent chacune une réponse différente :

| Obstacle | Cote | Réponse | Ce qu'il impose |
|---|---|---|---|
| **Barrière** (jaune) | 1,05 m | se saute | le *rythme* |
| **Pilier** (magenta) | 2,90 m | se contourne | la *trajectoire* |
| **Fossé** | 3,1 et 4,4 m | de l'élan | la *vitesse* |
| **Balayeuse** (violet) | 0,75 m, mobile | l'esquive ou le saut | l'*instant* |

Chaque section introduit une mécanique isolément avant que la finale ne les combine : un
joueur doit pouvoir comprendre un obstacle avant de le rencontrer mêlé aux autres, sinon
un échec ne lui apprend rien. La difficulté vient de la combinaison — un fossé seul est
facile, un fossé avec une balayeuse qui arrive ne l'est plus.

Les **fossés** ont un rôle à part : ce sont les seuls obstacles qui punissent la
**lenteur**. Les trois autres se négocient à l'arrêt ; sans eux, on traverserait la map
au pas en attendant chaque ouverture.

Les **piliers mobiles** coulissent latéralement plutôt que de jaillir du sol. Le joueur
voit le passage se refermer et décide de forcer ou d'attendre ; un obstacle qui surgit
sous les pieds ne laisse aucun choix et se lit comme un piège.

#### Les cotes viennent du personnage

La première version fut dimensionnée à l'œil, et ses cotes ne correspondaient à rien :
des blocs de 1,75 m pour un corps de 1,60 m — à peine plus hauts que lui — et des
passages de 2,68 m pour une largeur de 0,90 m. Elle n'offrait d'ailleurs qu'une seule
décision, répétée : se placer latéralement devant un mur.

Tout dérive désormais de trois mesures relevées sur le personnage : **0,90 m de large,
1,60 m de haut**, saut de **2,15 m** culminant en 0,74 s de vol, soit **5,66 m de portée**
à pleine vitesse.

| Cote | Valeur | Règle |
|---|---|---|
| Barrière | 1,05 m | franchement sous le saut |
| Pilier | 2,90 m | franchement au-dessus |
| Passage large | 2,16 m | 2,4 × la largeur du corps |
| Passage serré | 1,44 m | 1,6 × — il faut viser |
| Fossé facile | 3,1 m | 55 % de la portée |
| Fossé dur | 4,4 m | 78 % de la portée, 1,2 m de marge |

`diag/blockdash.mjs` vérifie ces règles **avant même de jouer**, puis franchit chaque
obstacle isolément. Les anciennes cotes n'en passaient aucune.

### Fin de manche

Un bandeau incliné traverse l'écran : **QUALIFIÉ** en vert, **ÉLIMINÉ** en rouge (la
seconde variante est stylée et testée, mais pas encore déclenchée par le jeu — il faudra
une limite de temps ou des adversaires). Bande arrière et bande avant entrent par des
côtés opposés et se croisent, puis le texte arrive. Les entrées sont décalées : tout
arriver ensemble donnerait un panneau, se succéder donne un événement.

## Personnages animés

Deux façons d'animer coexistent, choisies automatiquement au chargement :

* **Rig procédural** (`src/rig.js`) — la position des os est calculée à chaque image à
  partir de la vitesse. Il suffit d'un squelette reconnaissable, sans aucune animation.
* **Lecteur de clips** (`src/cliprig.js`) — le modèle est joué avec ses propres
  animations. Réservé aux personnages qui en apportent de la **locomotion** : tous les
  modèles Meshy embarquent un clip de pose (`Armature|clip0|baselayer`) qui ne suffit pas,
  et basculer dessus privait chaque personnage du catalogue de son animation.

Les deux exposent la même interface, donc le reste du jeu ignore lequel tourne.

### Importer un personnage animé

Meshy livre **une animation par fichier**, chacun embarquant une copie complète du
maillage : trois clips coûtaient 50 Mo pour un personnage qui en pèse 16. Deux outils
règlent ça :

```bash
cd ../meshy-pipeline
# 1. Fusionner les clips dans un seul fichier (ne recopie que les données d'animation).
#    Un nom vide ou « - » garde le maillage du fichier sans son animation — utile pour
#    écarter la pose de liaison en A que Meshy livre avec le personnage.
node fusion-anims.mjs sortie.glb base.glb:- idle.glb:idle running.glb:running walking.glb:walking
# 2. Alléger le maillage (les personnages arrivent à ~200 000 triangles)
blender -b -P decimate.py -- sortie.glb decime.glb 30000
# 3. Recompresser la texture — c'est presque toujours ELLE qui pèse : Meshy livre du
#    PNG 4096 (17 Mo pour un seul personnage), invisible à la distance de jeu.
node retexture.mjs decime.glb final.glb 1024 88
```

Les trois étapes prises ensemble font passer un personnage de 50 Mo à moins de 2 Mo,
sans différence visible.

La fusion refuse de s'exécuter si les fichiers n'ont pas la même liste de nœuds : les
canaux d'animation ciblent les os **par index**, et un ordre différent mélangerait les
membres.

Le contour des personnages duplique la géométrie ; il est automatiquement ignoré au-delà
de 60 000 triangles, avec un avertissement en console. Son épaisseur est divisée par
l'échelle du modèle, sinon un personnage agrandi voit son liseré grossir d'autant.

Si le personnage n'apporte **pas de clip de repos**, la marche est figée sur son premier
appui : sans cela, un personnage immobile retombe sur sa pose de liaison, c'est-à-dire la
T-pose qu'on cherche justement à ne jamais montrer.

### Ce que les clips ne couvrent pas

Le personnage importé n'a que trois états — pose, marche, course — quand le jeu en connaît
six. Plutôt que d'inventer les manquants, le clip de course est **figé** sur un instant
choisi : jambes écartées pour la montée, corps ramassé pour la chute. Laisser le cycle
tourner donnerait un personnage qui pédale dans le vide, le défaut le plus visible qui
soit, puisque les jambes bougent alors que rien ne les porte.

## Contrôles

| Touche | Action |
|---|---|
| Entrée ou bouton JOUER | Lancer une course depuis le lobby |
| ZQSD / WASD / flèches | Courir |
| Espace | Sauter |
| Maj ou clic gauche | Plonger |
| A / E | Pivoter la caméra |
| R | Recommencer la course |
| Échap | Retour au lobby |
| H | Afficher les réglages |

## Assets 3D

Les `.glb` ne sont **pas versionnés** (~57 Mo). Ils se régénèrent sans reconsommer de
crédits : `tools/meshy-pipeline/state.json` conserve les identifiants de tâches Meshy et
le script re-télécharge les modèles déjà produits.

```bash
cd ../meshy-pipeline
set -a && source ../../.env && set +a
node generate.mjs                 # tous
node generate.mjs player-blob     # un seul
```

## Vérification

```bash
node sanity.mjs                   # physique en headless, sans rendu
node shoot.mjs                    # captures d'écran via Chromium headless
npm run build                     # syntaxe + imports
```

## Ce qui se transpose dans Unity

`src/tuning.js` uniquement — ces 25 constantes sont le livrable réel du prototype.
Le bouton « Copier les réglages » les exporte en JSON.
