export { createSeed } from './seed.mjs';

export const MODALITIES = Object.freeze({
  futebol: { label: 'Futebol', teamSize: 11, positions: ['Goleiro', 'Zagueiro', 'Lateral', 'Volante', 'Meia', 'Atacante'] },
  futsal: { label: 'Futsal', teamSize: 5, positions: ['Goleiro', 'Fixo', 'Ala', 'Pivô'] },
  society: { label: 'Society', teamSize: 7, positions: ['Goleiro', 'Defensor', 'Meio-campista', 'Atacante'] },
});

export const EVENT_RULES = Object.freeze([
  { type: 'goal', label: 'Gol', points: 6, group: 'positive', skill: { fin: 1 } },
  { type: 'assist', label: 'Assistência', points: 4, group: 'positive', skill: { pas: 1 } },
  { type: 'interception', label: 'Interceptação', points: 1, group: 'positive', skill: { def: 1 } },
  { type: 'tackle', label: 'Desarme com posse', points: 1, group: 'positive', skill: { def: 1 } },
  { type: 'save', label: 'Defesa', points: 1.5, group: 'positive', goalkeeperOnly: true, skill: { div: 1, ref: 1 } },
  { type: 'penaltySave', label: 'Defesa de pênalti', points: 6, group: 'positive', goalkeeperOnly: true, skill: { div: 1, ref: 1, pos: 1 } },
  { type: 'missedChance', label: 'Chance clara perdida', points: -1, group: 'negative', skill: { fin: -1 } },
  { type: 'penaltyMiss', label: 'Pênalti perdido', points: -3, group: 'negative', skill: { fin: -1 } },
  { type: 'dangerousPass', label: 'Passe errado', points: -1, group: 'negative', skill: { pas: -1, kic: -1 } },
  { type: 'goalError', label: 'Falha que causou gol', points: -3, group: 'negative', skill: { def: -1, han: -1, pos: -1 } },
  { type: 'ownGoal', label: 'Gol contra', points: -3, group: 'negative', skill: { def: -1, pos: -1 } },
  { type: 'yellow', label: 'Cartão amarelo', points: -1, group: 'negative' },
  { type: 'red', label: 'Cartão vermelho', points: -3, group: 'negative' },
]);

const RULES = new Map(EVENT_RULES.map(rule => [rule.type, rule]));
const SKILLS = ['rit', 'fin', 'pas', 'con', 'def', 'fis', 'div', 'han', 'kic', 'ref', 'spd', 'pos'];
const MATCH_STATUSES = ['scheduled', 'live', 'finished', 'cancelled'];
const clone = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
const randomIndex = (size, random) => { const pick = Number(random()); if (!Number.isFinite(pick) || pick < 0 || pick >= 1) fail('Não foi possível concluir o sorteio.'); return Math.floor(pick * size); };
const shuffled = (items, random) => { const list = [...items]; for (let i = list.length - 1; i > 0; i--) { const j = randomIndex(i + 1, random); [list[i], list[j]] = [list[j], list[i]]; } return list; };
const roundedSkill = value => Math.min(99, Math.max(1, Math.round(Number.isFinite(Number(value)) ? Number(value) : 65)));
const roundOf = (state, id) => state.rounds.find(round => round.id === id) ?? fail('Pelada não encontrada.');
const athleteOf = (state, id) => state.athletes.find(athlete => athlete.id === id) ?? fail('Atleta não encontrado.');
const matchOf = (round, id) => round.matches.find(match => match.id === id) ?? fail('Jogo não encontrado.');
const positionOf = (athlete, modality) => athlete.preferences?.[modality]?.primary || MODALITIES[modality]?.positions[1] || 'Atleta';
const goalkeeper = (athlete, modality) => positionOf(athlete, modality).toLocaleLowerCase('pt-BR') === 'goleiro';
const teamOf = (round, athleteId) => round.teams.find(team => team.athleteIds.includes(athleteId));

export function positionForRound(state, round, athleteId) {
  return round.positions?.[athleteId] || positionOf(athleteOf(state, athleteId), round.modality);
}

