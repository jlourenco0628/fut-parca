/** Original, editable Fut Parça athlete card. No remote images or dependencies. */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const clampRating = (value, fallback = 55) => Number.isFinite(Number(value)) ? Math.max(1, Math.min(99, Math.round(Number(value)))) : fallback;
const imageSource = value => {
  if (typeof value !== 'string' || !value.trim()) return '';
  const source = value.trim();
  return /^(?:https?:\/\/|blob:|data:image\/(?:png|jpeg|jpg|webp|gif|avif);base64,|\.\.?\/|\/)/i.test(source) && !/[\u0000-\u001f]/.test(source) ? source : '';
};

const positionLabel = position => {
  const value = String(position || 'Ala').toUpperCase();
  return ({ GOLEIRO: 'GOL', GOL: 'GOL', GK: 'GOL', FIXO: 'FIX', ALA: 'ALA', PIVÔ: 'PIV', PIVO: 'PIV', ZAGUEIRO: 'ZAG', ZAG: 'ZAG', DEFENSOR: 'DEF', LATERAL: 'LAT', VOLANTE: 'VOL', MEIA: 'MEI', 'MEIO-CAMPISTA': 'MEI', ATACANTE: 'ATA' })[value] || value.slice(0, 3);
};

const flagCountry = value => {
  const country = String(value || '').trim().toLocaleLowerCase('pt-BR');
  if (['pt', 'portugal', 'português', 'portuguesa'].includes(country)) return 'PT';
  if (['ar', 'argentina', 'argentino', 'argentina'].includes(country)) return 'AR';
  return 'BR';
};

const countryFlag = value => {
  const country = flagCountry(value);
  const flags = {
    BR: ['Brasil', '<rect width="32" height="22" rx="1.5" fill="#078446"/><path d="M16 2 30 11 16 20 2 11Z" fill="#ffdc3e"/><circle cx="16" cy="11" r="5.5" fill="#183b84"/><path d="M10.8 9.4c3.6-.3 6.9.4 10.3 2.6" fill="none" stroke="#fff" stroke-width="1.1"/><g fill="#fff"><circle cx="14" cy="12" r=".45"/><circle cx="18" cy="13.5" r=".45"/><circle cx="16" cy="14.5" r=".35"/></g>'],
    PT: ['Portugal', '<rect width="12" height="22" rx="1.5" fill="#046a38"/><path d="M10.5 0H32v22H10.5Z" fill="#da291c"/><circle cx="11" cy="11" r="4" fill="#ffcc33"/><circle cx="11" cy="11" r="2.4" fill="#fff"/><path d="M9.4 8.8h3.2v4.4H9.4Z" fill="#da291c"/>'],
    AR: ['Argentina', '<rect width="32" height="22" rx="1.5" fill="#74acdf"/><path d="M0 7.3h32v7.4H0Z" fill="#fff"/><circle cx="16" cy="11" r="2.4" fill="#f6b40e"/><path d="m16 7.6.5 1.6 1.4-.9-.6 1.6 1.7.1-1.5 1 1.2 1.2-1.7-.4.2 1.7-1.2-1.3-1.2 1.3.2-1.7-1.7.4 1.2-1.2-1.5-1 1.7-.1-.6-1.6 1.4.9Z" fill="#f6b40e"/>'],
  };
  const [label, art] = flags[country];
  return `<span class="athlete-card__flag-frame" aria-label="${label}" role="img"><svg class="athlete-card__flag" viewBox="0 0 32 22" aria-hidden="true">${art}</svg></span>`;
};

const clubBadge = club => {
  const source = imageSource(club?.logo);
  const name = String(club?.name || 'Fut Parça').trim() || 'Fut Parça';
  if (!source) return '<span class="athlete-card__crest athlete-card__crest--fallback" aria-label="Fut Parça" role="img"><span class="athlete-card__fallback-mark" aria-hidden="true"></span></span>';
  return `<span class="athlete-card__crest athlete-card__crest--group" aria-label="Escudo de ${escapeHTML(name)}" role="img"><img class="athlete-card__crest-image" src="${escapeHTML(source)}" alt="" loading="lazy" draggable="false" data-fp-logo-cutout></span>`;
};

