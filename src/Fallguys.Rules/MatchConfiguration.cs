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
