# Scripts de diagnostic

Ils se lancent depuis `tools/feel-lab` avec le serveur de dev actif (`npm run dev`,
port 5273) : `node diag/<script>.mjs [arguments]`. Les captures vont dans `shots/`.

| Script | Ce qu'il repond |
| --- | --- |
| `regress.mjs <modele…>` | Chaque personnage se charge, court, saute — sans erreur console ? |
| `planche.mjs <modele…>` | Portrait de chaque personnage sur le podium, meme cadrage. Sort echelle et nombre d'os. |
| `runanim.mjs <modele>` | Quatre captures en pleine course, pour juger l'animation. |
| `casier.mjs` | Capture l'onglet vestiaire. |
| `voirglb.mjs <fichier.glb>` | Rend un GLB isole (le fichier doit etre dans `public/models/`) et affiche ses dimensions et son nombre de triangles. Sert a juger un modele avant integration. |
| `culbute.mjs` | Trace l'etat du personnage pendant une course puis un saut. |
| `impact.mjs` | Verifie que la culbute se declenche encore sur un vrai impact. |
| `rigtest.mjs` | Le rig converge-t-il vers sa pose cible ? |
| `weights.mjs` | Distribution des poids de skinning par os. Un seul os dominant = maillage rigide. |
| `posetest.mjs <modele…>` | Capture au repos puis dans une pose extreme imposee : le maillage suit-il le squelette ? |
| `axistest.mjs <modele…>` | Quel axe de rotation rabat le bras le long du corps. |
| `skintest.mjs` | Le rig pilote-t-il le squelette auquel le maillage est attache ? |
| `apercu.mjs` | Vues d'ensemble du parcours : dessus, profil, zooms sur chaque RACCORD, et vues a hauteur de course. C'est la vue de dessus qui a revele que l'ancien trace etait une ligne droite, puis qu'il n'etait qu'un tas de dalles qui se chevauchaient. |
| `traversee.mjs` | Traverse **Le Rondin** avec la CAMERA DE JEU en deplacant le joueur d'etape en etape. Chaque etape est decrite par (voie, cote Z) et sa position exacte est LUE sur le trace. Seule facon de voir les masquages a hauteur de course. |
| `raccord.mjs [zDebut] [zFin]` | Y a-t-il un trou LA OU DEUX RUBANS SE REJOIGNENT ? Tire une grille de rayons sur toute la zone, sans rien supposer de la geometrie, et imprime pour chaque cote Z les intervalles de sol trouves. C'est le seul outil capable de voir un vide qui n'appartient a AUCUN ruban — `continuite.mjs` sonde les trajectoires, donc il ne peut pas le voir. Il a trouve, a la fusion des deux voies de La Course, un trou qui se refermait a 3,5 m puis SE ROUVRAIT a 7,5 m sur les deux derniers metres : le joueur voyait deux voies se rejoindre, derivait vers le milieu, et tombait. |
| `continuite.mjs` | Tire un rayon vers le bas tous les metres le long des trajectoires jouables — sur l'AXE ET SUR LES DEUX BORDS — et signale tout trou dans le sol. Les trajectoires sont lues sur `course.trajectoires`, donc le test suit le trace quand il bouge au lieu de sonder une carte imaginaire. |
| `finparcours.mjs [skip]` | Le dernier tiers est-il JOUABLE ? Pilote vraiment le personnage : la grande cote se monte-t-elle, et la patinoire glisse-t-elle ? Le verdict de la cote compare la hauteur du personnage a celle du RUBAN sous lui, pas un nombre de metres — la simulation tourne au ralenti en rendu logiciel. Argument optionnel : la liste `?skip=` (par defaut `balls,pendulums`, pour mesurer la pente sans se faire ecraser). |
| `ballons.mjs` | Verifie que les ballons devalent bien la rampe, et dans le bon sens. |
| `rampe.mjs` | Suit le joueur pose sur la rampe aux ballons : survit-il a l'impact ? |
| `shift.mjs` | Compare plusieurs decalages de camera pour la vitrine du vestiaire. |
| `portes.mjs` | Diagnostic complet du mini-jeu **Les Portes** : construction sans erreur, franchissement SANS RALENTIR d'une porte lisible, resistance d'une porte condamnee, ETANCHEITE de chaque mur au rayon, eclatement d'une porte capture image par image (la rupture dure moins d'une seconde, aucune capture prise au hasard ne la montre), et capture de lisibilite. |
| `portes-run.mjs [n]` | Joue n manches des Portes de bout en bout, pilote vers la bonne porte a chaque mur. Seul test qui dit si une donne est franchissable — la disposition changeant a chaque manche, une seule donne validee ne prouve rien. |
| `portes-leger.mjs` | Meme controle physique que `portes.mjs`, mais avec `?noassets` et sans capture : la scene retombe sur ses formes procedurales et le test passe meme quand la machine est trop chargee pour le harnais complet. |
| `verdict.mjs` | Deux verifications d'un coup : le bandeau de fin de manche (QUALIFIE / ELIMINE) s'affiche et se REJOUE d'une manche a l'autre ; et surtout, l'apparence des portes ne trahit pas la donne — deux donnes differentes sont rejouees et comparees emplacement par emplacement. |
| `lobbyvue.mjs` | Cadrage du lobby, vue d'accueil et vitrine : ou tombe le personnage dans l'image, et le socle donne-t-il l'impression d'etre pose sur un sol qui n'existe pas. |
| `partie.mjs` | Deroulement d'une PARTIE : trois manches tirees au sort et enchainees jusqu'a la victoire. Verifie l'enchainement, la liberation de chaque monde physique, une couronne par partie (et non par manche), et des graines toutes distinctes. Remplace l'ancien `cycles.mjs`, qui alternait les epreuves a la main. |
| `perf.mjs` | Budget de rendu map par map : draw calls, triangles, temps de construction, et poids telecharge au demarrage. Les DRAW CALLS comptent plus que les triangles — un GPU avale des millions de triangles, mais chaque appel de dessin coute un aller-retour avec le pilote. Budget vise : 100 a 300. |
| `portrait.mjs <modele>` | Fabrique le portrait de vitrine A PARTIR DU MODELE, pas d'une image generee : la tuile et l'avatar sont ainsi garantis identiques, et le portrait ne peut pas dater d'une version anterieure. |
| `animchar.mjs [modele]` | Personnage anime par ses PROPRES clips : verifie que les clips sont bien charges (ils vivent a cote de la scene dans un glTF et se perdent en silence), que le melange repos/marche/course suit la vitesse, et que le personnage ne PEDALE PAS en l'air. Le controle en vol appelle le rig directement, avec un temoin au sol : sans lui, un rig completement fige passerait le test. |
| `fatigue.mjs` | La FATIGUE DE SAUT, en sept verdicts. Elle agit sur la HAUTEUR : on la mesure donc a l'arret, ou rien d'autre ne peut la faire varier, en sautant DES QU'ON RETOUCHE LE SOL. Cinq sauts colles doivent monter de moins en moins haut et la hauteur doit REVENIR apres un arret. Puis la vraie question, celle qui compte : la fatigue etant une modification du CONTROLEUR, elle s'applique aux quatre epreuves et raccourcit la portee sur laquelle toutes leurs cotes ont ete dimensionnees. On confronte donc le saut epuise a l'obstacle sautable le plus haut du jeu et au plus long vide a couvrir, LUS DANS LA SCENE. |
| `dalles.mjs` | Diagnostic des **Dalles**, en douze verdicts. La question qui decide de tout — LE CHEMIN EXISTE-T-IL ? — se verifie en parcours de graphe, en connexite par les ARETES : deux dalles qui ne se touchent que par un coin ne font pas un chemin, le joueur y franchirait un vide en diagonale et le rayon de sol du controleur peut n'y rien trouver. Un damier dont le chemin n'est pas connexe est un mini-jeu impossible, et rien a l'ecran ne le dirait. Puis le collider (dessus a la cote, portee jusqu'a 5 cm du bord, le jeu de 16 cm qui est un VRAI vide), la regle et SON TEMOIN — une dalle du chemin ne cede jamais, seul test qui distingue « le mini-jeu marche » de « toutes les dalles tombent », les deux ayant la meme allure sur une capture —, le sursis mesure section par section EN TEMPS DE JEU, la memoire des trous apres une chute du joueur, et un pilote qui CONNAIT le chemin et le suit de bout en bout : il ne mesure pas la difficulte, il prouve que le chemin est physiquement praticable. |
| `dallesvues.mjs` | Six vues fixes des **Dalles** — depart, damier de dessus, trous deja ouverts, section 2, section 3 en plan large, arrivee. Il fait TOMBER quelques dalles avant de photographier : un damier intact ne montre pas ce que le mini-jeu donne a voir, ce sont les trous qui font l'image. Contrairement au harnais de mesure, le decor Meshy est charge — c'est justement lui qu'on vient juger. |
| `hexagone.mjs` | Diagnostic de **L'Hexagone**, en dix-huit verdicts. Deux questions distinctes, et la seconde ne se deduit pas de la premiere : la tour est-elle JUSTE, et est-elle un JEU ? Cote geometrie, le collider est l'enveloppe convexe des sommets du maillage — donc en principe il ne PEUT pas s'en ecarter, ce qui est exactement la raison de le verifier quand meme. Puis la regle qui fait le mini-jeu : pose au centre d'un hexagone on en recouvre UN, a cheval sur une arete DEUX, sur un sommet TROIS — sans quoi un joueur a cheval resterait debout sur un hexagone qu'il n'a jamais paye. Puis les deux verrous qui tiennent la carte debout : on ne remonte JAMAIS d'un etage (saut plein ET saut suivi d'un plongeon, l'echappatoire evidente), et une chute d'etage a 16,4 m/s ne declenche aucune culbute parasite. Enfin le verdict qui decide vraiment : TROIS pilotes aux comportements opposes doivent obtenir trois issues opposees. |
| `hexavues.mjs` | Six vues fixes de **L'Hexagone** — la tour entiere, le depart, un etage de pres, des trous vus de profil, la boue, et une vue A LA VERTICALE. Cette derniere est la seule qui prouve l'orientation des hexagones : c'est elle qui a montre que le lisere dessine sur la face etait tourne de 30 degres et que la grille se lisait comme un pavage de TRIANGLES. Il CREUSE la tour avant de photographier, et laisse des hexagones EN COURS de sursis dans le champ : une tour intacte ne montre rien de ce que le mini-jeu donne a voir. |
| `echine.mjs` | **Le Rondin.** Neuf verdicts sur la nouvelle échine : le collider n'est jamais sous le visuel, aucun trou non voulu, la lèvre de la coque passe sous l'eau, les cotes d'arête et de trou tiennent face au saut, les barils sont une fonction pure du temps, et le sol est continu du départ à l'arrivée. Les caméras sont dérivées de `__sections()`, jamais écrites en dur. Remplace `rondin.mjs`, qui mesurait l'ancien cylindre tournant. |
| `survol.mjs` | **Séquence d'entrée, sur les quatre épreuves.** Aucune coordonnée NaN, le rail reste au-dessus du plan de mort, il progresse bien du départ vers l'arrivée, et le carrousel s'arrête sur l'épreuve réellement tirée. Capture trois images par épreuve : carrousel, survol, ligne de départ après la coupe. |
| `cartes.mjs` | **Vignettes du carrousel**, rendues DEPUIS les epreuves. Elles avaient d'abord ete dessinees par un generateur d'images : jolies, mais elles ne montraient pas le terrain qu'on va jouer, et une vignette qui ment sur ce qui arrive est pire qu'une vignette absente puisqu'elle est crue. Le cadrage emprunte le rail du survol plutot que d'en inventer un second qui divergerait. **A relancer apres toute modification visible d'une epreuve.** |
| `lr_jeu.mjs` | **Captures a hauteur de joueur, avec la camera du JEU**, en huit points du Rondin. Tous les autres apercus placent la camera a la main, loin et haut : ils montrent la geometrie, pas la partie. Trois versions du decor ont ete validees sur ces vues-la puis jetees apres essai — une version ne montrait QUE de l'eau jusqu'a l'horizon, ce qui ne se voyait sur aucun apercu. **A regarder avant de declarer un decor fini.** |

