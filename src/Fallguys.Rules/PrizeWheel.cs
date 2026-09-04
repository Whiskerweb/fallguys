namespace Fallguys.Rules;

/// <summary>
/// Une ISSUE : une ligne du tableau des gains d'un mode.
///
/// <paramref name="Vingtiemes"/> donne, rang par rang, le gain en VINGTIÈMES DE LA MISE ;
/// <paramref name="Xp"/> donne, rang par rang, l'XP que la roue accorde à ceux qui ne
/// touchent pas d'argent — zéro partout ailleurs. STANDARD en arène vaut
/// [100, 50, 34, 24, 20, 20, 20, 20, 0…] : ×5,0 au vainqueur, ×2,5 au deuxième, la mise
/// rendue jusqu'au huitième.
///
/// Pourquoi des vingtièmes : des pas de 0,10 USDC à 2 USDC, assez fins pour que dix cases
/// portent dix montants distincts. Toute mise du catalogue est divisible par vingt en
/// micro-unités ; une mise qui ne le serait pas laisse son reste à la maison, jamais
/// l'inverse.
///
/// Le type garde son nom historique (<c>PrizeVariant</c>) : il est référencé par les tests
/// et par <see cref="PayoutPolicy"/>, et une issue EST une variante de barème — ce qui a
/// changé, c'est QUAND elle est tirée, et combien il y en a.
/// </summary>
public sealed record PrizeVariant(
    string Id,
    string Nom,
    int Poids,
    IReadOnlyList<int> Vingtiemes,
    IReadOnlyList<int> Xp);

/// <summary>Le palier d'un rang : ce que dit la roue avant de tourner.</summary>
public enum PrizeTier { Diamant, Or, Argent, Bronze }

/// <summary>Une case de la roue d'UN joueur : la ligne, son poids, ce qu'elle lui donne.</summary>
public sealed record WheelSlot(string Issue, int Poids, Money Gain, int Xp);

/// <summary>
/// LA ROUE. Elle TIRE, à la fin de la partie, la ligne du tableau qui paie.
///
/// ELLE TOURNAIT AVANT LE DÉPART, ET C'ÉTAIT UNE POSITION JURIDIQUE. La qualification
/// « compétition de skill » du spec (§ 5) tenait à ce qu'aucune machine ne décide de ce
/// qu'un joueur gagne une fois sa mise engagée. Le 2 septembre 2026 le directeur produit,
/// prévenu de ce point et de l'alternative « tirée avant, scellée, révélée après », a choisi
/// le tirage APRÈS la partie. C'est sa décision, consignée dans l'amendement du 2 septembre
/// de la spec ; aucun code d'ici ne la tranche, et la validation juridique reste en tête de
/// la liste d'avant-mainnet.
///
/// LE RAKE VARIE D'UNE LIGNE À L'AUTRE, ET VAUT 10 % EN MOYENNE. Une ligne distribue entre
/// 70 % et 100 % du pot — jamais plus : la maison ne sort jamais un centime. Pondérées par
/// leurs poids, les dix lignes distribuent EXACTEMENT 90 % du pot, et <see cref="Validate"/>
/// l'exige au vingtième près. C'est ce qui permet une case à 4,00 sur un duel à 2 USDC
/// (tout le pot au vainqueur) à côté d'une case à 2,60 ; à rake fixe, dix cases distinctes
/// n'existaient pas. Choix produit du 2 septembre 2026.
///
/// « Passe la manche 1, tu récupères ta mise » survit à toutes les lignes ; un bronze ne
/// gagne jamais plus que sa mise. UNE ROUE PAR JOUEUR : la colonne de son rang, dix cases
/// de tailles proportionnelles aux poids. La taille d'une case EST sa probabilité.
/// </summary>
public static class PrizeWheel
{
    private const int Total = 10_000;

    /// <summary>Une mise se découpe en vingtièmes : un gain s'écrit `mise × vingtièmes / 20`.</summary>
    public const int Vingtiemes = 20;

    /// <summary>Dix cases par roue : une promesse produit, que <see cref="Validate"/> exige.</summary>
    public const int SlotsPerWheel = 10;

    /// <summary>Étale une ligne d'arène : les huit payés, zéro partout, puis la mise rendue à un bronze.</summary>
    private static int[] Etaler(int joueurs, int[] payes, int rembourse = 0)
    {
        var d = new int[joueurs];
        for (var i = 0; i < payes.Length; i++) d[i] = payes[i];
        if (rembourse > 0) d[rembourse - 1] = Vingtiemes;
        return d;
    }

    /// <summary>L'XP des rangs qui ne touchent rien : zéro là où il y a de l'argent, la valeur ailleurs.</summary>
    private static int[] XpDe(int[] vingtiemes, int seuil, int[] valeurs)
    {
        var xp = new int[vingtiemes.Length];
        for (var i = seuil; i < vingtiemes.Length; i++)
            xp[i] = vingtiemes[i] > 0 ? 0 : (i - seuil < valeurs.Length ? valeurs[i - seuil] : 0);
        return xp;
    }

