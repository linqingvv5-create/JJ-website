# 资金与投资管理系统：第一阶段开发计划

更新日期：2026-07-21

## 第一阶段实现状态

| 范围 | 当前实现 |
| --- | --- |
| 家庭成员 | 支持新增多个成员、成员账户和成员账本视角 |
| 收入、支出、转账 | 六类财务记录均已建模；转账强制双账户且不计收支 |
| 个人与家庭归属 | 支持个人/家庭、共享/私密、是否计入家庭统计及分摊预留 |
| 账户管理 | 支持全部要求的账户类型、增改停用、余额调整、月流入流出和资产口径 |
| 家庭账单明细 | 支持三类视角、搜索、排序、筛选、按月查看和备注行内编辑 |
| 月度统计 | 支持收入、支出、结余、必须/非必须支出及成员支出 |
| 鹅鸭鸡 | `DreamAnimal` 与 `DreamGoal` 分离，支持目标、状态、体型、进度和历史 |
| 真实账户关系 | 目标可关联多个真实账户；目标转入强制真实转出/转入账户 |
| 投资摘要 | 只读现有投资账户摘要并更新小鹅与家庭资产，不生成家庭账目 |
| CSV | 支持按当前视角导出和批量导入 |
| 手机端 | 快速记账表单和资金页面均提供窄屏布局 |
| 持久化 | 新资金模型使用独立 D1 关系表；现有股票状态继续使用原存储 |

Excel 文件导入导出、快捷指令写入接口及其他未列入第一阶段的能力继续按后续阶段处理。

## 1. 本轮结论与保护边界

本项目将从“股票投资系统”扩展为“资金与投资管理系统”，但第一阶段采用增量开发，不大范围重构现有投资模块。

以下现有交易计划实现列为只读保护区，本阶段不修改其布局、样式和业务逻辑：

- `finance.html` 中现有投资页面骨架和“交易计划”入口。
- `trade-board.js` 中持仓详情、买卖计划、做 T、策略说明、下一步操作及交易执行相关函数。
- `style.css` 中现有交易计划、持仓详情、Excel 交易表相关样式。
- `data.js` 中现有股票账户、持仓、交易计划、成交历史和默认投资数据。

新资金模块只读取投资账户摘要，不把股票买卖写入家庭账单，也不反向修改交易计划。

## 2. 当前技术栈

- 前端：原生 HTML、CSS、JavaScript，无 React/Vue、无前端打包依赖。
- 页面：`finance.html` 为投资主页面，`trade-board.js` 负责页面状态、渲染和交互，`style.css` 负责样式，`data.js` 提供默认投资数据。
- 本地状态：浏览器 `localStorage`，现有投资状态键为 `linqing-trade-board-excel-v1`。
- 云端同步：
  - Sites/Cloudflare Worker 路径使用 D1，表为 `shared_state`，当前把整个投资状态以 JSON 文档保存为 `board-state`。
  - Cloudflare Pages Functions 路径使用 Supabase，表为 `public.app_documents`，同样以 JSONB 文档保存；现有 `/api/modules/[moduleId]` 已支持按模块分文档。
- API：现有主投资状态使用 `GET/POST /api/state`；Pages Functions 另有 `/api/actions` 和 `/api/modules/[moduleId]`。
- 部署：`.openai/hosting.json` 声明 Sites 项目和 D1 绑定；`build-site.ps1` 组装静态资源和 Worker 输出。
- PWA/移动端：`finance-manifest.webmanifest`、移动 viewport 和现有响应式样式已存在。

## 3. 当前页面与文件定位

### 交易计划页面

交易计划不是独立 HTML 路由，而是投资持仓详情内由 JavaScript 渲染的区域：

- 页面骨架与入口：`finance.html`
- 主实现：`trade-board.js`
  - 持仓详情：`renderDetail`
  - 下一步操作：`renderNextActions`
  - 买卖计划：`renderBuyTab`、`renderBuyRow`、`renderBuyCard`
  - 卖出计划：`renderSellTab`、`renderSellRow`、`renderSellCard`
  - 做 T：`renderTradeTab` 及相关执行函数
  - 策略说明：`renderStrategyTab`
