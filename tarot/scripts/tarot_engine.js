#!/usr/bin/env node
/**
 * 塔罗牌解读规则引擎 v2.0
 * 零依赖，Node 10+ 可直接运行。Python 版见 tarot_engine.py。
 *
 * v2.0 修复：
 *  - 正逆位判定不再误伤牌名（倒吊人 / 正义）
 *  - 报牌归一化改为「最长别名匹配 + 结构化解析」，支持 钱币三 / 杯中二 / 星币王后 / 大阿卡纳14号
 *  - 新增花色缺席、位置-元素交互、正逆位分离的主题共振
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'references');

const ELEMENT_POLARITY = { '火': '阳', '风': '阳', '水': '阴', '土': '阴' };
const ELEMENT_OPPOSE = { '火': '水', '水': '火', '风': '土', '土': '风' };

const CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };

const SUIT_PATTERNS = [
  ['星币', /星币|钱币|金币|硬币|土币|pentacle|coins?/i],
  ['权杖', /权杖|火杖|wands?/i],
  ['圣杯', /圣杯|水杯|杯|cups?/i],
  ['宝剑', /宝剑|剑|swords?/i]
];

const RANK_PATTERNS = [
  ['page', /侍从|侍者|卫士|侍卫|童子|学徒|page/i],
  ['knight', /骑士|武士|骑手|knight/i],
  ['queen', /皇后|女王|王后|queen/i],
  ['king', /国王|君王|大帝|king/i]
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
}

function loadAllCards() {
  const cards = {};
  const aliases = {};
  const majors = readJson('major-arcana.json').major_arcana || [];
  const minors = readJson('minor-arcana.json').minor_arcana || [];

  for (const c of majors.concat(minors)) {
    cards[c.id] = c;
    const names = [c.name, c.name_en].concat(c.aliases || []);
    for (const a of names) {
      if (!a) continue;
      const lower = String(a).toLowerCase();
      aliases[lower] = c.id;
      const nospace = lower.replace(/\s+/g, '');
      if (nospace && !(nospace in aliases)) aliases[nospace] = c.id;
    }
  }
  return { cards, aliases };
}

function loadSpreads() {
  return readJson('spreads.json').spreads || [];
}

/** 归一化：去空白与常见标点，英文小写 */
function normalize(text) {
  return String(text || '')
    .replace(/[\u3000\s]+/g, '')
    .replace(/[，,。.、；;：:！!？?（）()【】\[\]「」『』"'"'']/g, '')
    .toLowerCase();
}

/** 别名按键长降序，保证「倒吊人」优先于「吊人」 */
function sortedAliasKeys(aliases) {
  return Object.keys(aliases).sort((a, b) => b.length - a.length);
}

/**
 * 检测正逆位。
 * 核心修复：先把文本中的牌名整段剔除，再判断方位标记。
 * 这样 "倒吊人" 不会被 "倒" 误判为逆位，"正义" 不会被 "正" 误判为正位。
 */
function detectOrientation(text, aliases) {
  if (!text) return 'unknown';
  let t = normalize(text);

  // 剔除牌名（长别名优先，替换为分隔符避免拼接出新词）
  for (const alias of sortedAliasKeys(aliases || {})) {
    if (alias.length >= 2 && t.includes(alias)) {
      t = t.split(alias).join('|');
    }
  }

  const reversedRe = /逆位|逆|倒牌|倒立|倒着|倒置|颠倒|反位|反转|反向|↓/;
  const uprightRe = /正位|正着|直立|正向|↑/;

  if (reversedRe.test(t)) return 'reversed';
  if (uprightRe.test(t)) return 'upright';
  return 'unknown';
}

/** 结构化解析：花色 + 数字 / 宫廷等级 */
function structuredParse(t) {
  let rest = t;
  let suit = null;
  for (const [name, re] of SUIT_PATTERNS) {
    if (re.test(rest)) { suit = name; rest = rest.replace(re, ''); break; }
  }
  if (!suit) return null;

  for (const [rank, re] of RANK_PATTERNS) {
    if (re.test(rest)) {
      const prefix = { '星币': 'pentacle', '权杖': 'wand', '圣杯': 'cup', '宝剑': 'sword' }[suit];
      return `${prefix}-${rank}`;
    }
  }

  let n = null;
  const digit = rest.match(/\d+/);
  if (digit) n = parseInt(digit[0], 10);
  if (!n) {
    if (/王牌|ace|a$/i.test(rest)) n = 1;
    else {
      for (const [cn, v] of Object.entries(CN_NUM)) {
        if (rest.includes(cn)) { n = v; break; }
      }
    }
  }
  if (!n || n < 1 || n > 10) return null;
  const prefix = { '星币': 'pentacle', '权杖': 'wand', '圣杯': 'cup', '宝剑': 'sword' }[suit];
  return `${prefix}-${String(n).padStart(2, '0')}`;
}