const goalkeeperForRound = (state, round, id) => positionForRound(state, round, id).toLocaleLowerCase('pt-BR') === 'goleiro';

function snapshotPositions(state, round) {
  round.positions ||= {};
  for (const team of round.teams) {
    for (const id of team.athleteIds) {
      if (!round.positions[id]) round.positions[id] = positionOf(athleteOf(state, id), round.modality);
    }
  }
}

function skillChanges(state, round, event) {
  const isGoalkeeper = goalkeeperForRound(state, round, event.athleteId);
  if (event.type === 'assist') return isGoalkeeper ? { kic: 1 } : { pas: 1 };
  if (event.type === 'dangerousPass') return isGoalkeeper ? { kic: -1 } : { pas: -1 };
  if (event.type === 'goalError') return isGoalkeeper ? { han: -1, pos: -1 } : { def: -1 };
  if (event.type === 'ownGoal') return isGoalkeeper ? { pos: -1 } : { def: -1 };
  const rule = RULES.get(event.type);
  if (rule?.goalkeeperOnly && !isGoalkeeper) return {};
  return rule?.skill || {};
}

function validateModality(modality) {
  if (!MODALITIES[modality]) fail('Modalidade inválida.');
}

function validateRosters(state, round) {
  validateModality(round.modality);
  const seen = new Set();
  const teamIds = new Set();
  for (const team of round.teams) {
    if (teamIds.has(team.id)) fail('Há equipes com o mesmo identificador.');
    teamIds.add(team.id);
    if (team.captainId != null && !team.athleteIds.includes(team.captainId)) fail('O capitão precisa fazer parte da equipe.');
    for (const id of team.athleteIds) {
      athleteOf(state, id);
      if (seen.has(id)) fail('Um atleta só pode pertencer a uma equipe na pelada.');
      seen.add(id);
    }
  }
  for (const match of round.matches) {
    if (!teamIds.has(match.homeId) || !teamIds.has(match.awayId)) fail('O jogo contém uma equipe não confirmada.');
    if (match.homeId === match.awayId) fail('Um jogo precisa de duas equipes diferentes.');
    if (!MATCH_STATUSES.includes(match.status)) fail('Situação do jogo inválida.');
  }
}

function validateFantasy(state, round, lineup) {
  const expected = MODALITIES[round.modality].teamSize;
  if (!lineup.name?.trim()) fail('Informe o nome do time fantasy.');
  if (!Array.isArray(lineup.athleteIds) || lineup.athleteIds.length !== expected) fail(`Escale exatamente ${expected} atletas para ${MODALITIES[round.modality].label.toLowerCase()}.`);
  if (new Set(lineup.athleteIds).size !== expected) fail('O fantasy não pode ter atletas repetidos.');
  let keepers = 0;
  for (const id of lineup.athleteIds) {
    const athlete = athleteOf(state, id);
    if (!teamOf(round, id)) fail('Só é possível escalar atletas confirmados nesta pelada.');
    if (goalkeeperForRound(state, round, athlete.id)) keepers++;
  }
  if (keepers !== 1) fail('O fantasy precisa de exatamente um goleiro.');
}

function validateReady(state, round) {
  validateRosters(state, round);
  if (round.teams.length < 2) fail('Confirme pelo menos duas equipes para a pelada.');
  if (!round.matches.length) fail('Cadastre pelo menos um jogo antes de iniciar a pelada.');
  const participatingTeams = new Set(round.matches.filter(match => match.status !== 'cancelled').flatMap(match => [match.homeId, match.awayId]));
  const minimum = MODALITIES[round.modality].teamSize;
  for (const team of round.teams.filter(item => participatingTeams.has(item.id))) {
    if (team.athleteIds.length < minimum) fail(`A equipe ${team.name} precisa de pelo menos ${minimum} atletas confirmados.`);
    if (!team.athleteIds.some(id => goalkeeperForRound(state, round, id))) fail(`A equipe ${team.name} precisa de pelo menos um goleiro.`);
  }
}

