import { describe, it, expect } from 'vitest';
import { buildInitialPrompt, validateSpawnBody, deriveTitle, buildClaudeSpawnCommand } from './spawn-prompt';

describe('buildInitialPrompt', () => {
  it('全信息：含 Read、Skill、执行任务', () => {
    const p = buildInitialPrompt({ files: ['a.md', 'b.md'], skills: ['thought-chain'], task: '整理笔记' });
    expect(p).toContain('用 Read 读取');
    expect(p).toContain('a.md');
    expect(p).toContain('b.md');
    expect(p).toContain('用 Skill 激活');
    expect(p).toContain('thought-chain');
    expect(p).toContain('整理笔记');
    expect(p).toMatch(/按顺序/);
  });

  it('files+skills 无 task：含等待指示', () => {
    const p = buildInitialPrompt({ files: ['a.md'], skills: ['x'] });
    expect(p).toContain('用 Read 读取');
    expect(p).toContain('等待我的指示');
    expect(p).not.toContain('执行任务');
  });

  it('仅 task：直接执行并提示自行确定文件', () => {
    const p = buildInitialPrompt({ task: '做测试' });
    expect(p).toContain('请开始执行任务：做测试');
    expect(p).toContain('自行确定');
  });

  it('全空：待命', () => {
    const p = buildInitialPrompt({});
    expect(p).toContain('上下文已就绪');
    expect(p).toContain('等待你的指示');
  });

  it('仅 files：含 Read 与等待指示', () => {
    const p = buildInitialPrompt({ files: ['only.md'] });
    expect(p).toContain('用 Read 读取');
    expect(p).toContain('only.md');
    expect(p).toContain('等待我的指示');
  });
});

describe('validateSpawnBody', () => {
  it('空对象合法', () => {
    const r = validateSpawnBody({});
    expect(r.ok).toBe(true);
    expect(r.normalized).toEqual({});
  });

  it('合法体原样保留', () => {
    const r = validateSpawnBody({ files: ['a'], skills: ['b'], task: 't', cwd: 'C:/x', focus: false, title: 'T' });
    expect(r.ok).toBe(true);
    expect(r.normalized.files).toEqual(['a']);
    expect(r.normalized.focus).toBe(false);
  });

  it('files 非数组 → 失败', () => {
    expect(validateSpawnBody({ files: 'a' }).ok).toBe(false);
  });

  it('files 元素非字符串 → 失败', () => {
    expect(validateSpawnBody({ files: ['a', 1] }).ok).toBe(false);
  });

  it('task 超长 → 失败', () => {
    expect(validateSpawnBody({ task: 'x'.repeat(4001) }).ok).toBe(false);
  });

  it('focus 非布尔 → 失败', () => {
    expect(validateSpawnBody({ focus: 'yes' }).ok).toBe(false);
  });

  it('非对象根 → 失败', () => {
    expect(validateSpawnBody(null).ok).toBe(false);
    expect(validateSpawnBody('s').ok).toBe(false);
  });
});

describe('deriveTitle', () => {
  it('显式 title 优先', () => {
    expect(deriveTitle({ title: '我的标题' }, 3)).toBe('我的标题');
  });
  it('无 title 用 task 前 12 字，超长截断加 …', () => {
    expect(deriveTitle({ task: '一二三四五六七八九十一二三四五' }, 1)).toBe('一二三四五六七八九十一二…');
    expect(deriveTitle({ task: '短任务' }, 1)).toBe('短任务');
  });
  it('无 title/task 用首文件名', () => {
    expect(deriveTitle({ files: ['C:/x/y/notes.md'] }, 1)).toBe('notes.md');
    expect(deriveTitle({ files: ['a\\b\\c.ts'] }, 1)).toBe('c.ts');
  });
  it('全空用 Terminal N', () => {
    expect(deriveTitle({}, 5)).toBe('Terminal 5');
  });
  it('空白 title 回退', () => {
    expect(deriveTitle({ title: '   ', task: '实际任务' }, 1)).toBe('实际任务');
  });
});

describe('buildClaudeSpawnCommand', () => {
  it('含 base64 解码与 claude 调用', () => {
    const cmd = buildClaudeSpawnCommand('你好，读 a.md');
    expect(cmd).toContain('FromBase64String');
    expect(cmd).toContain('claude $p');
    const m = cmd.match(/FromBase64String\('([^']+)'\)/);
    expect(m).not.toBeNull();
    expect(Buffer.from(m![1], 'base64').toString('utf8')).toBe('你好，读 a.md');
  });

  it('引号与特殊字符不破坏命令结构', () => {
    const cmd = buildClaudeSpawnCommand('含"双引号"和$变量');
    expect(cmd.match(/FromBase64String\('[^']*'\)/)).not.toBeNull();
    expect(cmd.endsWith('claude $p')).toBe(true);
  });

  it('含空格与特殊字符的 prompt：base64 往返完整', () => {
    const prompt = '读 a.md 后 *删除* 它；保留 b.md';
    const cmd = buildClaudeSpawnCommand(prompt);
    const m = cmd.match(/FromBase64String\('([^']+)'\)/);
    expect(m).not.toBeNull();
    expect(Buffer.from(m![1], 'base64').toString('utf8')).toBe(prompt);
  });
});
