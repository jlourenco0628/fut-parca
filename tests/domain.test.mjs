import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed, EVENT_RULES, MODALITIES, getRoundStats, getMatchScore, getAthleteSkills,
  getFantasyRanking, getSeasonRanking, recordEvent, removeEvent, saveFantasy, beginRound,
  setMatchStatus, closeRound, reopenRound, positionForRound, drawCaptains, drawTeams,
  getWeeklyMvp, getCardTier } from '../domain.mjs';

const roundId = 'pelada-01';
const draftId = 'pelada-02';
const id = n => `atleta-${String(n).padStart(2, '0')}`;
const round = state => state.rounds.find(item => item.id === roundId);
const stats = (state, n) => getRoundStats(state, roundId).find(row => row.athleteId === id(n));
const finished = () => setMatchStatus(createSeed(), roundId, 'jogo-3', 'finished');
const closed = () => closeRound(finished(), roundId);
const payload = (n, type, matchId = 'jogo-3') => ({ matchId, athleteId: id(n), type });

test('a demonstração fornece 15 atletas, três equipes e configurações por modalidade', () => {
  const seed = createSeed();
  assert.equal(seed.version, 1);
  assert.equal(seed.athletes.length, 15);
  assert.equal(round(seed).teams.length, 3);
  assert.equal(MODALITIES.futsal.teamSize, 5);
  for (const athlete of seed.athletes) assert.deepEqual(Object.keys(athlete.preferences), ['futebol', 'futsal', 'society']);
  assert.equal(EVENT_RULES.find(rule => rule.type === 'save').points, 1.5);
});

test('cards usam bronze, prata, ouro e destaque semanal', () => {
  assert.equal(getCardTier(60), 'bronze');
  assert.equal(getCardTier(70), 'silver');
  assert.equal(getCardTier(75), 'silver');
  assert.equal(getCardTier(76), 'gold');
  assert.equal(getCardTier(60, true), 'special');
  assert.equal(getWeeklyMvp(createSeed(), 'futsal'), null);
  const state = closed();
  const expected = getRoundStats(state, roundId).find(row => row.playedMatches > 0);
  assert.equal(getWeeklyMvp(state, 'futsal').athleteId, expected.athleteId);
});

test('sorteio de capitães usa apenas participantes, persiste no início e não pode ser refeito após começar', () => {
  const seed = createSeed();
  const picks = [.9, .1, .5];
  const drawn = drawCaptains(seed, draftId, () => picks.shift());
  const teams = drawn.rounds.find(item => item.id === draftId).teams;
  assert.deepEqual(teams.map(team => team.captainId), [id(5), id(6), id(13)]);
  assert.ok(teams.every(team => team.athleteIds.includes(team.captainId)));
  assert.ok(seed.rounds.find(item => item.id === draftId).teams.every(team => !team.captainId));
  const started = beginRound(drawn, draftId);
  assert.deepEqual(started.rounds.find(item => item.id === draftId).teams.map(team => team.captainId), teams.map(team => team.captainId));
  assert.throws(() => drawCaptains(started, draftId), /já foram definidos/);
});

test('sorteio exige atletas em todas as equipes e valida a escolha aleatória', () => {
  const empty = createSeed();
  empty.rounds.find(item => item.id === draftId).teams[0].athleteIds = [];
  assert.throws(() => drawCaptains(empty, draftId), /precisa ter atletas/);
  assert.throws(() => drawCaptains(createSeed(), draftId, () => 1), /Não foi possível concluir/);
});

