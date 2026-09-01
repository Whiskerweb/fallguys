#!/usr/bin/env python3
"""
SOUS-TITRER — incruste la voix off du trailer, MOT A MOT, cale sur le son.

── LE TEXTE SUIT LA VOIX, IL NE L'ACCOMPAGNE PAS ───────────────────────────────
Chaque mot apparait a l'instant ou il est PRONONCE. Les 48 instants sont releves sur la
bande son elle-meme (whisper.cpp, `-ml 1 --split-on-word`), jamais estimes a la reglette :
une estimation derive d'un dixieme de seconde par phrase, et sur un trailer de vingt-sept
secondes cela se voit des le troisieme carton.

Les mots s'AJOUTENT a leur place definitive : la ligne entiere est mise en page d'abord,
puis revelee mot a mot. Un texte centre qui grandit se recentre a chaque mot et danse
sous l'oeil ; ici il ne bouge pas d'un pixel.

── POURQUOI UNE BANDE D'IMAGES ET PAS UN FICHIER .ASS ──────────────────────────
Le ffmpeg installe ici est compile SANS libass : les filtres `subtitles` et `ass`
n'existent pas, et `drawtext` non plus faute de libfreetype. On rend donc la zone de
sous-titres en PNG, une image par image de video, et on l'incruste en UNE passe
d'`overlay`. Rendre la bande plutot que l'image entiere divise le poids par cinq, et les
etats identiques — la plupart des images — sont rendus une seule fois puis reutilises.

Le fichier .srt est ecrit a cote quand meme : pour YouTube, pour un montage ailleurs, et
parce qu'un sous-titre incruste ne se corrige plus.

Usage :
  python3 cine/sous-titrer.py <video> [sortie.mp4]
"""
import os
import shutil
import subprocess
import sys
import tempfile
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ── Les cartons. Chaque mot porte l'instant ou la voix l'attaque, releve sur le son.
#    `fin` est l'instant ou le carton s'efface. ───────────────────────────────────
CARTONS = [
    {"fin": 3.40, "lignes": [
        [('This', 0.21), ('is', 0.67), ('not', 0.98), ('free', 1.41), ('to', 2.08), ('play.', 2.35)],
    ]},
    {"fin": 5.95, "lignes": [
        [('You', 3.49), ('buy', 3.76), ('in.', 4.14), ('You', 4.86), ('run.', 5.17)],
    ]},
    {"fin": 9.40, "lignes": [
        [('You', 6.00), ('take', 6.24), ('it', 6.53), ('back,', 6.68), ('or', 7.39), ('you', 7.80), ("don't.", 8.16)],
    ]},
    # ── CES DEUX CARTONS ONT ETE REMESURES ──────────────────────────────────────
    # Le premier relevE les donnait a 10,00 et 12,81 s. Or il n'y a AUCUNE VOIX entre
    # 9,5 et 12 s : rien que de la musique. Le modele avait ferme le segment precedent
    # sur 10,000 pile — une valeur ronde, donc une bordure inventee, pas une mesure — et
    # reparti les mots suivants sur la plage vide. « 16 players » s'affichait ainsi plus
    # de deux secondes avant d'etre prononce.
    #
    # L'attaque a ete bornee au dixieme en transcrivant la meme fin avec un depart de
    # plus en plus tardif : a 13,4 s le modele entend encore « 16 », a 13,5 il entend
    # « Team » — le mot est deja entame. Les cinq mots suivants viennent d'une passe sur
    # la seule fenetre 13,3-16,8 s, trop serree pour qu'ils puissent s'y etaler.
    {"fin": 14.60, "lignes": [
        [('16', 13.45), ('players.', 13.80)],
    ]},
    {"fin": 16.90, "lignes": [
        [('Three', 14.66), ('rounds.', 15.04), ('One', 15.80), ('pot.', 16.15)],
    ]},
    {"fin": 20.95, "lignes": [
        [('Top', 16.98), ('eight', 17.12), ('keep', 17.31), ('their', 17.47), ('stake.', 17.66)],
        [('First', 18.00), ('takes', 18.74), ('four', 19.50), ('and', 19.82), ('a', 20.00),
         ('half', 20.06), ('times', 20.32), ('it.', 20.65)],
    ]},
    {"fin": 23.30, "lignes": [
        [('Sign', 21.00), ('up', 21.42), ('for', 21.67), ('early', 21.98), ('access', 22.47)],
    ]},
    {"fin": 26.95, "lignes": [
        [('Get', 23.34), ('5', 23.62), ('USDC', 24.02), ('and', 24.34), ('start', 24.65), ('playing.', 25.18)],
    ]},
]

