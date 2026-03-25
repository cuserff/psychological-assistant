/**
 * 心理测评量表数据源
 *
 * 包含 PHQ-9（抑郁筛查）、GAD-7（焦虑筛查）、SDS（抑郁自评）、SAS（焦虑自评）
 * 所有量表数据均来源于国际通用标准化量表
 */

// ==================== PHQ-9 抑郁症筛查量表 ====================

const PHQ9 = {
  id: 'PHQ-9',
  name: 'PHQ-9 抑郁症筛查量表',
  subtitle: '患者健康问卷-9',
  description: '国际通用的抑郁症筛查工具，评估过去两周的抑郁症状频率。',
  instruction: '在过去的两周里，以下问题困扰您的频率有多少？',
  icon: '😔',
  color: '#409EFF',
  questionCount: 9,
  estimatedTime: '2-3 分钟',
  questions: [
    '做事时提不起劲或没有兴趣',
    '感到心情低落、沮丧或绝望',
    '入睡困难、睡不安稳或睡眠过多',
    '感觉疲倦或没有活力',
    '食欲不振或吃太多',
    '觉得自己很糟糕——或觉得自己很失败，或让自己或家人失望',
    '对事物专注有困难，例如阅读报纸或看电视',
    '动作或说话速度缓慢到别人可以觉察？或正好相反——Loss焦躁或坐立不安，动来动去的情况比平常更多',
    '有不如死掉或用某种方式伤害自己的念头'
  ],
  options: [
    { label: '完全不会', score: 0 },
    { label: '好几天', score: 1 },
    { label: '一半以上的天数', score: 2 },
    { label: '几乎每天', score: 3 }
  ],
  totalScore: 27,
  levels: [
    { min: 0, max: 4, label: '无抑郁', severity: 'normal', color: '#67C23A', suggestion: '您目前的心理状态良好，没有明显的抑郁症状。建议保持良好的生活习惯，继续关注自身情绪变化。' },
    { min: 5, max: 9, label: '轻度抑郁', severity: 'mild', color: '#E6A23C', suggestion: '您可能存在轻度抑郁情绪。建议多与亲友沟通交流，保持规律作息，适当进行体育锻炼。如持续感到困扰，可考虑寻求专业心理咨询。' },
    { min: 10, max: 14, label: '中度抑郁', severity: 'moderate', color: '#F56C6C', suggestion: '您的抑郁症状较为明显，建议尽早寻求专业心理咨询师的帮助，进行心理评估和干预。同时注意保持社交活动和日常生活规律。' },
    { min: 15, max: 19, label: '中重度抑郁', severity: 'moderately-severe', color: '#E6004C', suggestion: '您的抑郁症状比较严重，强烈建议尽快寻求精神科医生或心理治疗师的专业帮助。请不要独自承受，及时向身边的人求助。' },
    { min: 20, max: 27, label: '重度抑郁', severity: 'severe', color: '#C00000', suggestion: '您的抑郁症状非常严重，请立即寻求精神科医生的帮助。如果有自我伤害的想法，请拨打24小时心理援助热线：400-161-9995 或 010-82951332。' }
  ]
}

// ==================== GAD-7 广泛性焦虑障碍量表 ====================

const GAD7 = {
  id: 'GAD-7',
  name: 'GAD-7 焦虑症筛查量表',
  subtitle: '广泛性焦虑障碍量表-7',
  description: '国际通用的焦虑症筛查工具，评估过去两周的焦虑症状频率。',
  instruction: '在过去的两周里，以下问题困扰您的频率有多少？',
  icon: '😰',
  color: '#E6A23C',
  questionCount: 7,
  estimatedTime: '2 分钟',
  questions: [
    '感觉紧张、焦虑或急切',
    '不能够停止或控制担忧',
    '对各种各样的事情担忧过多',
    '很难放松下来',
    '由于不安而无法静坐',
    '变得容易烦恼或急躁',
    '感到似乎将有可怕的事情发生'
  ],
  options: [
    { label: '完全不会', score: 0 },
    { label: '好几天', score: 1 },
    { label: '一半以上的天数', score: 2 },
    { label: '几乎每天', score: 3 }
  ],
  totalScore: 21,
  levels: [
    { min: 0, max: 4, label: '无焦虑', severity: 'normal', color: '#67C23A', suggestion: '您目前没有明显的焦虑症状，心理状态较为平稳。建议继续保持当前的生活节奏，适时关注自身情绪变化。' },
    { min: 5, max: 9, label: '轻度焦虑', severity: 'mild', color: '#E6A23C', suggestion: '您可能存在轻度焦虑。建议尝试深呼吸、冥想等放松方法，保持规律运动和充足睡眠。如焦虑持续，可考虑咨询心理专业人士。' },
    { min: 10, max: 14, label: '中度焦虑', severity: 'moderate', color: '#F56C6C', suggestion: '您的焦虑症状较为明显，建议寻求专业心理咨询。可以学习放松训练、正念冥想等方法缓解焦虑，同时注意减少咖啡因摄入。' },
    { min: 15, max: 21, label: '重度焦虑', severity: 'severe', color: '#C00000', suggestion: '您的焦虑症状非常严重，请尽快寻求精神科医生或心理治疗师的专业帮助。如焦虑严重影响日常生活，建议到医院精神科就诊。' }
  ]
}

