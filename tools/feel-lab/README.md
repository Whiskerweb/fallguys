# Baby Guys — Feel Lab, prototype jouable

**Jetable.** Sert à régler le game feel et à valider la boucle lobby → course → résultat
avant de transposer dans Unity. Rien ici n'est destiné à la production.

## Lancer

```bash
npm install
npm run dev          # http://127.0.0.1:5273/
```

`?noassets` désactive les modèles Meshy et fait tourner la scène en formes procédurales —
utile pour isoler un problème d'asset.

## Le lobby ne montre que ce qui existe

Le lobby portait quatre onglets dont deux — **Boutique** et **Collaborations** — affichaient
huit lignes écrites en dur sur lesquelles aucun clic n'était branché, plus une garde-robe
construite puis immédiatement masquée et un bouton « Inviter des joueurs » sans handler.
Dans un jeu où l'on engage de l'argent, un bouton qui promet une fonctionnalité inexistante
coûte plus cher qu'un bouton absent : il apprend au joueur que l'interface ment. Tout cela
est parti. Il reste **trois choses**, parce qu'il n'y en a que trois qui marchent.

**La barre noire** porte l'identité (portrait, niveau, barre d'XP), le **solde en USDC** et
les paramètres. Une seule monnaie : c'est celle qu'on mise et celle qu'on gagne. Le compteur
de couronnes a disparu — il comptait quelque chose qui ne s'échangeait contre rien.

**Le bouton PERSONNAGE** ouvre la vitrine. Les vignettes sont des rendus du modèle lui-même
(`diag/portrait.mjs`), détourés, sur un cadre à la couleur de rareté.

**Le ticket** est la partie neuve. Il tient trois questions dans une carte : *à quelle table
je joue* (1, 2 ou 5 USDC), *combien il y a dans le pot*, et *où je dois finir pour gagner
quoi*.

### Le ticket dit la vérité, pas une approximation

Aucun montant n'est écrit dans le HTML. `src/economie.js` est un **port ligne à ligne** de
`src/Fallguys.Rules/PayoutPolicy.cs`, en micro-unités entières comme `Money.cs` — jamais de
flottant, parce qu'un centième d'USDC perdu par arrondi à chaque partie est un bug comptable
qu'on ne retrouve plus six mois plus tard. Le lobby annonce donc exactement ce que le
serveur de règlement paiera.

Pour une table à 1 USDC, seize joueurs, commission 15 % :

| Rang | Gain | |
|---|---|---|
| 1er | 4,50 | ×4,5 |
| 2e | 2,50 | ×2,5 |
| 3e | 1,50 | ×1,5 |
| 4e | 1,10 | ×1,1 |
| **5e–8e** | **1,00** | **mise rendue** |
| 9e–16e | — | rien |

La bande verte est le **seuil de non-perte** : finir dans les huit rend la mise. C'est
l'amortisseur du « mur des 95 % de perdants » décrit dans le spec, et c'est la seule chose
du modèle économique qui mérite d'occuper de la place à l'écran. L'échelle regroupe les rangs
qui paient pareil — seize lignes dont douze identiques ne se lisent pas, six lignes se lisent
d'un coup d'œil.

La mise est **débitée au lancement**, pas à l'arrivée : c'est ce qui sépare un bouton d'un
engagement, et abandonner en cours de partie la perd. Le gain est crédité à la fin selon le
rang atteint. Le prototype est solo, donc ce rang est toujours 1er — mais le calcul, lui, est
le vrai, et le jour où quinze adversaires arrivent, seul le rang passé change.

`diag/economie.mjs` vérifie les trois tables rang par rang contre des valeurs dérivées à la
main du C#, plus l'invariant `distribué + commission = pot`.

## Une partie, pas une épreuve

Le bouton JOUER lance une **partie** : trois manches tirées au sort, jouées d'affilée
jusqu'à la finale, qui donne la victoire. Le joueur ne choisit pas son terrain — un joueur
fort à la course mais faible aux portes ne peut pas éviter les portes. C'est ce qui fait
qu'une victoire veut dire quelque chose.

Une seule arène vit à la fois : elle est construite au départ de la manche et **libérée**
au passage à la suivante, pour ne pas faire tourner plusieurs mondes physiques en
parallèle.

L'interface est en ANGLAIS ; les commentaires du code restent en français. Les noms
d'épreuve et de personnage ci-dessous sont ceux affichés à l'écran — les identifiants de
fichiers gardent leur nom d'origine : `char-grenouille.glb` porte **Pepe**,
`char-techtitan.glb` porte **BabyMusk**, `char-diplomate.glb` porte **BabyNetan**.

| Épreuve | Principe |
|---|---|
| **The Dash** | Parcours d'obstacles serpentant, avec embranchement et ballons déterministes. |
| **The Doors** | Sept murs percés de portes en papier : certaines cèdent, les autres sont condamnées. |
| **The Logs** | Des échines de troncs géants au-dessus d'un lagon, reliées par des ponts de cordes et un gué : arêtes d'écorce à sauter ou à contourner, barils qui dévalent, trous traversants. |
| **The Tiles** | Un damier jeté au-dessus du vide. Une seule ligne de dalles porte ; toutes les autres cèdent sous le pied. |
| **The Hex** | Une tour de dalles hexagonales au-dessus d'une boue rose. Toutes cèdent, aucune ne revient. On ne va nulle part : on tient. **Seule épreuve de SURVIE du catalogue.** |

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

**Le raccord des deux voies s'ouvrait au dernier moment.** Les voies se rapprochent
jusqu'à 3,5 m d'écart, puis le vide entre elles **se rouvre à 7,5 m** sur les deux derniers
mètres avant la dalle commune : leurs rubans s'inclinent en fin de course, et une tranche à
Z constant les voit s'écarter. Le joueur, lui, voit deux voies qui se rejoignent — il dérive
vers le milieu au moment précis où le trou s'élargit. La dalle commune démarre désormais
trois mètres plus tôt et couvre toute la zone de convergence, sans rambarde : une rambarde y
poserait un mur au beau milieu du couloir.

`diag/raccord.mjs` l'a trouvé, et lui seul pouvait : il tire une grille de rayons sur toute
la zone sans rien supposer de la géométrie. `continuite.mjs` sonde les trajectoires, et le
trou n'appartenait à aucune.

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

