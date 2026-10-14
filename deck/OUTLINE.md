# 路演结构与逐页 Prompt(英文版先行)

> 状态:草案,等待逐页确认。确认之前不出图。
> 风格锚点只有两张(已定稿,原样使用):
> `refs/style-query.jpg`(Query what actually happened)与 `refs/style-loop.jpg`(Memory with the human in the loop)。
> 封面是第三张锚点。之前的 A–F 参考图不再使用。

## 0. 视觉规则(所有新页面共用)

| 项 | 规则 |
| --- | --- |
| 风格 | **平面**。不要 3D、不要渲染质感、不要图标拟物。只用细线描边卡片、半调点阵、淡紫色强调面板、圆形灰底线性图标。 |
| 底色 | 暖白纸面 `#f2f1ec`,细颗粒;细黑框线 + 裁切标记 + 右下角小黑方块(与封面和两张定稿图一致)。 |
| 标题 | 宽圆角科技感大写字体(同 "QUERY WHAT ACTUALLY HAPPENED"),第二行用紫色。这是页面里唯一"抽象"的字体。 |
| 正文 | 干净的无衬线字体,**深色、大字号**(1920 宽下不小于约 30px),只写短句。每页正文不超过约 40 个英文单词。 |
| 左上角 | 留空,由代码叠加 App 真实 logo(`app/build/icon.svg`)。定稿的两张保持原样,不叠。 |
| 信息密度 | 每页只讲一件事。能用一个结构(并排两列、三行表、一条线)说清的,不再加第二个。 |
| 语言 | 先出英文版。全部定稿后,由 Codex 统一再出中文版,播放器按一个键(`L`)切换语言。 |

### 共用 prompt 前缀(每页都带,附 `style-query.jpg` + `style-loop.jpg` 作为 Image 1/2)

```text
Use case: infographic-diagram
Asset type: 16:9 presentation slide, at least 1672x941.
Style: match Image 1 and Image 2 exactly. They are FLAT UI-style slides: warm off-white paper (#f2f1ec) with fine grain, a thin black hairline frame with crop marks and tick marks, a small solid black square at the bottom-right, thin black outlined cards, a halftone dot-gradient strip on the left edge of cards, soft lavender (#d9d0fb, accent #8c73f2) highlight panels, small circular light-grey icon badges with simple line icons, and a big uppercase title in a wide rounded technical display typeface with the second line in violet.
Strictly flat: NO 3D, NO perspective, NO glass or metal render, NO shadows, NO photoreal objects.
Body text: clean dark sans-serif, large and high contrast, short phrases only, generous whitespace.
Leave the top-left corner (22% width x 12% height) completely empty. Do not draw any logo or wordmark.
Render only the exact text listed below, verbatim and correctly spelled. Add no other text.
```

---

## 1. 整体叙事(19 页)

```text
 1  Cover ──────────────────────────────── 定稿
 ─ 背景:行业现状 ─────────────────────────
 2  两个主流方向:Memory 与 Skill Market
 3  Memory 的问题:画像可错,事实不能错
 4  Obelisk 的答案:检索并重组事实 ─────── 定稿(Query what actually happened)
 5  Skill Market 的问题:明文、没人读、会拖垮 Harness
 ─ Obelisk 做的两件事 ───────────────────
 6  零成本沉淀经验
 7  组织高匹配的上下文(知识付费 2.0)
 8  论点:AI-Native should be context-native first
 9  从可查询到被批准、可验证 ─────────── 定稿(Memory with the human in the loop)
 ─ 本次黑客松:上链 ───────────────────────
10  章节页:Putting context on-chain
11  链上补什么:三个缺口,三个答案
12  怎么上链:用户签名,中继付费
13  Skill 成为资产:指纹与族谱
14  真实使用与场景归因
15  市场:收入沿族谱分账
16  私密分享:只给一个钱包
17  演示闭环:AI 能力履历
18  现状:测试网与主网
19  收尾 / slogan
```

