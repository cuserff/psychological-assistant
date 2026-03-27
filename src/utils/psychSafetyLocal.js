/**
 * 前端兜底：用户发送前对原文做高风险关键词扫描（与后端规则保持同方向，非临床判定）。
 * @param {string} text
 * @returns {{ riskLevel: 'none'|'high', hitRules: string[] }}
 */
export function analyzeLocalPsychRiskText(text) {
  const raw = String(text || '')
  const compact = raw.replace(/\s+/g, '')
  const lower = raw.toLowerCase()
  if (!compact && !lower.trim()) {
    return { riskLevel: 'none', hitRules: [] }
  }

  /** @type {string[]} */
  const hitRules = []

  const selfHarmPatterns = [
    /自杀/, /自殘/, /自残/, /轻生/, /輕生/, /不想活/, /不想活了/, /活不下去/,
    /结束生命/, /了结生命/, /自我了断/, /自我了結/, /一了百了/, /死了算了/,
    /想死/, /去死/, /求死/, /陪我去死/, /割腕/, /跳楼/, /上吊/, /烧炭/, /燒炭/,
    /卧轨/, /服毒/, /吃藥死/, /吃药死/, /结束一切/, /残害自己/, /弄死自己/
  ]
  const harmOthersPatterns = [
    /杀了他/, /殺了他/, /杀了她/, /殺了她/, /弄死他/, /弄死她/, /砍人/, /想杀人/,
    /殺人/, /报复社会/, /報復社會/, /同归于尽/, /同歸於盡/, /打死他/, /打死她/
  ]

  if (selfHarmPatterns.some((re) => re.test(compact))) {
    hitRules.push('self_harm')
  }
  if (harmOthersPatterns.some((re) => re.test(compact))) {
    hitRules.push('harm_others')
  }

  if (/\b(suicid|kill\s*myself|self[\s-]*harm|want\s*to\s*die)\b/i.test(lower)) {
    hitRules.push('self_harm')
  }

  if (hitRules.length === 0) {
    return { riskLevel: 'none', hitRules: [] }
  }
  return { riskLevel: 'high', hitRules: [...new Set(hitRules)] }
}