### Le Rondin

Une chaîne d'**échines de troncs géants** au-dessus d'un lagon, reliées par des ponts de
cordes, un gué de pierres et une plaine à chicanes.

> **Refonte d'août 2026.** La version précédente faisait courir le joueur sur un cylindre
> étroit (R = 5,5 m) qui tournait jusqu'à 0,55 rad/s : la rotation portait tout le mini-jeu.
> La refonte suit la référence — le tronc s'élargit à 12 m, sa rotation tombe à 0,10–0,18
> rad/s, et la pression temporelle passe aux **barils**. Il tourne toujours, et il doit :
> une passe intermédiaire l'avait quasi immobilisé, et à l'essai la map ne s'appelait plus
> Le Rondin.

L'échine est large et bombée. Le sommet est presque plat, donc on y court sans y penser ;
les flancs, eux, se dérobent de plus en plus. La difficulté n'est plus de corriger une
rotation, elle est de **ne pas se laisser pousser vers la pente** — par un baril, par une
arête qu'on contourne, ou simplement par son propre élan en sortie de saut. Le tronc ne fait
rien contre le joueur : il attend que le joueur se déporte.

| Obstacle | Cote | Réponse | Ce qu'il impose |
|---|---|---|---|
| **Anneau** (rouge, bleu) | 1,05 m, **tour complet** | se saute | le *rythme* |
| **Arc** | 3,30 m, portion de circonférence | se contourne | la *trajectoire* |
| **Baril** | R 0,9 m, 5,6 m/s, voie fixe | s'esquive | le *tempo* |
| **Trou** | 3,4 m, traversant | s'anticipe | la *lecture* |

#### Les obstacles font le tour du tronc, et c'est obligatoire

C'est le défaut le plus grave qu'ait eu cette scène, et il ne se voyait sur aucune capture.
Les arêtes étaient posées autour de la crête **dans le repère local du tronçon** — donc
elles tournaient avec lui. Passé un quart de tour elles se retrouvaient sur le flanc, puis
sous le rondin, et il ne restait plus rien du tout à franchir sur le dessus : le mini-jeu se
vidait de lui-même au bout de quelques secondes de rotation.

Deux formes répondent au problème, et il faut les deux :

- l'**anneau** fait le tour complet. Quelle que soit la rotation, il en présente toujours une
  portion au sommet : c'est lui qui garantit qu'il y a toujours quelque chose à sauter ;
- les **arcs** sont équidistants sur la circonférence, et c'est le lot entier qui pivote avec
  la graine. La rotation les fait défiler au sommet l'un après l'autre — celui qu'on voit
  arriver n'est pas celui qu'on devra contourner.

Décaler chaque arc séparément rompait l'équidistance et rouvrait des secteurs vides de 145°.
`diag/echine.mjs` mesure désormais le plus grand secteur vide de chaque tronçon, et exige au
moins un anneau complet par tronçon.

Rouge et bleu sont le **même objet** dans deux teintes : le joueur n'a pas à apprendre que
bleu voudrait dire autre chose, il voit seulement qu'il en a déjà passé un.

**L'ouverture d'une arête haute n'est pas choisie, elle est déduite.** On exige qu'il reste,
d'un côté au moins, 1,2 largeur de corps de terrain libre à l'intérieur de la crête
praticable — d'où 1,08 m de passage résiduel. Une arête qui barrerait toute la crête
n'imposerait pas un détour mais une chute.

**Toutes les cotes dérivent du personnage** — 0,90 m de large, 1,60 m de haut, saut de
2,15 m, portée de 5,27 m. Le rayon de **9,5 m** donne une crête utile de 7,1 m sous 22°
d'inclinaison, soit huit largeurs de corps : de la place pour manœuvrer, esquiver et se
tromper. C'est cette marge qui permet aux barils d'exister sans rendre la manche injouable.

Le rayon a d'abord été fixé à 12 m. Le tronc mesurait alors vingt-quatre largeurs de corps
d'un bord à l'autre : à l'écran le personnage devenait un point, on ne lisait plus sa
position sur la courbure, et le tronc cessait d'être un rondin pour devenir une route.
**L'échelle se juge sur le personnage, pas sur le plan.**

#### La pente est le vrai danger

`glisseAt` lit l'**inclinaison réelle du terrain** sous les pieds, pas une zone peinte au
sol : c'est la géométrie qui décide. En deçà de 22° on court normalement ; au-delà
l'adhérence part progressivement ; à 50° elle a disparu. Le joueur peut donc mordre sur le
flanc pour contourner une arête, et même y gagner du terrain — tant qu'il n'y reste pas.

Le seuil bas n'est pas franc par prudence : un plafond net ferait basculer l'adhérence d'un
pas à l'autre, et le joueur lirait un bug.

#### Le parcours alterne effort et respiration

| Section | Longueur | Ce qui s'y joue |
|---|---|---|
| Départ | plage large | aucun avantage de position (exigence de la spec) |
| Pont de cordes | 12 m | on court droit |
| **Échine 1** | 45 m | la pente seule — 3 arêtes basses, 1 haute, 1 trou |
| Gué de pierres | 14 m | on louvoie, sans jamais quitter l'axe |
| **Échine 2** | 50 m | les barils entrent — 3 barils, 5 arêtes, 2 trous |
| Pont de cordes | 14 m | respiration avant la dernière |
| **Échine 3** | 50 m | tout ensemble — 5 barils, 7 arêtes, 3 trous |
| Plaine à chicanes | 30 m | plat et sans chute : la difficulté est de trajectoire |
| Arrivée | damier | on finit en courant vite |

Un palier entre deux montées n'est pas une faveur : sans lui, la difficulté croissante se
lit comme une seule longue punition, et le joueur n'a jamais l'occasion de constater qu'il a
progressé. Toutes les sections **empiètent de 2 m** sur leur voisine — se toucher au bord ne
suffit pas, le lagon est deux mètres plus bas et la moindre imprécision de raccord y verse
le joueur sans qu'aucun obstacle ne soit en cause.

#### Le cylindre est complet, et c'est la condition de la rotation

Une version intermédiaire n'engendrait que l'**arc supérieur** — 140° — pour économiser les
triangles de la moitié immergée. C'était une fausse économie, et elle a coûté deux fois.

