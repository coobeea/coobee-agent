import type { AnalysisTemplate } from '@shared/types/insight';

const now = Date.now();

export const builtinInsightTemplates: AnalysisTemplate[] = [
  {
    id: 'meeting-quick-insight',
    name: '会议速览',
    description: '提炼会议进展、风险和待办，适合先验证最小闭环。',
    icon: 'i-carbon-chart-line-data',
    category: 'meeting',
    analysisPrompt: [
      '请根据输入文本输出一份结构化洞察。',
      '重点关注：当前阶段、关键主题、风险、待办、情绪倾向。',
      '输出必须覆盖模板里的所有维度。'
    ].join('\n'),
    refreshStrategy: {
      trigger: 'manual'
    },
    outputFormat: 'card',
    builtIn: true,
    createdAt: now,
    updatedAt: now,
    dimensions: [
      {
        key: 'stage',
        label: '当前阶段',
        type: 'enum',
        prompt: '判断当前讨论处于开场、澄清、推进、阻塞或收尾哪个阶段。',
        options: ['开场', '澄清', '推进', '阻塞', '收尾'],
        required: true
      },
      {
        key: 'focus',
        label: '当前焦点',
        type: 'text',
        prompt: '用一句话概括当前最值得关注的核心主题。',
        required: true
      },
      {
        key: 'confidence',
        label: '推进信心',
        type: 'score',
        prompt: '给当前推进状态打 0-100 分，并反映在数值里。',
        required: true,
        showTrend: true
      },
      {
        key: 'risks',
        label: '风险点',
        type: 'list',
        prompt: '列出当前暴露的风险或阻塞点。',
        maxItems: 5
      },
      {
        key: 'nextActions',
        label: '下一步动作',
        type: 'list',
        prompt: '列出接下来最关键的 1-5 条动作。',
        maxItems: 5
      },
      {
        key: 'aligned',
        label: '是否已达成共识',
        type: 'boolean',
        prompt: '判断参与方是否已经形成基本一致意见。'
      },
      {
        key: 'keywords',
        label: '关键词',
        type: 'tags',
        prompt: '提取最值得保留的 3-6 个关键词。',
        maxItems: 6
      }
    ]
  }
];