`viewer.html` (a la racine) est la page utilisee par `voirglb.mjs` :
`http://127.0.0.1:5273/viewer.html?m=mon-modele.glb`.

## Deux pieges qui ont coute cher

**Ne jamais editer une source pendant qu'un harnais tourne.** Vite recharge la page a
chaud, `window.__probeGame` disparait, et le test echoue sur une erreur qui n'a rien a
voir avec ce qu'il mesure.

**Mesurer le rendu par les pixels du canevas WebGL ne marche pas.** Lire
`renderer.domElement` hors du cycle de rendu renvoie du noir : un test de distinction
visuelle comparait ainsi du noir a du noir et concluait a l'identite. Quand c'est possible,
verifier l'INVARIANT plutot que l'image — dans `verdict.mjs`, comparer deux donnes est a la
fois plus simple et plus concluant qu'un echantillonnage de couleurs.

**Un drapeau anime coute un programme de shader.** `flag()` injecte son ondulation par
`onBeforeCompile` : chaque drapeau porte donc son propre programme a compiler. Six
oriflammes posees le long d'une cote suffisaient a faire tomber le rendu logiciel sous
une image par seconde des la deuxieme manche — la partie s'arretait au changement de map,
avec un symptome qui ressemblait a un blocage du jeu. Sur une scene reconstruite a chaque
manche, tout ce qui compile doit se compter.