test('sorteio de times mantém nomes e participantes, distribui goleiros e libera um novo sorteio de capitães', () => {
  const seed = createSeed();
  const withCaptains = drawCaptains(seed, draftId, () => .5);
  const drawn = drawTeams(withCaptains, draftId, 'random', () => .5);
  const before = withCaptains.rounds.find(item => item.id === draftId).teams;
  const after = drawn.rounds.find(item => item.id === draftId).teams;
  assert.deepEqual(after.map(team => team.name), before.map(team => team.name));
  assert.deepEqual(after.map(team => team.athleteIds.length), [5, 5, 5]);
  assert.deepEqual(after.flatMap(team => team.athleteIds).sort(), before.flatMap(team => team.athleteIds).sort());
  assert.ok(after.every(team => team.athleteIds.some(id => seed.athletes.find(athlete => athlete.id === id).preferences.futsal.primary === 'Goleiro')));
  assert.ok(after.every(team => team.captainId === null));
  assert.equal(drawn.rounds.find(item => item.id === draftId).drawMode, 'random');
  assert.throws(() => drawTeams(beginRound(drawn, draftId), draftId), /antes de começar/);
});

test('sorteio equilibrado usa nota do card e aproxima a força dos times', () => {
  const seed = createSeed();
  for (let index = 0; index < seed.athletes.length; index++) {
    const value = index < 5 ? 90 : index < 10 ? 70 : 50;
    for (const key of Object.keys(seed.athletes[index].baseSkills.futsal)) seed.athletes[index].baseSkills.futsal[key] = value;
  }
  const random = drawTeams(seed, draftId, 'random', () => .5);
  const balanced = drawTeams(seed, draftId, 'balanced', () => .5);
  const totals = state => state.rounds.find(item => item.id === draftId).teams.map(team => team.athleteIds.reduce((sum, athleteId) => sum + getAthleteSkills(state, athleteId, 'futsal').overall, 0));
  const spread = values => Math.max(...values) - Math.min(...values);
  assert.ok(spread(totals(balanced)) <= spread(totals(random)));
  assert.deepEqual(balanced.rounds.find(item => item.id === draftId).teams.map(team => team.athleteIds.length), [5, 5, 5]);
  assert.equal(balanced.rounds.find(item => item.id === draftId).drawMode, 'balanced');
  assert.throws(() => drawTeams(seed, draftId, 'invalid'), /aleatório ou equilibrado/);
});

test('placares, assists e defesas são acumulados em todos os jogos do dia', () => {
  const seed = createSeed();
  assert.equal(getMatchScore(round(seed), 'jogo-1').home, 3);
  assert.equal(getMatchScore(round(seed), 'jogo-1').away, 2);
  assert.equal(getMatchScore(round(seed), 'jogo-2').home, 1);
  assert.equal(stats(seed, 5).goals, 3);
  assert.equal(stats(seed, 3).assists, 3);
  assert.equal(stats(seed, 1).saves, 8);
  assert.equal(stats(seed, 6).saves, 10);
  assert.equal(stats(seed, 1).playedMatches, 1, 'jogo ao vivo ainda não conta como partida concluída');
});

test('fantasy soma exatamente os resultados individuais e rankings estão ordenados', () => {
  const seed = createSeed();
  const rows = new Map(getRoundStats(seed, roundId).map(row => [row.athleteId, row]));
  const rankings = getFantasyRanking(seed, roundId);
  for (const lineup of rankings) {
    assert.equal(lineup.points, lineup.athleteIds.reduce((sum, athleteId) => sum + rows.get(athleteId).points, 0));
    assert.equal(lineup.athleteNames.length, 5);
    assert.equal(lineup.athletes.length, 5);
  }
  assert.ok(rankings.every((item, index) => index === 0 || rankings[index - 1].points >= item.points));
});

test('a temporada só recebe resultados quando a pelada é fechada', () => {
  const seed = createSeed();
  assert.deepEqual(getSeasonRanking(seed, 'futsal'), []);
  const next = closeRound(finished(), roundId);
  const player = getSeasonRanking(next, 'futsal').find(row => row.athleteId === id(5));
  assert.equal(player.points, stats(next, 5).points);
  assert.equal(player.playedMatches, 2);
  assert.equal(player.playedRounds, 1);
  assert.deepEqual(getSeasonRanking(next, 'society'), []);
});

