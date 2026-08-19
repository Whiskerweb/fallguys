using Fallguys.Rules;
using Xunit;

namespace Fallguys.Rules.Tests;

public class PayoutPolicyTests
{
    private static readonly StakeContext OneDollar = StakeContext.Usdc(StakeTier.Micro, 1m);

    [Fact]
    public void Reproduit_exactement_la_table_de_reference_du_spec()
    {
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, OneDollar);

        Assert.Equal(Money.FromUnits(16m), table.Pot);
        Assert.Equal(Money.FromUnits(2.40m), table.Rake);

        Assert.Equal(Money.FromUnits(4.50m), table.ForRank(1));
        Assert.Equal(Money.FromUnits(2.50m), table.ForRank(2));
        Assert.Equal(Money.FromUnits(1.50m), table.ForRank(3));
        Assert.Equal(Money.FromUnits(1.10m), table.ForRank(4));

        for (var rank = 5; rank <= 8; rank++)
            Assert.Equal(Money.FromUnits(1m), table.ForRank(rank));

        for (var rank = 9; rank <= 16; rank++)
            Assert.Equal(Money.Zero, table.ForRank(rank));
    }

    [Fact]
    public void Invariant_monetaire_aucune_unite_creee_ni_perdue()
    {
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, OneDollar);
        Assert.Equal(table.Pot, table.TotalDistributed + table.Rake);
    }

    [Theory]
    [InlineData(0.25)]
    [InlineData(1)]
    [InlineData(5)]
    [InlineData(0.37)]
    public void Invariant_monetaire_tient_pour_toute_mise(decimal units)
    {
        var stake = StakeContext.Usdc(StakeTier.Micro, units);
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, stake);
        Assert.Equal(table.Pot, table.TotalDistributed + table.Rake);
    }

    [Theory]
    [InlineData(12, 6, 3)]
    [InlineData(24, 12, 6)]
    public void Invariant_monetaire_tient_a_12_et_24_joueurs(int players, int afterRound1, int finalists)
    {
        var config = new MatchConfiguration(players, new[] { afterRound1, finalists, 1 }, 1500, new[] { 35, 15, 5, 1, 1, 1 });
        var table = PayoutPolicy.Compute(config, OneDollar);
        Assert.Equal(table.Pot, table.TotalDistributed + table.Rake);
        Assert.Equal(players, table.PayoutByRank.Count);
    }

    [Fact]
    public void Les_survivants_de_la_manche_1_recuperent_au_moins_leur_mise()
    {
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, OneDollar);
        for (var rank = 1; rank <= MatchConfiguration.Default.RefundThreshold; rank++)
            Assert.True(table.ForRank(rank) >= OneDollar.EntryFee, $"rang {rank}");
    }

    [Fact]
    public void Les_gains_sont_strictement_decroissants_chez_les_finalistes()
    {
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, OneDollar);
        for (var rank = 1; rank < MatchConfiguration.Default.FinalistCount; rank++)
            Assert.True(table.ForRank(rank) > table.ForRank(rank + 1), $"rang {rank}");
    }

    [Fact]
    public void Mode_gratuit_ne_distribue_rien_et_ne_prend_aucun_rake()
    {
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, StakeContext.Free);
        Assert.Equal(Money.Zero, table.Pot);
        Assert.Equal(Money.Zero, table.Rake);
        Assert.Equal(Money.Zero, table.TotalDistributed);
        Assert.All(table.PayoutByRank, m => Assert.Equal(Money.Zero, m));
    }

    [Fact]
    public void Compute_valide_la_configuration_recue()
    {
        var invalide = new MatchConfiguration(16, new[] { 8, 4, 2 }, 1500, new[] { 35, 15, 5, 1 });
        Assert.Throws<ArgumentException>(() => PayoutPolicy.Compute(invalide, OneDollar));
    }

    [Fact]
    public void ForRank_rejette_un_rang_hors_bornes()
    {
        var table = PayoutPolicy.Compute(MatchConfiguration.Default, OneDollar);
        Assert.Throws<ArgumentOutOfRangeException>(() => table.ForRank(0));
        Assert.Throws<ArgumentOutOfRangeException>(() => table.ForRank(17));
    }
}