**Un Chromium orphelin fausse tout ce qui suit.** Un script tue par timeout n'atteint
jamais `browser.close()`. Les navigateurs restes ouverts consomment le processeur et
ralentissent le rendu logiciel au point de faire echouer des scenes parfaitement saines —
le symptome ressemble alors a une regression de la map. Les harnais recents fixent donc un
`process.on('exit')` qui ferme le navigateur quoi qu'il arrive.

**Ne jamais tirer un rayon depuis l'interieur du joueur.** `castRay` en mode solide renvoie
une distance NULLE quand son origine est deja dans une forme — et le collider du personnage
en est une. Un pilote qui sondait devant lui depuis son propre centre voyait donc un obstacle
colle en permanence : il sautait a chaque image et ne franchissait jamais rien. Le symptome
ressemblait a une carte infranchissable, la cause etait dans le harnais. Les rayons partent
desormais au moins 1,2 m devant, ou au-dessus de la tete comme le fait `traversee.mjs`.

**Une grille de sondes ne trouve pas un petit trou.** La premiere version de `rondin.mjs`
balayait six cotes par troncon pour verifier les percements : un trou fait 2,2 m sur 45, et
aucune sonde n'en a touche un seul. Le test annoncait « aucun trou bouche » sur zero mesure,
c'est-a-dire rien du tout. On tire desormais AU DROIT de chaque trou, a sa cote exacte, avec
des temoins juste a cote. Un test qui ne peut pas echouer ne prouve rien.

