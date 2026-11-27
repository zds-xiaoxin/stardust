# 把「额度胶囊」装进你的工作台

状态：**已在星尘里**。有订阅额度读数时才显示。

直接把下面这段提示词发给 Claude Code / Codex / T3 Code：

```text
请参考 `stardust-kit/quota-capsule/` 里的 `QuotaTopbar.tsx`、`quotaTopbar.module.css`、`quotaTopbarModel.ts`，给我的工作台顶栏加一组「额度胶囊」：
将同目录的 `quotaFreshness.ts` 和 `usageQuotaPresentation.ts` 一起安装到额度组件目录。前者只依赖契约类型，旧宿主也能使用顶栏的 30 分钟时限。
1. 每个订阅一枚胶囊：18px 进度环 + 名称 + 剩余百分比 + 窗口缩写；剩余 ≤ 20% 时数字变琥珀色；
2. 点击胶囊展开面板，列出各订阅的 5 小时和每周窗口、进度条与重置时间；面板里提供刷新和完成按钮，Esc 关闭；
3. 最多固定 4 枚，偏好存到本地存储，默认按剩余量排序；
4. 读数超过 30 分钟未更新时用灰色并标注，每 10 分钟自动刷新；
5. 数据来自你项目已有的额度接口，不要硬编码账号或路径；完成后跑 lint、类型检查和 QuotaTopbar 的浏览器测试。
```