function validateEvent(state, round, event) {
  const match = matchOf(round, event.matchId);
  if (match.status === 'cancelled') fail('Não é possível registrar lances em um jogo cancelado.');
  if (!['live', 'finished'].includes(match.status)) fail('Inicie o jogo antes de registrar os lances.');
  const athlete = athleteOf(state, event.athleteId);
  const team = teamOf(round, athlete.id);
  if (!team || (team.id !== match.homeId && team.id !== match.awayId)) fail('O atleta não pertence às equipes deste jogo.');
  const rule = RULES.get(event.type);
  if (!rule) fail('Tipo de lance inválido.');
  if (rule.goalkeeperOnly && !goalkeeperForRound(state, round, athlete.id)) fail('Este lance só pode ser registrado para um goleiro.');
  return rule;
}

function mutateRound(state, roundId, update) {
  roundOf(state, roundId);
  const next = clone(state);
  const round = roundOf(next, roundId);
  if (round.status === 'live') snapshotPositions(next, round);
  update(round, next);
  return next;
}

function editable(round) {
  if (round.status === 'closed') fail('Reabra a pelada para corrigir os resultados.');
}

export function getMatchScore(round, matchId) {
  const match = matchOf(round, matchId);
  let home = 0, away = 0;
  if (['live', 'finished'].includes(match.status)) {
    for (const event of round.events) {
      if (event.matchId !== match.id || !['goal', 'ownGoal'].includes(event.type)) continue;
      const team = teamOf(round, event.athleteId);
      if (!team || ![match.homeId, match.awayId].includes(team.id)) continue;
      const homeScored = event.type === 'ownGoal' ? team.id === match.awayId : team.id === match.homeId;
      if (homeScored) home++; else away++;
    }
  }
  return { home, away, homeGoals: home, awayGoals: away, homeId: match.homeId, awayId: match.awayId };
}

export function getRoundStats(state, roundId) {
  const round = roundOf(state, roundId);
  const rows = round.teams.flatMap(team => team.athleteIds.map(id => {
    const athlete = athleteOf(state, id);
    const counts = Object.fromEntries(EVENT_RULES.map(rule => [rule.type, 0]));
    const playedMatches = round.matches.filter(match => match.status === 'finished' && [match.homeId, match.awayId].includes(team.id)).length;
    return { athleteId: id, name: athlete.name, nickname: athlete.nickname || athlete.name, teamId: team.id, teamName: team.name,
      position: positionForRound(state, round, id), isGoalkeeper: goalkeeperForRound(state, round, id), points: 0, playedMatches,
      ...counts, goals: 0, assists: 0, interceptions: 0, tackles: 0, saves: 0, penaltySaves: 0 };
  }));
  const byId = new Map(rows.map(row => [row.athleteId, row]));
  for (const event of round.events) {
    const match = round.matches.find(item => item.id === event.matchId);
    const row = byId.get(event.athleteId);
    const rule = RULES.get(event.type);
    if (!match || !['live', 'finished'].includes(match.status) || !row || !rule || ![match.homeId, match.awayId].includes(row.teamId)) continue;
    if (rule.goalkeeperOnly && !row.isGoalkeeper) continue;
    row[event.type]++;
    row.points += rule.points;
  }
  for (const row of rows) {
    row.goals = row.goal;
    row.assists = row.assist;
    row.interceptions = row.interception;
    row.tackles = row.tackle;
    row.penaltySaves = row.penaltySave;
    row.saves = row.save + row.penaltySave;
  }
  return rows.sort((a, b) => b.points - a.points || b.goals - a.goals || a.nickname.localeCompare(b.nickname, 'pt-BR'));
}

function ranked(rows) {
  let previousPoints, previousRank;
  return rows.map((row, index) => {
    const rank = index > 0 && row.points === previousPoints ? previousRank : index + 1;
    previousPoints = row.points;
    previousRank = rank;
    return { ...row, rank };
  });
}

