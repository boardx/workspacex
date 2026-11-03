/** One presentation map for the form, details and reversible Markdown sections. */
export const EXPERT_PROFILE_FIELDS = [
 ['category','分类','text'],['location','所在地','text'],['age','年龄','number'],['occupation','职业','text'],
 ['goals','目标','list'],['interests','兴趣','list'],['painPoints','痛点','list'],
 ['motivations','动机','list'],['influences','影响因素','list'],
 ['introvertExtrovert','内向—外向','trait'],['analyticalCreative','分析—创造','trait'],['busyTimeRich','忙碌—时间充裕','trait'],
 ['serviceValue','服务价值','detail'],['typicalAdvice','典型建议','detail'],
] as const;
export type ExpertProfileKey = typeof EXPERT_PROFILE_FIELDS[number][0];

export const expertProfileFieldLabels = Object.fromEntries(EXPERT_PROFILE_FIELDS.map(([key, label]) => [key, label])) as Record<ExpertProfileKey, string>;
