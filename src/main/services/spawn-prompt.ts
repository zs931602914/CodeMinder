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
  const hasTask = task && task.length > 0;

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
