using Fallguys.Rules;
using Xunit;

namespace Fallguys.Rules.Tests;

public class StandingsTests
{
    private static readonly MatchConfiguration Config =
        new(4, new[] { 2, 1 }, 1500, new[] { 35, 15 });

    private static readonly PlayerId A = new("A");
    private static readonly PlayerId B = new("B");
    private static readonly PlayerId C = new("C");
    private static readonly PlayerId D = new("D");

    private static Standings NewStandings() => new(Config, new[] { A, B, C, D });

    [Fact]
    public void Au_depart_tous_les_entrants_sont_actifs()
    {
        var standings = NewStandings();
        Assert.Equal(new[] { A, B, C, D }, standings.Active);
        Assert.False(standings.IsComplete);
    }

    [Fact]
    public void Une_manche_elimine_les_derniers_arrives()
    {
        var standings = NewStandings();
        standings.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B }));
        Assert.Equal(new[] { C, A }, standings.Active);
    }

    [Fact]
    public void Le_classement_final_place_les_survivants_devant_les_elimines()
    {
        var standings = NewStandings();
        standings.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B }));
        standings.ApplyRound(new RoundOutcome(1, new[] { A, C }));

        Assert.True(standings.IsComplete);
        Assert.Equal(new[] { A, C, D, B }, standings.FinalRanking());
    }

    [Fact]
    public void ApplyRound_refuse_un_ordre_qui_ne_couvre_pas_les_joueurs_actifs()
    {
        var standings = NewStandings();
        Assert.Throws<ArgumentException>(() =>
            standings.ApplyRound(new RoundOutcome(0, new[] { C, A, D })));
    }

    [Fact]
    public void ApplyRound_refuse_un_joueur_inconnu()
    {
        var standings = NewStandings();
        Assert.Throws<ArgumentException>(() =>
            standings.ApplyRound(new RoundOutcome(0, new[] { C, A, D, new PlayerId("Z") })));
    }

    [Fact]
    public void ApplyRound_refuse_une_manche_hors_sequence()
    {
        var standings = NewStandings();
        Assert.Throws<ArgumentException>(() =>
            standings.ApplyRound(new RoundOutcome(1, new[] { C, A, D, B })));
    }

    [Fact]
    public void FinalRanking_refuse_une_partie_inachevee()
    {
        var standings = NewStandings();
        standings.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B }));
        Assert.Throws<InvalidOperationException>(() => standings.FinalRanking());
    }

    [Fact]
    public void ApplyRound_refuse_une_manche_apres_la_fin()
    {
        var standings = NewStandings();
        standings.ApplyRound(new RoundOutcome(0, new[] { C, A, D, B }));
        standings.ApplyRound(new RoundOutcome(1, new[] { A, C }));
        Assert.Throws<InvalidOperationException>(() =>
            standings.ApplyRound(new RoundOutcome(2, new[] { A })));
    }
}