test('não fecha com jogo pendente, nem com todos os jogos cancelados', () => {
  assert.throws(() => closeRound(createSeed(), roundId), /todos os jogos/);
  let state = createSeed();
  for (const match of round(state).matches) state = setMatchStatus(state, roundId, match.id, 'cancelled');
  assert.throws(() => closeRound(state, roundId), /pelo menos um jogo/);
});

test('fechamento é imutável, versionado e idempotente', () => {
  const before = finished();
  const serialized = JSON.stringify(before);
  const next = closeRound(before, roundId);
  assert.equal(JSON.stringify(before), serialized);
  assert.equal(round(next).status, 'closed');
  assert.equal(round(next).revision, 1);
  assert.ok(Number.isFinite(Date.parse(round(next).closedAt)));
  assert.equal(closeRound(next, roundId), next);
});

test('correção recalcula pontos e skills sem duplicar a evolução, preservando escalações', () => {
  const original = closed();
  const initialFantasy = structuredClone(round(original).fantasy);
  const originalPoints = stats(original, 5).points;
  const originalSkills = getAthleteSkills(original, id(5), 'futsal');
  const reopened = reopenRound(original, roundId);
  assert.deepEqual(round(reopened).fantasy, initialFantasy);
  assert.throws(() => saveFantasy(reopened, roundId, initialFantasy[0]), /travadas/);
  const corrected = closeRound(recordEvent(reopened, roundId, payload(5, 'goal')), roundId);
  assert.equal(round(corrected).revision, 2);
  assert.equal(stats(corrected, 5).points, originalPoints + 6);
  assert.equal(getAthleteSkills(corrected, id(5), 'futsal').fin, originalSkills.fin, 'mais um gol na mesma rodada mantém o limite de +1');
  const correctedAgain = closeRound(reopenRound(corrected, roundId), roundId);
  assert.deepEqual(getAthleteSkills(correctedAgain, id(5), 'futsal'), getAthleteSkills(corrected, id(5), 'futsal'));
});

test('gol contra favorece o adversário, sem ser contado como gol do atleta', () => {
  const before = createSeed();
  const next = recordEvent(before, roundId, payload(2, 'ownGoal'));
  assert.equal(getMatchScore(round(next), 'jogo-3').home, 2);
  assert.equal(getMatchScore(round(next), 'jogo-3').away, 1);
  assert.equal(stats(next, 2).goals, 0);
  assert.equal(stats(next, 2).ownGoal, 1);
  assert.equal(stats(next, 2).points, stats(before, 2).points - 3);
});

test('defesa de pênalti é uma categoria exclusiva com +6, sem +1,5 adicional', () => {
  const before = createSeed();
  const next = recordEvent(before, roundId, payload(1, 'penaltySave'));
  assert.equal(stats(next, 1).points - stats(before, 1).points, 6);
  assert.equal(stats(next, 1).saves, stats(before, 1).saves + 1);
  assert.equal(stats(next, 1).save, stats(before, 1).save);
  assert.equal(stats(next, 1).penaltySaves, 1);
});

test('lances validam goleiro, atleta participante, tipo e identificador único', () => {
  const seed = createSeed();
  assert.throws(() => recordEvent(seed, roundId, payload(2, 'save')), /goleiro/);
  assert.throws(() => recordEvent(seed, roundId, payload(6, 'goal')), /equipes deste jogo/);
  assert.throws(() => recordEvent(seed, roundId, payload(1, 'invalid')), /Tipo de lance/);
  assert.throws(() => recordEvent(seed, roundId, { ...payload(1, 'save'), id: round(seed).events[0].id }), /já foi registrado/);
  assert.throws(() => recordEvent(seed, roundId, { ...payload(1, 'save'), athleteId: 'inexistente' }), /Atleta não encontrado/);
});

test('remoção é imutável e corrige pontuação e placar', () => {
  const seed = createSeed();
  const goal = round(seed).events.find(event => event.type === 'goal' && event.athleteId === id(5));
  const next = removeEvent(seed, roundId, goal.id);
  assert.equal(stats(next, 5).points, stats(seed, 5).points - 6);
  assert.equal(getMatchScore(round(next), goal.matchId).home, 2);
  assert.ok(round(seed).events.some(event => event.id === goal.id));
  assert.throws(() => removeEvent(seed, roundId, 'ausente'), /Lance não encontrado/);
});

