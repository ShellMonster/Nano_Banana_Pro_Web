export interface TemplateRequirement {
  minRefs: number;
  note: string;
}

export interface TemplateItem {
  id: string;
  title: string;
  channels: string[];
  materials: string[];
  industries: string[];
  ratio: string;
  preview: string;
  image: string;
  prompt?: string;
  tips?: string;
  source?: TemplateSource;
  tags?: string[];
  requirements?: TemplateRequirement;
}

export interface TemplateSource {
  name: string;
  label?: string;
  icon?: string;
  url?: string;
}

export const templateChannels = [
  '全部',
  '电商',
  '微信/公众号',
  '社群发圈',
  '生活',
  '娱乐',
  '小红书',
  '短视频平台',
  '线下印刷',
  '线下电商'
];

export const templateMaterials = [
  '全部',
  '海报',
  'PPT',
  '公众号首图',
  '文章长图',
  '小红书配图',
  '小红书封面',
  '全屏海报',
  '电商竖版海报',
  '商品主图',
  '公众号次图',
  '详情页'
];

export const templateIndustries = [
  '全部',
  '通用',
  '教育培训',
  '金融保险',
  '商品零售',
  '企业行政',
  '美容美妆',
  '食品生鲜',
  '服饰箱包',
  '政务媒体',
  '生活服务'
];

export const templateRatios = ['全部', '1:1', '3:4', '4:5', '9:16', '16:9', '2:3'];

const ratioSizes: Record<string, { width: number; height: number }> = {
  '1:1': { width: 800, height: 800 },
  '3:4': { width: 750, height: 1000 },
  '4:5': { width: 800, height: 1000 },
  '9:16': { width: 720, height: 1280 },
  '16:9': { width: 1280, height: 720 },
  '2:3': { width: 800, height: 1200 }
};

const palette = [
  ['#c3cfe2', '#c3cfe2'],
  ['#f6d365', '#fda085'],
  ['#84fab0', '#8fd3f4'],
  ['#a1c4fd', '#c2e9fb'],
  ['#d4fc79', '#96e6a1'],
  ['#ffecd2', '#fcb69f'],
  ['#fbc2eb', '#a6c1ee'],
  ['#fdfbfb', '#ebedee'],
  ['#cfd9df', '#e2ebf0'],
  ['#d299c2', '#fef9d7'],
  ['#fddb92', '#d1fdff'],
  ['#9890e3', '#b1f4cf']
];