    private static PrizeVariant Issue(string id, string nom, int poids, int[] vingtiemes, int seuil, int[] xp) =>
        new(id, nom, poids, vingtiemes, XpDe(vingtiemes, seuil, xp));

    /// <summary>
    /// L'arène : 320 vingtièmes de pot, 288 en moyenne. STANDARD reste, au centime près, la
    /// table historique du dépôt. Les quatre premiers ont dix montants distincts ; huit
    /// lignes sur dix rendent sa mise à UN bronze, du 9e (14 %) au 16e (4 %). JACKPOT
    /// paie ×7,9 au vainqueur : la maison ne garde que 6 % sur cette ligne.
    /// </summary>
    private static readonly PrizeVariant[] Arena =
    {
        Issue("plat",      "FLAT",      600, Etaler(16, new[] { 50, 44, 38, 30, 26, 24, 23, 21 }, 15),  8, new[] { 60, 55, 50, 45, 40, 35, 30, 25 }),
        Issue("doux",      "SOFT",      900, Etaler(16, new[] { 62, 45, 35, 27, 25, 23, 22, 21 }, 13),  8, new[] { 80, 70, 60, 50, 45, 40, 35, 30 }),
        Issue("partage",   "SHARE",    1200, Etaler(16, new[] { 70, 51, 31, 26, 23, 22, 21, 20 }, 11),  8, new[] { 50, 45, 40, 35, 30, 25, 20, 15 }),
        Issue("equilibre", "BALANCE",  1400, Etaler(16, new[] { 82, 47, 29, 25, 22, 21, 20, 20 }, 10),  8, new[] { 100, 90, 80, 70, 60, 50, 40, 30 }),
        Issue("standard",  "STANDARD", 2200, Etaler(16, new[] { 100, 50, 34, 24, 20, 20, 20, 20 }),     8, new[] { 40, 35, 30, 25, 20, 20, 15, 15 }),
        Issue("podium",    "PODIUM",   1400, Etaler(16, new[] { 102, 39, 26, 23, 20, 20, 20, 20 }, 9),  8, new[] { 70, 60, 50, 45, 40, 35, 30, 25 }),
        Issue("pointu",    "SHARP",    1000, Etaler(16, new[] { 116, 33, 24, 21, 20, 20, 20, 20 }, 12), 8, new[] { 45, 40, 35, 30, 25, 20, 20, 15 }),
        Issue("couronne",  "CROWN",     700, Etaler(16, new[] { 125, 28, 23, 20, 20, 20, 20, 20 }, 14), 8, new[] { 120, 100, 80, 70, 60, 50, 40, 30 }),
        Issue("royale",    "ROYAL",     400, Etaler(16, new[] { 131, 26, 22, 22, 20, 20, 20, 20 }, 16), 8, new[] { 90, 80, 70, 60, 50, 40, 30, 20 }),
        Issue("jackpot",   "JACKPOT",   200, Etaler(16, new[] { 158, 22, 20, 20, 20, 20, 20, 20 }),     8, new[] { 150, 130, 110, 90, 70, 50, 30, 20 }),
    };

    /// <summary>
    /// Quatre joueurs, deux places payées, dix montants distincts pour chacune. Le vainqueur
    /// va de ×1,5 à ×3,0 ; deux lignes rendent une part de mise à un bronze.
    /// </summary>
    private static readonly PrizeVariant[] Squad =
    {
        Issue("plat",      "FLAT",      600, new[] { 30, 24, 0, 13 }, 2, new[] { 40, 30 }),
        Issue("doux",      "SOFT",      900, new[] { 33, 21, 13, 0 }, 2, new[] { 50, 45 }),
        Issue("partage",   "SHARE",    1200, new[] { 37, 33, 0, 0 },  2, new[] { 30, 25 }),
        Issue("equilibre", "BALANCE",  1400, new[] { 41, 31, 0, 0 },  2, new[] { 60, 50 }),
        Issue("standard",  "STANDARD", 2200, new[] { 50, 22, 0, 0 },  2, new[] { 25, 20 }),
        Issue("podium",    "PODIUM",   1400, new[] { 45, 27, 0, 0 },  2, new[] { 45, 35 }),
        Issue("pointu",    "SHARP",    1000, new[] { 48, 26, 0, 0 },  2, new[] { 35, 25 }),
        Issue("couronne",  "CROWN",     700, new[] { 52, 25, 0, 0 },  2, new[] { 80, 60 }),
        Issue("royale",    "ROYAL",     400, new[] { 56, 23, 0, 0 },  2, new[] { 100, 70 }),
        Issue("jackpot",   "JACKPOT",   200, new[] { 60, 20, 0, 0 },  2, new[] { 150, 100 }),
    };

