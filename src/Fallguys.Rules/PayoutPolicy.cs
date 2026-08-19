namespace Fallguys.Rules;

/// <summary>
/// Payouts gradués. Règle unique : les survivants de la manche 1 récupèrent leur mise,
/// et ce qui reste après le rake est réparti en bonus entre les finalistes.
/// Ce choix place le seuil de non-perte exactement à la fin de la première manche —
/// c'est l'amortisseur du "mur des 95 % de perdants" décrit dans le spec.
/// </summary>
public static class PayoutPolicy
{
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