**Un test qui vise a cote mesure autre chose.** La premiere version de `dalles.mjs` tirait
ses rayons de « vide » dans le jeu entre deux dalles, y compris devant le premier rang et
derriere le dernier — c'est-a-dire sur les paliers de pierre, qui sont pleins et le
doivent. Elle signalait donc sept sols fantomes qui etaient exactement le sol qu'on veut y
trouver. Un test qui accuse la scene de faire ce qu'on lui demande ne mesure rien : les
tirs sont desormais restreints aux jeux INTERIEURS au damier.

**Le temps du jeu n'est pas le temps de la montre.** Toujours dans `dalles.mjs`, le sursis
d'une dalle mesurait 0,87 s pour 0,45 s annonces. Ni la scene ni le reglage n'etaient en
cause : le navigateur headless rend a une dizaine d'images par seconde, la boucle de jeu
borne son `dt`, et le temps SIMULE avance donc deux fois moins vite que la montre. Tout
chronometrage d'un comportement de scene se prend sur `runTime`, jamais sur
`performance.now()`. Corollaire : il faut attendre la fin du DECOMPTE avant de mesurer,
`runTime` ne courant pas pendant celui-ci.

**Attendre que ca se stabilise peut tout rater.** La meme fonction laissait d'abord une
demi-seconde « le temps que le joueur se pose » avant de commencer son releve. Les
sections 2 et 3 ont des sursis de 0,30 s et 0,20 s : leur dalle etait deja tombee quand le
releve demarrait, le tremblement n'etait jamais vu, la mesure revenait nulle — et les deux
sections les plus dures n'etaient tout simplement pas mesurees, sans qu'aucun verdict ne
passe au rouge pour le dire.