    /// <summary>
    /// Le duel : dix montants distincts pour le vainqueur, de ×1,3 à ×2,0 — JACKPOT lui donne
    /// le pot entier. Le perdant récupère une part de sa mise sur les trois lignes basses.
    /// </summary>
    private static readonly PrizeVariant[] Duel =
    {
        Issue("plat",      "FLAT",      600, new[] { 26, 7 }, 1, new[] { 0 }),
        Issue("doux",      "SOFT",      900, new[] { 28, 8 }, 1, new[] { 0 }),
        Issue("partage",   "SHARE",    1200, new[] { 30, 8 }, 1, new[] { 0 }),
        Issue("equilibre", "BALANCE",  1400, new[] { 35, 0 }, 1, new[] { 40 }),
        Issue("standard",  "STANDARD", 2200, new[] { 36, 0 }, 1, new[] { 20 }),
        Issue("podium",    "PODIUM",   1400, new[] { 37, 0 }, 1, new[] { 30 }),
        Issue("pointu",    "SHARP",    1000, new[] { 32, 0 }, 1, new[] { 25 }),
        Issue("couronne",  "CROWN",     700, new[] { 38, 0 }, 1, new[] { 60 }),
        Issue("royale",    "ROYAL",     400, new[] { 39, 0 }, 1, new[] { 80 }),
        Issue("jackpot",   "JACKPOT",   200, new[] { 40, 0 }, 1, new[] { 150 }),
    };

    /// <summary>
    /// Le catalogue, par identifiant de mode. L'ORDRE DES ISSUES EST PORTANT : le tirage
    /// parcourt les poids cumulés dans cet ordre. Réordonner cette liste change la ligne
    /// que rend chaque graine, donc ce que des parties déjà réglées auraient payé.
    /// </summary>
    public static IReadOnlyList<PrizeVariant> For(MatchMode mode) => mode.Id switch
    {
        "duel" => Duel,
        "squad" => Squad,
        "arena" => Arena,
        _ => throw new ArgumentException($"aucune roue pour le mode « {mode.Id} »"),
    };

    /// <summary>
    /// Le PALIER d'un rang. Arène : ◆ 1 · ★ 2-4 · ● 5-8 · ○ 9-16. Squad : ◆ 1 · ★ 2 · ○ 3-4.
    /// Duel : ◆ 1 · ○ 2.
    /// </summary>
    public static PrizeTier TierOf(MatchMode mode, int rank)
    {
        var seuil = mode.Config.RefundThreshold;
        if (rank == 1) return PrizeTier.Diamant;
        if (rank > seuil) return PrizeTier.Bronze;
        return rank <= Math.Max(2, seuil / 2.0) ? PrizeTier.Or : PrizeTier.Argent;
    }

    /// <summary>
    /// Vérifie qu'un catalogue est payable : dix lignes, aucune au-dessus du pot ni sous
    /// 70 %, poids à 100 %, 90 % du pot distribués EN MOYENNE au vingtième près, aucun
    /// rang qualifié sous sa mise, pyramide dans la bande payée, jamais plus que la mise
    /// au-delà, de l'XP exactement là où il n'y a pas d'argent.
    /// </summary>
    public static void Validate(MatchMode mode)
    {
        var catalogue = For(mode);
        var joueurs = mode.PlayerCount;
        var seuil = mode.Config.RefundThreshold;
        var pot = Vingtiemes * joueurs;
        var poids = 0;
        long pondere = 0;

        if (catalogue.Count != SlotsPerWheel)
            throw new ArgumentException($"« {mode.Id} » a {catalogue.Count} issues : une roue en a {SlotsPerWheel}.");

        foreach (var v in catalogue)
        {
            if (v.Vingtiemes.Count != joueurs || v.Xp.Count != joueurs)
                throw new ArgumentException($"« {v.Id} » donne {v.Vingtiemes.Count} rangs pour {joueurs} joueurs.");

            var somme = v.Vingtiemes.Sum();
            if (somme > pot)
                throw new ArgumentException($"« {v.Id} » distribue {somme} vingtièmes pour un pot de {pot} : la maison paierait.");
            if (somme * 10 < pot * 7)
                throw new ArgumentException($"« {v.Id} » ne distribue que {somme} vingtièmes sur {pot} : sous 70 % du pot.");
            if (v.Vingtiemes.Any(d => d < 0))
                throw new ArgumentException($"« {v.Id} » porte un gain négatif.");

            for (var rang = 1; rang <= seuil; rang++)
                if (v.Vingtiemes[rang - 1] < Vingtiemes)
                    throw new ArgumentException($"« {v.Id} » paie le rang {rang} sous sa mise alors qu'il a passé la manche 1.");

            for (var i = 1; i < seuil; i++)
                if (v.Vingtiemes[i] > v.Vingtiemes[i - 1])
                    throw new ArgumentException($"« {v.Id} » paie le rang {i + 1} plus que le rang {i}.");

            for (var i = seuil; i < joueurs; i++)
            {
                if (v.Vingtiemes[i] > Vingtiemes)
                    throw new ArgumentException($"« {v.Id} » paie le rang {i + 1} plus que sa mise sans l'avoir gagnée.");
                if ((v.Vingtiemes[i] == 0) != (v.Xp[i] > 0))
                    throw new ArgumentException($"« {v.Id} » : le rang {i + 1} doit gagner de l'XP exactement quand il ne gagne pas d'argent.");
            }
            if (v.Xp.Take(seuil).Any(x => x != 0))
                throw new ArgumentException($"« {v.Id} » donne de l'XP de roue à un rang payé.");

            poids += v.Poids;
            pondere += (long)v.Poids * somme;
        }

        if (poids != Total)
            throw new ArgumentException($"les poids de « {mode.Id} » font {poids} points de base au lieu de {Total}.");

        // LE RAKE VAUT 10 % EN MOYENNE, EXACTEMENT.
        var attendu = (long)Total * (pot - pot * mode.Config.RakeBasisPoints / Total);
        if (pondere != attendu)
            throw new ArgumentException(
                $"« {mode.Id} » distribue {pondere / (double)Total} vingtièmes en moyenne au lieu de {attendu / (double)Total}.");
    }