let cardInstance = 0;

function portrait(id) {
  const presets = {
    'avatar-1': { skin:'#d6a481', jersey:'#173344', hair:0, female:false },
    'avatar-2': { skin:'#70442e', jersey:'#143f35', hair:1, female:false },
    'avatar-3': { skin:'#e1b18e', jersey:'#353c70', hair:2, female:true },
    'avatar-4': { skin:'#75462f', jersey:'#6a2948', hair:0, female:true },
  };
  const preset = presets[id];
  let seed = 0;
  for (const letter of String(id || 'parca')) seed = (seed * 31 + letter.charCodeAt(0)) >>> 0;
  const skins = ['#b7754e', '#d6a481', '#865638', '#c98f69', '#9f6b4b'];
  const jerseys = ['#143f35', '#173344', '#1e493b', '#353c29'];
  const skin = preset?.skin || skins[seed % skins.length];
  const jersey = preset?.jersey || jerseys[(seed >>> 3) % jerseys.length];
  const hair = preset?.hair ?? seed % 3;
  const hairShape = preset?.female ? '<path d="M48 91Q43 35 84 30Q125 36 120 94L112 107 107 55Q85 39 62 55L58 108Z" fill="#241c1b"/><path d="M51 70Q49 32 85 31Q117 33 118 67 106 48 87 45 67 47 55 68Z" fill="#241c1b"/>' : hair === 0 ? '<path d="M52 66C48 29 107 21 116 61L111 74 105 49 64 51 56 78Z" fill="#221c19"/><path d="M61 48 58 40 68 36 73 28 84 33 95 28 103 35 113 40 110 55Z" fill="#221c19"/>' : hair === 1 ? '<path d="M52 70C46 30 102 25 115 53L115 73 108 57C92 52 86 42 70 52L59 79Z" fill="#2c221c"/>' : '<path d="M54 60C62 33 98 32 111 59L108 50C92 38 73 40 59 51Z" fill="#29221c"/>';
  return `<svg class="athlete-card__portrait" viewBox="0 0 170 210" aria-hidden="true"><path d="M16 210 22 153Q27 136 62 127L108 127Q143 136 148 153L155 210Z" fill="${jersey}"/><path d="m62 127 7-28h32l7 28-23 20Z" fill="${skin}"/><path d="m66 124 19 13 19-13 10 5-29 24-29-24Z" fill="#dfc97d"/><path d="M53 62Q54 39 82 37Q109 39 114 62L110 92Q102 119 85 122Q65 118 56 94Z" fill="${skin}"/><ellipse cx="53" cy="79" rx="5" ry="11" fill="${skin}"/><ellipse cx="114" cy="79" rx="5" ry="11" fill="${skin}"/>${hairShape}<path d="M64 71q8-4 15-1M91 70q8-3 14 1" stroke="#433026" stroke-width="2.8" fill="none" stroke-linecap="round"/><ellipse cx="72" cy="77" rx="2" ry="2.4" fill="#291f1a"/><ellipse cx="99" cy="77" rx="2" ry="2.4" fill="#291f1a"/><path d="m86 76-3 15 7 1" stroke="#8a563b" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M74 102q11 6 22-1" stroke="#6a3f30" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M65 95q3 18 20 21 15-2 21-18-3 24-22 26-18-5-19-29Z" fill="#32251e" opacity=".2"/><path d="M30 154 41 210M140 154 129 210" stroke="#fff" stroke-opacity=".13" stroke-width="2"/><path d="m39 147 15-6 6 14-15 6Z" fill="#e7d18a"/><path d="M112 141h13v15h-13Z" fill="#e7d18a"/><path d="M65 177h40" stroke="#e7d18a" stroke-width="3" stroke-linecap="round"/><path d="M71 183h28" stroke="#e7d18a" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}

/**
 * @param {{athlete: {id?: string|number, name?: string, nickname?: string, photo?: string, avatar?: string, countryCode?: string, nationality?: string}, skills?: object, position?: string, modality?: string, variant?: 'bronze'|'silver'|'gold'|'blue'|'special', compact?: boolean, club?: {name?: string, logo?: string}}} options
 * @returns {string} Safe HTML; insert into the application DOM and load card.css once.
 */
export function renderAthleteCard({ athlete = {}, skills = {}, position = 'Ala', modality = 'futsal', variant = 'gold', compact = false, club = {} } = {}) {
  const kind = ['bronze', 'silver', 'gold', 'blue', 'special'].includes(variant) ? variant : 'gold';
  const pos = positionLabel(position);
  const goalkeeper = pos === 'GOL';
  const attributes = goalkeeper ? [['div', 'DEF'], ['han', 'SEG'], ['kic', 'REP'], ['ref', 'REF'], ['spd', 'VEL'], ['pos', 'POS']] : [['rit', 'RIT'], ['fin', 'FIN'], ['pas', 'PAS'], ['con', 'CON'], ['def', 'DEF'], ['fis', 'FIS']];
  const average = attributes.reduce((sum, [key]) => sum + clampRating(skills[key]), 0) / 6;
  const rating = clampRating(skills.overall, Math.round(average));
  const name = String(athlete.nickname || athlete.name || 'Novo Parça').trim();
  const source = imageSource(athlete.photo);
  const avatarSource = /^avatar-[1-4]$/.test(String(athlete.avatar || '')) ? `./${athlete.avatar}.png` : '';
  const instance = ++cardInstance;
  const gradId = `fp-card-${kind}-${String(athlete.id || name).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'athlete'}-${instance}`;
  const entries = [attributes.slice(0, 3), attributes.slice(3)].map(column => `<div class="athlete-card__stat-column">${column.map(([key, label]) => `<div class="athlete-card__stat" data-stat="${key}"><strong>${clampRating(skills[key])}</strong><span>${label}</span></div>`).join('')}</div>`).join('');
  const nameClass = name.length > 17 ? ' athlete-card__name--long' : '';
  const award = kind === 'special' ? '<span class="athlete-card__award">MELHOR DA SEMANA</span>' : '';
  const shield = 'M130 8C154 22 187 26 218 29C226 43 237 49 248 53L238 250C236 285 213 306 181 324L130 352L79 324C47 306 24 285 22 250L12 53C23 49 34 43 42 29C73 26 106 22 130 8Z';
  return `<article class="athlete-card athlete-card--${kind}${compact ? ' athlete-card--compact' : ''}" data-athlete-id="${escapeHTML(athlete.id)}" data-modality="${escapeHTML(modality)}" aria-label="Card de ${escapeHTML(name)}, ${escapeHTML(position)}, nota geral ${rating}">${award}<svg class="athlete-card__background" viewBox="0 0 260 360" aria-hidden="true"><defs><linearGradient id="${gradId}" x1=".04" y1=".02" x2=".95" y2="1"><stop offset="0" class="athlete-card__stop-1"/><stop offset=".3" class="athlete-card__stop-2"/><stop offset=".66" class="athlete-card__stop-3"/><stop offset="1" class="athlete-card__stop-4"/></linearGradient><linearGradient id="${gradId}-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".22" stop-color="#fff" stop-opacity=".28"/><stop offset=".52" stop-color="#241304" stop-opacity=".42"/><stop offset=".78" stop-color="#fff" stop-opacity=".42"/><stop offset="1" stop-color="#2b1704" stop-opacity=".5"/></linearGradient><radialGradient id="${gradId}-light" cx="35%" cy="22%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".42" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".13"/></radialGradient><clipPath id="${gradId}-clip"><path d="${shield}"/></clipPath></defs><path class="athlete-card__depth" d="${shield}" transform="translate(0 4)"/><path class="athlete-card__outer" d="${shield}" fill="url(#${gradId})"/><g clip-path="url(#${gradId}-clip)"><path d="m-8 128 121-81 156 61-127 48Z" fill="#fff" opacity=".14"/><path d="M112 47 231-6 269 108Z" fill="#fff" opacity=".12"/><path d="m113 47 17 175 12-66Z" fill="#4f3307" opacity=".12"/><path d="m-3 237 145-81 138 129-149-39Z" fill="#fff" opacity=".1"/><path d="m131 246 115 77-114 54-1-43Z" fill="#fff" opacity=".16"/><path d="m-4 234 136 100-1-88Z" fill="#4e3105" opacity=".09"/><path d="${shield}" fill="url(#${gradId}-light)"/><path class="athlete-card__micro-lines" d="M24 210h212M27 218h206M30 226h200"/></g><path class="athlete-card__rim" d="${shield}" fill="none" stroke="url(#${gradId}-rim)"/><path class="athlete-card__inner-rim" d="M17 61 43 38Q99 31 130 18Q161 31 217 38L243 61 230 249Q226 283 176 313L130 339 84 313Q34 283 30 249Z" fill="none"/></svg><div class="athlete-card__texture" aria-hidden="true"></div><div class="athlete-card__sheen" aria-hidden="true"></div><div class="athlete-card__upper"><strong class="athlete-card__overall">${rating}</strong><span class="athlete-card__position">${escapeHTML(pos)}</span><span class="athlete-card__identity-line"></span>${countryFlag(athlete.countryCode || athlete.nationality)}</div>${clubBadge(club)}<div class="athlete-card__photo${source ? ' athlete-card__photo--uploaded' : ''}">${source || avatarSource ? `<img class="athlete-card__portrait athlete-card__portrait--photo" src="${escapeHTML(source || avatarSource)}" alt="Foto de ${escapeHTML(name)}" loading="lazy" draggable="false"${source ? ' data-fp-cutout' : ''}/>` : portrait(athlete.id || name)}</div><div class="athlete-card__name${nameClass}"><span>${escapeHTML(name.toLocaleUpperCase('pt-BR'))}</span></div><div class="athlete-card__stats" aria-label="Atributos">${entries}</div></article>`;
}