D'abord un bug : un arc n'a de sol au-dessus **pour aucune phase autre que la verticale**, et
la phase tirée au sort de l'ancien cylindre a été conservée. Les trois tronçons se sont
retrouvés tournés n'importe comment, et le harnais de continuité a mesuré 140 mètres de
parcours sans le moindre sol.

Puis, une fois la phase corrigée, la conséquence de fond : **un arc ne peut pas tourner.**
Il a fallu remplacer la rotation par un roulis de quelques degrés — et à l'essai, personne ne
voyait plus le tronc bouger. On est donc revenu au cylindre fermé.

L'économie est reprise ailleurs, et mieux : le pas des anneaux passe de 1,0 m à **1,6 m**. Un
cylindre est lisse le long de son axe, donc le raffiner dans cette direction n'achète rien,
alors que le raffiner autour de la circonférence change la silhouette. Le tronçon complet
coûte ainsi *moins* cher que l'arc qu'il remplace.

| Tronçon | Rotation | Entraînement à la crête | Ce qu'il apprend |
|---|---|---|---|
| 1 | 0,13 rad/s | 1,24 m/s | la dérive seule |
| 2 | −0,18 rad/s, **sens inverse** | 1,71 m/s | il faut se réadapter |
| 3 | 0,23 rad/s | 2,19 m/s | tout ensemble, resserré |

C'est l'**entraînement** (ω·R) que le joueur ressent, pas ω : les vitesses angulaires sont
relevées quand le rayon baisse, pour que la sensation ne change pas.

C'est l'inversion du **sens** qui coûte le plus au joueur : le geste appris au tronçon
précédent devient exactement le mauvais.

La paroi n'a pas d'épaisseur : le trimesh de Rapier arrête des deux côtés, donc la face qu'on
voit est exactement celle qui porte. Et **un trou est double** — chaque percement retire aussi
les cellules diamétralement opposées, faute de quoi le joueur tomberait au fond d'une coque
close, vivant et immobile, sans savoir s'il est mort ou coincé.

Le sentier de terre battue occupe 3,1 m sur 9 : il doit rester **minoritaire**, faute de quoi
l'écorce ne se voit plus que sur les flancs et le tronc se lit comme une plage.

#### Le décor : lagon, plage, colline

Trois versions du décor ont été jetées avant celle-ci, et toujours pour la même raison de
méthode : **je jugeais sur des vues cadrées à la main, loin et haut.** Elles montrent la
géométrie ; elles ne montrent pas la partie. Le joueur est à un mètre soixante au ras du
tronc, et c'est de là qu'un décor se juge — `diag/lr_jeu.mjs` prend désormais les captures
avec la caméra du jeu, depuis le personnage, en huit points du parcours.

Vu de là, la version « terrain générique + chaîne de montagnes » ne montrait **que de l'eau
jusqu'à l'horizon** : toute la terre avait été repoussée hors du champ pour que le relief
ait la place de monter. Rien de tout cela ne se voyait sur mes aperçus.

D'où le principe retenu : **la vue se ferme près.** Une colline à quatre-vingts mètres
arrête le regard mieux qu'une chaîne à quatre cents, elle coûte moins cher, et elle dispense
de meubler tout ce qu'il y aurait entre les deux.

`createTerrain` ne pouvait pas produire ça, et il a fallu s'y casser les dents pour le voir :
il modèle une cuvette entourée d'une ceinture de crêtes, et entre les deux la plaine est
plate et à la même altitude que la cuvette. Aucun réglage ne donne à la fois de l'eau au
centre, une plage étroite et une colline proche.

`createRivage` (dans `terrain.js`) part de l'autre bout. La carte est un **couloir** : le
décor ne dépend donc pas de la distance au centre, mais de la seule distance à l'**axe**. On
définit un profil en travers — fond, pente, plage, colline — et on le balaie sur toute la
longueur. Trois conséquences : la plage a la largeur qu'on veut et pas celle qui tombe ; la
colline ferme la vue à hauteur d'œil ; et en faisant **onduler** le profil le long de Z, le
rivage devient une courbe organique au lieu d'une ligne droite — c'est le même bruit qui
déplace la plage et la colline, donc les bandes restent parallèles comme sur une vraie côte.

Le lagon est resserré à vingt-quatre mètres de part et d'autre du tronc, soit deux largeurs
et demie de rondin : la proportion de la référence.

**Ce que la vue à hauteur de joueur a aussi révélé**, et qu'aucun aperçu n'avait montré :

| Défaut | Ce qu'il en est |
|---|---|
| Un disque gris cuirassé à dessus vert moisi | la plateforme de départ — **la première chose que voit le joueur**, il naît dessus |
| Des « tables » de bois plantées dans l'eau | les propulseurs à barils, sur pilotis au milieu du lagon ; ils sont désormais sur la **plage** |
| Des planches flottant au hasard | des troncs à la dérive, censés meubler le lagon ; supprimés |
| Des dalles vertes plates à gros contour | les chicanes de la plaine, seule chose verte du parcours, d'un vocabulaire étranger |

Les chicanes sont maintenant des **plots** de deux mètres, aux teintes des arêtes du tronc.
Un seul bloc large de huit mètres remplissait l'écran d'un aplat de couleur ; découpé en
plots, il laisse voir derrière, donne une échelle — on compte les plots — et se lit comme un
parcours plutôt que comme un mur.

#### Le décor est celui des autres épreuves

Le Rondin s'était doté d'un décor à lui : des berges en boîtes plates, un rideau de jungle
en panneau texturé, et des silhouettes de collines découpées. Chaque pièce résolvait bien
son problème local, et l'ensemble ne ressemblait à aucune autre carte du jeu.

Il reprend maintenant les deux outils que La Course et Les Portes utilisaient déjà :

- **`createTerrain`** — un seul maillage dont les sommets sont déplacés et la couleur donnée
  par l'altitude. Le rivage devient l'endroit où le sol traverse le plan d'eau, donc une
  découpe irrégulière qu'on n'a pas eu à dessiner ; et un appel de dessin remplace les six
  boîtes de berge.
- **`mountainRange`** — la ceinture de sommets striés rose et crème de la direction
  artistique v2. Un sommet strié a du volume, une calotte claire et une teinte qui varie
  d'un anneau à l'autre ; mes silhouettes étaient plates et unies, et se lisaient comme du
  carton posé au fond.

