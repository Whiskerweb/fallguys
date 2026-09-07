using Fallguys.Rules;
using Xunit;

namespace Fallguys.Rules.Tests;

/// <summary>
/// Les trois formes de partie ouvertes au public. Valeurs posées à la main.
/// </summary>
public class MatchModeTests
{
    [Fact]
    public void Les_trois_modes_ont_la_forme_annoncee_dans_le_lobby()
    {
        Assert.Equal(2,  MatchMode.Duel.PlayerCount);
        Assert.Equal(1,  MatchMode.Duel.RoundCount);
        Assert.Equal("1", string.Join(",", MatchMode.Duel.Config.RoundSurvivors));

        Assert.Equal(4,    MatchMode.Squad.PlayerCount);
        Assert.Equal(2,    MatchMode.Squad.RoundCount);
        Assert.Equal("2,1", string.Join(",", MatchMode.Squad.Config.RoundSurvivors));

        Assert.Equal(16,     MatchMode.Arena.PlayerCount);
        Assert.Equal(3,      MatchMode.Arena.RoundCount);
        Assert.Equal("8,4,1", string.Join(",", MatchMode.Arena.Config.RoundSurvivors));
    }

    [Fact]
    public void L_arene_EST_la_configuration_de_reference_pas_une_copie()
    {
        // Même instance : un réglage ne peut pas s'appliquer à l'une sans l'autre.
        Assert.Same(MatchConfiguration.Default, MatchMode.Arena.Config);
    }

    [Fact]
    public void Les_trois_configurations_sont_valides()
    {
        foreach (var m in MatchMode.All) m.Config.Validate();
    }

    /// <summary>
    /// Le duel tient en une manche, et c'est la seule forme de partie qui le puisse.
    /// Trois joueurs en une manche n'ont pas de deuxième place à départager.
    /// </summary>
    [Fact]
    public void Une_manche_unique_n_est_admise_qu_a_deux_joueurs()
    {
        new MatchConfiguration(2, new[] { 1 }, 1000, new[] { 1 }).Validate();

        Assert.Throws<ArgumentException>(() =>
            new MatchConfiguration(4, new[] { 1 }, 1000, new[] { 1 }).Validate());
        Assert.Throws<ArgumentException>(() =>
            new MatchConfiguration(16, new[] { 1 }, 1000, new[] { 40, 15, 7, 2 }).Validate());
    }

    /// <summary>
    /// Le duel se paie sans une ligne de code de plus : le seul survivant de la manche 1
    /// récupère sa mise, puis prend tout le bonus. La règle fondatrice y dégénère bien.
    /// </summary>
    [Theory]
    [InlineData(2,   3.60)]
    [InlineData(5,   9.00)]
    [InlineData(10, 18.00)]
    public void Le_duel_paie_1_8_au_vainqueur_par_les_deux_chemins(decimal mise, decimal gain)
    {
        var stake = StakeContext.Usdg(StakeTier.Micro, mise);

        // Chemin des poids (celui des salons réduits) …
        var poids = PayoutPolicy.Compute(MatchMode.Duel.Config, stake);
        Assert.Equal(Money.FromUnits(gain), poids.ForRank(1));
        Assert.Equal(Money.Zero, poids.ForRank(2));

        // … et chemin de la roue : le même montant, sinon le lobby mentirait.
        var roue = PrizeWheel.PayoutFor(MatchMode.Duel, "standard", stake);
        Assert.Equal(poids.ForRank(1), roue.ForRank(1));
        Assert.Equal(poids.ForRank(2), roue.ForRank(2));
        Assert.Equal(poids.Rake, roue.Rake);
    }

    /// <summary>
    /// `ForPlayers` continue de refuser deux joueurs, et ce n'est pas une contradiction :
    /// il DÉRIVE une pyramide d'un effectif, pour un salon de seize qui part à douze.
    /// Le duel n'est pas un salon réduit, c'est un mode déclaré.
    /// </summary>
    [Fact]
    public void Un_salon_reduit_a_deux_reste_refuse_meme_si_le_duel_existe()
    {
        Assert.Throws<ArgumentException>(() => MatchConfiguration.ForPlayers(2));
        Assert.Throws<ArgumentException>(() => MatchConfiguration.ForPlayers(1));
        Assert.Equal(2, MatchMode.Duel.PlayerCount);   // et pourtant il se joue
    }

    [Fact]
    public void Les_mises_ouvertes_sont_2_5_et_10_USDG()
    {
        // Doublé à l'identique dans les deux ports JavaScript (`PALIERS`).
        Assert.Equal(new[] { 2m, 5m, 10m }, MatchMode.StakeTiers);
    }

    [Fact]
    public void Un_mode_inconnu_est_refuse_clairement()
    {
        Assert.Throws<ArgumentException>(() => MatchMode.ById("squads"));
        Assert.Equal("duel",  MatchMode.ById("duel").Id);
        Assert.Equal("squad", MatchMode.ById("squad").Id);
        Assert.Equal("arena", MatchMode.ById("arena").Id);
    }

    /// <summary>
    /// L'ordre du sélecteur du lobby : du plus court au plus long. Il est affiché tel
    /// quel, donc il est testé.
    /// </summary>
    [Fact]
    public void Les_modes_sont_ordonnes_du_plus_court_au_plus_long()
    {
        Assert.Equal(new[] { "duel", "squad", "arena" }, MatchMode.All.Select(m => m.Id));
        for (var i = 1; i < MatchMode.All.Count; i++)
            Assert.True(MatchMode.All[i].PlayerCount > MatchMode.All[i - 1].PlayerCount);
    }

    /// <summary>
    /// Les neuf tables ouvertes au public bouclent toutes, dans toutes leurs variantes.
    /// </summary>
    [Fact]
    public void Les_neuf_tables_ouvertes_conservent_l_argent()
    {
        var comptees = 0;
        foreach (var mode in MatchMode.All)
        foreach (var mise in MatchMode.StakeTiers)
        {
            var stake = StakeContext.Usdg(StakeTier.Micro, mise);
            foreach (var v in PrizeWheel.For(mode))
            {
                var t = PayoutPolicy.Compute(mode.Config, stake, v);
                Assert.Equal(t.Pot, t.TotalDistributed + t.Rake);
                Assert.Equal(mode.PlayerCount, t.PayoutByRank.Count);
            }
            comptees++;
        }
        Assert.Equal(9, comptees);
    }
}
