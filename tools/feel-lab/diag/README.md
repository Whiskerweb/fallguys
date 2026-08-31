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
| `rondin.mjs` | Diagnostic du **Rondin**, en onze verdicts. Les cotes d'abord, verifiees sur les NOMBRES avant de jouer (fagot sous le saut, palissade au-dessus, passage residuel autour d'une palissade, largeur d'un trou) : un pilote qui passe peut passer par chance. Puis la mesure : le collider colle-t-il au visuel (864 rayons tires sur la paroi, tolerance 1 cm) ; les trous traversent-ils, ET SEULEMENT EUX (des temoins juste a cote doivent trouver la paroi intacte) ; la rotation EMPORTE-T-ELLE le joueur, touches lachees, a hauteur de w*R — c'est le seul test qui prouve le portage de surface, et il ne se voit sur aucune capture ; un temoin immobile sur l'ilot ; aucune culbute parasite en tombant sur le troncon le plus rapide ; un pilote traverse les quatre troncons ; et deux graines identiques donnent la meme carte. Les tirs de geometrie tournent en `?skip=fagots` : un rayon rencontre le fagot AVANT la paroi, et comptait quatre parois percees qui n'etaient qu'un anneau de batons. |

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
