import { createHash } from 'node:crypto';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';

const template = 'meeting-feedback';
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const publicationToken = /^[A-Za-z0-9_-]{1,512}\.[A-Za-z0-9_-]{43}$/;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const titles = ['会议名称', '会议日期', '会议目标和议程清晰。', '会议内容与我的工作相关。', '参会者有足够机会表达意见。', '会议时长是否合适？', '会后行动项、负责人和时间明确。', '下次会议最值得改进的地方是什么？'];
const types = ['short','date','scale','scale','scale','single','scale','open'];
const keys = (obj, expected) => obj && Object.keys(obj).sort().join(',') === expected;
export function surveyFixture(run) {
  const title = 'QA 原型复盘 ' + run;
  const answer = 'QA 合成答卷 ' + run + '：队列提示可读，希望增加口味差异说明。';
  return { title, answer, values: [title, '2026-11-01', '4', '4', '4', '合适', '4', answer] };
}
// Pin the draft emitted by the native meeting-feedback template, including nested Markdown,
// question settings and report sections. A template change requires reviewing the new payload.
export const nativeSurveyTemplateDigest = body => createHash('sha256').update(JSON.stringify([body.questions, body.template])).digest('hex');
export function createSurveyCollectionGuard(run, trustedTemplate = '36567f1a9f6588b1e8933a75a3072043eb40cb9855cf48318dc2149b19d720b0') {
  const fixture = surveyFixture(run);
  let active = false, id, version, token, responseId;
  const expectedValues = [...fixture.values];
  const spent = new Set();
  const reject = () => { throw new ProbeFailure('NATIVE_SURVEY_SCOPE_REJECTED'); };
  const take = kind => { if (spent.has(kind)) reject(); spent.add(kind); return { allow: true, kind }; };
  const questionId = i => template + '-q' + (i + 1);
  function decide(method, url, body, projectId, audience) {
    if (!active || !projectId) return;
    const path = url.pathname;
    if (method === 'GET') {
      const studio = path === '/studio/survey' && url.searchParams.get('create') === '1' && url.searchParams.get('projectId') === projectId && url.searchParams.size === 2;
      const ownedStudio = id && ['design','publish','responses'].some(section => path === '/studio/survey/' + id + '/' + section) && url.searchParams.get('projectId') === projectId && url.searchParams.size === 1;
      const ownedRead = id && path === '/api/surveys/' + id && !url.search;
      const publicRead = token && ['/surveys/', '/api/public/surveys/'].some(prefix => path === prefix + token) && !url.search;
      if (ownedRead) return { allow: true, kind: 'survey-read' };
      if (studio || ownedStudio || publicRead) return { allow: true, kind: 'read' };
      return;
    }
    if (method !== 'POST' || url.search) return;
    if (audience === 'survey-participant' && (!token || path !== '/api/public/surveys/' + token + '/responses')) reject();
    if (path === '/api/surveys') {
      if (!keys(body, 'questions,tags,template,title') || body.title !== fixture.title || !Array.isArray(body.tags) || body.tags.length
        || nativeSurveyTemplateDigest(body) !== trustedTemplate || body.template?.id !== template + '-report' || body.questions?.length !== titles.length
        || !body.questions.every((q,i) => q.id === questionId(i) && q.title === titles[i] && q.type === types[i]
          && q.provenance?.source === 'template' && q.provenance.sourceId === 'builtin-survey-' + template)) reject();
      return take('survey-create');
    }
    if (id && path === '/api/projects/' + projectId + '/resources' && body?.kind === 'survey') {
      if (!keys(body, 'kind,projectId,resourceId') || body.projectId !== projectId || body.resourceId !== id) reject();
      return take('survey-link');
    }
    if (id && path === '/api/surveys/' + id + '/publish') {
      if (!spent.has('survey-linked') || !keys(body, 'expectedVersion') || body.expectedVersion !== version) reject();
      return take('survey-publish');
    }
    if (token && path === '/api/surveys/' + id + '/close') {
      if (!keys(body, 'expectedVersion') || body.expectedVersion !== version) reject();
      return take('survey-close');
    }
    if (token && path === '/api/public/surveys/' + token + '/responses') {
      if (audience !== 'survey-participant' || !keys(body, 'answers,durationSeconds,submissionId') || !uuidPattern.test(body.submissionId) || !Number.isInteger(body.durationSeconds)
        || body.durationSeconds < 0 || body.durationSeconds > 1800 || body.answers?.length !== titles.length) reject();
      for (let i=0; i<titles.length; i++) {
        const row = body.answers.find(answer => answer.questionId === questionId(i));
        if (!keys(row, 'questionId,value') || String(row.value) !== String(expectedValues[i]) || !['number','string'].includes(typeof row.value)) reject();
      }
      return take('survey-submit');
    }
  }
  function observe(kind, status, data) {
    if (typeof kind !== 'string' || !kind.startsWith('survey-')) return;
    if (![200,201,204].includes(status)) reject();
    if (kind === 'survey-create') {
      if (!idPattern.test(data?.id ?? '') || data.title !== fixture.title || data.status !== 'draft' || data.responses?.length !== 0 || data.publication || !Number.isInteger(data.version)) reject();
      id = data.id; version = data.version;
    }
    if (kind === 'survey-read') {
      if (data?.id !== id || !Number.isInteger(data.version)) reject();
      version = data.version;
    }
    if (kind === 'survey-close') {
      if (data?.id !== id || data.publication?.status !== 'closed') reject();
      token = undefined;
    }
    if (kind === 'survey-link') spent.add('survey-linked');
    if (kind === 'survey-publish') {
      if (data?.id !== id || data.publication?.status !== 'collecting' || !publicationToken.test(data.publication.token ?? '')) reject();
      token = data.publication.token; version = data.version;
      for (const i of [2,3,4,5,6]) {
        const question = data.publication.questions.find(q => q.id === questionId(i));
        const choice = i === 5 ? 1 : 3;
        if (!question || question.title !== titles[i] || !question.options?.[choice]) reject();
        expectedValues[i] = question.config?.optionIds?.[choice] ?? question.options[choice];
      }
    }
    if (kind === 'survey-submit') {
      if (!idPattern.test(data?.responseId ?? '') || data.replayed !== false) reject();
      responseId = data.responseId;
    }
  }
  return { arm() { if (active) reject(); active = true; }, decide, observe, publicLink: () => token ? '/surveys/' + token : null, receipt: () => ({ id, responseId }) };
}

