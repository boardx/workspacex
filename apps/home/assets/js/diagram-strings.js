/**
 * diagram-strings.js — copy that JS draws rather than HTML declaring.
 *
 * Page copy lives in index.html (English) + zh.js (Chinese). Diagram labels
 * have no DOM to be authored in, so both languages sit here, side by side, so
 * a translator can never see one without the other. `check-i18n.mjs` fails if
 * diagrams.js calls t() with a key that is missing from this file, or if
 * either language of a key is empty.
 */
export default {
  /* hero chain */
  'd.chain.context':  { en: 'Context',  zh: '上下文' },
  'd.chain.agents':   { en: 'Agents',   zh: '智能体' },
  'd.chain.action':   { en: 'Action',   zh: '行动'   },
  'd.chain.evidence': { en: 'Evidence', zh: '证据'   },
  'd.chain.memory':   { en: 'Memory',   zh: '记忆'   },

  /* shift axis */
  'd.axis.a1': { en: 'Compute',      zh: '算力' },
  'd.axis.a2': { en: 'Intelligence', zh: '智能' },
  'd.axis.a3': { en: 'Work',         zh: '工作' },
  'd.axis.was': { en: 'Where value sat', zh: '价值曾经在这里' },
  'd.axis.now': { en: 'Where it is going', zh: '价值正在去那里' },

  /* problem: the broken chain */
  'd.break.ask':    { en: 'Ask',        zh: '提问'     },
  'd.break.answer': { en: 'Answer',     zh: '生成回答' },
  'd.break.redo':   { en: 'Re-do by hand', zh: '人工重做' },
  'd.break.check':  { en: 'Check',      zh: '人工检查' },
  'd.break.file':   { en: 'File away',  zh: '归档遗忘' },
  'd.break.lost':   { en: 'context lost', zh: '上下文丢失' },

  /* the loop */
  'd.loop.intent':  { en: 'Intent',  zh: '意图' },
  'd.loop.explore': { en: 'Explore', zh: '探索' },
  'd.loop.create':  { en: 'Create',  zh: '创造' },
  'd.loop.act':     { en: 'Act',     zh: '行动' },
  'd.loop.verify':  { en: 'Verify',  zh: '验证' },
  'd.loop.learn':   { en: 'Learn',   zh: '学习' },
  'd.loop.leadHuman': { en: 'Human leads', zh: '人主导' },
  'd.loop.leadAi':    { en: 'Agents lead', zh: '智能体主导' },
  'd.loop.leadBoth':  { en: 'Together',    zh: '共同' },
  'd.loop.leadEv':    { en: 'Gate',        zh: '闸口' },

  /* architecture */
  'd.arch.l5':   { en: 'Experience',        zh: '体验层' },
  'd.arch.l5d':  { en: 'Chat · Canvas · Docs · Spatial', zh: '对话 · 画布 · 文档 · 空间' },
  'd.arch.l4':   { en: 'Agents & Workflow', zh: '智能体与工作流' },
  'd.arch.l4d':  { en: 'Agents · Skills · Planner · Eval', zh: '智能体 · 技能 · 规划 · 评估' },
  'd.arch.l3':   { en: 'Harness',           zh: '执行护栏' },
  'd.arch.l3d':  { en: 'Execution · Tools · Evidence · Governance', zh: '执行 · 工具 · 证据 · 治理' },
  'd.arch.l2':   { en: 'Ontology & Knowledge', zh: '本体与知识' },
  'd.arch.l2d':  { en: 'Entity · Relation · Event · Memory', zh: '实体 · 关系 · 事件 · 记忆' },
  'd.arch.l1':   { en: 'Infrastructure',    zh: '基础设施' },
  'd.arch.l1d':  { en: 'Cloud · On-prem · Local-first · Identity', zh: '云 · 私有化 · 本地优先 · 身份' },
  'd.arch.fast': { en: 'moves fast',   zh: '快速演进' },
  'd.arch.stable': { en: 'must stay stable', zh: '必须稳定' },
  'd.arch.swap': { en: 'swappable',    zh: '可替换' },

  /* harness gates */
  'd.harness.authorize': { en: 'Authorize', zh: '授权' },
  'd.harness.execute':   { en: 'Execute',   zh: '执行' },
  'd.harness.observe':   { en: 'Observe',   zh: '观测' },
  'd.harness.verify':    { en: 'Verify',    zh: '验证' },
  'd.harness.evidence':  { en: 'Evidence',  zh: '留证' },
  'd.harness.rollback':  { en: 'Rollback',  zh: '回滚' },
  'd.harness.pass':      { en: 'passed',    zh: '通过' },
  'd.harness.fail':      { en: 'failed — reversed', zh: '未通过，已撤回' },

  /* ontology graph */
  'd.graph.person':   { en: 'Person',   zh: '人'   },
  'd.graph.project':  { en: 'Project',  zh: '项目' },
  'd.graph.decision': { en: 'Decision', zh: '判断' },
  'd.graph.evidence': { en: 'Evidence', zh: '证据' },
  'd.graph.action':   { en: 'Action',   zh: '行动' },
  'd.graph.artifact': { en: 'Artifact', zh: '产物' },
  'd.graph.memory':   { en: 'Memory',   zh: '记忆' },
};