// ==================== SDS 抑郁自评量表 ====================

const SDS = {
  id: 'SDS',
  name: 'SDS 抑郁自评量表',
  subtitle: 'Zung氏抑郁自评量表',
  description: '由Zung编制的抑郁自评量表，通过20个项目全面评估抑郁状态。',
  instruction: '请根据您最近一周的实际感觉，选择最符合的选项。',
  icon: '📋',
  color: '#909399',
  questionCount: 20,
  estimatedTime: '5-8 分钟',
  // SDS 中正向计分题为 1-4 分，反向计分题标记 reverse: true
  questions: [
    { text: '我觉得闷闷不乐，情绪低沉', reverse: false },
    { text: '我觉得一天之中早晨最好', reverse: true },
    { text: '我一阵阵哭出来或觉得想哭', reverse: false },
    { text: '我晚上睡眠不好', reverse: false },
    { text: '我吃得跟平常一样多', reverse: true },
    { text: '我与异性密切接触时和以往一样感到愉快', reverse: true },
    { text: '我发觉我的体重在下降', reverse: false },
    { text: '我有便秘的苦恼', reverse: false },
    { text: '我心跳比平常快', reverse: false },
    { text: '我无缘无故地感到疲乏', reverse: false },
    { text: '我的头脑跟平常一样清楚', reverse: true },
    { text: '我觉得经常做的事情并没有困难', reverse: true },
    { text: '我觉得不安而平静不下来', reverse: false },
    { text: '我对将来抱有希望', reverse: true },
    { text: '我比平常容易生气激动', reverse: false },
    { text: '我觉得作出决定是容易的', reverse: true },
    { text: '我觉得自己是个有用的人，有人需要我', reverse: true },
    { text: '我的生活过得很有意思', reverse: true },
    { text: '我认为如果我死了别人会生活得更好', reverse: false },
    { text: '平常感兴趣的事我仍然照样感兴趣', reverse: true }
  ],
  options: [
    { label: '没有或很少时间', score: 1 },
    { label: '少部分时间', score: 2 },
    { label: '相当多时间', score: 3 },
    { label: '绝大部分或全部时间', score: 4 }
  ],
  // SDS 总分为粗分，标准分 = 粗分 × 1.25 取整
  useStandardScore: true,
  totalScore: 80, // 粗分满分
  standardTotalScore: 100, // 标准分满分
  levels: [
    { min: 0, max: 52, label: '正常', severity: 'normal', color: '#67C23A', suggestion: '您的情绪状态在正常范围内，没有明显的抑郁倾向。建议保持积极健康的生活方式。' },
    { min: 53, max: 62, label: '轻度抑郁', severity: 'mild', color: '#E6A23C', suggestion: '您可能存在轻度抑郁情绪。建议增加社交活动，保持规律运动，培养兴趣爱好。如持续两周以上，建议咨询心理专业人士。' },
    { min: 63, max: 72, label: '中度抑郁', severity: 'moderate', color: '#F56C6C', suggestion: '您的抑郁程度较为明显，建议尽早寻求专业心理咨询或治疗。注意保持日常生活规律，不要孤立自己。' },
    { min: 73, max: 100, label: '重度抑郁', severity: 'severe', color: '#C00000', suggestion: '您的抑郁程度非常严重，请立即寻求精神科医生的帮助。如有自我伤害的想法，请立即拨打心理援助热线：400-161-9995。' }
  ]
}

// ==================== SAS 焦虑自评量表 ====================

