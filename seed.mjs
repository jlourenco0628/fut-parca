const profiles = [
  ['Rafael Costa', 'Paredão', 'Goleiro', 82], ['João Pedro', 'JP', 'Fixo', 78], ['Lucas Silva', 'Luquinhas', 'Ala', 85], ['Bruno Lima', 'Brunão', 'Ala', 77], ['Matheus Alves', 'Matheuzinho', 'Pivô', 88],
  ['Diego Souza', 'Muralha', 'Goleiro', 81], ['Gabriel Rocha', 'Biel', 'Fixo', 76], ['Felipe Santos', 'Felipinho', 'Ala', 83], ['André Melo', 'Dedé', 'Ala', 79], ['Vinícius Oliveira', 'Vini', 'Pivô', 86],
  ['Thiago Pereira', 'Tigão', 'Goleiro', 80], ['Pedro Martins', 'Pedrão', 'Fixo', 75], ['Caio Ribeiro', 'Caião', 'Ala', 82], ['Gustavo Nunes', 'Guga', 'Ala', 84], ['Henrique Dias', 'Rick', 'Pivô', 87],
];

function baseSkills(overall, isGoalkeeper, index) {
  return { rit: overall + 2 - index % 4, fin: overall + (index % 5 === 4 ? 4 : -7), pas: overall - 1, con: overall + 1,
    def: overall + (index % 5 === 1 ? 5 : -14), fis: overall - 4,
    div: isGoalkeeper ? overall + 2 : 35, han: isGoalkeeper ? overall - 1 : 32, kic: isGoalkeeper ? overall - 5 : 38,
    ref: isGoalkeeper ? overall + 3 : 31, spd: isGoalkeeper ? overall - 15 : 37, pos: isGoalkeeper ? overall + 1 : 33 };
}

export function createSeed() {
  const athletes = profiles.map(([name, nickname, position, rating], index) => {
    const isGoalkeeper = position === 'Goleiro';
    return { id: `atleta-${String(index + 1).padStart(2, '0')}`, name, nickname, contact: `parca${index + 1}@example.com`, photo: '',
      preferences: {
        futebol: { primary: isGoalkeeper ? 'Goleiro' : position === 'Fixo' ? 'Zagueiro' : position === 'Pivô' ? 'Atacante' : 'Meia', secondary: isGoalkeeper ? 'Zagueiro' : 'Lateral' },
        futsal: { primary: position, secondary: isGoalkeeper ? 'Fixo' : position === 'Pivô' ? 'Ala' : 'Pivô' },
        society: { primary: isGoalkeeper ? 'Goleiro' : position === 'Fixo' ? 'Defensor' : position === 'Pivô' ? 'Atacante' : 'Meio-campista', secondary: isGoalkeeper ? 'Defensor' : 'Atacante' },
      }, baseSkills: { futebol: baseSkills(rating - 2, isGoalkeeper, index), futsal: baseSkills(rating, isGoalkeeper, index), society: baseSkills(rating - 1, isGoalkeeper, index) } };
  });
  const teams = [
    { id: 'verde', name: 'Maré Verde', color: '#c6ff5c', athleteIds: athletes.slice(0, 5).map(a => a.id) },
    { id: 'ouro', name: 'Sol Dourado', color: '#ffd36b', athleteIds: athletes.slice(5, 10).map(a => a.id) },
    { id: 'roxo', name: 'Resenha Roxa', color: '#ac8bfa', athleteIds: athletes.slice(10, 15).map(a => a.id) },
  ];
  const matches = [
    { id: 'jogo-1', homeId: 'verde', awayId: 'ouro', status: 'finished' },
    { id: 'jogo-2', homeId: 'ouro', awayId: 'roxo', status: 'finished' },
    { id: 'jogo-3', homeId: 'roxo', awayId: 'verde', status: 'live' },
  ];
  const events = [];
  const add = (matchId, index, type, count = 1) => {
    for (let i = 0; i < count; i++) events.push({ id: `lance-demo-${events.length + 1}`, matchId, athleteId: athletes[index - 1].id, type, createdAt: `2026-09-15T22:${String(events.length % 60).padStart(2, '0')}:00.000Z` });
  };
  add('jogo-1', 5, 'goal', 2); add('jogo-1', 3, 'goal'); add('jogo-1', 3, 'assist', 2); add('jogo-1', 4, 'assist');
  add('jogo-1', 10, 'goal'); add('jogo-1', 8, 'goal'); add('jogo-1', 9, 'assist'); add('jogo-1', 8, 'assist');
  add('jogo-1', 1, 'save', 5); add('jogo-1', 6, 'save', 4); add('jogo-1', 2, 'interception', 3); add('jogo-1', 7, 'tackle', 2); add('jogo-1', 5, 'missedChance');
  add('jogo-2', 10, 'goal'); add('jogo-2', 8, 'assist'); add('jogo-2', 15, 'goal'); add('jogo-2', 14, 'assist');
  add('jogo-2', 6, 'save', 6); add('jogo-2', 11, 'save', 5); add('jogo-2', 12, 'interception', 2); add('jogo-2', 13, 'tackle'); add('jogo-2', 9, 'dangerousPass');
  add('jogo-3', 5, 'goal'); add('jogo-3', 3, 'assist'); add('jogo-3', 14, 'goal'); add('jogo-3', 13, 'assist');
  add('jogo-3', 1, 'save', 3); add('jogo-3', 11, 'save', 2); add('jogo-3', 2, 'tackle');
  const fantasy = [
    { id: 'fantasy-jp', name: 'Só Resenha FC', owner: 'João Pedro', athleteIds: [athletes[0].id, athletes[2].id, athletes[4].id, athletes[7].id, athletes[13].id] },
    { id: 'fantasy-biel', name: 'Os Crias', owner: 'Gabriel Rocha', athleteIds: [athletes[5].id, athletes[1].id, athletes[9].id, athletes[12].id, athletes[14].id] },
    { id: 'fantasy-guga', name: 'Tropa do Guga', owner: 'Gustavo Nunes', athleteIds: [athletes[10].id, athletes[3].id, athletes[7].id, athletes[9].id, athletes[13].id] },
  ];
  return { version: 1, athletes, rounds: [
    { id: 'pelada-01', isDemo: true, title: 'Pelada dos Parças', date: '2026-09-15', modality: 'futsal', status: 'live', revision: 0, teams, matches, events, fantasy },
    { id: 'pelada-02', isDemo: true, title: 'Próxima resenha', date: '2026-09-22', modality: 'futsal', status: 'draft', revision: 0,
      teams: structuredClone(teams), matches: matches.map((match, index) => ({ ...match, id: `proximo-${index + 1}`, status: 'scheduled' })), events: [], fantasy: [] },
  ] };
}
