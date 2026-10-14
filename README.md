# 塔罗占卜 Agent（Tarot Reading Agent）

一个对话式塔罗牌占卜解读技能包，基于**韦特塔罗（Rider-Waite Smith，78 张牌）**&#x4F53;系。

用户提一个问题 → Agent 判断该抽几张牌 → 引导用户用实体牌抽牌 → 用户报牌名 + 正逆位 → Agent 结合**牌阵、元素、占星、数字**等多个维度，给出贴合个人感受、轻松有启发的解读。

> 不只是"报牌→解牌"，而是一套完整的引导式占卜流程：问题定性、牌阵选择、逐张抽牌引导、口语报牌归一化、多维深度解读，并内置严谨的**占卜适用范围边界**。

---

## 特点

- 🎴 **78 张牌完整知识库**：每张含牌名/别名/牌号/大类/花色/元素/占星对应/数字象征/正逆位关键词与详解/画面符号
- 🃏 **6 种牌阵**：单牌、三牌、四元素、关系、马蹄形（7 张）、凯尔特十字（10 张），含每个位置的语义
- 🧠 **多维解读引擎**：元素平衡、大阿卡纳占比、正逆位统计、占星汇总、数字分布、主题共振
- 🗣️ **口语报牌归一化**：支持"逆位愚者""倒牌女祭司""权杖十""The Fool""0 号牌"等各种说法自动识别
- 🛡️ **严谨边界**：明确区分"适合占卜 / 不适合但可引导 / 不能占卜"三类问题，涉及医疗、法律、人身安全等直接拒绝并引导求助
- 💬 **有人味**：轻松、缓和、活泼的语气，淡化说教，落脚在共情与启发

---

## 目录结构

```
tarot/
├── SKILL.md                  # 技能定义（流程 + 边界 + 语气规范）
├── references/               # 知识库
│   ├── major-arcana.json     #   22 张大阿卡纳
│   ├── minor-arcana.json     #   56 张小阿卡纳
│   └── spreads.json          #   6 种牌阵
└── scripts/
    └── tarot_engine.py       # 解读规则引擎（无外部依赖）
```

---

## 快速开始

### 方式一：作为 WorkBuddy 技能安装

1. 将 `tarot/` 目录复制到你的技能目录：`~/.workbuddy/skills/tarot/`
2. 重启 / 刷新 WorkBuddy 会话
3. 对话中直接说："帮我占卜一下……"，即会自动触发

### 方式二：直接调用引擎（Python 3）

```python
from tarot_engine import load_all_cards, resolve_card, detect_orientation, build_reading

cards, aliases = load_all_cards()
cid = resolve_card("逆位节制", aliases)          # -> major-14
orientation = detect_orientation("逆位节制")     # -> reversed
ctx = build_reading(cards, [{"card_id": cid, "orientation": orientation}])
print(ctx["element_balance"], ctx["astrology"])
```

### 方式三：命令行自检

```bash
python scripts/tarot_engine.py
```

---

## 完整占卜流程

1. **问题定性**：领域、类型、复杂度
2. **占卜范围判定**：适合 / 可引导 / 拒绝
3. **选择牌阵**（内部决策，不剧透结构）
4. **逐张抽牌引导**（主动告知总张数，保持神秘感与直觉）
5. **报牌归一化**（牌名/牌号/英文名/正逆位口语）
6. **深度解读**（元素 + 数字 + 占星 + 牌阵融合，共情式表达）

---

## 设计理念

这套工具的核心不是"算得准不准"，而是把塔罗当作**一面照见自己的镜子**——通过牌阵结构和知识维度，帮助用户以新的角度理解当下的处境与内心。因此：

- 解读**指向自己、指向当下、答案开放、有行动余地**
- 语气**淡化说教**，呈现知识本身，让用户感到"被理解"而非"被分析"
- 明确**边界**：塔罗推不出客观事实和他人的内心，也绝不替代专业医疗/法律/心理建议

---

## 贡献

欢迎通过 Issue 和 Pull Request 参与：

- 补充 / 修正牌义与占星对应
- 新增牌阵（在 `references/spreads.json` 中添加）
- 优化解读引擎（`scripts/tarot_engine.py`）
- 完善口语归一化的别名（在各牌 `aliases` 字段中补充）

提交前请确保 `python scripts/tarot_engine.py` 能正常自检通过。

---

## 许可

- 代码（`scripts/`）：MIT License
- 内容（牌库、SKILL.md 文本）：CC BY-SA 4.0

详见 [LICENSE.md](LICENSE.md)。塔罗牌名与传统牌义属公共领域；本项目不含任何版权图片。

---

## 免责声明

仅供娱乐与自我反思，不构成任何专业建议。详见 [LICENSE.md](LICENSE.md) 中的免责声明。
