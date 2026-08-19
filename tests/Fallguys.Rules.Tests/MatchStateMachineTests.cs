using Fallguys.Rules;
using Xunit;

namespace Fallguys.Rules.Tests;

public class MatchStateMachineTests
{
    private static readonly MatchConfiguration Config =
        new(4, new[] { 2, 1 }, 1500, new[] { 35, 15 });

    private static readonly StakeContext Stake = StakeContext.Usdc(StakeTier.Micro, 1m);

    private static readonly PlayerId A = new("A");
    private static readonly PlayerId B = new("B");
    private static readonly PlayerId C = new("C");
    private static readonly PlayerId D = new("D");

    private static MatchStateMachine NewMatch() => new("match-1", Config, Stake);

    private static MatchStateMachine PlayedToTheEnd()
    {
        var match = NewMatch();
        match.Start(new[] { A, B, C, D });
        match.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B }));
        match.ApplyRound(new RoundOutcome(1, new[] { A, C }));
        return match;
    }

    [Fact]
    public void Une_partie_commence_en_lobby()
    {
        Assert.Equal(MatchPhase.Lobby, NewMatch().Phase);
    }

    [Fact]
    public void Start_fait_passer_la_partie_en_cours()
    {
        var match = NewMatch();
        match.Start(new[] { A, B, C, D });
        Assert.Equal(MatchPhase.InProgress, match.Phase);
    }

    [Fact]
    public void ApplyRound_avant_Start_est_refuse()
    {
        var match = NewMatch();
        Assert.Throws<InvalidOperationException>(() =>
            match.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B })));
    }

    [Fact]
    public void Start_deux_fois_est_refuse()
    {
        var match = NewMatch();
        match.Start(new[] { A, B, C, D });
        Assert.Throws<InvalidOperationException>(() => match.Start(new[] { A, B, C, D }));
    }

    [Fact]
    public void Settle_avant_la_fin_des_manches_est_refuse()
    {
        var match = NewMatch();
        match.Start(new[] { A, B, C, D });
        Assert.Throws<InvalidOperationException>(() => match.Settle("1.0.0", "hash"));
    }

    [Fact]
    public void Settle_produit_un_resultat_complet_et_passe_en_regle()
    {
        var match = PlayedToTheEnd();
        var result = match.Settle("1.0.0", "abc123");

        Assert.Equal(MatchPhase.Settled, match.Phase);
        Assert.Equal("match-1", result.MatchId);
        Assert.Equal("1.0.0", result.BuildVersion);
        Assert.Equal("abc123", result.ReplayHash);
        Assert.Equal(4, result.Payouts.Count);

        Assert.Equal(A, result.Payouts[0].Player);
        Assert.Equal(1, result.Payouts[0].Rank);
        Assert.Equal(C, result.Payouts[1].Player);
        Assert.Equal(D, result.Payouts[2].Player);
        Assert.Equal(B, result.Payouts[3].Player);
    }

    [Fact]
    public void Le_resultat_respecte_l_invariant_monetaire()
    {
        var result = PlayedToTheEnd().Settle("1.0.0", "abc123");
        var distributed = result.Payouts.Aggregate(Money.Zero, (sum, p) => sum + p.Amount);
        Assert.Equal(result.Pot, distributed + result.Rake);
    }

    [Fact]
    public void Les_montants_du_resultat_suivent_la_table_de_payouts()
    {
        var expected = PayoutPolicy.Compute(Config, Stake);
        var result = PlayedToTheEnd().Settle("1.0.0", "abc123");
        foreach (var payout in result.Payouts)
            Assert.Equal(expected.ForRank(payout.Rank), payout.Amount);
    }

    [Fact]
    public void Settle_deux_fois_est_refuse()
    {
        var match = PlayedToTheEnd();
        match.Settle("1.0.0", "abc123");
        Assert.Throws<InvalidOperationException>(() => match.Settle("1.0.0", "abc123"));
    }

    [Fact]
    public void Une_partie_gratuite_se_regle_avec_des_montants_nuls()
    {
        var match = new MatchStateMachine("match-free", Config, StakeContext.Free);
        match.Start(new[] { A, B, C, D });
        match.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B }));
        match.ApplyRound(new RoundOutcome(1, new[] { A, C }));
        var result = match.Settle("1.0.0", "hash");

        Assert.Equal(Money.Zero, result.Pot);
        Assert.All(result.Payouts, p => Assert.Equal(Money.Zero, p.Amount));
        Assert.Equal(4, result.Payouts.Count);
    }
}
