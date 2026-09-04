using Fallguys.Rules;
using Xunit;

namespace Fallguys.Rules.Tests;

/// <summary>
/// La roue : dix issues par mode, le tirage qui en désigne une à la FIN de la partie, et la
/// roue de chaque rang.
///
/// Les valeurs sont POSÉES À LA MAIN. Celles du mélangeur, des tirages et des espérances
/// ont été calculées par une implémentation indépendante (un script Python) et non par le
/// code testé : c'est ce qui rend le verrou utile. Si un jour ces constantes changent, ce
/// n'est pas le test qui a tort — c'est que le mélangeur ou l'ordre du catalogue a bougé,
/// et avec lui ce que des parties déjà réglées auraient payé.
/// </summary>
public class PrizeWheelTests
{
    [Fact]
    public void Chaque_catalogue_est_payable()
    {
        // Dix lignes, aucune au-dessus du pot, 90 % en moyenne au vingtième près, poids à
        // 100 %, pyramide dans la bande payée, jamais sous la mise, XP là où pas d'argent.
        foreach (var mode in MatchMode.All) PrizeWheel.Validate(mode);
    }

    [Fact]
    public void Dix_cases_par_roue_dans_les_trois_modes()
    {
        foreach (var mode in MatchMode.All)
        {
            Assert.Equal(10, PrizeWheel.For(mode).Count);
            for (var r = 1; r <= mode.PlayerCount; r++)
                Assert.Equal(10, PrizeWheel.WheelFor(mode, r, StakeContext.Usdc(StakeTier.Micro, 2m)).Count);
        }
    }

    [Fact]
    public void Le_melangeur_rend_les_memes_entiers_que_les_ports_JavaScript()
    {
        Assert.Equal(0u,          PrizeWheel.Hash32(0));
        Assert.Equal(1753845952u, PrizeWheel.Hash32(1));
        Assert.Equal(388445122u,  PrizeWheel.Hash32(42));
        Assert.Equal(3676312043u, PrizeWheel.Hash32(20260901));
        Assert.Equal(2834422664u, PrizeWheel.Hash32(123456789));
    }

    [Theory]
    [InlineData(0u,  "plat")]
    [InlineData(1u,  "standard")]
    [InlineData(2u,  "partage")]
    [InlineData(3u,  "equilibre")]
    [InlineData(4u,  "podium")]
    [InlineData(7u,  "couronne")]
    [InlineData(25u, "royale")]
    [InlineData(42u, "standard")]
    [InlineData(123456789u, "partage")]
    public void Une_graine_donne_toujours_la_meme_issue(uint graine, string attendu)
    {
        foreach (var mode in MatchMode.All)
        {
            Assert.Equal(attendu, PrizeWheel.Draw(mode, graine).Id);
            Assert.Equal(attendu, PrizeWheel.Draw(mode, graine).Id);
        }
    }

    [Fact]
    public void Les_poids_annonces_sont_ceux_qui_tombent()
    {
        var compte = new Dictionary<string, int>();
        for (var g = 0u; g < 100_000u; g++)
        {
            var id = PrizeWheel.Draw(MatchMode.Arena, g).Id;
            compte[id] = compte.GetValueOrDefault(id) + 1;
        }

        foreach (var v in PrizeWheel.For(MatchMode.Arena))
        {
            var observe = compte.GetValueOrDefault(v.Id) * 10_000.0 / 100_000.0;
            Assert.True(Math.Abs(observe - v.Poids) < 50,
                $"« {v.Id} » annoncé à {v.Poids / 100.0} %, observé à {observe / 100.0} %");
        }
    }

    /// <summary>STANDARD EST LA TABLE HISTORIQUE DU DÉPÔT, AU MICRO PRÈS, et la plus fréquente.</summary>
    [Fact]
    public void STANDARD_en_arene_reproduit_la_table_de_reference()
    {
        var t = PrizeWheel.PayoutFor(MatchMode.Arena, "standard", StakeContext.Usdc(StakeTier.Micro, 1m));

        Assert.Equal(Money.FromUnits(16m), t.Pot);
        Assert.Equal(Money.FromUnits(1.60m), t.Rake);
        Assert.Equal(Money.FromUnits(5.00m), t.ForRank(1));
        Assert.Equal(Money.FromUnits(2.50m), t.ForRank(2));
        Assert.Equal(Money.FromUnits(1.70m), t.ForRank(3));
        Assert.Equal(Money.FromUnits(1.20m), t.ForRank(4));
        for (var r = 5; r <= 8; r++) Assert.Equal(Money.FromUnits(1m), t.ForRank(r));
        for (var r = 9; r <= 16; r++) Assert.Equal(Money.Zero, t.ForRank(r));
        Assert.Equal(2200, PrizeWheel.ById(MatchMode.Arena, "standard").Poids);
    }