test('pelada fechada bloqueia alterações nos jogos e nos lances', () => {
  const state = closed();
  assert.throws(() => recordEvent(state, roundId, payload(5, 'goal')), /Reabra/);
  assert.throws(() => removeEvent(state, roundId, round(state).events[0].id), /Reabra/);
  assert.throws(() => setMatchStatus(state, roundId, 'jogo-3', 'live'), /Reabra/);
});

test('jogo cancelado não pontua, nem contribui para skills ou partidas jogadas', () => {
  const cancelled = setMatchStatus(createSeed(), roundId, 'jogo-3', 'cancelled');
  assert.equal(stats(cancelled, 5).goals, 2);
  assert.equal(stats(cancelled, 1).saves, 5);
  assert.equal(getMatchScore(round(cancelled), 'jogo-3').home, 0);
  assert.throws(() => recordEvent(cancelled, roundId, payload(5, 'goal')), /cancelado/);
  const state = closeRound(cancelled, roundId);
  assert.equal(stats(state, 1).playedMatches, 1);
  assert.equal(stats(state, 11).playedMatches, 1);
});

test('skills evoluem gradualmente, sem medir ausência de gol nem alterar outras modalidades', () => {
  const before = createSeed();
  const next = closed();
  assert.equal(getAthleteSkills(next, id(5), 'futsal').fin, getAthleteSkills(before, id(5), 'futsal').fin + 1);
  assert.equal(getAthleteSkills(next, id(2), 'futsal').fin, getAthleteSkills(before, id(2), 'futsal').fin, 'não marcar não reduz finalização');
  assert.equal(getAthleteSkills(next, id(2), 'futsal').def, getAthleteSkills(before, id(2), 'futsal').def + 1);
  assert.equal(getAthleteSkills(next, id(9), 'futsal').pas, getAthleteSkills(before, id(9), 'futsal').pas, 'uma assistência e um passe errado se compensam');
  assert.deepEqual(getAthleteSkills(next, id(5), 'society'), getAthleteSkills(before, id(5), 'society'));
});

test('erro registrado reduz skill e sofrer gol não penaliza automaticamente o goleiro', () => {
  let state = createSeed();
  const keeper = getAthleteSkills(state, id(1), 'futsal');
  state = recordEvent(state, roundId, payload(4, 'missedChance'));
  const beforeFin = getAthleteSkills(state, id(4), 'futsal').fin;
  state = closeRound(setMatchStatus(state, roundId, 'jogo-3', 'finished'), roundId);
  assert.equal(getAthleteSkills(state, id(4), 'futsal').fin, beforeFin - 1);
  assert.equal(getAthleteSkills(state, id(1), 'futsal').han, keeper.han);
  assert.equal(getAthleteSkills(state, id(1), 'futsal').pos, keeper.pos);
  assert.equal(getAthleteSkills(state, id(1), 'futsal').ref, keeper.ref + 1);
});

test('skills são inteiras entre 1 e 99 e nota geral depende da posição', () => {
  const state = finished();
  state.athletes[4].baseSkills.futsal.fin = 99;
  state.athletes[3].baseSkills.futsal.fin = 1;
  state.rounds[0].events.push({ id: 'low-fin', ...payload(4, 'missedChance'), createdAt: new Date().toISOString() });
  const next = closeRound(state, roundId);
  assert.equal(getAthleteSkills(next, id(5), 'futsal').fin, 99);
  assert.equal(getAthleteSkills(next, id(4), 'futsal').fin, 1);
  for (const athlete of next.athletes) {
    const skills = getAthleteSkills(next, athlete.id, 'futsal');
    for (const value of Object.values(skills).filter(value => typeof value === 'number')) assert.ok(Number.isInteger(value) && value >= 1 && value <= 99);
  }
  assert.equal(getAthleteSkills(next, id(1), 'futsal').isGoalkeeper, true);
});