Deux options ont été ajoutées aux modules partagés, avec des valeurs par défaut qui laissent
les autres cartes rigoureusement identiques :

| Option | Module | Ce qu'elle résout |
|---|---|---|
| `echelleX` | `createTerrain` | rend la cuvette **elliptique**. Ronde, il aurait fallu un rayon si grand pour couvrir 220 m de long que la terre serait sortie du champ |
| `releve` | `createTerrain` | relève la **plaine** hors de la cuvette. Sans lui, cuvette et plaine sont à la même altitude : le module ne savait pas faire un lagon |
| `cx` / `cz`, `rayonCretes` | `createTerrain` | recentrer et éloigner la ceinture de crêtes |
| `densite`, `rayon` | `mountainRange` | poser la **même** chaîne, un sommet sur deux — éclaircir vaut mieux que supprimer quand une carte est déjà chargée |

Deux réglages se lisent sur les **seuils de couleur** du terrain, et non à l'œil : l'herbe
tient jusqu'à 9 m de dénivelé, la roche rose prend le relais jusqu'à 30. Une version
intermédiaire faisait monter la terre de quinze mètres en trente — le rivage passait
directement à la roche et la carte était cernée de masses magenta. Il faut que le sol
franchisse le plan d'eau tôt, puis reste longtemps dans la bande d'herbe.

#### Aucune texture sur les arêtes, et un aplat sur le tronc

Le premier jeu de textures était généré, détaillé, ombré — et faux. La référence est presque
nue : le tronc est un aplat orange traversé de quelques stries douces, les arêtes d'écorce
n'ont aucun motif, et tout le relief vient du toon shading et de la silhouette. Une écorce
photographique, même stylisée, ramène une fréquence spatiale que le reste du jeu n'a pas, et
la map se met à jurer avec les autres épreuves.

Cinq PNG générés — écorce, sentier, anneaux, arête rouge, arête bleue — pesaient plus de
quatre mégaoctets pour ce mauvais résultat. Ils sont remplacés par `boisLisse`, `sentierBois`
et `anneauxBois`, volontairement pauvres, procéduraux et gratuits. Ce qui fait l'arête, ce
n'est pas son motif : c'est son **arrondi** et le **cordage doré** qui la ceint.

Les vingt-neuf textures restantes sont passées en JPEG : aucune ne portait d'alpha, et le PNG
ne servait qu'à peser. **29,3 Mo → 3,2 Mo**, à qualité invisible sur des aplats.

#### Les sections se touchent, elles ne se chevauchent plus

Chaque section empiétait de 2 m sur sa voisine, pour qu'aucun vide ne s'ouvre au raccord.
Entre deux surfaces plates c'était sans conséquence ; contre un **cylindre**, c'était un
défaut visible de loin : le tablier du pont, posé à la hauteur de la crête, s'enfonçait de
deux mètres dans le tronc et en ressortait par le flanc. Les pierres du gué se retrouvaient
carrément posées sur le rondin.

Les sections sont donc bord à bord, et la continuité est assurée autrement : par un **seuil**
posé à cheval sur chaque jonction, 8 cm au-dessus de la crête. Deux surfaces exactement
coplanaires produisent un z-fighting et, si l'une est courbe, une interpénétration franche ;
8 cm suffisent à s'en affranchir, le personnage mesure 1,60 m et ne sent pas la marche, et
l'œil lit une pièce de charpente posée sur le rondin — ce qu'elle est.

#### D'où vient un baril, et où il finit

Les barils apparaissaient et disparaissaient au milieu du tronc. On ne savait ni d'où ils
venaient ni pourquoi ils s'arrêtaient — et un obstacle dont on ne comprend pas la provenance
ne s'anticipe pas, il se subit. Trois temps désormais, tous les trois visibles :

1. **le propulseur**, une machine de bois sur pilotis dans le lagon, au bout lointain du
   tronçon, avec un bras qui bascule. On la voit de loin, on voit le bras partir, et on sait
   qu'un baril arrive avant de l'avoir vu voler. Les propulseurs alternent de rive : deux
   tirs du même côté et le joueur cesse de surveiller l'autre ;
2. **le vol**, une parabole jusqu'à la voie sur laquelle le baril va rouler — c'est lui qui
   annonce la voie, donc qui rend l'esquive préparable ;
3. **la rupture**, contre le seuil du tronçon, en une gerbe de sept bûchettes qui retombent
   sous la gravité du jeu et rapetissent. Disparaître d'un coup se lisait comme un bug.

Le tout reste une fonction pure du temps : les trois temps sont trois intervalles d'un même
compte à rebours, et les éclats partent dans des directions lues dans une table. Une période
doit donc contenir le cycle **entier** — sur un tronçon de 50 m le roulé dure déjà 8,5 s,
d'où des périodes de l'ordre de 13 s. Ce sont les *phases*, décalées, qui font qu'un baril
part toutes les quatre secondes, et non la période.

Un piège en découle, et le harnais l'a trouvé : un baril caché garde quand même une position,
et si on ne la pose pas explicitement, elle vaut celle du dernier appel — donc elle dépend de
l'**ordre** des mises à jour, et l'objet cesse d'être une fonction du temps. Un objet
invisible a un état, et cet état doit rester reproductible.

#### Le bug qui faisait GAGNER la manche

Un corps cinématique qui recouvre un corps dynamique est séparé par le solveur en une seule
image, et la vitesse d'expulsion est proportionnelle à la profondeur du recouvrement — elle
n'a aucune borne. Le joueur qui touchait un baril, ou se coinçait contre une arête, partait à
plusieurs dizaines de mètres par seconde, franchissait le décor et atterrissait **après la
ligne d'arrivée**.

Trois corrections, dont deux sur la cause :

1. **Le collider du baril ne tourne plus.** Un cylindre est invariant par rotation autour de
   son axe : la lui faire subir ne change rien à sa forme, mais donne au solveur une vitesse
   de surface de 5,6 m/s qu'il transmet intégralement. Seul le *mesh* tourne — le roulé se
   voit, et ne pousse plus.
2. **Le baril naît sept mètres au-delà du bout de la section.** Il est donc déjà lancé quand
   il atteint le sol praticable, au lieu d'apparaître d'un coup sur quelqu'un.