# ── Apparence. Tout est en fraction de la HAUTEUR d'image : le meme reglage tient en
#    1080p, en 1440p et en vertical. ──────────────────────────────────────────────
POLICE = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"
CORPS = 0.046          # hauteur de police
MARGE_BAS = 0.075      # du bas de l'image au bas du texte
LARGEUR_UTILE = 0.82   # part de la largeur ou le texte peut s'etaler
LIGNES_MAX = 2         # hauteur de la bande : le carton le plus haut
BLANC = (255, 255, 255, 255)
# Le liserE reprend l'encre du jeu (#1b1030) plutot qu'un noir pur : sur les aplats
# satures de la piste, un contour noir decoupe la lettre, celui-ci la pose.
ENCRE = (27, 16, 48, 255)
OMBRE = (10, 6, 20, 150)


def sonde(video, champs):
    return subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", f"stream={champs}", "-of", "csv=p=0:s=,", video],
        capture_output=True, text=True, check=True).stdout.strip().split(",")


class Bande:
    """Rend la zone de sous-titres : une bande pleine largeur, texte cale en bas."""

    def __init__(self, largeur, hauteur):
        self.largeur = largeur
        self.corps = round(hauteur * CORPS)
        self.police = ImageFont.truetype(POLICE, self.corps)
        self.interligne = round(self.corps * 0.24)
        self.marge = round(self.corps * 0.6)     # loge le liserE et le flou de l'ombre
        self.trait = max(2, round(self.corps * 0.055))
        # Hauteur de ligne prise sur les METRIQUES de la police, pas sur la boite
        # d'encre : « 16 players. » et « Sign up » n'ont pas la meme boite, et deux
        # cartons successifs sautaient alors de quelques pixels.
        montee, descente = self.police.getmetrics()
        self.ligne_h = montee + descente
        self.hauteur = (self.ligne_h * LIGNES_MAX + self.interligne * (LIGNES_MAX - 1)
                        + self.marge * 2)
        self._mesure = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
        self.espace = self._mesure.textlength(" ", font=self.police)

    def poser(self, lignes):
        """Mise en page DEFINITIVE d'un carton : chaque mot recoit sa place une fois."""
        n = len(lignes)
        haut = self.hauteur - self.marge - n * self.ligne_h - (n - 1) * self.interligne
        places, large = [], 0
        for i, ligne in enumerate(lignes):
            larg = [self._mesure.textlength(m, font=self.police) for m, _ in ligne]
            total = sum(larg) + self.espace * (len(ligne) - 1)
            large = max(large, total + self.trait * 2)
            x = (self.largeur - total) / 2
            y = haut + i * (self.ligne_h + self.interligne)
            for (mot, debut), l in zip(ligne, larg):
                places.append((mot, debut, x, y))
                x += l + self.espace
        return places, large

    def image(self, places, chemin):
        """Dessine les mots deja prononces. `places` est deja filtre."""
        img = Image.new("RGBA", (self.largeur, self.hauteur), (0, 0, 0, 0))
        if places:
            # L'ombre est rendue a part puis floutee : c'est elle qui detache le texte
            # d'un fond clair. Le liserE seul suffit sur du sombre, pas sur du cyan.
            ombre = Image.new("RGBA", img.size, (0, 0, 0, 0))
            d_ombre, d = ImageDraw.Draw(ombre), ImageDraw.Draw(img)
            for mot, _, x, y in places:
                d_ombre.text((x, y + round(self.corps * 0.09)), mot, font=self.police,
                             fill=OMBRE, stroke_width=self.trait, stroke_fill=OMBRE)
                d.text((x, y), mot, font=self.police, fill=BLANC,
                       stroke_width=self.trait, stroke_fill=ENCRE)
            img = Image.alpha_composite(ombre.filter(ImageFilter.GaussianBlur(round(self.corps * 0.10))), img)
        img.save(chemin)


