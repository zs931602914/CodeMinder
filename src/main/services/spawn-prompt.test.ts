import { describe, it, expect } from 'vitest';
import { buildInitialPrompt, validateSpawnBody } from './spawn-prompt';

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