- 样式：`style.css` 中详情页、计划折叠面板、表格、卡片和移动端规则。
- 默认数据：`data.js` 中 `plans`、`tradeHistory`、`completedSales` 等投资数据。

### 持仓页面

- 页面骨架：`finance.html` 的 `#home-view` 和 `#account-list`。
- 主实现：`trade-board.js` 的 `renderHome`、`renderAccount`、`renderHolding`、`openHolding`、持仓增删和价格更新逻辑。
- 数据：`data.js` 的 `accounts`、`holdings`、`positionLots`。
- 样式：`style.css` 中账户列表、持仓行、资产摘要和移动端规则。

### 现有资金管理页面

- 页面骨架：`finance.html` 的 `#funds-view`、`#funds-content`，底部快捷入口为 `data-quick-target="funds"`。
- 主实现：`trade-board.js` 的 `openFundsManagement`、`renderFundsManagement`、`openLedgerEditor`、`openBankFundsEditor`、`openBankTransfer`。
- 当前数据：`state.bankCash`、投资 `state.accounts[].availableCash` 和 `state.ledgerEntries`。
- 当前局限：账本记录只有日期、类型、单一账户、金额、备注；“转入/转出”不是双账户原子记录；收入、支出、证券资金移动仍处于同一个投资状态文档，不能直接作为新的家庭账本模型。

## 4. 当前存储方式及第一阶段策略

### 当前方式

1. `trade-board.js` 先读写 `localStorage`。
2. 页面通过 `/api/state` 拉取和推送整个投资状态。
3. 云端用 revision 和 savedAt 保存一份 `board-state` JSON 文档。
4. Sites Worker 使用 D1 的 `shared_state`；Pages Functions 使用 Supabase 的 `app_documents`。

### 第一阶段策略

新资金功能直接并入现有 `finance.html`，但使用独立的 D1 关系表和 `/api/finance/*` 接口保存。投资模块继续使用现有 `board-state`、`/api/state` 和现有本地键。`localStorage` 只保存临时草稿、筛选条件和当前视图，不作为家庭账单、账户余额或目标进度的权威数据源。

这样可以做到：

- 家庭账单、账户、目标和报表数据与股票交易数据物理分表、分接口保存。
- 新模块失败或迁移时，不影响现有持仓和交易计划。
- 投资摘要通过只读适配器从现有投资状态计算，不复制每笔股票交易。
- 第一阶段不引入新的前端框架，也不重构现有投资存储；新增的资金明细从第一天起使用 D1 规范化表，支持可靠筛选、排序、归属和余额更新。

资金模块保存动作必须经过统一领域服务，禁止页面直接随意改余额。每次保存一笔业务记录时，在同一份新状态快照中同时完成交易、账户余额、目标流水和统计派生更新，避免出现“明细有了但余额没变”的半完成状态。

## 5. 四类数据边界

| 数据域 | 允许的记录 | 对家庭收支的影响 | 对账户余额的影响 | 与投资模块关系 |
| --- | --- | --- | --- | --- |
| 日常账单 | 收入、支出、退款、报销 | 按类型和 `includeInFamilyStats` 统计 | 是 | 不生成股票交易 |
| 账户转账 | 两个真实账户之间，或真实账户与目标资金分配之间的移动 | 永不计收入或支出 | 转出减、转入加 | 银行与证券账户互转仍是转账 |
| 投资交易 | 股票买入、卖出、持仓、成本、盈亏 | 永不计普通家庭收支 | 由现有投资模块管理 | 家庭模块只读摘要 |
| 资金目标 | 鹅、鸭、鸡的目标、分配、扣减和进度 | 分配不计收支；实际目标支出可关联一笔日常支出 | 取决于是否伴随真实账户转账/支出 | 小鹅可关联投资摘要 |

必须保持以下不变量：