/** 大阿卡纳编号解析：大阿卡纳14号 / 14号牌 / 第14张 / 0号牌 */
function majorByNumber(t) {
  let m = t.match(/(?:大阿卡纳|大牌|major)?(\d{1,2})号(?:牌)?/);
  if (!m) m = t.match(/第(\d{1,2})张/);
  if (!m) m = t.match(/^(\d{1,2})$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 0 || n > 21) return null;
  return 'major-' + String(n).padStart(2, '0');
}

/**
 * 报牌归一化。顺序：整体精确 → 最长别名匹配 → 大阿卡纳编号 → 结构化 → 模糊包含。
 */
function resolveCard(text, aliases) {
  if (!text) return null;
  const t = normalize(text);
  if (!t) return null;

  if (aliases[t]) return aliases[t];

  let best = null;
  let bestLen = 0;
  for (const alias of sortedAliasKeys(aliases)) {
    if (alias.length < 2) continue;
    if (t.includes(alias) && alias.length > bestLen) {
      best = aliases[alias];
      bestLen = alias.length;
    }
  }
  if (best) return best;

  const major = majorByNumber(t);
  if (major) return major;

  const structured = structuredParse(t);
  if (structured) return structured;

  return null;
}

/** 虚词与泛用字，参与匹配只会引入噪声 */
const STOP_CHARS = /[的了着在和与是有个一其之这那]/g;

/**
 * 汉字级重合度。
 * 牌面符号是"背上的十剑"这类艺术化短语，用户说的是"背上插了好多剑"，
 * 二字组匹配对不上，改用汉字集合重合更稳。
 */
function charOverlap(label, text) {
  const chars = [...new Set(label.replace(STOP_CHARS, '').split(''))]
    .filter(ch => /[\u4e00-\u9fa5]/.test(ch));
  if (!chars.length) return 0;
  const hit = chars.filter(ch => text.includes(ch)).length;
  return hit / chars.length;
}

/**
 * 按画面描述反推牌。用户常常说不出牌名，只能说"一个人站在悬崖边"。
 * 用牌面符号 + 牌名 + 关键词做加权匹配，返回候选让用户确认，不要直接断定。
 */