test('fantasy aceita criação e edição no rascunho, validando tamanho e exatamente um goleiro', () => {
  const seed = createSeed();
  const lineup = { id: 'teste', name: 'Parças', owner: 'João', athleteIds: [id(1), id(2), id(3), id(4), id(5)] };
  const created = saveFantasy(seed, draftId, lineup);
  assert.equal(seed.rounds[1].fantasy.length, 0);
  assert.equal(created.rounds[1].fantasy.length, 1);
  const edited = saveFantasy(created, draftId, { ...lineup, name: 'Parças FC' });
  assert.equal(edited.rounds[1].fantasy.length, 1);
  assert.equal(edited.rounds[1].fantasy[0].name, 'Parças FC');
  assert.throws(() => saveFantasy(seed, draftId, { ...lineup, athleteIds: [id(1), id(2)] }), /exatamente 5 atletas/);
  assert.throws(() => saveFantasy(seed, draftId, { ...lineup, athleteIds: [id(1), id(2), id(2), id(4), id(5)] }), /repetidos/);
  assert.throws(() => saveFantasy(seed, draftId, { ...lineup, athleteIds: [id(1), id(6), id(3), id(4), id(5)] }), /exatamente um goleiro/);
  assert.throws(() => saveFantasy(seed, draftId, { ...lineup, athleteIds: [id(2), id(3), id(4), id(5), id(7)] }), /exatamente um goleiro/);
});

test('atleta fora da confirmação não entra no fantasy', () => {
  const seed = createSeed();
  seed.rounds[1].teams[0].athleteIds = seed.rounds[1].teams[0].athleteIds.filter(athleteId => athleteId !== id(5));
  assert.throws(() => saveFantasy(seed, draftId, { name: 'Parças', athleteIds: [id(1), id(2), id(3), id(4), id(5)] }), /confirmados/);
});

test('início trava escalações e valida número de equipes, tamanho, goleiro e atletas duplicados', () => {
  const seed = createSeed();
  const live = beginRound(seed, draftId);
  assert.equal(live.rounds[1].status, 'live');
  assert.equal(beginRound(live, draftId), live);
  assert.throws(() => saveFantasy(live, draftId, { name: 'Parças', athleteIds: [id(1), id(2), id(3), id(4), id(5)] }), /travadas/);
  const small = createSeed();
  small.rounds[1].teams[0].athleteIds.pop();
  assert.throws(() => beginRound(small, draftId), /pelo menos 5 atletas/);
  const missingKeeper = createSeed();
  missingKeeper.athletes[0].preferences.futsal.primary = 'Fixo';
  assert.throws(() => beginRound(missingKeeper, draftId), /pelo menos um goleiro/);
  const duplicate = createSeed();
  duplicate.rounds[1].teams[1].athleteIds.push(id(2));
  assert.throws(() => beginRound(duplicate, draftId), /uma equipe/);
  const single = createSeed();
  single.rounds[1].teams = [single.rounds[1].teams[0]];
  single.rounds[1].matches = [];
  assert.throws(() => beginRound(single, draftId), /duas equipes/);
});

test('fechamento rejeita escalação inválida e súmula corrompida', () => {
  const badLineup = finished();
  round(badLineup).fantasy[0].athleteIds[0] = id(6);
  round(badLineup).fantasy[0].athleteIds[1] = id(11);
  assert.throws(() => closeRound(badLineup, roundId), /um goleiro/);
  const badEvent = finished();
  round(badEvent).events.push({ id: 'corrompido', ...payload(6, 'goal'), createdAt: new Date().toISOString() });
  assert.throws(() => closeRound(badEvent, roundId), /equipes deste jogo/);
});