- 银行卡转入证券账户：`TRANSFER`，不计支出。
- 证券账户转回银行卡：`TRANSFER`，不计收入。
- 股票买入和卖出只存在于投资域，不进入 `FinanceTransaction`。
- 投资盈亏只进入 `InvestmentAccountSummary` 和 `AssetSnapshot`，不生成普通收入或支出。
- 家庭资产页只读取投资账户摘要，不读取股票交易明细。
- 信用卡消费是 `EXPENSE`；信用卡还款是银行卡到信用卡的 `TRANSFER`。
- 余额调整是 `BALANCE_ADJUSTMENT`，单独计审计差额，默认不计家庭收入/支出。
- 转账必须同时存在 `fromAccountId` 和 `toAccountId`，且两者不能相同。
- 金额统一以人民币“分”存储为整数，避免浮点误差；显示层再格式化为元。

## 6. 准备新增的数据模型

### FamilyMember

- `id`
- `displayName`
- `role`：本人、伴侣或其他家庭成员
- `avatarColor`
- `isCurrentUser`
- `isActive`
- `createdAt`、`updatedAt`

### FinanceAccount

- `id`
- `name`
- `type`：`BANK`、`WECHAT`、`ALIPAY`、`CASH`、`CREDIT_CARD`、`FAMILY_SHARED`、`FUND`、`SECURITIES`、`OTHER`
- `ownerMemberId`
- `currency`
- `openingBalanceCents`
- `currentBalanceCents`
- `creditLimitCents`、`billingDay`、`repaymentDay`（信用卡可选）
- `includeInFamilyAssets`
- `isShared`
- `isArchived`
- `updatedAt`

本月流入、本月流出由交易按账户和月份派生，不作为手工维护的事实字段。

### FinanceCategory

- `id`
- `name`
- `direction`：`INCOME` 或 `EXPENSE`
- `parentId`：二级分类指向一级分类
- `scope`：系统默认或家庭自定义
- `ownerMemberId`：个人私有分类可选
- `sortOrder`
- `isActive`

默认收入分类：工资、奖金、父母给予、意外之财、写书收入、UP主收入、投资分红、利息、退款、其他收入。

默认支出一级分类：生活必须支出、生活非必须支出、梦想计划支出、投资相关费用、其他支出；按需求预置对应二级分类，并允许自定义。

### FinanceTransaction

- `id`
- `occurredAt`
- `type`：`INCOME`、`EXPENSE`、`TRANSFER`、`REFUND`、`REIMBURSEMENT`、`BALANCE_ADJUSTMENT`
- `amountCents`：始终为正数，方向由类型和账户字段决定
- `categoryId`、`subcategoryId`
- `fromAccountId`：支出、转账转出、退款退回来源等场景使用
- `toAccountId`：收入、转账转入、报销入账等场景使用
- `bookkeeperMemberId`
- `payerMemberId`
- `ownership`：`PERSONAL` 或 `FAMILY`
- `ownerMemberId`：个人归属时必填
- `isShared`
- `includeInFamilyStats`
- `dreamGoalId`：可选关联鹅鸭鸡目标
- `merchant`
- `note`
- `splitAllocations`：预留 `{ memberId, ratioBps, amountCents }[]`，第一阶段不做欠款结算
- `relatedTransactionId`：退款、报销关联原记录
- `importBatchId`
- `createdAt`、`updatedAt`

校验规则由类型决定：`TRANSFER` 必须双账户；普通支出必须有转出账户；普通收入必须有转入账户；退款和报销保留独立类型，不伪装成普通收入。

### DreamAnimal

- `id`
- `kind`：`GOOSE`、`DUCK`、`CHICKEN`
- `name`
- `ownerMemberId`
- `visualVariant`：大鹅、小鹅或其他展示变体
- `sortOrder`
- `isActive`

### DreamGoal

- `id`
- `animalId`
- `name`
- `targetAmountCents`
- `allocatedAmountCents`
- `spentAmountCents`
- `principalCents`、`earningsCents`（鹅使用）
- `targetDate`
- `status`：鸡支持 `SAVING`、`GROWN`、`USED`、`COMPLETED`、`CLOSED`；鹅鸭使用适配后的进行中/完成/关闭状态
- `linkedAccountIds`
- `linkedInvestmentAccountIds`
- `createdAt`、`updatedAt`

目标进度由目标流水、账户分配和投资摘要派生。“卖鸡”只改变目标状态或生成目标支出关联，不创建特殊收入类型。

### AssetSnapshot

