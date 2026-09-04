using Fallguys.Rules;
using Xunit;

namespace Fallguys.Rules.Tests;

public class ForPlayersTests
{
    /// <summary>
    /// Deux joueurs restent refusés ICI, et la raison a changé : ce n'est plus « un duel
    /// est impossible » — <see cref="MatchMode.Duel"/> existe et paie ×1,8 — c'est que
    /// cette méthode DÉRIVE une pyramide d'un effectif, par moitiés successives, pour un
    /// salon de seize qui part à douze. Elle a besoin de deux manches ; un duel n'en a
    /// qu'une, et sa forme est posée à la main, pas calculée.
    ///
    /// La séparation est portante : l'échelle de 3 à 24 produite ici est comparée rang par
    /// rang aux deux ports JavaScript à chaque exécution. Y faire entrer le duel
    /// déplacerait 66 tables verrouillées.
    /// </summary>
    [Fact]
    public void Un_salon_reduit_a_deux_reste_refuse_le_duel_est_un_mode_pas_un_salon()
    {
        Assert.Throws<ArgumentException>(() => MatchConfiguration.ForPlayers(2));
        Assert.Throws<ArgumentException>(() => MatchConfiguration.ForPlayers(1));

        // Et pourtant un duel se joue, et se paie.
        var duel = PayoutPolicy.Compute(
            MatchMode.Duel.Config, StakeContext.Usdc(StakeTier.Micro, 2m));
        Assert.Equal(Money.FromUnits(3.60m), duel.ForRank(1));
    }

    [Theory]
    [InlineData(16, "8,4,1")]
    [InlineData(8, "4,2,1")]
    [InlineData(4, "2,1")]
    [InlineData(3, "2,1")]
    public void Reproduit_la_pyramide_attendue(int players, string attendu)
    {
        var c = MatchConfiguration.ForPlayers(players);
        Assert.Equal(attendu, string.Join(",", c.RoundSurvivors));
    }

    [Fact]
    public void Seize_joueurs_redonne_exactement_la_configuration_de_reference()
    {
        var c = MatchConfiguration.ForPlayers(16);
        var d = MatchConfiguration.Default;
        Assert.Equal(d.PlayerCount, c.PlayerCount);
        Assert.Equal(string.Join(",", d.RoundSurvivors), string.Join(",", c.RoundSurvivors));
        Assert.Equal(d.RakeBasisPoints, c.RakeBasisPoints);
    }

    [Fact]
    public void Toute_configuration_de_3_a_24_joueurs_est_valide_et_conserve_l_argent()
    {
        var mise = StakeContext.Usdc(StakeTier.Micro, 1m);
        for (var n = 3; n <= 24; n++)
        {
            var c = MatchConfiguration.ForPlayers(n);
            c.Validate();
            var t = PayoutPolicy.Compute(c, mise);
            Assert.Equal(t.Pot, t.TotalDistributed + t.Rake);
            Assert.Equal(n, t.PayoutByRank.Count);
            // Le rake vaut exactement 10 % du pot, tronqué vers le bas.
            Assert.Equal(mise.EntryFee.Micros * n / 10, t.Rake.Micros);
        }
    }

    /// <summary>
    /// Les MÊMES nombres que les deux implémentations JavaScript.
    ///
    /// `backend/src/gains.js` paie, `tools/feel-lab/src/economie.js` annonce, et ce
    /// fichier-ci fait foi. Trois implémentations d'une même règle dérivent toujours les
    /// unes des autres : les valeurs sont donc posées à la main, en micro-unités, telles
    /// qu'elles sortent des deux autres. Un écart signifie qu'un joueur verrait à l'écran
    /// un montant que le backend ne lui paiera pas.
    /// </summary>
    [Theory]
    [InlineData(3, 300_000, new long[] { 1_509_091, 1_190_909, 0 })]
    [InlineData(4, 400_000, new long[] { 2_163_637, 1_436_363, 0, 0 })]
    [InlineData(6, 600_000, new long[] { 2_745_455, 1_654_545, 1_000_000, 0 })]
    [InlineData(8, 800_000, new long[] { 3_327_273, 1_872_727, 1_000_000, 1_000_000 })]
    [InlineData(12, 1_200_000, new long[] { 4_096_775, 2_161_290, 1_541_935, 1_000_000 })]
    [InlineData(24, 2_400_000, new long[] { 6_818_184, 3_181_818, 2_018_181, 1_290_909 })]
    public void Donne_exactement_les_memes_montants_que_les_ports_JavaScript(
        int players, long rake, long[] premiersRangs)
    {
        var table = PayoutPolicy.Compute(
            MatchConfiguration.ForPlayers(players),
            StakeContext.Usdc(StakeTier.Micro, 1m));

        Assert.Equal(rake, table.Rake.Micros);
        for (var i = 0; i < premiersRangs.Length; i++)
            Assert.Equal(premiersRangs[i], table.ForRank(i + 1).Micros);
    }

    [Fact]
    public void Les_survivants_de_la_manche_1_recuperent_leur_mise_a_tout_effectif()
    {
        var mise = StakeContext.Usdc(StakeTier.Micro, 1m);
        for (var n = 3; n <= 24; n++)
        {
            var c = MatchConfiguration.ForPlayers(n);
            var t = PayoutPolicy.Compute(c, mise);
            for (var rank = 1; rank <= c.RefundThreshold; rank++)
                Assert.True(t.ForRank(rank) >= mise.EntryFee, $"{n} joueurs, rang {rank}");
        }
    }
}
