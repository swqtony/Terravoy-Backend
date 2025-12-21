# Supabase Risks and Gaps

- **Schema/Data已获取**：`supabase_raw/schema.sql` 和 `supabase_raw/data.sql` 已通过 `supabase db dump --linked` 拉取，作为当前真相源。
- **RLS政策缺失**：dump 中仅看到 RLS 启用（`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`），但没有任何 `CREATE POLICY`。需要确认 Supabase 控制台是否本就未配置策略，或导出遗漏；否则本地迁移需补充策略/鉴权逻辑。
- **Storage 未知**：dump 和代码均未体现 Supabase Storage 使用，需通过控制台确认是否有 bucket/签名/权限策略；本地后端暂不实现，统一返回 501 并提示使用 LeanCloud。
- **Cron/作业**：代码仅有 `orders/cron/auto_close_unconfirmed`（手动 HTTP 触发）。若控制台配置了调度任务，需要补充清单。
- **权限/Grants**：schema 中对 anon/authenticated/service_role 授予了 ALL（表/函数/序列），但无 RLS 策略，存在过度暴露风险；迁移时需在 API 层收紧。

## 待确认/后续动作
1. RLS Policy：查询确认 RLS 已开启（public 多表 + storage 多表），但未发现任何 `CREATE POLICY`；如控制台存在策略需导出补充，否则迁移时须在 API 层实现访问控制。
2. Storage：data dump 无 storage 数据；需在控制台/SQL 查询 buckets、objects、策略是否存在，并补充。
3. 确认是否有定时任务/cron（Supabase Scheduler）；如有，补充频率与逻辑。
4. 若需最小化权限，迁移时在本地 API 层实现等效的鉴权/授权规则，以替代缺失的 RLS Policy。
