import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AsrDraftStreamHandlers } from '@/lib/live-asr-draft';
import { SurveyAiProposal } from '@/components/survey/live/ai-proposal';
const { open, request } = vi.hoisted(() => ({ open: vi.fn(), request: vi.fn() }));
vi.mock('@/lib/live-asr-draft', async original => ({ ...await original<typeof import('@/lib/live-asr-draft')>(), openAsrDraftStream: open }));
vi.mock('@/lib/survey/runtime-client', () => ({ surveyRequest: request }));
let handlers: AsrDraftStreamHandlers;
let finish: () => void;
beforeEach(() => {
  open.mockReset(); request.mockReset(); localStorage.clear();
  localStorage.setItem('wsx.sessionToken', 'survey-session');
  vi.stubGlobal('WebSocket', class {}); vi.stubGlobal('AudioContext', class {});
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } });
  open.mockImplementation(async (value: AsrDraftStreamHandlers) => {
    handlers = value;
    return { stop: () => new Promise<void>(resolve => { finish = resolve; }) };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('records inline and appends settled text once while retaining typed text and a file', async () => {
  render(<SurveyAiProposal locked={false} onApply={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: '问卷需求' }), { target: { value: '已有研究目标' } });
  fireEvent.change(screen.getByLabelText('上传问卷文件'), { target: { files: [new File(['文件背景'], 'background.txt')] } });
  await waitFor(() => expect(screen.getByRole('button', { name: '生成问卷' })).toBeEnabled());
  expect(screen.queryByRole('link', { name: '开始录音' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '语音输入' }));
  await screen.findByRole('button', { name: '停止并追加文字' });
  act(() => handlers.onPartial('临时内容'));
  expect(screen.getByRole('textbox', { name: '问卷需求' })).toHaveValue('已有研究目标\n\n临时内容');
  expect(screen.getByRole('button', { name: '生成问卷' })).toBeDisabled();
  act(() => handlers.onFinal('语音目标。'));
  fireEvent.click(screen.getByRole('button', { name: '停止并追加文字' }));
  expect(screen.getByRole('button', { name: '生成问卷' })).toBeDisabled();
  await act(async () => { handlers.onFinished(); finish(); });
  await waitFor(() => expect(screen.getByRole('textbox', { name: '问卷需求' })).toHaveValue('已有研究目标\n\n语音目标。'));
  act(() => handlers.onFinished());
  expect(screen.getByRole('textbox', { name: '问卷需求' })).toHaveValue('已有研究目标\n\n语音目标。');
  fireEvent.click(screen.getByRole('button', { name: '生成问卷' }));
  expect(request.mock.calls[0]?.[1].body).toEqual(expect.objectContaining({ text: '已有研究目标\n\n语音目标。', file: expect.objectContaining({ name: 'background.txt' }) }));
});
it('cancels partial speech without changing the typed input', async () => {
  render(<SurveyAiProposal locked={false} onApply={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: '问卷需求' }), { target: { value: '原文' } });
  fireEvent.click(screen.getByRole('button', { name: '语音输入' }));
  await screen.findByRole('button', { name: '停止并追加文字' });
  act(() => handlers.onPartial('不要提交'));
  fireEvent.click(screen.getByRole('button', { name: '取消语音输入' }));
  await act(async () => { handlers.onFinished(); finish(); });
  expect(screen.getByRole('textbox', { name: '问卷需求' })).toHaveValue('原文');
  expect(request).not.toHaveBeenCalled();
});
it('leaves typed text editable after microphone permission or missing-device errors', async () => {
  const { LiveRecordingError } = await import('@/lib/live-recording');
  for (const detail of [{ kind: 'permission-denied' as const, message: '麦克风权限被拒绝' }, { kind: 'no-microphone' as const, message: '没有找到可用的麦克风设备' }]) {
    open.mockRejectedValueOnce(new LiveRecordingError(detail));
    const view = render(<SurveyAiProposal locked={false} onApply={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '问卷需求' }), { target: { value: '已有文本' } });
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(detail.message));
    expect(screen.getByRole('textbox', { name: '问卷需求' })).toHaveValue('已有文本');
    expect(screen.getByRole('button', { name: '生成问卷' })).toBeEnabled();
    view.unmount();
  }
});
it('keeps interrupted confirmed speech pending until explicit retain or discard', async () => {
  render(<SurveyAiProposal locked={false} onApply={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: '问卷需求' }), { target: { value: '已有文本' } });
  fireEvent.click(screen.getByRole('button', { name: '语音输入' }));
  await screen.findByRole('button', { name: '停止并追加文字' });
  act(() => { handlers.onFinal('确认内容。'); handlers.onError('AUDIO_FORMAT_REJECTED'); });
  expect(screen.getByRole('button', { name: '生成问卷' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '保留已确认转录' }));
  expect(screen.getByRole('textbox', { name: '问卷需求' })).toHaveValue('已有文本\n\n确认内容。');
  await waitFor(() => expect(screen.getByRole('button', { name: '生成问卷' })).toBeEnabled());
});
it('releases its inline stream on leaving the import view without submitting speech', async () => {
  const stop = vi.fn(async () => undefined);
  open.mockImplementationOnce(async (value: AsrDraftStreamHandlers) => { handlers = value; return { stop }; });
  const view = render(<SurveyAiProposal locked={false} onApply={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '语音输入' }));
  await screen.findByRole('button', { name: '停止并追加文字' });
  act(() => handlers.onPartial('尚未确认'));
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
  act(() => handlers.onFinished());
  expect(request).not.toHaveBeenCalled();
});
it('preserves over-limit dictated text and blocks generation until edited back within the contract', async () => {
  render(<SurveyAiProposal locked={false} onApply={vi.fn()} />);
  const input = screen.getByRole('textbox', { name: '问卷需求' });
  const original = '字'.repeat(Number(input.getAttribute('maxlength')) - 1);
  fireEvent.change(input, { target: { value: original } });
  fireEvent.click(screen.getByRole('button', { name: '语音输入' }));
  await screen.findByRole('button', { name: '停止并追加文字' });
  act(() => handlers.onFinal('补充需求。'));
  fireEvent.click(screen.getByRole('button', { name: '停止并追加文字' }));
  await act(async () => { handlers.onFinished(); finish(); });
  expect(input).toHaveValue(original + '\n\n补充需求。');
  expect(screen.getByRole('alert')).toHaveTextContent('超过');
  expect(screen.getByRole('button', { name: '生成问卷' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '生成问卷' }));
  expect(request).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '缩短后的研究需求' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '生成问卷' })).toBeEnabled();
});
it.each([19999, 20000])('allows a valid %i-character demand at the contract boundary', length => {
  request.mockImplementation(() => new Promise(() => {}));
  render(<SurveyAiProposal locked={false} onApply={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: '问卷需求' }), { target: { value: '字'.repeat(length) } });
  expect(screen.getByRole('button', { name: '生成问卷' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '生成问卷' }));
  expect(request.mock.calls[0]?.[1].body.text).toHaveLength(length);
});
it('blocks a 20001-character demand without submitting it', () => {
  render(<SurveyAiProposal locked={false} onApply={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: '问卷需求' }), { target: { value: '字'.repeat(20001) } });
  expect(screen.getByRole('alert')).toHaveTextContent('超过');
  expect(screen.getByRole('button', { name: '生成问卷' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '生成问卷' }));
  expect(request).not.toHaveBeenCalled();
});
