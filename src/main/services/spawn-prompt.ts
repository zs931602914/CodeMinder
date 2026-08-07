/**
 * 派生终端的纯逻辑：prompt 构造、参数校验、标题推导、注入命令构造。
 * 不依赖 electron，便于单测。
 */

export interface SpawnContext {
  files?: string[];
  skills?: string[];
  task?: string;
}

export function buildInitialPrompt(ctx: SpawnContext): string {
  const files = ctx.files?.filter(f => f && f.length > 0) ?? [];
  const skills = ctx.skills?.filter(s => s && s.length > 0) ?? [];
  const task = ctx.task?.trim();
  const hasFiles = files.length > 0;
  const hasSkills = skills.length > 0;
  const hasTask = !!task && task.length > 0;

  if (!hasFiles && !hasSkills && !hasTask) {
    return '上下文已就绪，等待你的指示。';
  }

  if (!hasFiles && !hasSkills) {
    return `请开始执行任务：${task}（如需读取文件请自行确定）`;
  }

  const steps: string[] = [];
  if (hasFiles) steps.push(`用 Read 读取：${files.join('、')}`);
  if (hasSkills) steps.push(`用 Skill 激活：${skills.join('、')}`);
  const indexed = steps.map((s, i) => `${i + 1}) ${s}`);

  if (hasTask) {
    indexed.push(`${indexed.length + 1}) 完成后开始执行任务：${task}`);
  } else {
    indexed.push(`${indexed.length + 1}) 完成后简述已就绪的上下文并等待我的指示`);
  }

  return `请按顺序初始化上下文：\n${indexed.join('；\n')}`;
}

export interface SpawnBody extends SpawnContext {
  cwd?: string;
  focus?: boolean;
  title?: string;
  sourceTerminalId?: string;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  normalized: SpawnBody;
}

const MAX_TASK = 4000;
const MAX_ARRAY = 50;
const MAX_STR = 1000;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

export function validateSpawnBody(body: unknown): ValidationResult {
  const fail = (error: string): ValidationResult => ({ ok: false, error, normalized: {} });
  const normalized: SpawnBody = {};

  if (typeof body !== 'object' || body === null) return fail('请求体必须是对象');
  const b = body as Record<string, unknown>;

  if (b.files !== undefined) {
    if (!isStringArray(b.files)) return fail('files 必须是字符串数组');
    if (b.files.length > MAX_ARRAY) return fail(`files 最多 ${MAX_ARRAY} 项`);
    normalized.files = b.files;
  }
  if (b.skills !== undefined) {
    if (!isStringArray(b.skills)) return fail('skills 必须是字符串数组');
    if (b.skills.length > MAX_ARRAY) return fail(`skills 最多 ${MAX_ARRAY} 项`);
    normalized.skills = b.skills;
  }
  if (b.task !== undefined) {
    if (typeof b.task !== 'string') return fail('task 必须是字符串');
    if (b.task.length > MAX_TASK) return fail(`task 过长（≤${MAX_TASK}）`);
    normalized.task = b.task;
  }
  if (b.cwd !== undefined) {
    if (typeof b.cwd !== 'string' || b.cwd.length > MAX_STR) return fail('cwd 非法');
    normalized.cwd = b.cwd;
  }
  if (b.focus !== undefined) {
    if (typeof b.focus !== 'boolean') return fail('focus 必须是布尔值');
    normalized.focus = b.focus;
  }
  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || b.title.length > MAX_STR) return fail('title 非法');
    normalized.title = b.title;
  }
  if (b.sourceTerminalId !== undefined) {
    if (typeof b.sourceTerminalId !== 'string') return fail('sourceTerminalId 非法');
    normalized.sourceTerminalId = b.sourceTerminalId;
  }

  return { ok: true, normalized };
}

export function deriveTitle(body: SpawnBody, fallbackIndex: number): string {
  const title = body.title?.trim();
  if (title) return title;

  const task = body.task?.trim();
  if (task) return task.length > 12 ? task.slice(0, 12) + '…' : task;

  if (body.files && body.files.length > 0) {
    const first = body.files[0];
    return first.split(/[\\/]/).pop() || first;
  }

  return `Terminal ${fallbackIndex}`;
}