- `id`
- `snapshotDate`
- `scope`：家庭、成员、账户、目标或投资摘要
- `scopeId`
- `assetCents`
- `liabilityCents`
- `netAssetCents`
- `principalCents`
- `profitLossCents`
- `source`：手工、账户汇总或投资摘要
- `createdAt`

### InvestmentAccountSummary

- `id`
- `investmentAccountId`：映射现有投资账户 id
- `name`
- `ownerMemberId`
- `totalAssetCents`
- `principalCents`
- `profitLossCents`
- `availableCashCents`
- `marketValueCents`
- `updatedAt`
- `sourceRevision`

该模型由适配器从现有 `accounts`、`holdings`、`positionLots` 和价格计算得出，只读，不保存股票交易明细。

### 第一阶段辅助模型

为保证导入、目标历史和同步可审计，另准备：

- `DreamGoalLedgerEntry`：目标分配、扣减、投资估值变化和手工调整历史。
- `ImportBatch`：CSV/Excel 导入文件名、时间、行数、错误和去重标识。
- `FinanceSettings`：默认成员、默认账本视角、家庭名称和数据版本。

## 7. 准备新增的页面视图与路由

所有功能都放进截图所示的现有 `finance.html`，保持同一个红色标题栏、主内容区和底部导航，不另建 `money.html`。使用 hash 只表示当前视图，刷新后仍回到同一个网页：

- `/finance.html#/overview`：资金总览
- `/finance.html#/ledger`：家庭账本、我的账本、对方账本视角和 Excel 风格明细
- `/finance.html#/quick-add`：手机端快速记账
- `/finance.html#/accounts`：日常账户管理
- `/finance.html#/dreams`：鹅鸭鸡与目标进度
- `/finance.html#/investment-accounts`：投资账户资产摘要
- `/finance.html#/holdings`：现有持仓管理视图
- `/finance.html#/reports`：月报、年报和资产报表

现有交易计划仍在选择某只持仓后进入原详情区域，不改其 DOM 结构、样式、编辑方式或执行逻辑。新增导航控制器只负责在现有投资视图和新资金视图之间切换。

准备新增的 API：

- `GET/POST /api/finance/members`：家庭成员。
- `GET/POST/PATCH /api/finance/accounts`：账户。
- `GET/POST/PATCH /api/finance/transactions`：账单、转账和余额调整。
- `GET/POST/PATCH /api/finance/goals`：鹅鸭鸡和目标流水。
- `GET /api/finance/summary?month=YYYY-MM`：月度统计与资产摘要。
- `GET /api/investment-summary`：可选的只读摘要端点；第一阶段也可由前端适配器从只读 `/api/state` 计算。
- `GET /api/finance-export.csv`：后续服务端导出预留；第一阶段 CSV 导出可直接在浏览器完成。

第一阶段不开放 iPhone 快捷指令写入接口，只在模型和 API 认证设计中预留未来 `POST /api/finance/transactions`。

## 8. 准备新增或修改的文件

### 新增

- `finance-system.js`：新资金模块的路由、状态、领域校验、记账闭环和统计。
- `finance-system.css`：仅服务新资金页面，避免污染现有交易计划样式。
- `finance-system-data.js`：默认成员、分类、账户和鹅鸭鸡示例结构。
- `finance-investment-adapter.js`：只读生成 `InvestmentAccountSummary`。
- `finance-csv.js`：CSV 模板、导入校验、去重和导出。
- `db/schema.ts`：新资金模型对应的 D1 表、索引与约束定义。
- `drizzle/*_create_finance_system.sql`：生成并检查后的资金模块迁移。
- `docs/finance-investment-system-plan.md`：本规划文档。
- `docs/finance-csv-template.csv`：第一阶段导入模板与字段示例。
- `functions/api/finance/*`：Pages Functions 部署路径的资金 API。
- `functions/api/investment-summary.js`：只读投资摘要端点（若采用服务端摘要）。

### 计划修改

