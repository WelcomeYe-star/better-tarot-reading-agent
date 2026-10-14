"""
塔罗牌解读规则引擎
负责：元素平衡计算、大阿卡纳占比、正逆位统计、占星对应汇总、主题共振检测、花色/数字分布。
纯数据驱动，无外部依赖。
"""

import json
import os

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "references")


def load_all_cards():
    """加载全部 78 张牌，返回 {id: card} 与 {别名: id} 的归一化映射。"""
    cards = {}
    aliases = {}
    with open(os.path.join(DATA_DIR, "major-arcana.json"), encoding="utf-8") as f:
        for c in json.load(f)["major_arcana"]:
            cards[c["id"]] = c
            for a in [c["name"], c["name_en"]] + c.get("aliases", []):
                aliases[a.lower()] = c["id"]
    with open(os.path.join(DATA_DIR, "minor-arcana.json"), encoding="utf-8") as f:
        for c in json.load(f)["minor_arcana"]:
            cards[c["id"]] = c
            for a in [c["name"], c["name_en"]] + c.get("aliases", []):
                aliases[a.lower()] = c["id"]
    return cards, aliases


def load_spreads():
    with open(os.path.join(DATA_DIR, "spreads.json"), encoding="utf-8") as f:
        return json.load(f)["spreads"]


def resolve_card(text, aliases):
    """将用户输入（牌名/别名/牌号）归一化为 card id。返回 id 或 None。

    支持：
    - 精确别名匹配
    - 剥离正逆位标记（逆位/正位/倒/反位/颠倒等）
    - 忽略空格
    - 模糊包含匹配（用户输入中包含某个别名）
    """
    t = (text or "").strip().lower()
    # 1. 直接精确匹配
    if t in aliases:
        return aliases[t]
    # 2. 剥离正逆位标记后匹配
    stripped = t
    for marker in ["逆位", "正位", "倒牌", "倒", "反位", "颠倒", "反转", "直位"]:
        stripped = stripped.replace(marker, "")
    stripped = stripped.strip()
    if stripped in aliases:
        return aliases[stripped]
    # 3. 忽略所有空格后再匹配
    nospace = stripped.replace(" ", "").replace("　", "")
    if nospace in aliases:
        return aliases[nospace]
    # 4. 模糊包含匹配：别名出现在用户输入中（取最长的别名，避免误匹配）
    best = None
    best_len = 0
    for alias, cid in aliases.items():
        if len(alias) >= 2 and alias in nospace:
            if len(alias) > best_len:
                best = cid
                best_len = len(alias)
    return best


def detect_orientation(text):
    """检测输入中的正逆位信息。返回 'upright' / 'reversed' / 'unknown'。"""
    t = (text or "").strip()
    reversed_markers = ["逆位", "逆", "倒", "反位", "颠倒", "倒牌", "反转"]
    upright_markers = ["正位", "正", "直"]
    for m in reversed_markers:
        if m in t:
            return "reversed"
    for m in upright_markers:
        if m in t:
            return "upright"
    return "unknown"


def analyze_element_balance(cards, card_ids):
    """统计四元素分布，检测是否失衡（某元素占主导或缺失）。"""
    from collections import Counter
    cnt = Counter()
    for cid in card_ids:
        el = cards[cid].get("element")
        if el:
            cnt[el] += 1
    total = sum(cnt.values())
    if total == 0:
        return {"counts": {}, "dominant": None, "missing": [], "note": ""}
    dominant = cnt.most_common(1)[0][0] if total >= 2 and cnt.most_common(1)[0][1] >= 2 else None
    all_elements = ["火", "水", "风", "土"]
    missing = [e for e in all_elements if e not in cnt]
    note = ""
    if dominant and cnt[dominant] == total:
        note = f"元素高度集中于「{dominant}」，能量单一"
    elif dominant:
        note = f"「{dominant}」元素占主导（{cnt[dominant]}/{total}）"
    if missing and total >= 3:
        note += (("；" if note else "") + f"缺少「{'、'.join(missing)}」元素")
    return {"counts": dict(cnt), "dominant": dominant, "missing": missing, "note": note}