    /// <summary>
    /// Les dix lignes d'arène à 2 USDC : les quatre premiers, le rake de la ligne, et le
    /// bronze à qui la mise est rendue (0 = personne). Montants posés à la main.
    /// </summary>
    [Theory]
    [InlineData("plat",       5.00, 4.40, 3.80, 3.00, 4.40, 15)]
    [InlineData("doux",       6.20, 4.50, 3.50, 2.70, 4.00, 13)]
    [InlineData("partage",    7.00, 5.10, 3.10, 2.60, 3.60, 11)]
    [InlineData("equilibre",  8.20, 4.70, 2.90, 2.50, 3.40, 10)]
    [InlineData("standard",  10.00, 5.00, 3.40, 2.40, 3.20,  0)]
    [InlineData("podium",    10.20, 3.90, 2.60, 2.30, 3.00,  9)]
    [InlineData("pointu",    11.60, 3.30, 2.40, 2.10, 2.60, 12)]
    [InlineData("couronne",  12.50, 2.80, 2.30, 2.00, 2.40, 14)]
    [InlineData("royale",    13.10, 2.60, 2.20, 2.20, 1.90, 16)]
    [InlineData("jackpot",   15.80, 2.20, 2.00, 2.00, 2.00,  0)]
    public void Les_dix_lignes_d_arene_a_2_USDC(string id, decimal p1, decimal p2, decimal p3, decimal p4, decimal rake, int rembourse)
    {
        var t = PrizeWheel.PayoutFor(MatchMode.Arena, id, StakeContext.Usdc(StakeTier.Micro, 2m));

        Assert.Equal(Money.FromUnits(32m), t.Pot);
        Assert.Equal(Money.FromUnits(rake), t.Rake);
        Assert.Equal(Money.FromUnits(p1), t.ForRank(1));
        Assert.Equal(Money.FromUnits(p2), t.ForRank(2));
        Assert.Equal(Money.FromUnits(p3), t.ForRank(3));
        Assert.Equal(Money.FromUnits(p4), t.ForRank(4));
        for (var r = 5; r <= 8; r++) Assert.True(t.ForRank(r) >= Money.FromUnits(2m), $"rang {r} sous la mise sur « {id} »");
        for (var r = 9; r <= 16; r++)
            Assert.Equal(r == rembourse ? Money.FromUnits(2m) : Money.Zero, t.ForRank(r));
        Assert.Equal(t.Pot, t.TotalDistributed + t.Rake);
    }

    /// <summary>Les dix lignes de squad à 5 USDC. Deux places payées, dix montants distincts chacune.</summary>
    [Theory]
    [InlineData("plat",       7.50, 6.00, 0.00, 3.25)]
    [InlineData("doux",       8.25, 5.25, 3.25, 0.00)]
    [InlineData("partage",    9.25, 8.25, 0.00, 0.00)]
    [InlineData("equilibre", 10.25, 7.75, 0.00, 0.00)]
    [InlineData("standard",  12.50, 5.50, 0.00, 0.00)]
    [InlineData("podium",    11.25, 6.75, 0.00, 0.00)]
    [InlineData("pointu",    12.00, 6.50, 0.00, 0.00)]
    [InlineData("couronne",  13.00, 6.25, 0.00, 0.00)]
    [InlineData("royale",    14.00, 5.75, 0.00, 0.00)]
    [InlineData("jackpot",   15.00, 5.00, 0.00, 0.00)]
    public void Les_dix_lignes_de_squad_a_5_USDC(string id, decimal p1, decimal p2, decimal p3, decimal p4)
    {
        var t = PrizeWheel.PayoutFor(MatchMode.Squad, id, StakeContext.Usdc(StakeTier.Micro, 5m));

        Assert.Equal(Money.FromUnits(20m), t.Pot);
        Assert.Equal(Money.FromUnits(p1), t.ForRank(1));
        Assert.Equal(Money.FromUnits(p2), t.ForRank(2));
        Assert.Equal(Money.FromUnits(p3), t.ForRank(3));
        Assert.Equal(Money.FromUnits(p4), t.ForRank(4));
        Assert.Equal(t.Pot, t.TotalDistributed + t.Rake);
        Assert.True(t.Rake >= Money.Zero, "la maison ne paie jamais");
    }

