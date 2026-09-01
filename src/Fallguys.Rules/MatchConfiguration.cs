namespace Fallguys.Rules;

/// <summary>
/// Forme d'une partie : combien de joueurs entrent, combien survivent à chaque manche,
/// quel rake s'applique, comment le bonus se répartit entre finalistes.
/// Tout est exprimé en nombres de survivants — jamais en constantes — pour que la même
/// structure tourne de 12 à 24 joueurs sans changement de code.
/// </summary>
public sealed record MatchConfiguration(
    int PlayerCount,
    IReadOnlyList<int> RoundSurvivors,
    int RakeBasisPoints,
    IReadOnlyList<int> FinalistBonusWeights)
{
    /// <summary>
    /// Structure de référence : 16 joueurs, 3 manches, rake 10 %.
    ///
    /// Les poids de bonus valent [40, 15, 7, 2] et non [35, 15, 5, 1] : ces derniers avaient
    /// été calibrés pour tomber sur des chiffres ronds à 15 % de rake. À 10 %, la même formule
    /// paie 2,714285 USDC au deuxième — un montant qu'on ne peut ni afficher ni défendre dans
    /// un jeu où l'on engage de l'argent réel. Les poids corrigés redonnent des montants exacts
    /// (5,00 / 2,50 / 1,70 / 1,20 à la table à 1 USDC) et un reste de division nul.
    ///
    /// Le rake et les poids forment un couple : réviser l'un sans l'autre produit des gains
    /// justes au centime près et illisibles à l'écran.
    /// </summary>
    public static MatchConfiguration Default { get; } =
        new(16, new[] { 8, 4, 1 }, 1000, new[] { 40, 15, 7, 2 });

    /// <summary>
    /// Combien de manches pour un effectif donné : chaque manche élimine environ la
    /// moitié, jusqu'au vainqueur. Plafonné à trois — au-delà, une partie devient longue
    /// sans devenir plus intéressante, et le spec en retient trois.
    /// </summary>
    public static int RoundsForPlayers(int players) =>
        Math.Clamp((int)Math.Ceiling(Math.Log2(Math.Max(2, players))), 1, 3);

    /// <summary>
    /// La configuration d'une partie à N joueurs.
    ///
    /// Le démarrage à froid — risque n°1 du spec — impose d'ouvrir des salons plus petits
    /// que seize : il faut seize joueurs vivants, prêts à miser le même montant, au même
    /// instant, et au premier jour il n'y en a aucun. Un salon réduit doit donc être payé
    /// selon SON effectif, pas selon un barème à seize qui promettrait un pot inexistant.
    ///
    /// Deux joueurs sont REFUSÉS, et ce n'est pas un oubli. Il faut au moins deux manches
    /// (<see cref="Validate"/>), donc <c>RoundSurvivors[0] &lt; 2</c> donc <c>= 1</c>, donc
    /// la manche suivante devrait laisser moins d'un joueur. C'est structurellement
    /// impossible. Un duel n'est pas une compétition à places : s'il faut en autoriser un,
    /// c'est une partie d'exhibition, hors table de gains — pas un barème de plus.
    /// </summary>
    public static MatchConfiguration ForPlayers(int players, int rakeBasisPoints = 1000)
    {
        if (players < 3)
            throw new ArgumentException(
                $"Une partie payante demande au moins 3 joueurs ; {players} demandé(s). " +
                "Un duel se joue hors table de gains.");

        var rounds = Math.Max(2, RoundsForPlayers(players));
        var survivors = new int[rounds];
        for (var i = 1; i < rounds; i++)
        {
            // `rounds - i + 1` garantit qu'il reste toujours assez de joueurs pour tenir
            // les manches suivantes : sans ce plancher, un petit effectif produirait une
            // suite non strictement décroissante, que Validate() refuserait.
            survivors[i - 1] = Math.Max(rounds - i + 1, players >> i);
        }
        survivors[rounds - 1] = 1;

        // Le nombre de finalistes dicte combien de poids de bonus sont utilisés ; on en
        // fournit toujours assez, en reprenant les premiers de la table de référence.
        var finalists = survivors[rounds - 2];
        var weights = new int[Math.Max(finalists, 4)];
        var reference = new[] { 40, 15, 7, 2 };
        for (var i = 0; i < weights.Length; i++) weights[i] = i < reference.Length ? reference[i] : 1;

        var config = new MatchConfiguration(players, survivors, rakeBasisPoints, weights);
        config.Validate();
        return config;
    }

    public int RoundCount => RoundSurvivors.Count;

    /// <summary>Rang au-delà duquel le joueur ne récupère plus sa mise : les survivants de la manche 1.</summary>
    public int RefundThreshold => RoundSurvivors[0];

    /// <summary>Nombre de joueurs qui entrent dans la dernière manche.</summary>
    public int FinalistCount => RoundSurvivors[RoundCount - 2];

    public void Validate()
    {
        if (PlayerCount < 2)
            throw new ArgumentException("PlayerCount doit valoir au moins 2.");

        if (RoundCount < 2)
            throw new ArgumentException("Une partie doit compter au moins 2 manches.");

        if (RoundSurvivors[0] >= PlayerCount)
            throw new ArgumentException("La manche 1 doit eliminer au moins un joueur.");

        for (var i = 1; i < RoundCount; i++)
        {
            if (RoundSurvivors[i] >= RoundSurvivors[i - 1])
                throw new ArgumentException(
                    $"La progression des survivants doit etre strictement decroissante (manche {i + 1}).");
        }

        if (RoundSurvivors[RoundCount - 1] != 1)
            throw new ArgumentException("La derniere manche doit designer un vainqueur unique.");

        if (RakeBasisPoints is < 0 or > 10_000)
            throw new ArgumentException("Le rake doit etre compris entre 0 et 10000 points de base.");

        // Rembourser les survivants de la manche 1 coute RefundThreshold / PlayerCount du pot.
        // Le rake ne doit pas rendre ce remboursement impossible.
        var refundShareBasisPoints = (long)RefundThreshold * 10_000L / PlayerCount;
        if (10_000L - RakeBasisPoints < refundShareBasisPoints)
            throw new ArgumentException(
                $"Le rake de {RakeBasisPoints} points de base ne laisse pas de quoi rembourser " +
                $"les {RefundThreshold} survivants de la manche 1.");

        if (FinalistBonusWeights.Count < FinalistCount)
            throw new ArgumentException(
                $"Il faut au moins {FinalistCount} poids de bonus pour {FinalistCount} finalistes.");

        if (FinalistBonusWeights.Take(FinalistCount).Any(w => w < 0))
            throw new ArgumentException("Les poids de bonus doivent etre positifs ou nuls.");

        if (FinalistBonusWeights.Take(FinalistCount).Sum() <= 0)
            throw new ArgumentException("La somme des poids de bonus doit etre strictement positive.");
    }
}