    /// <summary>
    /// Mélangeur d'entier 32 bits (finaliseur « lowbias32 »), en arithmétique non signée
    /// qui déborde silencieusement. Sans état, cinq opérations, et le même entier en C#,
    /// en JavaScript et en SQL.
    /// </summary>
    public static uint Hash32(uint graine)
    {
        var x = graine;
        x ^= x >> 16;
        x *= 0x7feb352du;
        x ^= x >> 15;
        x *= 0x846ca68bu;
        x ^= x >> 16;
        return x;
    }

    /// <summary>
    /// L'issue d'une partie, tirée de sa graine de roue — celle que le serveur de jeu tire
    /// au hasard cryptographique au classement final. Déterministe à partir de là.
    /// </summary>
    public static PrizeVariant Draw(MatchMode mode, uint graine)
    {
        var catalogue = For(mode);
        var tirage = (int)(Hash32(graine) % Total);
        var cumul = 0;
        foreach (var v in catalogue)
        {
            cumul += v.Poids;
            if (tirage < cumul) return v;
        }
        return catalogue[^1];
    }

    /// <summary>La table des gains d'un mode et d'une issue, pour une mise donnée.</summary>
    public static PayoutTable PayoutFor(MatchMode mode, string issueId, StakeContext stake) =>
        PayoutPolicy.Compute(mode.Config, stake, ById(mode, issueId));

    /// <summary>
    /// LA ROUE D'UN JOUEUR : la colonne de son rang, dix cases. Chaque case porte le gain
    /// de ce rang dans une issue, l'XP si l'issue ne lui donne pas d'argent, et le poids
    /// de l'issue — qui est la TAILLE de la case.
    /// </summary>
    public static IReadOnlyList<WheelSlot> WheelFor(MatchMode mode, int rank, StakeContext stake)
    {
        if (rank < 1 || rank > mode.PlayerCount)
            throw new ArgumentException($"rang {rank} hors bornes (1..{mode.PlayerCount}) en {mode.Id}");
        return For(mode)
            .Select(v => new WheelSlot(v.Id, v.Poids, PayoutFor(mode, v.Id, stake).ForRank(rank), v.Xp[rank - 1]))
            .ToList();
    }

    /// <summary>
    /// L'ESPÉRANCE par rang : la moyenne des dix lignes pondérée par leurs poids, tronquée
    /// au micro — ce que le ticket annonce quand rien n'est encore tiré.
    /// </summary>
    public static IReadOnlyList<Money> ExpectedFor(MatchMode mode, StakeContext stake)
    {
        var attendus = new long[mode.PlayerCount];
        foreach (var v in For(mode))
        {
            var t = PayoutFor(mode, v.Id, stake);
            for (var r = 1; r <= mode.PlayerCount; r++) attendus[r - 1] += t.ForRank(r).Micros * v.Poids;
        }
        return attendus.Select(a => new Money(a / Total)).ToList();
    }

    /// <summary>Retrouve une issue par son identifiant, et refuse l'inconnue.</summary>
    public static PrizeVariant ById(MatchMode mode, string id)
    {
        var v = For(mode).FirstOrDefault(x => x.Id == id);
        if (v is null)
            throw new ArgumentException($"issue inconnue « {id} » pour le mode « {mode.Id} ».");
        return v;
    }
}