export async function collectNativeSurvey({ page, expect, actions, saveSource, fixture, receipt, createSurveyParticipant }) {
  const [studio] = await Promise.all([page.waitForEvent('popup'), actions.getByRole('link', { name: '在新标签页创建问卷' }).click()]);
  try {
    const dialog = studio.getByRole('dialog', { name: '新建问卷' });
    await dialog.getByRole('textbox', { name: '问卷名称' }).fill(fixture.title);
    await dialog.getByRole('radio', { name: /从模板创建/ }).check();
    await dialog.getByRole('combobox', { name: '选择问卷模板' }).selectOption('builtin-survey-' + template);
    await dialog.getByRole('button', { name: '下一步' }).click();
    await expect(studio).toHaveURL(/\/studio\/survey\/[^/?]+\/design/);
    const id = receipt().id;
    if (!id || !new URL(studio.url()).pathname.endsWith('/' + id + '/design')) throw new ProbeFailure('NATIVE_SURVEY_CREATE_NOT_OBSERVED');
    await actions.getByRole('button', { name: '刷新已关联资料' }).click();
    const linked = actions.getByRole('combobox', { name: '关联项目问卷' });
    await expect(linked.locator('option').filter({ hasText: fixture.title })).toHaveAttribute('value', id);
    await saveSource(() => linked.selectOption(id));
    const publishLink = actions.getByRole('link', { name: '打开问卷发布' });
    const publishUrl = new URL(await publishLink.getAttribute('href'), page.url());
    if (publishUrl.origin !== new URL(page.url()).origin || publishUrl.pathname !== '/studio/survey/' + id + '/publish') throw new ProbeFailure('NATIVE_SURVEY_PUBLISH_LINK_INVALID');
    await studio.goto(publishUrl.href);
    await studio.getByRole('button', { name: '开始回收' }).click();
    const stop = studio.getByRole('button', { name: '停止回收' });
    await expect(stop).toBeVisible();
    try {
      await actions.getByRole('button', { name: '刷新答卷' }).click();
      const href = await actions.getByRole('link', { name: '打开填写链接' }).getAttribute('href');
      const respondent = await createSurveyParticipant(href);
      try {
        const form = respondent.page;
        await expect(form.getByRole('heading', { name: fixture.title })).toBeVisible();
        await form.getByRole('textbox', { name: titles[0] }).fill(fixture.title);
        await form.getByLabel(titles[1]).fill(fixture.values[1]);
        for (const index of [2,3,4,6]) await form.getByRole('group', { name: titles[index] }).getByRole('radio').nth(3).check();
        await form.getByRole('group', { name: titles[5] }).getByLabel('合适', { exact: true }).check();
        await form.getByRole('textbox', { name: titles[7] }).fill(fixture.answer);
        await form.getByRole('button', { name: '提交答卷' }).click();
        await expect(form.getByRole('status')).toBeVisible();
        if (!receipt().responseId) throw new ProbeFailure('NATIVE_SURVEY_SUBMISSION_NOT_OBSERVED');
      } finally { await respondent.close(); }
    } finally {
      await studio.reload();
      studio.once('dialog', confirmation => confirmation.message() === '停止回收后将不再接受新答卷，继续吗？' ? confirmation.accept() : confirmation.dismiss());
      await stop.click();
      await expect(stop).toHaveCount(0);
    }
    await actions.getByRole('button', { name: '刷新答卷' }).click();
    await saveSource(() => actions.getByRole('combobox', { name: '选择本测试的答卷证据' }).selectOption(receipt().responseId));
    await expect(actions.getByText('已定位答卷 ' + receipt().responseId, { exact: true })).toBeVisible();
  } finally { await studio.close(); }
}