页数分配:背景 5 页,Obelisk 做什么 4 页,上链 9 页。背景保持精简,让上链占主体。

---

## 2. 逐页:讲什么、写什么、画什么

### 1 · Cover
定稿,不改。

### 2 · 两个主流方向
- **这一页要让观众记住**:行业里有两条路,Memory 和 Skill Market。
- **页面文字**
  - 标题:`TWO MAINSTREAM` / `DIRECTIONS`
  - 左卡 01 `MEMORY`:"Remember the user. Remember what happened."
  - 右卡 02 `SKILL MARKET`:"Package know-how as Skills. Share it. Sell it."
- **画面**:两张并排的大卡片,风格同 `style-loop` 的行结构,左边半调条。卡片中间没有任何装饰,只有一个小的 `+`。无图标之外的插图。
- **Prompt(接共用前缀)**
```text
Layout: two tall outlined cards side by side with a small plus sign between them. Top-right small label: "INDUSTRY LANDSCAPE".
Title: "TWO MAINSTREAM" / "DIRECTIONS" (second line violet).
Left card: number "01", heading "MEMORY", body "Remember the user. Remember what happened."
Right card: number "02", heading "SKILL MARKET", body "Package know-how as Skills. Share it. Sell it."
Each card has one circular icon badge at the top (a simple line icon).
```

### 3 · Memory 的问题
- **这一页要让观众记住**:Memory 想讲"数字分身 / 类人脑记忆"的故事,大多数系统做不到。**只有用户画像**需要传统 Memory。事实核查类场景里,检索错误是灾难性的;画像错了,用户纠正反而是好事。
- **页面文字**
  - 标题:`PROFILES CAN BE WRONG.` / `FACTS CAN'T.`
  - 第 1 行 `User profile`(Who you are):"A wrong guess gets corrected by the user. That helps." 标记:可接受。
  - 第 2 行 `Factual recall`(What happened):"A wrong answer is silent, and decisions get built on it." 标记:不可接受。
  - 底部一句:"The digital-twin story is hard to deliver. Facts are where memory must be exact."
