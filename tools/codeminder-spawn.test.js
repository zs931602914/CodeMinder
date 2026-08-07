import { describe, it, expect } from 'vitest';
import { parseArgs, buildPayload } from './codeminder-spawn';

describe('parseArgs', () => {
  it('解析 files/skills/task，默认 focus=true', () => {
    const o = parseArgs(['--files', 'a.md,b.md', '--skills', 'x', '--task', '做测试']);
    expect(o.files).toEqual(['a.md', 'b.md']);
    expect(o.skills).toEqual(['x']);
    expect(o.task).toBe('做测试');
    expect(o.focus).toBe(true);
  });

  it('--no-focus 置 focus=false', () => {
    expect(parseArgs(['--no-focus']).focus).toBe(false);
  });

  it('--cwd 覆盖默认 cwd', () => {
    const o = parseArgs(['--cwd', 'D:/proj']);
    expect(o.cwd).toBe('D:/proj');
  });

  it('--title 解析', () => {
    expect(parseArgs(['--title', '标题']).title).toBe('标题');
  });

  it('空 argv 仍有默认 cwd/focus', () => {
    const o = parseArgs([]);
    expect(o.focus).toBe(true);
    expect(typeof o.cwd).toBe('string');
  });
});

describe('buildPayload', () => {
  it('省略空数组/空字段', () => {
    const p = buildPayload({ files: [], skills: [], cwd: 'C:/x', focus: true });
    expect(p).toEqual({ cwd: 'C:/x', focus: true });
    expect(p.files).toBeUndefined();
  });
  it('保留非空字段', () => {
    const p = buildPayload({ files: ['a'], skills: ['b'], task: 't', cwd: 'C:/x', focus: false, title: 'T' });
    expect(p).toEqual({ files: ['a'], skills: ['b'], task: 't', cwd: 'C:/x', focus: false, title: 'T' });
  });
});
