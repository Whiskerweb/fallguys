using Fallguys.Rules;
using Xunit;

namespace Fallguys.Rules.Tests;

public class MatchConfigurationTests
{
    [Fact]
    public void Default_correspond_a_la_structure_de_reference_du_spec()
    {
        var config = MatchConfiguration.Default;
        Assert.Equal(16, config.PlayerCount);
        Assert.Equal(new[] { 8, 4, 1 }, config.RoundSurvivors);
        Assert.Equal(1500, config.RakeBasisPoints);
        Assert.Equal(3, config.RoundCount);
        Assert.Equal(8, config.RefundThreshold);
        Assert.Equal(4, config.FinalistCount);
    }

    [Theory]
    [InlineData(12, 6, 3)]
    [InlineData(24, 12, 6)]
    public void La_structure_tourne_a_12_et_24_joueurs(int players, int afterRound1, int finalists)
    {
        var config = new MatchConfiguration(players, new[] { afterRound1, finalists, 1 }, 1500, new[] { 35, 15, 5, 1, 1, 1 });
        config.Validate();
        Assert.Equal(afterRound1, config.RefundThreshold);
        Assert.Equal(finalists, config.FinalistCount);
    }

    [Fact]
    public void Validate_refuse_une_progression_non_decroissante()
    {
        var config = new MatchConfiguration(16, new[] { 4, 8, 1 }, 1500, new[] { 35, 15, 5, 1 });
        var ex = Assert.Throws<ArgumentException>(() => config.Validate());
        Assert.Contains("decroissante", ex.Message);
    }

    [Fact]
    public void Validate_refuse_une_derniere_manche_sans_vainqueur_unique()
    {
        var config = new MatchConfiguration(16, new[] { 8, 4, 2 }, 1500, new[] { 35, 15, 5, 1 });
        Assert.Throws<ArgumentException>(() => config.Validate());
    }

    [Fact]
    public void Validate_refuse_un_rake_qui_rend_le_remboursement_impossible()
    {
        var config = new MatchConfiguration(16, new[] { 8, 4, 1 }, 6000, new[] { 35, 15, 5, 1 });
        var ex = Assert.Throws<ArgumentException>(() => config.Validate());
        Assert.Contains("rake", ex.Message);
    }

    [Fact]
    public void Validate_refuse_des_poids_de_bonus_qui_ne_couvrent_pas_les_finalistes()
    {
        var config = new MatchConfiguration(16, new[] { 8, 4, 1 }, 1500, new[] { 35, 15 });
        Assert.Throws<ArgumentException>(() => config.Validate());
    }

    [Fact]
    public void StakeContext_Free_a_une_mise_nulle()
    {
        Assert.Equal(StakeTier.Free, StakeContext.Free.Tier);
        Assert.Equal(Money.Zero, StakeContext.Free.EntryFee);
    }
}