- **画面**:严格沿用 `style-loop` 的三行结构,改成两行。上行灰,下行淡紫强调。右端是对勾和叉(同 loop 里的 ✕ 和 ✓),不要警告三角。
- **Prompt**
```text
Layout: two stacked wide rows like Image 2 (halftone strip on the left of each row, a number, a name with a small caption, a short text block on the right, a status mark at the far right). Top-right small label: "MEMORY".
Title: "PROFILES CAN BE WRONG." / "FACTS CAN'T." (second line violet).
Row 01 (grey): name "User profile", caption "WHO YOU ARE", text "A wrong guess gets corrected by the user. That helps.", mark: check.
Row 02 (lavender, emphasised): name "Factual recall", caption "WHAT HAPPENED", text "A wrong answer is silent, and decisions get built on it.", mark: cross.
Bottom centered line: "The digital-twin story is hard to deliver. Facts are where memory must be exact."
```
- **可选证据**(需要你确认要不要放):Obelisk 维护者用它回看过去的 code review,提炼出贡献规则(obelisk PR #27)。

### 4 · Obelisk 的答案:检索并重组事实
定稿 `style-query.jpg`,原样使用。
口头话术:"所以 Obelisk 负责事实类内容的检索和重组,这是 Memory 的另一半,实际效果非常好。"

### 5 · Skill Market 的问题
- **这一页要让观众记住**:现在的 Skill 市场像旧的知识付费。Skill 是明文,到处可复制;几乎没人读、没人评估它是否适合自己的场景,多是跟风使用;堆满之后在模型越来越强的今天,甚至拖垮 Harness。结果:没跑通变现(依赖创作者在各平台做流量),也无法衡量真实效用。
- **页面文字**
  - 标题:`KNOWLEDGE-FOR-PAY,` / `AS PLAINTEXT.`
  - 三行:`01 Copyable` "Plain text. Copied and shared everywhere." / `02 Unread` "Few read it. Most just follow the crowd." / `03 Bloat` "A crowded Skill list can slow a strong model's harness down."
  - 右侧结论两条:`No real monetization` "Income depends on grinding for traffic." / `No measurable utility` "Nobody can tell if a Skill works, or where."
- **画面**:左侧三行(loop 的行样式),右侧一个黑色结论块分两条,中间一条细箭头。
- **Prompt**
```text
Layout: three stacked rows on the left (Image 2 row style), one black result panel on the right with two stacked entries, joined by a thin arrow. Top-right small label: "SKILL MARKET".
Title: "KNOWLEDGE-FOR-PAY," / "AS PLAINTEXT." (second line violet).
Rows: "01 Copyable - Plain text. Copied and shared everywhere." / "02 Unread - Few read it. Most just follow the crowd." / "03 Bloat - A crowded Skill list can slow a strong model's harness down."
Black panel (white text, violet small captions): "RESULT" "No real monetization" "Income depends on grinding for traffic." and "RESULT" "No measurable utility" "Nobody can tell if a Skill works, or where."
```

### 6 · 零成本沉淀经验(第一件事)
- **这一页要让观众记住**:我们擅长从事实里总结。用户不需要精心设计,想法一出来,运行中产生的**正模式、反模式**就能沉淀成 Skill。跨所有 Coding Agent;**没有冷启动**——多数 Memory 要用一个月才开始变复杂有用(同时伴随更多错误),我们没有这个包袱。
- **页面文字**
  - 标题:`ZERO-COST` / `DISTILLATION`
  - 左:`Do the work` → 右:`Get the Skill`,中间一个结构:Run → Patterns and anti-patterns → Skill。(结构借自你原来的流程图:Real sessions → Relevant evidence → Skill draft + source card → Human review → Minted Skill,但画法要和 loop 一致,不用方框流程图。)
  - 三条优势:"No curation needed." / "Works across every coding agent." / "No cold start. Useful from day one."
- **画面**:沿用 `style-loop` 的三行结构。三行即三个阶段:`01 Real sessions`(已发生的运行)→ `02 Evidence + source card`(正反模式带出处)→ `03 Minted Skill`(人审后),右端每行一个状态标记。优势三条放在底部一行。
- **Prompt**
```text
Layout: three stacked wide rows exactly like Image 2, each row = number, name with small caption, a one-line description on the right, a status mark. Top-right small label: "ONE · DISTILL".
Title: "ZERO-COST" / "DISTILLATION" (second line violet).
Row 01 name "Real sessions", caption "WHAT YOU ALREADY DID", text "Every run, across every coding agent."
Row 02 name "Evidence + source card", caption "PATTERNS AND ANTI-PATTERNS", text "Pulled from facts, each with its origin."
Row 03 (lavender, emphasised) name "Skill", caption "REVIEWED, THEN MINTED", text "No curation. No cold start. Useful from day one.", mark: check.
```
- **待你确认**:是否保留 "Human review"(人审后再铸造)作为这条线上的一步?

### 7 · 组织高匹配的上下文(第二件事,知识付费 2.0)
- **这一页要让观众记住**:因为记录了大量原始轨迹,我们清楚一个 Skill **是怎么诞生的**,以及它**真正在哪些场景下有效**。我们把这些整理成有用的上下文,交给用户。
- **页面文字**
  - 标题:`KNOWLEDGE-FOR-PAY` / `2.0`
  - 三行:`01 How it was born` "The original trajectory behind the Skill." / `02 Where it works` "The scenes where it really delivers." / `03 Matched to you` "Context that fits what you are doing now."
- **画面**:同样是 loop 的三行结构,第 3 行淡紫强调。(原来的"同一 Skill 在不同场景表现不同"的柱状图,信息保留在第 14 页,用我们的画法重画。)
- **Prompt**:与第 6 页相同结构,文案如上,右上角标签 `"TWO · DELIVER"`。

### 8 · 论点
- **这一页要让观众记住**:`AI-Native should be context-native first.` 真正有用的知识应该更好地成为你的上下文,并且足够契合你当下最需要的场景,而不是名字或工具切面上"看起来"匹配。
- **页面文字**
  - 大句:"AI-Native should be **context-native** first."
  - 副句:"Useful knowledge should become your context, fitted to the scene you are in right now, not matched by name or tool facet."
- **画面**:参考你给的第三张(`style-statement.png`)的留白和大字,但换成我们的边框与字体。居中大句,不堆东西。这一页可以用代码做,字体和字号清晰。
- **Prompt**:不需要生成,代码实现。

### 9 · 从可查询到被批准、可验证
定稿 `style-loop.jpg`,原样使用。
口头话术:"人批准的结论才成为记忆,并且有链上记录——这就把我们带到本次黑客松做的事。"

### 10 · 章节页:Putting context on-chain
- **页面文字**:`PUTTING` / `CONTEXT` / `ON-CHAIN`;小字:"BOT Chain. Provenance, usage, payment, privacy."
- **画面**:和封面同一个语言:半调、轨道细线、一个主视觉。主视觉用**平面线稿的账本块**(一排五个、一个带紫色高亮),不是 3D 渲染。
- **Prompt**(接共用前缀,另加封面作 Image 3 的风格参考)
```text
Layout: section divider like the cover (Image 3): large empty paper on the left for the title, line-art illustration on the right. Illustration: a row of five flat rectangular ledger blocks drawn as black line art with halftone shading, linked by a dashed line, the middle block highlighted in violet. FLAT line art only, no 3D render.
Top-right small label: "HACKATHON BUILD".
Title: "PUTTING" / "CONTEXT" / "ON-CHAIN" (last line violet). Small line below: "BOT Chain. Provenance, usage, payment, privacy."
```

### 11 · 链上补什么:三个缺口,三个答案
- **这一页要让观众记住**:回到第 5 页的三个问题,链分别怎么回答。这是上链部分的总览,也是目录。
- **页面文字**
  - 标题:`EVERY GAP GETS` / `AN ON-CHAIN ANSWER`
  - 三行(行内左右结构,左是缺口,右是答案):
    - "Copied, no attribution" → `Fingerprints and lineage` (SkillRegistry)
    - "No measurable utility" → `Real usage by scene` (UsageStats)
    - "No real monetization" → `Priced offers and royalties` (SkillMarket)
  - 底部加一行:"Private context, only for one wallet" → `Encrypted shares` (KeyRegistry · ShareRegistry)
- **画面**:loop 的行结构,四行,每行右端写合约名(小字)。
- **Prompt**
```text
Layout: four stacked wide rows (Image 2 style). Each row: a number, the gap on the left, a thin arrow, the on-chain answer on the right in bold, and the contract name as a small caption at the far right. Top-right small label: "ON-CHAIN".
Title: "EVERY GAP GETS" / "AN ON-CHAIN ANSWER" (second line violet).
Row 01: "Copied, no attribution" -> "Fingerprints and lineage" caption "SkillRegistry"
Row 02: "No measurable utility" -> "Real usage by scene" caption "UsageStats"
Row 03: "No real monetization" -> "Priced offers and royalties" caption "SkillMarket"
Row 04 (lavender): "Context too sensitive to send" -> "Encrypted shares" caption "KeyRegistry, ShareRegistry"
```

### 12 · 怎么上链:用户签名,中继付费
- **这一页要让观众记住**:用户的会话留在本机;只有签名后的动作上链;中继服务付 gas,但它只是提交者,动作的主体永远是签名者;服务看不到明文。合约没有 owner、没有 admin key、不可升级。
- **页面文字**
  - 标题:`USERS SIGN.` / `THE RELAY PAYS.`
  - 三列(`style-query` 的三栏结构,带箭头):`01 Your machine` "Sessions stay local. You sign each action." → `02 Relay` "Checks the signature. Pays the gas. Never sees plaintext." → `03 BOT Chain` "Five contracts. The signer is the actor."
  - 底部:"No owner. No admin key. No upgrade path."
- **画面**:直接用 `style-query` 的三栏 + 箭头版式,每栏里是三条小卡(简单的文本卡,不画流程图方框)。
- **Prompt**
```text
Layout: three columns with an arrow between each, exactly like Image 1's three-column structure (numbered column header with caption, then a stack of three small cards inside each column). Top-right small label: "ARCHITECTURE".
Title: "USERS SIGN." / "THE RELAY PAYS." (second line violet).
Column 01 "YOUR MACHINE": cards "Sessions stay local" / "You sign each action" / "Wallet key never leaves".
Column 02 "RELAY": cards "Checks the signature" / "Pays the gas" / "Never sees plaintext".
Column 03 "BOT CHAIN": cards "Five contracts" / "The signer is the actor" / "No admin key".
Bottom line: "No owner. No admin key. No upgrade path."
```
- **待你确认**:"Wallet key never leaves" 这条是我推断的,请确认或删除。

### 13 · Skill 成为资产:指纹与族谱
- **这一页要让观众记住**:Skill 铸造上链,有指纹、有版本、有父子关系。作者能证明"这是我先做的",别人基于它改出的新 Skill 挂在族谱上。
- **页面文字**
  - 标题:`MINT IT.` / `LINEAGE STAYS.`
  - 三行:`01 Fingerprint` "Every version is hashed on-chain." / `02 Parent` "Every fork points to where it came from." / `03 Birth scenes` "Each Skill records the work it was born from."
- **画面**:loop 的三行;右端不放对勾,放一个小的"父子"线稿图标。族谱树不单独画方框图,用三行即可。
- **Prompt**:同第 6 页结构,文案如上,标签 `"SKILL REGISTRY"`。

### 14 · 真实使用与场景归因
- **这一页要让观众记住**:Obelisk 本来就记录每次调用与上下文,所以能统计真实使用,而不是安装量。同一个 Skill 在不同场景表现不同;效果用"顺利率"表示,并始终展示样本量,排除"无法判断"。
- **页面文字**
  - 标题:`READ THE EVIDENCE,` / `NOT THE DESCRIPTION.`
  - 三栏(query 结构):`01 Reported` "Calls per Skill version, per wallet." → `02 By scene` "Where it was used, and how it went." → `03 Smooth rate` "Smooth ÷ (Smooth + Rework + Failure). Unknown excluded. Sample size shown."
- **画面**:query 的三栏版式。第 2 栏里放三条简单的水平进度条(只画条,不加 3D、不加图表轴),表示"同一 Skill 在不同场景的顺利程度",条上有场景名,不带数字。标注 `ILLUSTRATIVE`。
- **Prompt**
```text
Layout: three columns with arrows, as in Image 1. Top-right small label: "USAGE STATS".
Title: "READ THE EVIDENCE," / "NOT THE DESCRIPTION." (second line violet).
Column 01 "REPORTED": cards "Calls per Skill version" / "Per signing wallet".
Column 02 "BY SCENE": a card containing three flat horizontal bars labelled "Creative decks" (long, violet), "Landing pages" (medium, dark grey), "E-commerce admin" (short, light grey). No numbers. A small outlined tag "ILLUSTRATIVE".
Column 03 "SMOOTH RATE": a card with the line "Smooth / (Smooth + Rework + Failure)" and below it "Unknown excluded. Sample size shown."
```
- **待你确认**:是否需要放具体数字?原图里的 918 / 91% 是示意数据,我先不放。

### 15 · 市场:收入沿族谱分账
- **这一页要让观众记住**:买一次,一笔交易、一张收据,收入按族谱自动分给上游作者和平台;有访问模式与许可类型;一切可在链上核对。(知识付费 2.0 的"付费"一半。)
- **页面文字**
  - 标题:`ROYALTIES FOLLOW` / `THE LINEAGE.`
  - 三栏:`01 Buyer pays` "One transaction. One receipt." → `02 Split by lineage` "Author, parent, grandparent… and the platform fee." → `03 Verifiable` "Every receipt and allocation is on-chain."
  - 底部一行小卡:"Free · Per retrieval · Perpetual" / "Personal · Commercial"
- **画面**:query 三栏版式;第 2 栏里放一条水平堆叠的分账条(不同宽度的方块,加 `ILLUSTRATIVE`)。
- **待你确认**:平台费率是否展示?(合约里是固定的,我不写具体数字。)

### 16 · 私密分享:只给一个钱包
- **这一页要让观众记住**:上下文是"死文本"还是"能接着用的历史",区别在于它保留因果和出处。分享时:先检查并打码,在本机加密给接收者的钱包;规则(次数、期限、撤回)上链;接收者签名打开,每次打开留下收据。
- **页面文字**
  - 标题:`HAND IT TO` / `ONE WALLET.`
  - 三栏:`01 Check and seal` "Secrets masked. Encrypted on your machine." → `02 Rules on-chain` "One wallet. Open N times. Expires. Revocable." → `03 Open with a receipt` "The recipient signs. The open is recorded."
- **画面**:query 三栏;每栏三条小卡。第 2 栏的"规则"用四个小标签。**不画 3D 的盒子和钥匙。**
- **Prompt**:同第 12 页结构,文案如上,标签 `"PRIVATE SHARE"`。

### 17 · 演示闭环:AI 能力履历
- **这一页要让观众记住**:演示不是一个个功能,而是一个闭环——找一个履历 Skill、用它读取自己的真实历史生成履历、履历里的数据链到链上记录、关键证据私密出示给招聘方;这次调用本身又计入真实使用。
- **页面文字**
  - 标题:`ONE LOOP,` / `END TO END.`
  - 四个阶段,用 `style-loop` 的四行结构:`01 Find` "Pick a resume Skill by measured scenes." / `02 Use` "It reads your own history, locally." / `03 Prove` "Numbers link to on-chain records." / `04 Show` "Share the evidence with one recruiter's wallet."
- **画面**:loop 的行结构,四行。
- **待你确认**:演示现场到底演什么?如果最终不演这个,我换成你的实际演示步骤。

### 18 · 现状
- **页面文字**
  - 标题:`WHERE WE ARE` / `TODAY.`
  - 两栏:`Testnet · Chain ID 968` "Full loop live: sign, relay, mint, use, buy, settle." / `Mainnet · Chain ID 677` "Same frozen code. A few real transactions with explorer links."
  - 底部:"Test tokens and simulated roles are labelled as such."
- **画面**:两张并排大卡(同第 2 页版式),左卡淡紫、右卡白。
- **待你确认**:主网此刻是否已部署?(`docs/submission/two-networks.md` 写的是"尚未发布"。如已部署,我改写为已完成并附上浏览器链接。)

### 19 · 收尾
- 文案:`CONTEXT-NATIVE FIRST.` / `AI-NATIVE FOLLOWS.`;小字保留原句 "AI-Native should be context-native first."
- 画面:和封面成对,但**不重复同一画面**。现有的"黑色半调方尖碑"那张可以保留,也可以按你的审美重生成。

---

## 3. 我需要你确认的清单

1. 整体页序和页数,是否符合你讲的逻辑。尤其:第 8 页(论点)放在第 7 页之后、第 9 页之前,是否合适。
2. 第 3 页的证据:是否放 PR #27 的案例。
3. 第 6 页:是否保留 "Human review"。
4. 第 12 页:"Wallet key never leaves" 是否属实。
5. 第 14 页:是否放具体数字,还是只放示意。
6. 第 17 页:现场演示内容。
7. 第 18 页:主网部署状态。
8. 上链部分 9 页是否够用,是否要拆分或合并。

## 4. 实现备忘

- 播放器里每页用一张图时,同一页准备 `en` / `zh` 两个版本,按 `L` 切换,URL 记住语言。
- 代码实现的页面(第 8 页)文字用 `data-i18n` 两套文案。
- 英文全部定稿之后,再统一用 Codex 生成中文版。所有 prompt 放在 `deck/prompts/`,便于重跑。
