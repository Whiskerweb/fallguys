namespace Fallguys.Rules;

/// <summary>
/// Résultat du calcul de payouts pour une configuration et une mise données.
/// <paramref name="PayoutByRank"/> est indexé à partir de 0 pour le rang 1.
/// </summary>
public sealed record PayoutTable(Money Pot, Money Rake, IReadOnlyList<Money> PayoutByRank)
{
    /// <summary>Gain du rang donné (1 = vainqueur).</summary>
    public Money ForRank(int rank)
    {
        if (rank < 1 || rank > PayoutByRank.Count)
            throw new ArgumentOutOfRangeException(nameof(rank), rank,
                $"Rang attendu entre 1 et {PayoutByRank.Count}.");
        return PayoutByRank[rank - 1];
    }

    public Money TotalDistributed =>
        PayoutByRank.Aggregate(Money.Zero, static (sum, m) => sum + m);
}