def srt(chemin):
    def code(t):
        h, r = divmod(t, 3600); m, s = divmod(r, 60)
        return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{round((s % 1) * 1000):03d}"
    with open(chemin, "w") as f:
        for i, c in enumerate(CARTONS, 1):
            debut = c["lignes"][0][0][1]
            texte = "\n".join(" ".join(m for m, _ in l) for l in c["lignes"])
            f.write(f"{i}\n{code(debut)} --> {code(c['fin'])}\n{texte}\n\n")


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    video = sys.argv[1]
    sortie = sys.argv[2] if len(sys.argv) > 2 else os.path.splitext(video)[0] + "-sous-titre.mp4"

    largeur, hauteur, cadence = sonde(video, "width,height,r_frame_rate")
    largeur, hauteur = int(largeur), int(hauteur)
    num, den = (int(v) for v in cadence.split("/"))
    fps = num / den
    duree = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video],
        capture_output=True, text=True, check=True).stdout.strip())
    images = round(duree * fps)

    bande = Bande(largeur, hauteur)
    print(f"{largeur}x{hauteur} a {fps:g} i/s, {images} images, {len(CARTONS)} cartons")

    # Mise en page une fois pour toutes ; on ne fera plus que filtrer par le temps.
    poses = []
    for c in CARTONS:
        places, large = bande.poser(c["lignes"])
        if large > largeur * LARGEUR_UTILE:
            print(f"  ATTENTION : « {places[0][0]}… » large de {round(large)} px, hors zone utile")
        poses.append((places, c["fin"]))

    dossier = tempfile.mkdtemp(prefix="sous-titres-")
    cache = {}
    for i in range(images):
        t = i / fps
        visibles, cle = (), None
        for k, (places, fin) in enumerate(poses):
            if places[0][1] <= t < fin:
                # Les mots d'un carton sont ranges par instant d'attaque : ceux qui sont
                # deja prononces forment donc toujours un PREFIXE. L'etat d'une image se
                # resume ainsi a deux entiers, ce qui rend le cache exact.
                n = sum(1 for _, debut, _, _ in places if debut <= t)
                visibles, cle = places[:n], (k, n)
                break
        chemin = os.path.join(dossier, f"{i + 1:05d}.png")
        # La plupart des images repetent l'etat de la precedente : on ne rend qu'une fois
        # chacun des ~57 etats, et on recopie.
        if cle in cache:
            shutil.copyfile(cache[cle], chemin)
        else:
            bande.image(visibles, chemin)
            cache[cle] = chemin
    print(f"  {len(cache)} etats distincts rendus pour {images} images")

    srt(os.path.splitext(sortie)[0] + ".srt")
    y = hauteur - bande.hauteur - round(hauteur * MARGE_BAS) + bande.marge
    subprocess.run(
        ["ffmpeg", "-v", "error", "-stats", "-y", "-i", video,
         "-framerate", f"{num}/{den}", "-i", os.path.join(dossier, "%05d.png"),
         "-filter_complex", f"[0:v][1:v]overlay=x=0:y={y}[v]",
         "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "slow", "-crf", "16",
         "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", "-shortest",
         sortie], check=True)
    shutil.rmtree(dossier, ignore_errors=True)
    print(f"\n→ {sortie}")
    print(f"→ {os.path.splitext(sortie)[0] + '.srt'}")


if __name__ == "__main__":
    main()