3. **Un plafond de vitesse** (`Character.limiterVitesse`) appliqué *après* chaque pas. Les
   deux premières corrections traitent les causes connues ; aucune ne peut prouver qu'il n'en
   reste pas une autre. Le plafond, lui, le prouve : il porte sur la vitesse elle-même, donc
   il vaut quelle que soit la géométrie qui l'a produite.

`diag/echine.mjs` pose le personnage dans la voie d'un baril à l'instant de son passage et
mesure sa pointe de vitesse pendant une seconde : 6,2 m/s, pour un plafond à 16,7.

#### Les barils sont une fonction pure du temps

La spec interdit tout aléa dans le monde du jeu, et un baril est exactement le cas où l'on
serait tenté d'y recourir. `ballChute`, dans La Course, tire encore sa voie et sa gigue **à
l'exécution** : son calendrier ne tient que si deux clients appellent le générateur le même
nombre de fois dans le même ordre.

Ici il n'y a pas de générateur à l'exécution du tout. Le lâcher *k* sort d'une division, sa
voie d'une table indexée par *k*, et le corps est **cinématique** — un corps dynamique aurait
été plus joli à regarder rebondir, mais sa trajectoire dépendrait de l'historique des
contacts, donc du joueur, donc de la machine. Un obstacle dont le parcours dépend de qui le
regarde n'est pas rejouable. `diag/echine.mjs` le vérifie en relisant les positions à un
instant donné après avoir fait avancer la scène ailleurs.

Les périodes (3,7 / 4,3 / 5,1 / 4,7 / 3,3 s) sont volontairement non commensurables : des
périodes égales referaient sans cesse la même figure, et le joueur apprendrait un instant
plutôt qu'une lecture.

#### Le portage de surface — ce qu'il a fallu changer au contrôleur

Rien de tout cela ne se sentait avant une retouche de trois lignes dans `src/character.js`.

Le personnage est un corps dynamique dont la vitesse horizontale est **réécrite à chaque
sous-pas en repère monde**, et dont le freinage au sol le ramène vers le zéro *du monde*. Une
surface qui défile sous ses pieds ne l'emportait donc jamais : elle ne faisait que gêner.

Désormais, **au sol, la référence est la surface** : la vitesse voulue et le freinage
s'expriment par rapport à elle. En l'air on retrouve le repère du monde, donc on garde
l'élan pris sur le tronc. La scène le renseigne par `surfaceAt(pos)`, à côté de `glisseAt` :
pour une rotation ω autour de l'axe, la vitesse d'un point de la paroi vaut ω × r. La
formule *est* la physique — à ceci près qu'avec le roulis, ω n'est plus une constante mais la
dérivée du sinus, relue à chaque pose.

La détection de culbute a suivi : elle se déclenche sur une **secousse** de 5,2 m/s en un
pas, et poser le pied sur une surface qui défile en produit une. Mesurée dans le repère de
surface, elle ne se déclenche plus.

`diag/echine.mjs` rend dix verdicts, et remplace `rondin.mjs` qui mesurait l'ancien
cylindre étroit. Les cotes d'abord, sur les nombres et avant de jouer — un pilote qui passe ne
prouve pas qu'une cote est juste, il peut passer par chance. Puis la mesure : le collider
n'est jamais sous le visuel (0,24 cm au pire sur 779 tirs), aucun trou non voulu dans la
paroi, la lèvre passe sous l'eau, les barils sont purs, et le sol est continu de bout en
bout. C'est ce dernier verdict qui a trouvé, dans le gué, deux pierres consécutives qui
manquaient l'axe — un vide d'un mètre au-dessus du lagon, invisible à la lecture du code.

Un piège de mesure, pour finir : **la crête est toujours en haut.** Un cylindre qui tourne
autour de son axe ne change pas de silhouette, donc la paroi se trouve à l'angle monde π/2
quelle que soit sa rotation ; c'est le repère *local*, où sont déclarés les trous, qui tourne
sous elle. Une version du harnais ajoutait la rotation à la position du tir : passé une
demi-rotation, il sondait sous le tronc et rapportait deux mètres d'écart de collider. Le
défaut était dans la mesure, pas dans la scène — et il aurait été très facile de « corriger »
la scène jusqu'à ce que le test se taise.

### Les Dalles

Un damier de dalles au-dessus du vide, et un seul chemin qui le traverse.

Ce mini-jeu ne se gagne pas à la course, il se gagne à la **lecture**. Rien, dans une
dalle, ne dit si elle porte : la seule façon de le savoir est de poser le pied dessus,
c'est-à-dire de payer. Ce que le joueur exploite ensuite n'est pas une observation du
terrain mais la **mémoire des dalles déjà tombées** — les trous derrière lui sont la carte,
et ils s'accumulent.

C'est la dynamique des Portes transposée d'un mur à un plan : celui qui mène défriche pour
tous ceux qui suivent, et savoir quand suivre plutôt que mener est une compétence à part
entière. La différence tient au coût — une porte qui cède est gratuite, une dalle qui cède
fait tomber.

**Le sursis.** Une dalle piégée ne disparaît pas au contact : elle *tremble* d'abord, puis
lâche. Ce délai est ce qui fait du mini-jeu un jeu d'adresse plutôt qu'un tirage — il
autorise le **pas de sonde**, où l'on avance d'une dalle et où l'on se retire avant qu'elle
ne parte. Une dalle qui a commencé à trembler est perdue même si l'on recule : sans cela le
pas de sonde serait gratuit et le damier ne se dévoilerait jamais. Le collider descend avec
le visuel pendant le tremblement — on le sent sous les pieds avant de le voir.

| Section | Damier | Écart latéral | Sursis |
|---|---|---|---|
| 1 | 9 × 12 | 1 colonne | 0,36 s |
| 2 | 11 × 15 | 1 colonne | 0,24 s |
| 3 | 13 × 17 | jusqu'à 2 | 0,16 s |

La difficulté ne monte pas en changeant la règle : elle monte en élargissant le damier —
plus de mauvaises réponses par rang — et en **éteignant le droit à l'erreur**. La lecture
reste la même du début à la fin.