const buildSvg = (label: string, ratio: string, seed: number, scale = 1) => {
  const size = ratioSizes[ratio] || ratioSizes['3:4'];
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  const colors = palette[seed % palette.length];
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <defs>\n    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">\n      <stop offset="0%" stop-color="${colors[0]}" />\n      <stop offset="100%" stop-color="${colors[1]}" />\n    </linearGradient>\n  </defs>\n  <rect width="100%" height="100%" fill="url(#g)" />\n  <circle cx="${Math.round(width * 0.72)}" cy="${Math.round(height * 0.28)}" r="${Math.round(Math.min(width, height) * 0.12)}" fill="rgba(255,255,255,0.55)" />\n  <rect x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.68)}" width="${Math.round(width * 0.76)}" height="${Math.round(height * 0.12)}" rx="${Math.round(width * 0.04)}" fill="rgba(255,255,255,0.55)" />\n  <text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.55)}" font-size="${Math.round(width * 0.07)}" font-family="Arial" font-weight="700" fill="rgba(20,30,45,0.75)">\n    ${label}\n  </text>\n</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const buildTemplate = (seed: number, ratio: string, label: string) => {
  return {
    preview: buildSvg(label, ratio, seed, 0.6),
    image: buildSvg(label, ratio, seed, 1)
  };
};

export const templateItems: TemplateItem[] = [
  {
    id: 'tpl-001',
    title: '社群优惠海报',
    channels: ['社群发圈'],
    materials: ['海报'],
    industries: ['商品零售'],
    ratio: '3:4',
    ...buildTemplate(0, '3:4', 'TEMPLATE 01'),
    prompt: '暖色背景的限时优惠海报，突出折扣数字与活动时间。',
    tips: '适合社群活动通知，建议后期替换折扣数字与时间信息。',
    source: { name: '@banana-contrib', label: 'GitHub', icon: 'github', url: 'https://example.com/templates/tpl-001' },
    tags: ['优惠', '折扣', '营销']
  },
  {
    id: 'tpl-002',
    title: '公众号首图·课程推荐',
    channels: ['微信/公众号'],
    materials: ['公众号首图'],
    industries: ['教育培训'],
    ratio: '3:4',
    ...buildTemplate(1, '3:4', 'TEMPLATE 02'),
    prompt: '清爽教育风格，突出课程标题与讲师信息。',
    tips: '建议保留留白区域，后期替换课程标题与讲师信息。',
    source: { name: '@teach-annie', label: '公众号', icon: 'wechat', url: 'https://example.com/templates/tpl-002' },
    tags: ['课程', '教育', '知识']
  },
  {
    id: 'tpl-003',
    title: '小红书封面·美妆',
    channels: ['小红书'],
    materials: ['小红书封面'],
    industries: ['美容美妆'],
    ratio: '3:4',
    ...buildTemplate(2, '3:4', 'TEMPLATE 03'),
    prompt: '干净的美妆分享封面，留出标题与卖点位置。',
    tips: '适合美妆种草封面，突出产品名与核心卖点即可。',
    source: { name: '@美妆小薯', label: '小红书', icon: 'xhs', url: 'https://example.com/templates/tpl-003' },
    tags: ['美妆', '封面', '种草']
  },
  {
    id: 'tpl-004',
    title: '电商主图·服饰',
    channels: ['电商'],
    materials: ['商品主图'],
    industries: ['服饰箱包'],
    ratio: '1:1',
    ...buildTemplate(3, '1:1', 'TEMPLATE 04'),
    prompt: '简洁电商主图，突出产品质感与主卖点。',
    tips: '电商主图建议搭配产品实拍或风格参考图。',
    source: { name: '@shop-studio', label: '电商素材', icon: 'shop', url: 'https://example.com/templates/tpl-004' },
    tags: ['电商', '主图', '服饰']
  },
  {
    id: 'tpl-005',
    title: '详情页·卖点排版',
    channels: ['电商'],
    materials: ['详情页'],
    industries: ['商品零售'],
    ratio: '2:3',
    ...buildTemplate(4, '2:3', 'TEMPLATE 05'),
    prompt: '分区展示卖点的长图模板，适合电商详情页。',
    tips: '详情页长图适合分区排版，文案可后期叠加。',
    source: { name: '@detail-lab', label: '电商素材', icon: 'shop', url: 'https://example.com/templates/tpl-005' },
    tags: ['详情页', '排版', '卖点']
  },
  {
    id: 'tpl-006',
    title: '城市生活海报',
    channels: ['生活'],
    materials: ['海报'],
    industries: ['生活服务'],
    ratio: '9:16',
    ...buildTemplate(5, '9:16', 'TEMPLATE 06'),
    prompt: '轻松明亮的生活服务海报，突出活动主题。',
    tips: '生活服务活动海报，适合叠加门店信息与二维码。',
    source: { name: '@life-plan', label: '生活服务', icon: 'local', url: 'https://example.com/templates/tpl-006' },
    tags: ['生活', '海报']
  },
  {
    id: 'tpl-007',
    title: '短视频平台封面',
    channels: ['短视频平台'],
    materials: ['全屏海报'],
    industries: ['通用'],
    ratio: '9:16',
    ...buildTemplate(6, '9:16', 'TEMPLATE 07'),
    prompt: '短视频封面结构，强调标题与强对比视觉。',
    tips: '短视频封面建议标题简短，保持中心视觉突出。',
    source: { name: '@video-maker', label: '短视频', icon: 'video', url: 'https://example.com/templates/tpl-007' },
    tags: ['短视频', '封面']
  },
  {
    id: 'tpl-008',
    title: '线下印刷通用海报',
    channels: ['线下印刷'],
    materials: ['海报'],
    industries: ['通用'],
    ratio: '2:3',
    ...buildTemplate(7, '2:3', 'TEMPLATE 08'),
    prompt: '适合线下印刷的高对比海报结构。',
    tips: '线下印刷需注意留白与安全边距，文字后期添加。',
    source: { name: '@print-studio', label: '印刷素材', icon: 'print', url: 'https://example.com/templates/tpl-008' },
    tags: ['线下', '印刷']
  },
  {
    id: 'tpl-009',
    title: '公众号次图·政务',
    channels: ['微信/公众号'],
    materials: ['公众号次图'],
    industries: ['政务媒体'],
    ratio: '4:5',
    ...buildTemplate(8, '4:5', 'TEMPLATE 09'),
    prompt: '政务媒体风格的次图模板，突出标题信息。',
    tips: '政务次图保持简洁稳重风格，标题居中更清晰。',
    source: { name: '@gov-media', label: '政务媒体', icon: 'gov', url: 'https://example.com/templates/tpl-009' },
    tags: ['政务', '公众号']
  },
  {
    id: 'tpl-010',
    title: '表情包模板',
    channels: ['娱乐'],
    materials: ['海报'],
    industries: ['通用'],
    ratio: '1:1',
    ...buildTemplate(9, '1:1', 'TEMPLATE 10'),
    prompt: '适合作为表情包背景的简洁构图。',
    tips: '表情包模板，请再上传角色参考图进行融合。',
    source: { name: '@meme-corner', label: '表情素材', icon: 'meme', url: 'https://example.com/templates/tpl-010' },
    tags: ['表情包', '娱乐'],
    requirements: {
      minRefs: 2,
      note: '还需要一张角色照片作为第二参考图'
    }
  },
  {
    id: 'tpl-011',
    title: '文章长图·金融资讯',
    channels: ['微信/公众号'],
    materials: ['文章长图'],
    industries: ['金融保险'],
    ratio: '2:3',
    ...buildTemplate(10, '2:3', 'TEMPLATE 11'),
    prompt: '金融资讯长图模板，突出栏目与数据区域。',
    tips: '金融资讯长图可按模块展示数据，标题可后期替换。',
    source: { name: '@fin-news', label: '金融素材', icon: 'finance', url: 'https://example.com/templates/tpl-011' },
    tags: ['金融', '长图']
  },
  {
    id: 'tpl-012',
    title: '小红书配图·美食',
    channels: ['小红书'],
    materials: ['小红书配图'],
    industries: ['食品生鲜'],
    ratio: '4:5',
    ...buildTemplate(11, '4:5', 'TEMPLATE 12'),
    prompt: '美食笔记配图，留出标题与卖点标签位置。',
    tips: '小红书配图建议搭配标题贴纸或手写体文案。',
    source: { name: '@foodie-note', label: '美食素材', icon: 'food', url: 'https://example.com/templates/tpl-012' },
    tags: ['美食', '配图']
  }
];