    /// <summary>
    /// Le duel à 2 USDC : dix montants distincts pour le vainqueur, de 2,60 à 4,00 — et 4,00
    /// est le pot entier, rake zéro sur cette ligne. C'est ce que le directeur produit a
    /// demandé en voyant trois fois « 3.60 » sur la roue.
    /// </summary>
    [Theory]
    [InlineData("plat",      2.60, 0.70, 0.70)]
    [InlineData("doux",      2.80, 0.80, 0.40)]
    [InlineData("partage",   3.00, 0.80, 0.20)]
    [InlineData("pointu",    3.20, 0.00, 0.80)]
    [InlineData("equilibre", 3.50, 0.00, 0.50)]
    [InlineData("standard",  3.60, 0.00, 0.40)]
    [InlineData("podium",    3.70, 0.00, 0.30)]
    [InlineData("couronne",  3.80, 0.00, 0.20)]
    [InlineData("royale",    3.90, 0.00, 0.10)]
    [InlineData("jackpot",   4.00, 0.00, 0.00)]
    public void Le_duel_a_2_USDC(string id, decimal p1, decimal p2, decimal rake)
    {
        var t = PrizeWheel.PayoutFor(MatchMode.Duel, id, StakeContext.Usdc(StakeTier.Micro, 2m));
        Assert.Equal(Money.FromUnits(4m), t.Pot);
        Assert.Equal(Money.FromUnits(rake), t.Rake);
        Assert.Equal(Money.FromUnits(p1), t.ForRank(1));
        Assert.Equal(Money.FromUnits(p2), t.ForRank(2));
    }

    [Fact]
    public void Dix_montants_distincts_pour_le_vainqueur_dans_les_trois_modes()
    {
        var stake = StakeContext.Usdc(StakeTier.Micro, 2m);
        foreach (var mode in MatchMode.All)
        {
            var gains = PrizeWheel.WheelFor(mode, 1, stake).Select(c => c.Gain.Micros).ToList();
            Assert.Equal(10, gains.Distinct().Count());
        }
        // Et pour le deuxième en squad, et les rangs 2 à 3 en arène.
        Assert.Equal(10, PrizeWheel.WheelFor(MatchMode.Squad, 2, stake).Select(c => c.Gain.Micros).Distinct().Count());
        Assert.Equal(10, PrizeWheel.WheelFor(MatchMode.Arena, 2, stake).Select(c => c.Gain.Micros).Distinct().Count());
        Assert.Equal(10, PrizeWheel.WheelFor(MatchMode.Arena, 3, stake).Select(c => c.Gain.Micros).Distinct().Count());
    }

    [Fact]
    public void Les_paliers_sont_ceux_annonces()
    {
        Assert.Equal(PrizeTier.Diamant, PrizeWheel.TierOf(MatchMode.Arena, 1));
        for (var r = 2; r <= 4; r++) Assert.Equal(PrizeTier.Or, PrizeWheel.TierOf(MatchMode.Arena, r));
        for (var r = 5; r <= 8; r++) Assert.Equal(PrizeTier.Argent, PrizeWheel.TierOf(MatchMode.Arena, r));
        for (var r = 9; r <= 16; r++) Assert.Equal(PrizeTier.Bronze, PrizeWheel.TierOf(MatchMode.Arena, r));

        Assert.Equal(PrizeTier.Diamant, PrizeWheel.TierOf(MatchMode.Squad, 1));
        Assert.Equal(PrizeTier.Or,      PrizeWheel.TierOf(MatchMode.Squad, 2));
        Assert.Equal(PrizeTier.Bronze,  PrizeWheel.TierOf(MatchMode.Squad, 3));
        Assert.Equal(PrizeTier.Bronze,  PrizeWheel.TierOf(MatchMode.Squad, 4));

        Assert.Equal(PrizeTier.Diamant, PrizeWheel.TierOf(MatchMode.Duel, 1));
        Assert.Equal(PrizeTier.Bronze,  PrizeWheel.TierOf(MatchMode.Duel, 2));
    }