export function getFantasyRanking(state, roundId) {
  const round = roundOf(state, roundId);
  const stats = new Map(getRoundStats(state, roundId).map(row => [row.athleteId, row]));
  return ranked(round.fantasy.map(lineup => ({ ...clone(lineup), points: lineup.athleteIds.reduce((total, id) => total + (stats.get(id)?.points ?? 0), 0),
    athleteNames: lineup.athleteIds.map(id => athleteOf(state, id).nickname || athleteOf(state, id).name),
    athletes: lineup.athleteIds.map(id => stats.get(id) || { athleteId: id, nickname: athleteOf(state, id).nickname, points: 0 })
  })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'pt-BR')));
}

export function getSeasonRanking(state, modality) {
  validateModality(modality);
  const rows = new Map(state.athletes.map(athlete => [athlete.id, {
    athleteId: athlete.id, name: athlete.name, nickname: athlete.nickname || athlete.name,
    position: positionOf(athlete, modality), isGoalkeeper: goalkeeper(athlete, modality),
    points: 0, goals: 0, assists: 0, interceptions: 0, tackles: 0, saves: 0, penaltySaves: 0, playedMatches: 0, playedRounds: 0,
  }]));
  const seasonRounds = state.rounds.filter(item => item.status === 'closed' && item.modality === modality)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const round of seasonRounds) {
    for (const stats of getRoundStats(state, round.id)) {
      const row = rows.get(stats.athleteId);
      for (const key of ['points', 'goals', 'assists', 'interceptions', 'tackles', 'saves', 'penaltySaves', 'playedMatches']) row[key] += stats[key];
      if (stats.playedMatches > 0) {
        row.playedRounds++;
        row.position = stats.position;
        row.isGoalkeeper = stats.isGoalkeeper;
      }
    }
  }
  return ranked([...rows.values()].filter(row => row.playedRounds > 0).sort((a, b) => b.points - a.points || b.goals - a.goals || a.nickname.localeCompare(b.nickname, 'pt-BR')));
}

export function getAthleteSkills(state, athleteId, modality) {
  validateModality(modality);
  const athlete = athleteOf(state, athleteId);
  const attributes = Object.fromEntries(SKILLS.map(key => [key, roundedSkill(athlete.baseSkills?.[modality]?.[key])]));
  const closedRounds = state.rounds.filter(item => item.status === 'closed' && item.modality === modality)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const round of closedRounds) {
    const sums = Object.fromEntries(SKILLS.map(key => [key, 0]));
    for (const event of round.events) {
      if (event.athleteId !== athleteId) continue;
      const match = round.matches.find(item => item.id === event.matchId);
      if (!match || match.status !== 'finished') continue;
      const changes = skillChanges(state, round, event);
      for (const [key, value] of Object.entries(changes)) sums[key] += value;
    }
    for (const key of SKILLS) attributes[key] = roundedSkill(attributes[key] + Math.sign(sums[key]));
  }
  const position = positionOf(athlete, modality);
  const isGoalkeeper = goalkeeper(athlete, modality);
  let weights;
  if (isGoalkeeper) weights = { div: .24, han: .2, kic: .12, ref: .24, spd: .05, pos: .15 };
  else if (['Zagueiro', 'Lateral', 'Fixo', 'Defensor', 'Volante'].includes(position)) weights = { rit: .12, fin: .06, pas: .17, con: .1, def: .35, fis: .2 };
  else if (['Atacante', 'Pivô'].includes(position)) weights = { rit: .18, fin: .35, pas: .12, con: .2, def: .03, fis: .12 };
  else weights = { rit: .18, fin: .18, pas: .25, con: .22, def: .07, fis: .1 };
  const overall = roundedSkill(Object.entries(weights).reduce((total, [key, weight]) => total + attributes[key] * weight, 0));
  return { ...attributes, overall, position, isGoalkeeper };
}