test('o início congela posições e a primeira alteração de rodada live migra a seed sem modificar o original', () => {
  const seed = createSeed();
  assert.equal(round(seed).positions, undefined);
  const initialized = beginRound(seed, roundId);
  assert.equal(Object.keys(round(initialized).positions).length, 15);
  assert.equal(round(initialized).positions[id(1)], 'Goleiro');
  assert.equal(round(seed).positions, undefined);
  const next = recordEvent(seed, roundId, payload(1, 'save'));
  assert.equal(round(next).positions[id(1)], 'Goleiro');
  const draft = beginRound(seed, draftId);
  assert.equal(Object.keys(draft.rounds[1].positions).length, 15);
});

test('mudança de preferência não altera posição ou elegibilidade do goleiro em uma rodada iniciada', () => {
  let state = beginRound(createSeed(), roundId);
  state.athletes[0].preferences.futsal.primary = 'Fixo';
  assert.equal(positionForRound(state, round(state), id(1)), 'Goleiro');
  assert.equal(stats(state, 1).isGoalkeeper, true);
  state = recordEvent(state, roundId, payload(1, 'save'));
  state = closeRound(setMatchStatus(state, roundId, 'jogo-3', 'finished'), roundId);
  assert.equal(stats(state, 1).position, 'Goleiro');
  const positions = structuredClone(round(state).positions);
  state.athletes[10].preferences.futsal.primary = 'Pivô';
  const corrected = closeRound(reopenRound(state, roundId), roundId);
  assert.deepEqual(round(corrected).positions, positions);
  assert.equal(stats(corrected, 11).isGoalkeeper, true);
  assert.equal(getSeasonRanking(corrected, 'futsal').find(row => row.athleteId === id(11)).isGoalkeeper, true);
});

test('goleiro que dá assistência evolui reposição e falha reduz segurança/posição, conforme função na rodada', () => {
  let state = beginRound(createSeed(), roundId);
  const before = getAthleteSkills(state, id(1), 'futsal');
  const assist = round(state).events.find(event => event.type === 'assist' && event.matchId === 'jogo-1' && event.athleteId === id(3));
  assist.athleteId = id(1);
  state = recordEvent(state, roundId, payload(1, 'goalError'));
  state.athletes[0].preferences.futsal.primary = 'Fixo';
  state = closeRound(setMatchStatus(state, roundId, 'jogo-3', 'finished'), roundId);
  const after = getAthleteSkills(state, id(1), 'futsal');
  assert.equal(after.kic, before.kic + 1);
  assert.equal(after.pas, before.pas);
  assert.equal(after.han, before.han - 1);
  assert.equal(after.pos, before.pos - 1);
  assert.equal(after.def, before.def);
});

test('passes errados e falhas do jogador de linha não alteram atributos de goleiro', () => {
  let state = createSeed();
  const beforeLine = getAthleteSkills(state, id(4), 'futsal');
  const beforeKeeper = getAthleteSkills(state, id(1), 'futsal');
  state = recordEvent(state, roundId, payload(4, 'dangerousPass'));
  state = recordEvent(state, roundId, payload(4, 'goalError'));
  state = recordEvent(state, roundId, payload(1, 'dangerousPass'));
  state = closeRound(setMatchStatus(state, roundId, 'jogo-3', 'finished'), roundId);
  const afterLine = getAthleteSkills(state, id(4), 'futsal');
  const afterKeeper = getAthleteSkills(state, id(1), 'futsal');
  assert.equal(afterLine.pas, beforeLine.pas, 'assistência e passe errado se compensam');
  assert.equal(afterLine.def, beforeLine.def - 1);
  for (const key of ['kic', 'han', 'pos']) assert.equal(afterLine[key], beforeLine[key]);
  assert.equal(afterKeeper.kic, beforeKeeper.kic - 1);
  assert.equal(afterKeeper.pas, beforeKeeper.pas);
});