    /// <summary>La roue du 9e en arène à 2 USDC : neuf cases d'XP, une mise rendue sur PODIUM (14 %).</summary>
    [Fact]
    public void La_roue_du_neuvieme_rend_la_mise_une_fois_sur_sept()
    {
        var roue = PrizeWheel.WheelFor(MatchMode.Arena, 9, StakeContext.Usdc(StakeTier.Micro, 2m));
        Assert.Equal(10, roue.Count);
        Assert.Equal(10_000, roue.Sum(c => c.Poids));

        var rendue = roue.Single(c => c.Gain > Money.Zero);
        Assert.Equal("podium", rendue.Issue);
        Assert.Equal(1400, rendue.Poids);
        Assert.Equal(Money.FromUnits(2m), rendue.Gain);
        Assert.Equal(0, rendue.Xp);

        foreach (var c in roue.Where(c => c.Gain == Money.Zero)) Assert.True(c.Xp > 0, $"« {c.Issue} » sans XP");
        Assert.Equal(150, roue.Single(c => c.Issue == "jackpot").Xp);
    }

    /// <summary>
    /// LA ROUE DU VAINQUEUR EN ARÈNE À 2 USDC : de 5,00 à 15,80 USDC, espérance 9,349.
    /// Espérance posée à la main : Σ poids × gain / 10 000, calculée à part. Et la somme des
    /// espérances vaut 90 % du pot : le rake vaut 10 % EN MOYENNE, au micro près.
    /// </summary>
    [Fact]
    public void La_roue_du_vainqueur_va_de_5_00_a_15_80_USDC()
    {
        var stake = StakeContext.Usdc(StakeTier.Micro, 2m);
        var roue = PrizeWheel.WheelFor(MatchMode.Arena, 1, stake);
        Assert.Equal(Money.FromUnits(5.00m), roue.Min(c => c.Gain));
        Assert.Equal(Money.FromUnits(15.80m), roue.Max(c => c.Gain));
        Assert.Equal(200, roue.Single(c => c.Gain == Money.FromUnits(15.80m)).Poids);

        var esperance = PrizeWheel.ExpectedFor(MatchMode.Arena, stake);
        Assert.Equal(Money.FromUnits(9.349m), esperance[0]);
        Assert.Equal(Money.FromUnits(4.259m), esperance[1]);
        Assert.Equal(Money.FromUnits(28.80m).Micros, esperance.Sum(m => m.Micros));

        // Idem en duel et en squad : 90 % du pot en moyenne, exactement.
        Assert.Equal(Money.FromUnits(3.60m).Micros, PrizeWheel.ExpectedFor(MatchMode.Duel, stake).Sum(m => m.Micros));
        Assert.Equal(Money.FromUnits(7.20m).Micros, PrizeWheel.ExpectedFor(MatchMode.Squad, stake).Sum(m => m.Micros));
        Assert.Equal(Money.FromUnits(3.39m), PrizeWheel.ExpectedFor(MatchMode.Duel, stake)[0]);
    }

    [Fact]
    public void Aucune_ligne_ne_fait_payer_la_maison()
    {
        foreach (var mode in MatchMode.All)
        foreach (var mise in MatchMode.StakeTiers)
        foreach (var v in PrizeWheel.For(mode))
        {
            var t = PayoutPolicy.Compute(mode.Config, StakeContext.Usdc(StakeTier.Micro, mise), v);
            Assert.Equal(t.Pot, t.TotalDistributed + t.Rake);
            Assert.True(t.Rake >= Money.Zero, $"« {v.Id} » en {mode.Id} : rake négatif");
            // Jamais plus de 30 % gardés non plus.
            Assert.True(t.Rake.Micros * 10 <= t.Pot.Micros * 3, $"« {v.Id} » en {mode.Id} : plus de 30 % gardés");
        }
    }

    [Fact]
    public void Une_issue_inconnue_est_refusee_clairement()
    {
        Assert.Throws<ArgumentException>(() => PrizeWheel.ById(MatchMode.Arena, "bonus"));
        Assert.Throws<ArgumentException>(() => PrizeWheel.WheelFor(MatchMode.Squad, 5, StakeContext.Usdc(StakeTier.Micro, 2m)));
    }
}