- `finance.html`：直接增加资金总览、家庭账本、账户、鹅鸭鸡、投资账户和报表的视图容器与导航；不改交易计划 DOM、样式或业务逻辑。
- `trade-board.js`：原则上不修改；若必须支持摘要，只新增独立只读导出适配接口，不改任何计划函数。
- `worker/site-worker.js`：增加 `/api/finance/*` 的 D1 关系数据接口，并保持 `/api/state` 行为不变。
- `build-site.ps1`：把新资金脚本、样式、迁移与同一个 `finance.html` 一起加入构建产物。
- `finance-manifest.webmanifest`：补充资金系统名称或 shortcuts，不改变现有交易页面运行逻辑。
- `README.md`：补充新模块、数据边界和运行说明。
- `supabase/schema.sql`：为备用 Pages/Supabase 部署路径增加对应关系表；绝不改写现有 `board-state`。

当前已进入第一阶段实现：新增 `finance-system.js`、`finance-system.css`、D1 数据模型与迁移，并在原 `finance.html` 内加入资金视图和导航。现有 `trade-board.js` 与 `style.css` 仍作为交易计划保护区，未修改。

## 9. 第一阶段实施顺序

1. **冻结保护区并建立独立状态**：为交易计划相关函数建立不改清单；加入 `finance-system-v1` 默认状态、版本和独立本地/云端存储。
2. **家庭成员、分类、账户基础数据**：实现成员、个人/家庭归属、账户类型、默认收入/支出分类和账户列表。
3. **打通家庭支出最小闭环**：记一笔家庭支出 → 校验并保存 → 明细出现 → 月度支出和结余更新 → 支付账户余额减少 → 家庭统计更新。
4. **打通收入、退款、报销和余额调整**：使用独立类型和明确统计口径，不用正负数伪装业务类型。
5. **打通双账户转账闭环**：一笔转账同时更新转出/转入账户，永不计家庭收入或支出；覆盖信用卡还款和银行/证券互转。
6. **实现账本视角和表格模式**：我的账本、对方账本、家庭账本；搜索、筛选、排序、按月查看和安全的行内编辑。
7. **实现鹅鸭鸡基础页面与目标流水**：大鹅、小鹅、鸭、鸡的数据结构、状态、简单体型等级和进度条。
8. **打通目标转账闭环**：银行卡转入买房鸭 → 保存转账/目标分配 → 不计消费 → 真实账户余额更新 → 买房鸭进度增加 → 历史可查。
9. **接入投资账户摘要**：从现有投资状态只读生成摘要；更新小鹅体型/进度和家庭总资产；不生成家庭收入或支出。
10. **统计与报表**：本月收入、支出、结余、必须/非必须支出、成员支出、账户余额、投资摘要、目标进度、月度和年度趋势。
11. **CSV 导入导出**：先预览和校验，再批量写入；导入走同一领域服务，确保余额与统计同步；Excel 原生导入导出放在第一阶段末尾，CSV 优先。
12. **移动端验收与回归**：快速记账触控流程、窄屏表格、离线本地保存、同步冲突提示；完整回归持仓、交易计划和下一步操作没有变化。

## 10. 第一阶段验收标准

### 家庭支出闭环

- 一次保存后产生且只产生一条 `EXPENSE`。
- 明细立即可见。
- 支付账户余额准确减少。
- 本月支出增加，本月结余减少。
- `ownership=FAMILY` 且 `includeInFamilyStats=true` 时进入家庭统计。
- 刷新和云端重拉后结果一致。

### 买房鸭转账闭环

- 记录类型为 `TRANSFER`，具有真实转出账户和目标关联。
- 不增加收入、不增加支出。
- 银行账户余额减少，买房鸭已分配金额和完成比例增加。
- 目标历史能定位这次转入。

### 投资摘要闭环

- 现有投资账户资产更新后，摘要总资产、可用资金、盈亏和更新时间变化。
- 小鹅的体型等级/进度按摘要变化。
- 家庭总资产包含勾选计入的投资摘要。
- 家庭账单中没有自动生成收入、支出或股票成交记录。

### 回归保护

- 交易计划页面布局和样式无变化。
- 买卖计划、做 T、策略说明、持仓更新和下一步操作逻辑无变化。
- 原投资状态键和 `/api/state` 行为保持兼容。

## 11. 暂不实施

- 微信、支付宝或银行自动同步。
- 自动交易。
- 鹅鸭鸡复杂动画。
- AI 消费建议。
- 家庭成员欠款和结算。
- 原生 App。
- 每笔股票交易同步到家庭账单。