const SAS = {
  id: 'SAS',
  name: 'SAS 焦虑自评量表',
  subtitle: 'Zung氏焦虑自评量表',
  description: '由Zung编制的焦虑自评量表，通过20个项目全面评估焦虑状态。',
  instruction: '请根据您最近一周的实际感觉，选择最符合的选项。',
  icon: '📝',
  color: '#F56C6C',
  questionCount: 20,
  estimatedTime: '5-8 分钟',
  questions: [
    { text: '我觉得比平常容易紧张和着急', reverse: false },
    { text: '我无缘无故地感到害怕', reverse: false },
    { text: '我容易心里烦乱或觉得惊恐', reverse: false },
    { text: '我觉得我可能将要发疯', reverse: false },
    { text: '我觉得一切都很好，也不会发生什么不幸', reverse: true },
    { text: '我手脚发抖打颤', reverse: false },
    { text: '我因为头痛、头颈痛和背痛而苦恼', reverse: false },
    { text: '我感觉容易衰弱和疲乏', reverse: false },
    { text: '我觉得心平气和，并且容易安静坐着', reverse: true },
    { text: '我觉得心跳得很快', reverse: false },
    { text: '我因为一阵阵头晕而苦恼', reverse: false },
    { text: '我有晕倒发作或觉得要晕倒似的', reverse: false },
    { text: '我吸气呼气都感到很容易', reverse: true },
    { text: '我手脚麻木和刺痛', reverse: false },
    { text: '我因为胃痛和消化不良而苦恼', reverse: false },
    { text: '我常常要小便', reverse: false },
    { text: '我的手常常是干燥温暖的', reverse: true },
    { text: '我脸红发热', reverse: false },
    { text: '我容易入睡并且一夜睡得很好', reverse: true },
    { text: '我做噩梦', reverse: false }
  ],
  options: [
    { label: '没有或很少时间', score: 1 },
    { label: '少部分时间', score: 2 },
    { label: '相当多时间', score: 3 },
    { label: '绝大部分或全部时间', score: 4 }
  ],
  useStandardScore: true,
  totalScore: 80,
  standardTotalScore: 100,
  levels: [
    { min: 0, max: 49, label: '正常', severity: 'normal', color: '#67C23A', suggestion: '您的焦虑水平在正常范围内，心理状态较为平稳。建议保持现有的良好生活习惯。' },
    { min: 50, max: 59, label: '轻度焦虑', severity: 'mild', color: '#E6A23C', suggestion: '您可能存在轻度焦虑。建议尝试放松训练（如深呼吸、渐进性肌肉放松），减少压力源，保持充足的睡眠。' },
    { min: 60, max: 69, label: '中度焦虑', severity: 'moderate', color: '#F56C6C', suggestion: '您的焦虑程度较为明显，建议寻求心理咨询师的帮助，学习焦虑管理技巧。适当运动和社交有助于缓解焦虑。' },
    { min: 70, max: 100, label: '重度焦虑', severity: 'severe', color: '#C00000', suggestion: '您的焦虑程度非常严重，请尽快到医院精神科就诊，可能需要药物和心理治疗的综合干预。' }
  ]
}

// ==================== 导出 ====================

/** 所有量表配置，以 id 为键 */
export const SCALES = {
  'PHQ-9': PHQ9,
  'GAD-7': GAD7,
  'SDS': SDS,
  'SAS': SAS
}

/** 量表列表（用于展示卡片） */
export const SCALE_LIST = [PHQ9, GAD7, SDS, SAS]

/**
 * 计算量表得分
 * @param {string} scaleId 量表 ID
 * @param {number[]} answers 用户作答数组（每题选中的选项索引，从 0 开始）
 * @returns {{ rawScore: number, standardScore: number|null, level: object }}
 */
export function calculateScore(scaleId, answers) {
  const scale = SCALES[scaleId]
  if (!scale) throw new Error(`未知量表: ${scaleId}`)

  let rawScore = 0

  answers.forEach((answerIndex, questionIndex) => {
    const question = scale.questions[questionIndex]
    const isReverse = typeof question === 'object' && question.reverse

    if (isReverse) {
      // 反向计分：选项分数翻转
      // SDS/SAS 选项 1,2,3,4 → 反向后 4,3,2,1
      const maxOptionScore = scale.options[scale.options.length - 1].score
      const minOptionScore = scale.options[0].score
      const originalScore = scale.options[answerIndex].score
      rawScore += (maxOptionScore + minOptionScore) - originalScore
    } else {
      rawScore += scale.options[answerIndex].score
    }
  })

  // 标准分计算（SDS/SAS 专用）
  let standardScore = null
  let scoreForLevel = rawScore

  if (scale.useStandardScore) {
    standardScore = Math.round(rawScore * 1.25)
    scoreForLevel = standardScore
  }

  // 查找对应等级
  const level = scale.levels.find(l => scoreForLevel >= l.min && scoreForLevel <= l.max)
    || scale.levels[scale.levels.length - 1]

  return { rawScore, standardScore, level }
}