const motionRoots = new WeakSet();

/** Delegated motion also works for cards inserted later by a page render or dialog. */
export function enableCardMotion(root = document) {
  if (!root?.addEventListener || motionRoots.has(root)) return;
  motionRoots.add(root);

  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const cardFrom = target => target instanceof Element ? target.closest('.athlete-card') : null;
  let activeCard = null;
  let pendingPoint = null;
  let frame = 0;

  const reset = card => {
    if (!card) return;
    card.classList.remove('athlete-card--moving');
    card.style.removeProperty('--fp-tilt-x');
    card.style.removeProperty('--fp-tilt-y');
    card.style.removeProperty('--fp-shine-x');
    card.style.removeProperty('--fp-shine-y');
    if (activeCard === card) activeCard = null;
    if (pendingPoint?.card === card) pendingPoint = null;
  };

  root.addEventListener('pointermove', event => {
    if (reducedMotion?.matches || event.pointerType === 'touch') return;
    const card = cardFrom(event.target);
    if (activeCard && activeCard !== card) reset(activeCard);
    if (!card) return;
    activeCard = card;
    pendingPoint = { card, x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!pendingPoint) return;
      const { card: current, x, y } = pendingPoint;
      pendingPoint = null;
      if (!current.isConnected) return;
      const bounds = current.getBoundingClientRect();
      const horizontal = Math.max(-1, Math.min(1, (x - bounds.left) / bounds.width * 2 - 1));
      const vertical = Math.max(-1, Math.min(1, (y - bounds.top) / bounds.height * 2 - 1));
      current.style.setProperty('--fp-tilt-x', `${(-vertical * 12).toFixed(1)}deg`);
      current.style.setProperty('--fp-tilt-y', `${(horizontal * 16).toFixed(1)}deg`);
      current.style.setProperty('--fp-shine-x', `${((horizontal + 1) * 50).toFixed(0)}%`);
      current.style.setProperty('--fp-shine-y', `${((vertical + 1) * 50).toFixed(0)}%`);
      current.classList.add('athlete-card--moving');
    });
  });

  root.addEventListener('pointerout', event => {
    const card = cardFrom(event.target);
    if (card && !(event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) reset(card);
  });

  root.addEventListener('pointerdown', event => {
    if (reducedMotion?.matches || event.pointerType !== 'touch') return;
    const card = cardFrom(event.target);
    if (!card) return;
    card.classList.remove('athlete-card--tap');
    requestAnimationFrame(() => card.classList.add('athlete-card--tap'));
    setTimeout(() => card.classList.remove('athlete-card--tap'), 850);
  });

  globalThis.addEventListener?.('blur', () => reset(activeCard));
}


