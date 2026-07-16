export function extractEducationGrade(text: string): string | undefined {
  const educationStage = text.match(/职业教育|成人教育|幼儿园|学前班|研究生|中职|中专|高职|本科|大学|博士|硕士|高中|初中|小学/u)?.[0];
  if (educationStage) return educationStage;

  const explicitGrade = text.match(/(?:\d{1,3}|[零〇一二三四五六七八九十百两]{1,4})年级/u)?.[0];
  if (explicitGrade) return explicitGrade;

  return text.match(/(?:初|高|大)[零〇一二三四五六七八九十\d]{1,3}/u)?.[0];
}

export function extractEducationSubject(text: string): string | undefined {
  const commonSubject = text.match(/道德与法治|信息技术|综合实践|劳动教育|语文|数学|英语|物理|化学|生物|地理|历史|政治|科学|计算机|编程|体育|音乐|美术/u)?.[0];
  if (commonSubject) return commonSubject;

  const grade = extractEducationGrade(text);
  if (!grade) return undefined;
  const afterGrade = text.slice(text.indexOf(grade) + grade.length).trimStart();
  return afterGrade.match(/^([\p{Script=Han}A-Za-z·]{1,12})(?=\s*[《“"])/u)?.[1];
}

export function extractEducationTopic(text: string): string | undefined {
  const quoted = text.match(/[《“"]([^》”"]{1,80})[》”"]/u)?.[1]?.trim();
  if (quoted) return quoted;

  const labeled = text.match(/(?:课题|主题)\s*[:：]?\s*([^，,。；;！!\n]{1,80})/u)?.[1]?.trim();
  return labeled || undefined;
}