**Aucun indice, jamais.** L'apparence d'une dalle dépend de sa position, jamais de son
état : même teinte, même face, même altitude, et aucune animation. Les dalles ne respirent
même pas — sur les Portes il fallait que *toutes* les feuilles battent pour ne rien trahir ;
ici la solution honnête est plus simple, un damier immobile se lisant mieux qu'un damier qui
ondule.

**Le chemin est connexe par les arêtes.** Quand le tracé se décale latéralement, les dalles
*traversées* par le décalage sont sûres elles aussi. Sans cela deux dalles ne se toucheraient
que par un coin : le joueur devrait franchir ce coin en aveugle, et le rayon de sol du
contrôleur — un seul rayon, parti du centre du corps — pourrait n'y rien trouver pendant une
image. Effet de bord voulu : un décalage large laisse un rang à deux ou trois dalles sûres,
c'est-à-dire un palier de repos, et il tombe là où le chemin vire — exactement là où le
joueur a besoin de temps.

Chaque palier de pierre est un **point de reprise**, et les dalles tombées le restent : une
deuxième tentative rejoue un damier déjà à moitié résolu. Sans cette mémoire, une erreur au
dernier rang coûterait le parcours entier.

`diag/dalles.mjs` rend dix-huit verdicts, tous au vert. La question qui décide de tout — *le chemin
existe-t-il ?* — se vérifie en parcours de graphe, en connexité par les arêtes : un damier
dont le chemin sûr n'est pas connexe est un mini-jeu impossible, et rien à l'écran ne le
dirait. Puis le collider (le dessus à 0 mm de la cote annoncée, une dalle qui porte jusqu'à
5 cm de son bord, le jeu de 16 cm qui est un vrai vide), la règle et son témoin — *une dalle
du chemin ne cède JAMAIS*, le seul test qui distingue « le mini-jeu marche » de « toutes les
dalles tombent » —, le sursis mesuré section par section, la mémoire des trous après une
chute, et un pilote qui suit le chemin de bout en bout — 63 repères, zéro chute, 30 s.

C'est la carte la plus légère du jeu : 180 appels de dessin et 192 000 triangles pour six
cents dalles, parce qu'une section entière tient en DEUX instances — le corps et la face —
et que tous ses colliders pendent d'un seul corps fixe. Posées une à une, les dalles
coûteraient plus de mille appels, quatre fois le budget entier.

### Entrée en manche

Sept secondes entre le clic et le départ, en quatre temps, tous relevés au chronomètre sur
la référence :

| Temps | Durée | Ce qu'il fait |
|---|---|---|
| Carrousel « Prochaine épreuve… » | 3,0 s | les cartes défilent et **ralentissent** jusqu'à s'arrêter sur l'épreuve tirée |
| Volet iris | 0,5 s | un disque s'ouvre sur la carte |
| Survol + carte-titre | 3,5 s | la caméra longe le parcours, le nom de l'épreuve s'affiche |
| **Coupe franche**, puis décompte | 0,9 s par chiffre | la caméra saute derrière le personnage, 3 · 2 · 1 · GO ! |

La coupe est le seul moment sans transition de toute la séquence, et c'est ce qui la rend
nette : après sept secondes de mouvement continu, l'arrêt sec dit « maintenant c'est à toi ».

**Le carrousel ne décide de rien.** L'épreuve et la graine sont tirées *avant* qu'il ne
démarre ; l'animation raconte une décision déjà prise. C'est ce qui permet de la sauter d'une
touche sans changer d'un iota ce qui va être joué — et c'est aussi ce qui la rend honnête,
puisqu'un carrousel qui tirerait au sort à l'affichage serait un générateur aléatoire de
plus, exactement ce que la spec interdit.

Pendant la séquence, la simulation est **arrêtée** : on ne fait pas tourner un monde physique
pendant sept secondes pour le jeter ensuite, et surtout le personnage ne doit pas avoir bougé
d'un centimètre quand la coupe tombe sur la ligne de départ. Le décor, lui, continue de vivre
— les barils roulent pendant le survol.

Le HUD se tait pendant la présentation : seule la carte-titre reste. C'est ce que fait la
référence, et cela évite que l'objectif, écrit à gauche, ne vienne buter contre le titre
centré.

#### Le survol est générique, et c'est la raison d'être du module

`src/survol.js` **dérive** le rail du tracé réel de l'arène, au lieu de le décrire à la main
dans chaque scène. Un rail écrit à la main aurait fini juste sur une seule carte : la scène
change, le rail ne suit pas, et personne ne s'en aperçoit avant de regarder.

Le problème est que `arena.trajectoires` n'a pas la même forme partout — La Course renvoie un
objet de voies nommées, Le Rondin une liste de segments, Les Portes et Les Dalles rien du
tout. Plutôt que de traiter trois cas, on ramène tout à la même mesure : un **échantillonnage
par Z**. Tous les points connus sont versés dans des tranches de profondeur, chaque tranche
est moyennée, et les tranches vides sont interpolées entre leurs voisines pleines — jamais
laissées à zéro, ce qui ferait plonger la caméra vers l'origine du monde à chaque trou de
données. Une carte qui bifurque donne alors sa ligne médiane, et une carte sans données la
droite du départ à l'arrivée, sans cas particulier.

`?nointro` saute toute la séquence. Les harnais l'emploient : certains enchaînent des
dizaines de manches, et sept secondes de présentation à chacune n'apprennent rien.

### HUD

Deux blocs d'angle, et rien au milieu. L'objectif à gauche, l'état de la manche à droite :
le centre de l'écran reste au jeu. Chaque bloc est une **pastille** d'étiquette posée sur une
**pilule** de valeur — l'étiquette dit ce qu'on lit, la pilule ce que ça vaut, et la valeur
reste lisible même quand on ne lit plus l'étiquette.

Le chronomètre est au format `MM:SS:CC` sur fond sombre, contrairement aux pilules blanches :
il change dix fois par seconde, et sur fond clair ce clignotement attire l'œil en permanence.

**« Qualifiés 0/8 » et non « 0/12 ».** Nos règles (`src/Fallguys.Rules/MatchConfiguration.cs`)
posent seize joueurs et une progression `[8, 4, 1]` : la manche 1 qualifie donc huit. Sans
adversaires le compteur passe simplement de `0/8` à `1/8` à l'arrivée — c'est le HUD de la
référence, branché sur nos vrais chiffres plutôt que sur une constante décorative.


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