def analyze_major_ratio(cards, card_ids):
    """统计大阿卡纳占比，占比越高提示事情分量越重/宿命感越强。"""
    if not card_ids:
        return {"major": 0, "minor": 0, "ratio": 0, "note": ""}
    major = sum(1 for cid in card_ids if cards[cid]["arcana"] == "major")
    minor = len(card_ids) - major
    ratio = round(major / len(card_ids), 2)
    note = ""
    if major == len(card_ids):
        note = "全部为大阿卡纳，此事分量极重，涉及深层人生议题"
    elif ratio >= 0.5:
        note = "大阿卡纳过半，事情的深层意义与命运感较强"
    elif major == 0:
        note = "无大阿卡纳，此事偏向日常实务层面"
    return {"major": major, "minor": minor, "ratio": ratio, "note": note}


def analyze_suits(cards, card_ids):
    """统计花色（小阿卡纳）分布。"""
    from collections import Counter
    cnt = Counter()
    for cid in card_ids:
        s = cards[cid].get("suit")
        if s:
            cnt[s] += 1
    return dict(cnt)


def analyze_numerology(cards, card_ids):
    """汇总数字象征（只对数字牌 1-10 有意义）。"""
    nums = []
    for cid in card_ids:
        n = cards[cid].get("number")
        if n and 1 <= n <= 10:
            nums.append(n)
    return nums


def analyze_astrology(cards, card_ids):
    """汇总占星对应（大阿卡纳与宫廷牌有占星/行星对应）。"""
    result = []
    for cid in card_ids:
        a = cards[cid].get("astrology")
        if a:
            result.append((cards[cid]["name"], a))
    return result


def analyze_orientation_stats(orientations):
    """统计正逆位分布。orientations: list of 'upright'/'reversed'/'unknown'。"""
    from collections import Counter
    cnt = Counter(orientations)
    return dict(cnt)


def detect_theme_resonance(cards, card_ids):
    """检测主题共振：多张牌的关键词是否指向同一主题。返回高频关键词。"""
    from collections import Counter
    kw = Counter()
    for cid in card_ids:
        for k in cards[cid].get("keywords_upright", []):
            kw[k] += 1
        for k in cards[cid].get("keywords_reversed", []):
            kw[k] += 1
    # 只保留出现 2 次及以上的关键词作为共振信号
    resonance = [k for k, v in kw.items() if v >= 2]
    return resonance


def build_reading(cards, card_entries, spread=None):
    """核心入口：根据抽到的牌（含正逆位）生成结构化解读上下文。

    card_entries: list of dict { 'card_id': ..., 'orientation': 'upright'/'reversed', 'position': {...} }
    spread: 牌阵 dict（可选）
    """
    card_ids = [e["card_id"] for e in card_entries if e.get("card_id")]
    orientations = [e.get("orientation", "unknown") for e in card_entries]

    context = {
        "cards": [],
        "element_balance": analyze_element_balance(cards, card_ids),
        "major_ratio": analyze_major_ratio(cards, card_ids),
        "suits": analyze_suits(cards, card_ids),
        "numerology": analyze_numerology(cards, card_ids),
        "astrology": analyze_astrology(cards, card_ids),
        "orientation_stats": analyze_orientation_stats(orientations),
        "theme_resonance": detect_theme_resonance(cards, card_ids),
    }

    for e in card_entries:
        c = cards.get(e["card_id"])
        if not c:
            continue
        orientation = e.get("orientation", "unknown")
        meaning = c["meaning_reversed"] if orientation == "reversed" else c["meaning_upright"]
        keywords = c["keywords_reversed"] if orientation == "reversed" else c["keywords_upright"]
        context["cards"].append({
            "name": c["name"],
            "name_en": c["name_en"],
            "arcana": c["arcana"],
            "suit": c.get("suit"),
            "element": c.get("element"),
            "astrology": c.get("astrology"),
            "number": c.get("number"),
            "orientation": orientation,
            "orientation_label": {"upright": "正位", "reversed": "逆位", "unknown": "未明确"}[orientation],
            "keywords": keywords,
            "meaning": meaning,
            "position": e.get("position"),
        })

    return context


if __name__ == "__main__":
    # 自检：加载数据并跑一个示例
    cards, aliases = load_all_cards()
    print(f"已加载 {len(cards)} 张牌，{len(aliases)} 个别名")
    sid = resolve_card("逆位节制", aliases)
    print("逆位节制 ->", sid, detect_orientation("逆位节制"))
    ctx = build_reading(cards, [{"card_id": sid, "orientation": "reversed"}])
    print(json.dumps(ctx["element_balance"], ensure_ascii=False))
    print("元素:", ctx["element_balance"]["note"])
    print("占星:", ctx["astrology"])