function matchByImagery(text, cards, limit = 3) {
  const t = normalize(text);
  if (!t) return [];

  const results = [];
  for (const id of Object.keys(cards)) {
    const c = cards[id];
    let score = 0;
    const hits = [];

    if (t.includes(normalize(c.name))) {
      score += 6;
      hits.push(c.name);
    }

    for (const sym of c.symbols || []) {
      const label = normalize(String(sym).split(/[（(]/)[0]);
      if (!label || label.length < 2) continue;
      if (t.includes(label)) {
        score += 3;
        hits.push(label);
        continue;
      }
      const r = charOverlap(label, t);
      if (r >= 0.6) {
        score += r * 3;
        hits.push(label);
      }
    }

    for (const k of (c.keywords_upright || []).concat(c.keywords_reversed || [])) {
      const nk = normalize(k);
      if (nk.length >= 2 && t.includes(nk)) {
        score += 1.2;
        hits.push(k);
      }
    }

    if (score > 0) {
      results.push({
        card_id: id,
        name: c.name,
        score: Math.round(score * 10) / 10,
        hits: [...new Set(hits)].slice(0, 4)
      });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 抽牌环节的校验告警：重复牌、未识别牌 */
function checkDrawWarnings(entries) {
  const warnings = [];
  const seen = new Map();

  entries.forEach((e, i) => {
    if (!e || !e.card_id) {
      warnings.push({
        type: 'unresolved_card',
        index: i + 1,
        note: `第 ${i + 1} 张没能识别，需要回到用户确认（问画面、花色数字或英文名）`
      });
      return;
    }
    if (seen.has(e.card_id)) {
      const first = seen.get(e.card_id);
      warnings.push({
        type: 'duplicate_card',
        card_id: e.card_id,
        positions: [first + 1, i + 1],
        note: `第 ${first + 1} 张和第 ${i + 1} 张是同一张牌——先确认是口误，还是两副牌混用`
      });
    } else {
      seen.set(e.card_id, i);
    }
  });

  return warnings;
}

function analyzeElementBalance(cards, ids) {
  const counts = {};
  for (const id of ids) {
    const el = cards[id] && cards[id].element;
    if (el) counts[el] = (counts[el] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return { counts: {}, dominant: null, missing: [], note: '' };

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const dominant = total >= 2 && sorted[0][1] >= 2 ? sorted[0][0] : null;
  const all = ['火', '水', '风', '土'];
  const missing = all.filter(e => !counts[e]);

  let note = '';
  if (dominant && counts[dominant] === total) note = `元素高度集中于「${dominant}」，能量单一，缺少其他维度的调节`;
  else if (dominant) note = `「${dominant}」元素占主导（${counts[dominant]}/${total}）`;
  if (missing.length && total >= 3) {
    note += (note ? '；' : '') + `缺少「${missing.join('、')}」元素`;
  }
  return { counts, dominant, missing, note };
}

function analyzeMajorRatio(cards, ids) {
  if (!ids.length) return { major: 0, minor: 0, ratio: 0, note: '' };
  const major = ids.filter(id => cards[id].arcana === 'major').length;
  const minor = ids.length - major;
  const ratio = Math.round((major / ids.length) * 100) / 100;
  let note = '';
  if (major === ids.length) note = '全部为大阿卡纳，此事分量极重，涉及深层人生议题';
  else if (ratio >= 0.5) note = '大阿卡纳过半，事情的深层意义较强，不只是日常层面的事';
  else if (major === 0) note = '无大阿卡纳，此事偏向日常实务与具体操作层面';
  else note = '大阿卡纳为辅，主题落在具体处境上，但有一层更深的底色';
  return { major, minor, ratio, note };
}

function analyzeSuits(cards, ids) {
  const counts = {};
  for (const id of ids) {
    const s = cards[id] && cards[id].suit;
    if (s) counts[s] = (counts[s] || 0) + 1;
  }
  return counts;
}

/** 花色缺席：缺哪种元素的语言，就是这件事里缺席的那种能力 */
function analyzeSuitAbsence(cards, ids) {
  const counts = analyzeSuits(cards, ids);
  const hasMinor = ids.some(id => cards[id].arcana === 'minor');
  if (!hasMinor) return { missing: [], note: '' };

  const all = ['权杖', '圣杯', '宝剑', '星币'];
  const lackMeaning = {
    '权杖': '火／行动与欲望',
    '圣杯': '水／情感与联结',
    '宝剑': '风／思考与表达',
    '星币': '土／现实与落地'
  };
  const missing = all.filter(s => !counts[s]);
  let note = '';
  if (ids.length >= 4 && missing.length) {
    note = '缺席的花色：' + missing.map(s => `${s}（${lackMeaning[s]}）`).join('、') +
      ' —— 这些层面在当前的牌面里没有发声，可能是尚未进入，也可能是被绕开了';
  }
  return { missing, note };
}

function analyzeNumerology(cards, ids) {
  return ids
    .map(id => {
      const c = cards[id];
      if (!c) return null;
      return { name: c.name, number: c.number, text: c.numerology || '' };
    })
    .filter(Boolean);
}

function analyzeAstrology(cards, ids) {
  return ids
    .map(id => {
      const c = cards[id];
      if (!c) return null;
      return { name: c.name, astrology: c.astrology || '' };
    })
    .filter(x => x && x.astrology);
}

function analyzeOrientationStats(orientations) {
  const counts = { upright: 0, reversed: 0, unknown: 0 };
  for (const o of orientations) counts[o in counts ? o : 'unknown'] += 1;
  const total = orientations.length;
  let note = '';
  if (total) {
    if (counts.reversed === total) note = '全部逆位，能量整体向内收，更多是内心层面的流动';
    else if (counts.reversed === 0 && counts.upright > 0) note = '全部正位，能量整体向外显，处在可以推动的阶段';
    else if (counts.reversed > counts.upright) note = `逆位偏多（${counts.reversed}/${total}），有不少能量还没找到出口`;
  }
  return { ...counts, note };
}

/**
 * 主题共振：正逆位关键词分开统计，同向重复才构成共振；
 * 同时找出「对立共振」（同一主题在不同牌上一正一反）。
 */
function detectThemeResonance(cards, ids) {
  const up = {};
  const rev = {};
  for (const id of ids) {
    const c = cards[id];
    if (!c) continue;
    for (const k of c.keywords_upright || []) up[k] = (up[k] || 0) + 1;
    for (const k of c.keywords_reversed || []) rev[k] = (rev[k] || 0) + 1;
  }
  const resonanceUpright = Object.entries(up).filter(([, v]) => v >= 2).map(([k]) => k);
  const resonanceReversed = Object.entries(rev).filter(([, v]) => v >= 2).map(([k]) => k);
  const tension = Object.keys(up).filter(k => rev[k] >= 1 && up[k] >= 1);
  return {
    upright: resonanceUpright,
    reversed: resonanceReversed,
    tension,
    note: resonanceUpright.length || resonanceReversed.length
      ? '同一主题在多张牌上重复出现，是这次牌阵里最值得停留的地方'
      : ''
  };
}

/**
 * 位置 × 元素交互：当牌阵位置自带元素属性（如四元素牌阵），
 * 比较「位置要的能量」与「抽到的牌给的能量」。
 */
function analyzePositionElement(cards, entries) {
  const results = [];
  for (const e of entries) {
    const pos = e.position;
    if (!pos || !pos.element) continue;
    const c = cards[e.card_id];
    if (!c || !c.element) continue;

    const posEl = pos.element;
    const cardEl = c.element;
    let relation = 'same';
    if (posEl !== cardEl) {
      relation = ELEMENT_OPPOSE[posEl] === cardEl ? 'oppose' : 'complement';
    }
    const relationLabel = {
      same: '同频——这个位置的能量被直接加强',
      oppose: '对冲——位置要的和牌给的相反，这里最容易出现内耗',
      complement: '互补——同极性但不同表达，能量能接上但要换个方式'
    }[relation];

    results.push({
      position: pos.name,
      position_element: posEl,
      card: c.name,
      card_element: cardEl,
      relation,
      note: `${pos.name}（${posEl}）抽到 ${c.name}（${cardEl}）：${relationLabel}`
    });
  }
  return results;
}

function positionOfSpread(spread, index) {
  if (!spread || !spread.positions) return null;
  return spread.positions[index] || null;
}

/**
 * 逆位四取向。
 * weakened 削弱 / blocked 阻滞 / internalized 内化 / excessive 过度
 *
 * 判定不靠随机，而是四个可解释的信号加权：
 *   1. 牌性档案（reversal_profile，权重最高）
 *   2. 牌阵位置语义
 *   3. 元素的外向/内向倾向
 *   4. 整阵逆位分布
 * 引擎只给候选排序和理由，最终由 Agent 结合用户的实际描述定夺。
 */
const REVERSAL_MODES = {
  weakened: {
    label: '削弱',
    phrase: '这股能量还在，只是很淡，像隔了一层玻璃',
    read: '落在「不够、不明显、提不起劲」上，别说成「完全没有」'
  },
  blocked: {
    label: '阻滞',
    phrase: '这股能量想出来，却卡在某个地方，使不上力',
    read: '落在「想动但动不了」的憋闷，重点讲卡住的那个点'
  },
  internalized: {
    label: '内化',
    phrase: '这股能量没往外走，全转成了心里的事',
    read: '落在「没说出口、只在心里发生」的部分'
  },
  excessive: {
    label: '过度',
    phrase: '这股能量太满了，用过头，反而失了分寸',
    read: '落在「太多、太急、收不住」，讲失衡而不是指责'
  }
};

const POSITION_RULES = [
  { re: /障碍|挑战|阻力|阻碍|考验/, mode: 'blocked', w: 2.0, why: '位置本身讲的就是阻碍，逆位更像是卡在这里' },
  { re: /隐藏|根源|潜|内在|深层/, mode: 'internalized', w: 2.0, why: '位置指向不易被看见的层面，逆位让它更往内沉' },
  { re: /建议|行动|方向|着力/, mode: 'blocked', w: 1.6, why: '建议位上的逆位，往往是「这股力推不动」' },
  { re: /自我|你的|状态|感受/, mode: 'internalized', w: 1.4, why: '位置指向你本人，逆位更容易向内' },
  { re: /情感|情绪|直觉|心/, mode: 'internalized', w: 1.2, why: '情感层面的位置，逆位更容易变成心里的事' },
  { re: /思维|想法|思考|沟通/, mode: 'internalized', w: 1.0, why: '思维层面的位置，逆位常表现为念头在心里打转' },
  { re: /现实|物质|落地|基础/, mode: 'blocked', w: 1.0, why: '现实层面的位置，逆位多是「落不了地」' },
  { re: /希望|恐惧|担忧|期待/, mode: 'internalized', w: 1.0, why: '期待与担忧本来就是心里的事' },
  { re: /结果|未来|走向|趋势/, mode: 'weakened', w: 1.4, why: '结果位上的逆位，多半是强度被削弱，而不是走向反转' },
  { re: /过去|已发生|背景/, mode: 'weakened', w: 1.0, why: '过去位上的逆位，常是「影响已经淡了」' }
];

const OUTWARD_ELEMENTS = ['火', '风'];

function analyzeReversal(cards, entries) {
  const all = entries.filter(e => e && e.card_id);
  const reversedCount = all.filter(e => e.orientation === 'reversed').length;

  const results = [];
  for (const e of all) {
    if (e.orientation !== 'reversed') continue;
    const card = cards[e.card_id];
    if (!card) continue;

    const scores = { weakened: 0, blocked: 0, internalized: 0, excessive: 0 };
    const reasons = { weakened: [], blocked: [], internalized: [], excessive: [] };
    const add = (mode, w, why) => { scores[mode] += w; reasons[mode].push(why); };

    const profile = card.reversal_profile;
    if (profile) {
      add(profile.primary, 2.0, `这张牌逆位最常呈现为「${REVERSAL_MODES[profile.primary].label}」：${profile.hint}`);
      if (profile.secondary && profile.secondary !== profile.primary) {
        add(profile.secondary, 1.0, `这张牌的次选取向是「${REVERSAL_MODES[profile.secondary].label}」`);
      }
    }

    const pos = e.position;
    if (pos) {
      const posText = `${pos.name || ''}${pos.meaning || ''}`;
      for (const rule of POSITION_RULES) {
        if (rule.re.test(posText)) add(rule.mode, rule.w, rule.why);
      }
      if (pos.element && ELEMENT_OPPOSE[pos.element] === card.element) {
        add('blocked', 1.2, `位置要的是${pos.element}，抽到的却是${card.element}牌——这个位置上最容易「使不上劲」`);
      }
    }

    if (OUTWARD_ELEMENTS.includes(card.element)) {
      add('blocked', 0.8, '火／风这类外向元素，逆位更容易表现成「推不动」');
      add('excessive', 0.8, '火／风这类外向元素，逆位也容易「用过头」');
    } else {
      add('internalized', 0.8, '水／土这类内向元素，逆位更容易往心里走');
      add('weakened', 0.8, '水／土这类内向元素，逆位也容易表现为「能量变淡」');
    }

    if (card.arcana === 'major') {
      add('internalized', 0.5, '大阿卡纳的逆位，更多指向深层的内在议题');
    }

    if (all.length >= 3 && reversedCount / all.length >= 0.6) {
      add('weakened', 1.0, '整阵逆位偏多，能量整体在往里收');
    }

    const ranked = Object.keys(scores)
      .map(mode => ({
        mode,
        label: REVERSAL_MODES[mode].label,
        score: Math.round(scores[mode] * 10) / 10,
        reasons: reasons[mode]
      }))
      .sort((a, b) => b.score - a.score);

    const gap = ranked[0].score - (ranked[1] ? ranked[1].score : 0);
    const confidence = gap >= 1.5 ? 'high' : gap >= 0.7 ? 'medium' : 'low';
    const top = REVERSAL_MODES[ranked[0].mode];

    results.push({
      card: card.name,
      position: pos ? (pos.name || String(pos)) : null,
      suggested: {
        mode: ranked[0].mode,
        label: ranked[0].label,
        phrase: top.phrase,
        read: top.read,
        hint: profile ? profile.hint : ''
      },
      confidence,
      candidates: ranked.filter(r => r.score > 0).slice(0, 3),
      note: confidence === 'low'
        ? '这张牌在不同流派的读法分歧较大，更该听用户自己怎么描述当下的感受'
        : ''
    });
  }
  return results;
}

/**
 * 解读方案：按牌阵规模给出长度预算、分层结构、关键牌与维度颗粒度。
 *
 * 核心不是"少讲维度"，而是"换颗粒度"：
 *   元素 / 占星 / 数字 —— 它们本质是分布性的，适合讲整阵的规律
 *   符号 —— 它是具体的画面，适合逐张讲
 * 四个维度都必须在场，但不必每张牌都把四个讲一遍。
 */
const READING_SCALES = [
  { upTo: 1, scale: 'single', label: '单牌', min: 200, max: 350, strategy: '可以讲透：一张牌的四个维度都展开' },
  { upTo: 3, scale: 'small', label: '三牌以内', min: 450, max: 750, strategy: '故事线为主，挑 1 张关键牌细读，其余各给一句定位' },
  { upTo: 5, scale: 'medium', label: '四到五张', min: 650, max: 950, strategy: '故事线 + 2 张关键牌细读，其余各给一句定位' },
  { upTo: 7, scale: 'large', label: '六到七张', min: 900, max: 1300, strategy: '分两段推进，只细读 2–3 张，剩下的用一句话带过' },
  { upTo: 10, scale: 'full', label: '八到十张', min: 1200, max: 1800, strategy: '先给整体走势，再落细节；细读不超过 3 张，其余一句定位' }
];

function planReading(ctx) {
  const cards = ctx.cards || [];
  const n = cards.length;
  const cfg = READING_SCALES.find(s => n <= s.upTo) || READING_SCALES[READING_SCALES.length - 1];

  const scored = cards.map(c => {
    let score = 0;
    const why = [];
    if (c.arcana === 'major') { score += 3; why.push('大阿卡纳，分量重'); }
    if (c.orientation === 'reversed') { score += 2; why.push('逆位，有张力'); }
    const posName = c.position ? (c.position.name || String(c.position)) : '';
    if (/现状|核心|结果|最终|本质|自我/.test(posName)) { score += 2; why.push('落在核心位置'); }
    return { index: c.index, name: c.name, score, why };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const keyLimit = n <= 3 ? 1 : n <= 5 ? 2 : 3;
  const keyCards = scored.filter(x => x.score > 0).slice(0, keyLimit);
  const rest = n - keyCards.length;

  return {
    scale: cfg.scale,
    label: cfg.label,
    card_count: n,
    budget: { min: cfg.min, max: cfg.max },
    strategy: cfg.strategy,
    key_cards: keyCards,
    dimensions: {
      array_level: ['元素', '占星', '数字'],
      card_level: ['画面符号'],
      note: '元素、占星、数字讲整阵的分布规律；符号讲单张的画面细节。四个维度都必须在场，但不必每张牌都讲四个'
    },
    per_card_hint: n >= 4 && rest > 0 ? `除关键牌外，其余 ${rest} 张各给一句定位，不要逐张展开` : '每张都可以展开',
    structure: ['一句话核心', '故事线', n >= 4 ? '分段推进' : '关键牌细读', '塔罗视角小结']
  };
}


/**
 * 核心入口。
 * entries: [{ card_id, orientation, position? }]
 * spread: 牌阵对象（可选，提供 positions 用于位置语义与元素交互）
 */
function buildReading(cards, entries, spread) {
  const ids = entries.map(e => e.card_id).filter(id => cards[id]);
  const orientations = entries.map(e => (e.orientation && e.orientation !== 'unknown' ? e.orientation : 'unknown'));

  const enriched = entries.map((e, i) => {
    const c = cards[e.card_id];
    if (!c) return null;
    const orientation = e.orientation && e.orientation !== 'unknown' ? e.orientation : 'unknown';
    const meaning = orientation === 'reversed' ? c.meaning_reversed : c.meaning_upright;
    const keywords = orientation === 'reversed' ? c.keywords_reversed : c.keywords_upright;
    return {
      index: i + 1,
      card_id: e.card_id,
      name: c.name,
      name_en: c.name_en,
      arcana: c.arcana,
      suit: c.suit,
      element: c.element,
      number: c.number,
      astrology: c.astrology,
      numerology: c.numerology,
      orientation,
      orientation_label: { upright: '正位', reversed: '逆位', unknown: '未明确' }[orientation],
      keywords,
      meaning,
      symbols: c.symbols || [],
      position: e.position || positionOfSpread(spread, i)
    };
  }).filter(Boolean);

  const ctx = {
    spread: spread ? { id: spread.id, name: spread.name, cards: spread.cards } : null,
    cards: enriched,
    element_balance: analyzeElementBalance(cards, ids),
    major_ratio: analyzeMajorRatio(cards, ids),
    suits: analyzeSuits(cards, ids),
    suit_absence: analyzeSuitAbsence(cards, ids),
    numerology: analyzeNumerology(cards, ids),
    astrology: analyzeAstrology(cards, ids),
    orientation_stats: analyzeOrientationStats(orientations),
    theme_resonance: detectThemeResonance(cards, ids),
    position_element: analyzePositionElement(cards, enriched.map(e => ({ card_id: e.card_id, position: e.position }))),
    reversal: analyzeReversal(cards, enriched),
    warnings: checkDrawWarnings(entries)
  };
  ctx.plan = planReading(ctx);
  return ctx;
}

/** 把结构化结果转成给模型读的纯文本摘要 */
function formatContext(ctx) {
  const lines = [];
  if (ctx.warnings && ctx.warnings.length) {
    lines.push('【抽牌告警】（先处理这些，再进解读）');
    for (const w of ctx.warnings) lines.push(`· ${w.note}`);
    lines.push('');
  }
  if (ctx.plan) {
    const p = ctx.plan;
    lines.push('【解读方案】');
    lines.push(`· 规模：${p.label}（${p.card_count} 张）→ 建议 ${p.budget.min}–${p.budget.max} 字`);
    lines.push(`· 打法：${p.strategy}`);
    if (p.key_cards.length) {
      lines.push('· 关键牌（值得细读）：' + p.key_cards.map(k => `${k.name}（${k.why.join('；')}）`).join('、'));
    }
    lines.push(`· 维度颗粒度：${p.dimensions.array_level.join('/')} 讲整阵分布；${p.dimensions.card_level.join('/')} 讲单张细节`);
    lines.push(`· ${p.per_card_hint}`);
    lines.push('');
  }
  lines.push('【牌面】');
  for (const c of ctx.cards) {
    const pos = c.position ? `[${c.position.name || c.position}] ` : '';
    lines.push(`${pos}${c.name}（${c.orientation_label}）｜元素：${c.element}｜数字：${c.number}｜占星：${c.astrology || '—'}`);
    if (c.symbols && c.symbols.length) lines.push(`  符号：${c.symbols.join('、')}`);
  }
  lines.push('');
  lines.push('【整体结构】');
  if (ctx.element_balance.note) lines.push(`· 元素：${ctx.element_balance.note}`);
  lines.push(`· 大阿卡纳占比：${ctx.major_ratio.ratio}（${ctx.major_ratio.note}）`);
  if (ctx.orientation_stats.note) lines.push(`· 正逆位：${ctx.orientation_stats.note}`);
  if (ctx.suit_absence.note) lines.push(`· ${ctx.suit_absence.note}`);
  if (ctx.theme_resonance.note) {
    const r = [];
    if (ctx.theme_resonance.upright.length) r.push(`同向共振：${ctx.theme_resonance.upright.join('、')}`);
    if (ctx.theme_resonance.reversed.length) r.push(`逆位共振：${ctx.theme_resonance.reversed.join('、')}`);
    lines.push(`· 主题：${r.join('；')}`);
  }
  if (ctx.position_element.length) {
    lines.push('');
    lines.push('【位置 × 元素】');
    for (const p of ctx.position_element) lines.push(`· ${p.note}`);
  }
  if (ctx.reversal && ctx.reversal.length) {
    lines.push('');
    lines.push('【逆位取向】（每张只讲一种，不要四种都罗列）');
    for (const r of ctx.reversal) {
      const where = r.position ? ` @${r.position}` : '';
      lines.push(`· ${r.card}${where} → 建议读作「${r.suggested.label}」：${r.suggested.phrase}`);
      for (const why of (r.candidates[0] ? r.candidates[0].reasons : [])) lines.push(`    - ${why}`);
      lines.push(`    - 表达落点：${r.suggested.read}`);
      if (r.candidates.length > 1) {
        lines.push(`    - 备选：${r.candidates.slice(1).map(c => `${c.label}(${c.score})`).join('、')}`);
      }
      if (r.note) lines.push(`    - 注意：${r.note}`);
    }
  }
  return lines.join('\n');
}

function selfTest() {
  const { cards, aliases } = loadAllCards();
  const ids = Object.keys(cards);
  console.log(`已加载 ${ids.length} 张牌，${Object.keys(aliases).length} 个别名`);

  const cases = [
    ['逆位愚者', 'major-00', 'reversed'],
    ['倒牌女祭司', 'major-02', 'reversed'],
    ['倒吊人', 'major-12', 'unknown'],
    ['倒吊人 逆位', 'major-12', 'reversed'],
    ['正义', 'major-11', 'unknown'],
    ['正义 正位', 'major-11', 'upright'],
    ['大阿卡纳14号', 'major-14', 'unknown'],
    ['0号牌', 'major-00', 'unknown'],
    ['The Fool', 'major-00', 'unknown'],
    ['权杖十', 'wand-10', 'unknown'],
    ['星币王后', 'pentacle-queen', 'unknown'],
    ['钱币三', 'pentacle-03', 'unknown'],
    ['杯中二', 'cup-02', 'unknown'],
    ['权杖卫士', 'wand-page', 'unknown'],
    ['星币皇后，正位', 'pentacle-queen', 'upright'],
    ['宝剑骑士', 'sword-knight', 'unknown']
  ];

  let pass = 0;
  for (const [input, wantId, wantOri] of cases) {
    const gotId = resolveCard(input, aliases);
    const gotOri = detectOrientation(input, aliases);
    const ok = gotId === wantId && gotOri === wantOri;
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${input} -> ${gotId} / ${gotOri}${ok ? '' : `  期望 ${wantId} / ${wantOri}`}`);
  }
  console.log(`\n归一化用例 ${pass}/${cases.length} 通过`);

  const fields = ['astrology', 'numerology', 'symbols'];
  for (const f of fields) {
    const lack = ids.filter(id => !cards[id][f] || (Array.isArray(cards[id][f]) && !cards[id][f].length));
    console.log(`字段 ${f}: 缺失 ${lack.length} 张${lack.length ? ' -> ' + lack.join(',') : ''}`);
  }

  const spreads = loadSpreads();
  const fourEl = spreads.find(s => s.id === 'four-elements');
  const celtic = spreads.find(s => s.id === 'celtic-cross');
  const rel = spreads.find(s => s.id === 'relationship');
  const single = spreads.find(s => s.id === 'single');
  const bmsVariant = (spreads.find(s => s.id === 'three').variants || []).find(v => v.id === 'body-mind-spirit');

  console.log('\n--- 逆位取向 ---');
  const scenarios = [
    { label: '圣杯七逆 @四元素·火位', card_id: 'cup-07', position: fourEl.positions[0], want: 'blocked' },
    { label: '权杖十逆 @关系·你', card_id: 'wand-10', position: rel.positions[0], want: 'excessive' },
    { label: '圣杯国王逆 @凯尔特·自我', card_id: 'cup-king', position: celtic.positions[6], want: 'internalized' },
    { label: '死神逆 @三牌·灵', card_id: 'major-13', position: bmsVariant.positions[2], want: 'blocked' },
    { label: '宝剑九逆 @三牌·心', card_id: 'sword-09', position: bmsVariant.positions[1], want: 'internalized' },
    { label: '愚者逆 @单牌', card_id: 'major-00', position: single.positions[0], want: 'blocked' }
  ];

  let rPass = 0;
  for (const s of scenarios) {
    const ctx = buildReading(cards, [{ card_id: s.card_id, orientation: 'reversed', position: s.position }], null);
    const r = ctx.reversal[0];
    const ok = r.suggested.mode === s.want;
    if (ok) rPass++;
    const alts = r.candidates.slice(1).map(c => `${c.label}(${c.score})`).join('、');
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.label} -> ${r.suggested.label}(${r.confidence})${alts ? '　备选 ' + alts : ''}${ok ? '' : `  期望 ${s.want}`}`);
  }
  console.log(`逆位取向用例 ${rPass}/${scenarios.length} 通过`);

  console.log('\n--- 画面反推 ---');
  const imagery = [
    ['一个人站在悬崖边，脚边有只小狗', 'major-00'],
    ['有个女的蒙着眼睛，手里交叉拿着两把剑', 'sword-02'],
    ['老人和小孩在拱门下，脚边有只狗', 'pentacle-10'],
    ['三个人举着杯子庆祝', 'cup-03'],
    ['一个人背上插了好多剑，趴在地上', 'sword-10'],
    ['一个女人抱着星币坐在花园里', 'pentacle-queen']
  ];
  let iTop1 = 0;
  let iTop3 = 0;
  for (const [desc, want] of imagery) {
    const cands = matchByImagery(desc, cards, 3);
    const hit1 = cands.length > 0 && cands[0].card_id === want;
    const hit3 = cands.some(c => c.card_id === want);
    if (hit1) iTop1++;
    if (hit3) iTop3++;
    console.log(`${hit3 ? 'PASS' : 'FAIL'}  ${desc} -> ${cands.map(c => `${c.name}(${c.score})`).join('、') || '无候选'}${hit1 ? '' : '　[Top1 未中，候选内]'}${hit3 ? '' : `  期望 ${want}`}`);
  }
  console.log(`画面反推：Top1 命中 ${iTop1}/${imagery.length}，Top3 命中 ${iTop3}/${imagery.length}`);

  console.log('\n--- 抽牌告警 ---');
  const dupCtx = buildReading(cards, [
    { card_id: 'major-00', orientation: 'upright' },
    { card_id: 'major-00', orientation: 'reversed' }
  ]);
  console.log(`${dupCtx.warnings.length === 1 ? 'PASS' : 'FAIL'}  重复牌 -> ${dupCtx.warnings.map(w => w.type).join(',')}`);
  const unresCtx = buildReading(cards, [
    { card_id: 'major-00', orientation: 'upright' },
    { card_id: null, orientation: 'unknown' }
  ]);
  console.log(`${unresCtx.warnings.length === 1 ? 'PASS' : 'FAIL'}  未识别牌 -> ${unresCtx.warnings.map(w => w.type).join(',')}`);

  console.log('\n--- 解读方案 ---');
  const planTests = [
    ['单牌', ['major-00'], single],
    ['三牌', ['major-00', 'cup-02', 'sword-03'], spreads.find(s => s.id === 'three')],
    ['五张', ['major-01', 'cup-02', 'sword-03', 'pentacle-04', 'major-05'], rel],
    ['七张', ['major-01', 'cup-02', 'sword-03', 'pentacle-04', 'major-05', 'wand-06', 'major-07'], spreads.find(s => s.id === 'horseshoe')],
    ['十张', ['major-01', 'cup-02', 'sword-03', 'pentacle-04', 'major-05', 'wand-06', 'major-07', 'wand-08', 'major-09', 'cup-10'], celtic]
  ];
  for (const [label, cardIds, sp] of planTests) {
    const c = buildReading(cards, cardIds.map(id => ({ card_id: id, orientation: 'upright' })), sp);
    const p = c.plan;
    const ok = p.card_count === cardIds.length && p.budget.max >= p.budget.min && p.key_cards.length <= 3;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}(${cardIds.length}) -> ${p.label}｜${p.budget.min}–${p.budget.max} 字｜细读 ${p.key_cards.length} 张：${p.key_cards.map(k => k.name).join('、') || '无'}`);
  }

  const ctx = buildReading(cards, [
    { card_id: 'cup-07', orientation: 'reversed' },
    { card_id: 'cup-02', orientation: 'upright' },
    { card_id: 'sword-03', orientation: 'upright' },
    { card_id: 'pentacle-08', orientation: 'upright' }
  ], fourEl);
  console.log('\n--- 示例上下文 ---');
  console.log(formatContext(ctx));
}

if (require.main === module) selfTest();

module.exports = {
  loadAllCards,
  loadSpreads,
  resolveCard,
  detectOrientation,
  matchByImagery,
  checkDrawWarnings,
  buildReading,
  planReading,
  formatContext,
  analyzeReversal,
  analyzeElementBalance,
  analyzeMajorRatio,
  analyzeSuitAbsence,
  detectThemeResonance,
  analyzePositionElement
};