test('skills são calculadas em ordem cronológica, independentemente da ordem de armazenamento', () => {
  let state = createSeed();
  state.athletes[4].baseSkills.futsal.fin = 99;
  const template = structuredClone(round(state));
  template.events = [];
  template.fantasy = [];
  template.matches = template.matches.map(match => ({ ...match, status: 'finished' }));
  const early = { ...structuredClone(template), id: 'cedo', date: '2026-09-08', events: [{ id: 'cedo-gol', ...payload(5, 'goal', 'jogo-1'), createdAt: '2026-09-08T22:00:00Z' }] };
  const late = { ...structuredClone(template), id: 'tarde', date: '2026-09-15', events: [{ id: 'tarde-erro', ...payload(5, 'missedChance', 'jogo-1'), createdAt: '2026-09-15T22:00:00Z' }] };
  state.rounds = [late, early];
  state = closeRound(closeRound(state, 'tarde'), 'cedo');
  assert.equal(getAthleteSkills(state, id(5), 'futsal').fin, 98);
  const reordered = { ...state, rounds: [...state.rounds].reverse() };
  assert.deepEqual(getAthleteSkills(reordered, id(5), 'futsal'), getAthleteSkills(state, id(5), 'futsal'));
});

test('a temporada exclui atleta cadastrado que não participou de pelada encerrada', () => {
  const state = closed();
  state.athletes.push({ ...structuredClone(state.athletes[4]), id: 'sem-participacao', nickname: 'Novo Parça' });
  assert.equal(getSeasonRanking(state, 'futsal').length, 15);
  assert.ok(!getSeasonRanking(state, 'futsal').some(row => row.athleteId === 'sem-participacao'));
});

test('lances são bloqueados no rascunho e em jogos agendados, mas aceitos para corrigir jogo finalizado', () => {
  const seed = createSeed();
  assert.throws(() => recordEvent(seed, draftId, payload(1, 'save', 'proximo-1')), /Inicie a pelada/);
  const liveDraft = beginRound(seed, draftId);
  assert.throws(() => recordEvent(liveDraft, draftId, payload(1, 'save', 'proximo-1')), /Inicie o jogo/);
  const liveMatch = setMatchStatus(liveDraft, draftId, 'proximo-1', 'live');
  assert.equal(recordEvent(liveMatch, draftId, payload(1, 'save', 'proximo-1')).rounds[1].events.length, 1);
  const ended = setMatchStatus(liveMatch, draftId, 'proximo-1', 'finished');
  assert.equal(recordEvent(ended, draftId, payload(1, 'save', 'proximo-1')).rounds[1].events.length, 1);
});

test('assistências por equipe não podem exceder gols próprios, mesmo quando o adversário marca gol contra', () => {
  let state = recordEvent(finished(), roundId, payload(3, 'assist', 'jogo-1'));
  assert.throws(() => closeRound(state, roundId), /assistências/);
  state = recordEvent(state, roundId, payload(10, 'ownGoal', 'jogo-1'));
  assert.equal(getMatchScore(round(state), 'jogo-1').home, 4);
  assert.throws(() => closeRound(state, roundId), /assistências/);
});

test('correção de gol exige corrigir assistência excedente antes de fechar novamente', () => {
  let state = reopenRound(closed(), roundId);
  const goal = round(state).events.find(event => event.type === 'goal' && event.matchId === 'jogo-1' && event.athleteId === id(5));
  const assist = round(state).events.find(event => event.type === 'assist' && event.matchId === 'jogo-1' && event.athleteId === id(3));
  state = removeEvent(state, roundId, goal.id);
  assert.throws(() => closeRound(state, roundId), /assistências/);
  state = closeRound(removeEvent(state, roundId, assist.id), roundId);
  assert.equal(round(state).revision, 2);
  assert.equal(getMatchScore(round(state), 'jogo-1').home, 2);
});

test('equipes que só tiveram jogos cancelados não precisam completar elenco no fechamento', () => {
  let state = createSeed();
  round(state).teams[2].athleteIds = [];
  round(state).fantasy = [];
  state = setMatchStatus(state, roundId, 'jogo-2', 'cancelled');
  state = setMatchStatus(state, roundId, 'jogo-3', 'cancelled');
  state = closeRound(state, roundId);
  assert.equal(round(state).status, 'closed');
  assert.equal(getSeasonRanking(state, 'futsal').length, 10);
});