**Un ilot n'est pas un socle.** `assets.get` pose la BASE du modele a la cote demandee.
Les arbres des Dalles etaient plantes a 0,24 fois la hauteur de l'ilot, c'est-a-dire au
milieu de son rocher, ou ils etaient entierement enterres. Rien ne le signalait : les
captures montraient simplement des ilots peles, et vingt-deux modeles etaient charges pour
n'etre jamais vus.

**Le harnais a besoin d'un serveur qui ne bouge pas.** `DALLES_PORT=5274 node
diag/dalles.mjs` vise un autre port que celui du dev — typiquement `npm run build` puis
`npx vite preview --port 5274`. Quand quelqu'un d'autre edite le depot, le rechargement a
chaud de Vite recharge la page EN PLEINE MESURE : l'arene disparait sous le harnais, tous
les rayons reviennent vides, et les verdicts accusent la scene de pannes qui n'ont pas eu
lieu. Une execution a ainsi annonce « 0 dalle sondee », « le jeu n'est pas un vide » et
« une dalle du chemin CEDE » — trois rouges, aucun defaut. D'ou le RAYON TEMOIN tire sur
la plateforme de depart avant toute mesure : un instrument qui ne voit pas le sol sous ses
pieds n'a pas le droit de condamner quoi que ce soit.

**Mesurer la consequence plutot que la cause.** La premiere version de `fatigue.mjs`
jugeait la fatigue de saut sur la PORTEE. Or la portee depend aussi de la vitesse au
decollage, jamais deux fois la meme : elle a lu 5,17 puis 4,56 puis 5,13 m sur des sauts
tous a fatigue NULLE. Le bruit ressemblait trait pour trait a la mecanique cherchee, et
trois verdicts sont passes au rouge sans qu'aucun defaut existe. On mesure desormais la
hauteur, qui est la grandeur sur laquelle la mecanique agit vraiment.

**Un pilote qui se repose ne mesure pas une rafale.** La meme version attendait d'etre
relancee a 7 m/s entre deux sauts, ce qui laissait plus d'une seconde au sol — assez pour
tout recuperer. Elle mesurait un joueur repose et concluait que la fatigue n'existait pas.

**`FEELLAB_PORT` est la convention du dossier.** `npm run build` puis `npx vite preview
--port 5274`, et `FEELLAB_PORT=5274 node diag/<harnais>.mjs`. Indispensable des que
quelqu'un d'autre edite le depot : le rechargement a chaud de Vite recharge la page EN
PLEINE MESURE, l'arene disparait sous le harnais, et les verdicts accusent la scene de
pannes qui n'ont pas eu lieu.


## Trois pieges de plus, tous rencontres sur L'Hexagone

**Un pilote qui compte en IMAGES mesure la machine, pas le jeu.** Le premier pilote de
`hexagone.mjs` avancait sa spirale d'un pas par image. Le navigateur sans fenetre tourne
autour de dix images par seconde : il se tournait les pouces a un demi-metre par seconde et
tombait sur place, ce qui donnait de la carte un verdict entierement faux. Tout ce qu'un
harnais fait avancer doit l'etre par le TEMPS ecoule, jamais par le nombre d'images.

**Un pilote doit utiliser l'information que la carte AFFICHE.** Le deuxieme pilote econome
attendait sur une horloge fixe sans regarder la dalle sous ses pieds : il tenait 11,8 s,
soit MOINS que le pilote qui court, et concluait que l'adresse ne payait pas. En lui donnant
l'avancement du sursis — la meme information que l'enfoncement et le blanchiment donnent a
l'oeil du joueur — il est passe a 75 s, la duree complete. Un pilote aveugle ne mesure pas
la strategie, il mesure sa propre cecite.

**Le solveur se met en travers d'une mesure posee.** Le verdict « toute la capsule paie »
posait le personnage pile sur un sommet ou trois hexagones se rencontrent, et lisait QUATRE
hexagones : le solveur expulse une capsule coincee la, et en quelques images le corps avait
derive jusqu'a en toucher un quatrieme. La mesure decrivait ce voyage, pas la regle. On
interroge donc une sonde NON DESTRUCTIVE de la scene ; que cette sonde s'applique bien au
vrai corps est prouve ailleurs, par les pilotes, qui ne consomment le sol que par ce chemin.
