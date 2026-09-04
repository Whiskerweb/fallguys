namespace Fallguys.Rules;

/// <summary>
/// Payouts gradués. Règle unique, et elle survit aux deux chemins ci-dessous : les
/// survivants de la manche 1 récupèrent leur mise, et ce qui reste après le rake va au
/// haut de tableau. Ce choix place le seuil de non-perte exactement à la fin de la
/// première manche — c'est l'amortisseur du « mur des 95 % de perdants » du spec.
///
/// DEUX CHEMINS, ET ILS NE SERVENT PAS À LA MÊME CHOSE :
///
///   • avec une <see cref="PrizeVariant"/> — les trois modes ouverts au public. Le barème
///     est posé à la main, tiré par la roue avant le départ, exact par construction.
///   • avec des poids — les SALONS RÉDUITS, un lobby de seize qui part à douze. Personne
///     n'a choisi cette forme, elle est calculée depuis l'effectif.
///
/// Les deux doivent boucler : pot = distribué + rake, toujours.
/// </summary>
public static class PayoutPolicy
{
    /// <summary>
    /// Payouts d'une partie à MODE DÉCLARÉ : le barème vient de la roue, pas des poids.
    ///
    /// C'est ce chemin-ci que suivent les trois modes ouverts au public. La variante donne
    /// directement le gain de chaque rang en dixièmes de mise, donc il n'y a rien à
    /// répartir au prorata et rien à arrondir : la somme vaut 90 % du pot par construction
    /// (<see cref="PrizeWheel.Validate"/>), pas par chance.
    ///
    /// L'autre surcharge, à poids, reste la seule pour les SALONS RÉDUITS — un lobby de
    /// seize qui part à douze n'a pas de variante, sa forme est calculée.
    /// </summary>
    public static PayoutTable Compute(MatchConfiguration config, StakeContext stake, PrizeVariant variant)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(stake);
        ArgumentNullException.ThrowIfNull(variant);
        config.Validate();

        if (variant.Vingtiemes.Count != config.PlayerCount)
            throw new ArgumentException(
                $"l'issue « {variant.Id} » donne {variant.Vingtiemes.Count} rangs " +
                $"pour {config.PlayerCount} joueurs.");

        var pot = stake.EntryFee * config.PlayerCount;

        /*
         * LE RAKE EST CE QUI RESTE. Une issue distribue entre 70 % et 100 % du pot (voir
         * PrizeWheel.Validate) ; la maison garde le complément — 10 % en moyenne sur les
         * dix lignes, jamais négatif. Le reste de division entière d'une mise qui ne serait
         * pas divisible par vingt va à la maison, jamais l'inverse : aucune ligne ne peut
         * faire sortir un micro de la caisse.
         */
        var payouts = new Money[config.PlayerCount];
        var allocated = Money.Zero;
        for (var i = 0; i < config.PlayerCount; i++)
        {
            payouts[i] = new Money(stake.EntryFee.Micros * variant.Vingtiemes[i] / PrizeWheel.Vingtiemes);
            allocated += payouts[i];
        }
        var rake = pot - allocated;

        return new PayoutTable(pot, rake, payouts);
    }

    /// <summary>
    /// Payouts d'un SALON RÉDUIT : la forme est calculée depuis l'effectif, le bonus est
    /// réparti au prorata de poids. C'est l'échelle de 3 à 24 joueurs, verrouillée rang
    /// par rang contre `backend/src/gains.js` et `tools/feel-lab/src/economie.js`.
    /// </summary>
    public static PayoutTable Compute(MatchConfiguration config, StakeContext stake)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(stake);
        config.Validate();

        var pot = stake.EntryFee * config.PlayerCount;
        var rake = pot.MultiplyByBasisPoints(config.RakeBasisPoints);
        var distributable = pot - rake;

        var payouts = new Money[config.PlayerCount];
        Array.Fill(payouts, Money.Zero);

        // 1. Remboursement de la mise aux survivants de la manche 1.
        for (var rank = 1; rank <= config.RefundThreshold; rank++)
            payouts[rank - 1] = stake.EntryFee;

        var refundTotal = stake.EntryFee * config.RefundThreshold;
        var bonusPool = distributable - refundTotal;

        // 2. Répartition du bonus entre finalistes, au prorata des poids.
        var finalistCount = config.FinalistCount;
        var weights = config.FinalistBonusWeights.Take(finalistCount).ToArray();
        var weightSum = weights.Sum();

        var allocated = Money.Zero;
        for (var i = 0; i < finalistCount; i++)
        {
            var share = new Money(bonusPool.Micros * weights[i] / weightSum);
            payouts[i] += share;
            allocated += share;
        }

        // 3. Le reste de division entière revient au vainqueur : aucune unité ne se perd.
        var remainder = bonusPool - allocated;
        if (remainder.Micros != 0)
            payouts[0] += remainder;

        return new PayoutTable(pot, rake, payouts);
    }
}