export function recordEvent(state, roundId, payload) {
  return mutateRound(state, roundId, (round, next) => {
    editable(round);
    if (round.status === 'draft') fail('Inicie a pelada antes de registrar os lances.');
    validateRosters(next, round);
    validateEvent(next, round, payload);
    const id = payload.id || uid('lance');
    if (round.events.some(event => event.id === id)) fail('Este lance já foi registrado.');
    round.events.push({ id, matchId: payload.matchId, athleteId: payload.athleteId, type: payload.type, createdAt: payload.createdAt || new Date().toISOString() });
  });
}

export function removeEvent(state, roundId, eventId) {
  return mutateRound(state, roundId, round => {
    editable(round);
    if (!round.events.some(event => event.id === eventId)) fail('Lance não encontrado.');
    round.events = round.events.filter(event => event.id !== eventId);
  });
}

export function saveFantasy(state, roundId, payload) {
  return mutateRound(state, roundId, (round, next) => {
    if (round.status !== 'draft') fail('As escalações estão travadas desde o início da pelada.');
    validateRosters(next, round);
    validateFantasy(next, round, payload);
    const lineup = { id: payload.id || uid('fantasy'), name: payload.name.trim(), owner: payload.owner?.trim() || 'Parça', athleteIds: [...payload.athleteIds] };
    const index = round.fantasy.findIndex(item => item.id === lineup.id);
    if (index === -1) round.fantasy.push(lineup); else round.fantasy[index] = lineup;
  });
}

export function drawCaptains(state, roundId, random = Math.random) {
  return mutateRound(state, roundId, (round, next) => {
    editable(round);
    validateRosters(next, round);
    if (round.teams.some(team => !team.athleteIds.length)) fail('Cada equipe precisa ter atletas para sortear seu capitão.');
    if (round.status === 'live' && round.teams.every(team => team.captainId)) fail('Os capitães já foram definidos nesta pelada.');
    round.teams = round.teams.map(team => {
      if (round.status === 'live' && team.captainId) return team;
      return { ...team, captainId: team.athleteIds[randomIndex(team.athleteIds.length, random)] };
    });
  });
}

export function drawTeams(state, roundId, mode = 'random', random = Math.random) {
  return mutateRound(state, roundId, (round, next) => {
    if (round.status !== 'draft') fail('Os times só podem ser sorteados antes de começar a pelada.');
    if (!['random', 'balanced'].includes(mode)) fail('Escolha sorteio aleatório ou equilibrado por nota.');
    validateRosters(next, round);
    const participants = round.teams.flatMap(team => team.athleteIds);
    if (participants.length < round.teams.length) fail('Confirme pelo menos um atleta por time antes do sorteio.');
    const order = shuffled(round.teams.map((_, index) => index), random);
    const rating = new Map(participants.map(id => [id, getAthleteSkills(next, id, round.modality).overall]));
    const keeper = id => goalkeeper(athleteOf(next, id), round.modality);
    const pool = ids => { const mixed = shuffled(ids, random); return mode === 'balanced' ? mixed.sort((a, b) => rating.get(b) - rating.get(a)) : mixed; };
    const goalkeepers = pool(participants.filter(keeper));
    const fieldPlayers = pool(participants.filter(id => !keeper(id)));
    const teams = round.teams.map(team => ({ ...team, athleteIds: [], captainId: null }));
    const capacity = teams.map((_, index) => Math.floor(participants.length / teams.length) + (order.indexOf(index) < participants.length % teams.length ? 1 : 0));
    const totals = teams.map(() => 0);
    const keeperCounts = teams.map(() => 0);
    const place = (id, isKeeper) => {
      const available = order.filter(index => teams[index].athleteIds.length < capacity[index]);
      const uncovered = isKeeper ? available.filter(index => !keeperCounts[index]) : [];
      const candidates = uncovered.length ? uncovered : available;
      const best = candidates.reduce((left, right) => {
        if (mode === 'balanced' && totals[right] !== totals[left]) return totals[right] < totals[left] ? right : left;
        return teams[right].athleteIds.length < teams[left].athleteIds.length ? right : left;
      }, candidates[0]);
      teams[best].athleteIds.push(id);
      totals[best] += rating.get(id);
      if (isKeeper) keeperCounts[best]++;
    };
    goalkeepers.forEach(id => place(id, true));
    fieldPlayers.forEach(id => place(id, false));
    if (mode === 'balanced') {
      const spread = values => Math.max(...values) - Math.min(...values);
      let improved = true;
      for (let pass = 0; pass < 60 && improved; pass++) {
        improved = false;
        search: for (let left = 0; left < teams.length; left++) for (let right = left + 1; right < teams.length; right++) {
          for (const a of teams[left].athleteIds) for (const b of teams[right].athleteIds) {
            if (keeper(a) !== keeper(b)) continue;
            const nextTotals = [...totals];
            nextTotals[left] += rating.get(b) - rating.get(a);
            nextTotals[right] += rating.get(a) - rating.get(b);
            if (spread(nextTotals) >= spread(totals)) continue;
            teams[left].athleteIds[teams[left].athleteIds.indexOf(a)] = b;
            teams[right].athleteIds[teams[right].athleteIds.indexOf(b)] = a;
            totals[left] = nextTotals[left]; totals[right] = nextTotals[right];
            improved = true;
            break search;
          }
        }
      }
    }
    round.teams = teams;
    round.drawMode = mode;
  });
}