### Greffer l'animation d'attente

Meshy ne livre pas de clip de repos : les personnages arrivent avec `running` et
`walking` seulement. À l'arrêt, ils retombaient donc sur leur pose de liaison — bras en
croix, jambes écartées — ou, au mieux, sur la marche gelée sur un appui, ce qui posait une
statue au milieu de la vitrine.

**Chaque personnage a son propre clip d'attente**, dans `tools/meshy-pipeline/anims/` :
`idle-babytrump.glb`, `idle-techtitan.glb`, `idle-grenouille.glb`, `idle-diplomate.glb`,
`idle-captainleeky.glb`, 10 s chacun. Un clip unique partagé par les cinq avait été monté
d'abord ; il marchait, mais cinq personnages qui attendent exactement pareil se lisent
comme cinq instances du même acteur, et la vitrine est précisément l'endroit où on les
compare.

Chacun arrive avec un maillage complet et sa texture, 5 à 6 Mo dont rien ne sert ici ;
réduits aux seules données d'animation, ils font 131 Ko et donnent une greffe identique
octet pour octet. Elle est possible parce que les cinq personnages partagent exactement le
même squelette : 24 os, mêmes noms, même ordre. `fusion-anims.mjs` le vérifie et refuse
sinon — les canaux d'animation ciblent les os par index, et un ordre différent
mélangerait les membres.

```bash
cd ../meshy-pipeline
for c in babytrump techtitan grenouille diplomate captainleeky; do
  node fusion-anims.mjs "/tmp/char-$c.glb" \
    "../feel-lab/public/models/char-$c.glb:*" "anims/idle-$c.glb:idle"
  mv "/tmp/char-$c.glb" "../feel-lab/public/models/char-$c.glb"
done
```

`fichier.glb:*` garde **toutes** les animations du fichier sous leur propre nom — sans
cette forme, reprendre un personnage déjà fusionné n'en gardait qu'une, et il repartait
sans sa course. Coût : +160 Ko par personnage, seules les données d'animation étant
recopiées.

`ClipRig` s'en saisit tout seul (`this.repos = this.actions.get('idle')`) : au lobby comme
en course à l'arrêt, le personnage joue son attente. Le repli « marche gelée » reste dans
le code pour un personnage qui arriverait sans le clip.

### Ce que les clips ne couvrent pas

Le personnage importé n'a que trois états — pose, marche, course — quand le jeu en connaît
six. Plutôt que d'inventer les manquants, le clip de course est **figé** sur un instant
choisi : jambes écartées pour la montée, corps ramassé pour la chute. Laisser le cycle
tourner donnerait un personnage qui pédale dans le vide, le défaut le plus visible qui
soit, puisque les jambes bougent alors que rien ne les porte.

### La fatigue de saut

Sauter en rafale coûte de la hauteur. Sans cela, la touche de saut n'a **aucun coût** : la
marteler est toujours au moins aussi bon que la doser, et un joueur qui saute en continu
franchit tout ce qu'un joueur mesuré franchit. La fatigue rend au saut son statut de
**ressource** — on la dépense, on attend qu'elle revienne.

Mesuré, cinq sauts collés bout à bout : **2,10 → 1,94 → 1,80 → 1,63 → 1,54 m**, puis
retour à 2,10 m après deux secondes au sol. La portée suit d'elle-même, de 5,17 à 4,46 m,
parce qu'un saut plus bas dure moins longtemps. C'est la seule façon cohérente de faire
« moins haut *et* moins loin » : brider la vitesse horizontale en vol aurait donné un
personnage qui freine en l'air, ce qui ne se lit pas comme de la fatigue mais comme un bug.

Trois choix demandent d'être justifiés.

**La récupération ne court qu'au sol.** En l'air on ne se repose pas — sinon les trois
quarts de seconde de vol d'un saut plein en effaceraient les deux tiers du coût, et la
rafale ne coûterait plus rien. Un joueur qui court et saute normalement, avec une seconde
au sol entre deux sauts, ne sent jamais la fatigue ; c'est voulu, « d'affilée » veut dire
d'affilée.

**Le premier saut est toujours plein.** Le coût ne s'ajoute qu'après. Ce n'est jamais le
saut qu'on demande qui est amputé, c'est le suivant — et c'est ce qui rend la mécanique
lisible plutôt que capricieuse.

