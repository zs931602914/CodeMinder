import { describe, it, expect } from 'vitest';
import { buildInitialPrompt } from './spawn-prompt';

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