export function beginRound(state, roundId) {
  const current = roundOf(state, roundId);
  if (current.status === 'live' && current.positions) return state;
  if (current.status === 'closed') fail('A pelada já foi fechada. Reabra para corrigir.');
  return mutateRound(state, roundId, (round, next) => {
    snapshotPositions(next, round);
    validateReady(next, round);
    for (const lineup of round.fantasy) validateFantasy(next, round, lineup);
    round.status = 'live';
  });
}

export function setMatchStatus(state, roundId, matchId, status) {
  return mutateRound(state, roundId, round => {
    editable(round);
    if (!MATCH_STATUSES.includes(status)) fail('Situação do jogo inválida.');
    if (status === 'live' && round.status === 'draft') fail('Inicie a pelada antes de começar o jogo.');
    matchOf(round, matchId).status = status;
  });
}

export function closeRound(state, roundId) {
  const current = roundOf(state, roundId);
  if (current.status === 'closed') return state;
  return mutateRound(state, roundId, (round, next) => {
    snapshotPositions(next, round);
    validateReady(next, round);
    if (!round.matches.some(match => match.status === 'finished')) fail('Finalize pelo menos um jogo antes de fechar a pelada.');
    if (round.matches.some(match => !['finished', 'cancelled'].includes(match.status))) fail('Finalize ou cancele todos os jogos antes de fechar a pelada.');
    const eventIds = new Set();
    for (const event of round.events) {
      if (eventIds.has(event.id)) fail('Há lances duplicados na súmula.');
      eventIds.add(event.id);
      const match = matchOf(round, event.matchId);
      // Lances de partidas canceladas ficam no histórico, mas não pontuam.
      if (match.status !== 'cancelled') validateEvent(next, round, event);
    }
    for (const lineup of round.fantasy) validateFantasy(next, round, lineup);
    for (const match of round.matches.filter(item => item.status === 'finished')) {
      for (const teamId of [match.homeId, match.awayId]) {
        const ownEvents = round.events.filter(event => event.matchId === match.id && teamOf(round, event.athleteId)?.id === teamId);
        const goals = ownEvents.filter(event => event.type === 'goal').length;
        const assists = ownEvents.filter(event => event.type === 'assist').length;
        if (assists > goals) fail('O número de assistências de uma equipe não pode ultrapassar seus gols no jogo.');
      }
    }
    round.status = 'closed';
    round.revision = (round.revision || 0) + 1;
    round.closedAt = new Date().toISOString();
  });
}

export function reopenRound(state, roundId) {
  const current = roundOf(state, roundId);
  if (current.status !== 'closed') fail('Só é possível reabrir uma pelada fechada.');
  return mutateRound(state, roundId, round => { round.status = 'live'; });
}