**Le plancher se déduit, il ne se choisit pas.** Le saut épuisé doit encore franchir tout
ce que les cartes *demandent* de franchir : l'obstacle sautable le plus haut du jeu
(l'arête basse du Rondin, 1,05 m) et le plus long vide à couvrir (son trou de 3,40 m). À
70 % de hauteur il reste 49 cm de marge sur l'un et 1,06 m sur l'autre. Un plancher plus
bas serait plus spectaculaire et faussement gratuit : à 55 %, l'apex tombe à 1,18 m, treize
centimètres au-dessus de l'arête — un joueur ayant sauté trois fois se retrouverait bloqué
devant un obstacle qu'il franchit d'habitude, sans qu'aucune image ne lui dise pourquoi.

Et parce qu'une mécanique qui change la portée sans rien montrer serait inacceptable dans
un jeu où l'on mise, **l'étirement et la poussière suivent la puissance** : un saut fatigué
s'étire moins et soulève moins de poussière. Le signal est dans le geste, là où le joueur
regarde déjà, et non dans une jauge à surveiller. `diag/fatigue.mjs` remesure les deux
marges à chaque exécution.

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
node diag/economie.mjs            # la table des gains contre le noyau de regles (sans navigateur)
node diag/partie.mjs              # deux parties completes : suites, graines, solde
node diag/dalles.mjs              # les dix-huit verdicts des Dalles
node diag/fatigue.mjs             # la fatigue de saut, et les marges qu'elle laisse
node shoot.mjs                    # captures d'écran via Chromium headless
npm run build                     # syntaxe + imports
```

### L'Hexagone

Clone de *Hex-A-Gone*, et la **première épreuve du jeu qui ne soit pas une course**.

Cinq étages de dalles hexagonales empilés au-dessus d'une boue rose. Chaque hexagone touché
s'enfonce, remonte, blanchit, puis disparaît pour toujours. Il n'y a pas de ligne d'arrivée
et aucun chemin à trouver : tous les hexagones sont identiques et tous cèdent. **Ce qui se
joue est la gestion d'un budget qui se consume**, et le vrai adversaire est le trou qu'on
vient soi-même de creuser derrière soi.

**Toute la capsule paie.** Un hexagone cède dès que le corps le RECOUVRE, pas seulement
celui qui se trouve sous son centre : passer une arête coûte deux hexagones, passer un
sommet en coûte trois. Ce n'est pas un raffinement. Le personnage détecte le sol par un
unique rayon vertical tiré de son centre — ne facturer que l'hexagone du centre laisserait
une capsule à cheval reposer réellement sur deux hexagones dont un seul aurait été payé.
« Creuser son propre trou » EST le jeu ; il faut donc que creuser coûte.

**Les étages s'élargissent vers le bas**, comme dans la référence, et c'est ce qui rend la
descente intéressante : tomber d'un étage n'est pas une punition mais un choix, puisqu'on
atterrit sur plus de sol qu'on n'en avait. On perd de la hauteur, on gagne du temps. On ne
remonte jamais — 14 m d'écart contre un apex mesuré à 2,10 m, et 2,39 m même en
enchaînant un plongeon au sommet du saut.

**Les portées, et ce que l'agrandissement a coûté.** La carte a d'abord été bâtie sur les
deux règles de la référence — un saut simple franchit *un* hexagone manquant, un
saut-plongeon en franchit deux — avec un rayon d'hexagone choisi pour qu'elles tombent
juste. En agrandissant la dalle d'une fois et demie pour la lisibilité, un trou d'un seul
hexagone est passé de 4,16 m à **6,24 m**, au-delà des 5,27 m d'un saut plein. **Le
franchissement passe donc désormais tout entier par le saut-plongeon** (8,31 m, et encore
7,29 m à fatigue pleine) : le saut ne sert plus qu'à se déplacer. Un trou de deux hexagones,
lui, ne se franchit par aucun moyen — creuser large est sans retour, et c'est ce qui fait
le jeu.

**Quatorze mètres entre deux étages**, contre 3,20 à la première version — assez alors pour
qu'on ne puisse pas remonter, pas assez pour qu'on VOIE : avec 2,70 m de hauteur libre, la
caméra se coinçait entre deux dalles et le joueur ne voyait ni l'étage du dessous ni ce qui
l'attendait en tombant. 13,25 m de dégagement — huit fois la taille du personnage — laissent
lire la profondeur de la tour d'un coup d'œil. La chute d'un étage coûte 0,82 s et arrive à
34 m/s, loin du plafond de 55 m/s du garde-fou de vitesse.

Ce qui borne cette cote par le haut n'est pas la physique mais **le ciel** : la couche de
nuages du jeu flotte entre 42 et 72 m, et une tour qui la traverse fait passer des paquets
blancs devant le terrain de jeu. Le sommet est donc posé à 30 m et la tour descend au lieu
de monter — c'est d'ailleurs là qu'elle se trouve dans la référence.

**Le collider EST le visuel.** Un prisme hexagonal est convexe, donc son collider est
l'enveloppe convexe des sommets du maillage — relus dans la géométrie, pas recalculés par
une seconde formule qui dirait la même chose et finirait par en diverger.

**Les motifs par étage** — chevrons, zigzags, pois — ne sont pas décoratifs : la référence
les a ajoutés comme dispositif d'**accessibilité daltonienne** après le correctif d'octobre
2020. Un clone qui garderait les couleurs en jetant les motifs reprendrait le défaut que la
référence a corrigé.

**Déterminisme sans tirage.** Chaque étage est une grille pleine identique, et c'est fidèle :
la rejouabilité ne vient pas du terrain mais de ce que le joueur en fait. La graine ne décide
que d'une chose, la tuile de départ.

`diag/hexagone.mjs` rend dix-neuf verdicts, tous au vert. Le dernier est celui qui décide :
**trois pilotes aux comportements opposés obtiennent trois issues étagées** — 10 s en
restant immobile, 33 s en courant sans se ménager, et les 75 s complètes en économisant son
sol (soit 36 % de consommation en moins, 1,72 hexagone par seconde contre 2,70). La durée à
tenir, 75 s, est posée dans cette fenêtre : plus du double de ce qu'obtient un jeu grossier,
atteignable par un jeu appliqué.

Détail qui vaut d'être noté : **à l'échelle précédente, le harnais n'arrivait pas à produire
cette mesure**. Tenir une dalle demande de rester à moins de 60 cm de son centre, et le
navigateur sans fenêtre avance de 76 cm par image — quatre pilotes successifs s'y sont
cassé les dents. En agrandissant la dalle pour la lisibilité, on a rendu la carte mesurable
par la même occasion.

## Le mode SURVIE

Une épreuve déclare `survie: { duree }` dans son contrat, et la boucle de jeu change de
règles : plus de ligne à franchir, la manche se gagne en **tenant** ; passer sous `killY`
n'est plus une chute mais une **élimination**, qui termine la partie ; le record devient le
temps le plus LONG ; et la barre de progression mesure le temps écoulé au lieu des mètres
parcourus. L'absence du champ vaut course, donc les quatre autres épreuves ne changent pas
d'un pouce.

La durée à tenir n'est pas un pis-aller destiné à masquer l'absence d'adversaires : la
référence elle-même s'arrête au bout d'un délai, et tous les survivants prennent alors la
couronne. On garde la règle, on raccourcit l'horloge.

L'issue s'exprime en **RANG**, jamais en booléen. `reglerPartie(rang)` prenait déjà un rang
et n'était appelé qu'avec `1`, faute d'une façon de perdre ; `perdreManche()` lui donne
l'autre moitié de son travail. Seul, tomber vaut la place juste derrière la dernière
qualifiante — 9ᵉ, 5ᵉ ou 2ᵉ selon la manche, que la table des gains paie déjà sans
modification. Le jour où seize joueurs s'affronteront, le serveur passera le vrai rang et
cette méthode ne bougera pas d'une ligne.

## Ce qui se transpose dans Unity

`src/tuning.js` uniquement — ces 25 constantes sont le livrable réel du prototype.
Le bouton « Copier les réglages » les exporte en JSON.
