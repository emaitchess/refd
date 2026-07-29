export type DemoRange = '7d' | '30d' | '90d';

export type DemoSurface =
  | 'ChatGPT'
  | 'Perplexity'
  | 'Gemini'
  | 'Google AI Mode'
  | 'Google AI Overviews';

export interface DemoTrendPoint {
  period: string;
  ultrahuman: number;
  oura: number;
  whoop: number;
  ringconn: number;
  sovUltrahuman: number;
  sovOura: number;
  sovWhoop: number;
  sovRingconn: number;
}

export interface DemoSurfaceRow {
  surface: string;
  fullSurface: DemoSurface;
  ultrahuman: number;
  citation: number;
  oura: number;
  whoop: number;
  ringconn: number;
}

export interface DemoRangeData {
  label: string;
  answerCount: number;
  runCount: number;
  tiles: {
    mention: {
      value: number;
      delta: number;
      spark: number[];
    };
    sov: {
      value: number;
      delta: number;
      spark: number[];
    };
    position: {
      value: number;
      delta: number;
      spark: number[];
    };
    citation: {
      value: number;
      delta: number;
      spark: number[];
    };
  };
  trend: DemoTrendPoint[];
  surfaces: DemoSurfaceRow[];
  prominence: { tier: string; share: number }[];
  sentiment: { stance: string; share: number }[];
  change: {
    title: string;
    body: string;
    detail: string;
  };
}

export interface DemoCitation {
  domain: string;
  url: string;
  note: string;
}

export interface DemoPromptResult {
  id: string;
  prompt: string;
  category: string;
  surface: DemoSurface;
  mentioned: boolean;
  cited: boolean;
  position: number | null;
  sentiment: 'positive' | 'neutral';
  summary: string;
  answer: string;
  citations: DemoCitation[];
}

const trend = (
  periods: string[],
  ultrahuman: number[],
  oura: number[],
  whoop: number[],
  ringconn: number[],
  sovUltrahuman: number[],
  sovOura: number[],
  sovWhoop: number[],
  sovRingconn: number[],
): DemoTrendPoint[] =>
  periods.map((period, index) => ({
    period,
    ultrahuman: ultrahuman[index] ?? 0,
    oura: oura[index] ?? 0,
    whoop: whoop[index] ?? 0,
    ringconn: ringconn[index] ?? 0,
    sovUltrahuman: sovUltrahuman[index] ?? 0,
    sovOura: sovOura[index] ?? 0,
    sovWhoop: sovWhoop[index] ?? 0,
    sovRingconn: sovRingconn[index] ?? 0,
  }));

export const DEMO_RANGE_ORDER: DemoRange[] = ['7d', '30d', '90d'];

export const DEMO_RANGE_DATA: Record<DemoRange, DemoRangeData> = {
  '7d': {
    label: 'Last 7 days',
    answerCount: 700,
    runCount: 7,
    tiles: {
      mention: {
        value: 62.4,
        delta: 4.6,
        spark: [55, 58, 57, 61, 60, 63, 64],
      },
      sov: {
        value: 26.8,
        delta: 2.3,
        spark: [23, 24, 24, 25, 26, 26, 27],
      },
      position: {
        value: 2,
        delta: -0.3,
        spark: [2.5, 2.4, 2.3, 2.2, 2.2, 2.1, 2],
      },
      citation: {
        value: 36.1,
        delta: 3.8,
        spark: [29, 31, 32, 34, 33, 35, 36],
      },
    },
    trend: trend(
      ['22 Jul', '23 Jul', '24 Jul', '25 Jul', '26 Jul', '27 Jul', '28 Jul'],
      [55, 58, 57, 61, 60, 63, 64],
      [79, 78, 80, 77, 78, 76, 77],
      [53, 52, 54, 55, 54, 56, 55],
      [31, 33, 32, 34, 35, 34, 36],
      [23, 24, 24, 25, 26, 26, 27],
      [36, 35, 36, 34, 34, 33, 33],
      [24, 24, 24, 25, 24, 25, 24],
      [13, 14, 13, 14, 15, 16, 16],
    ),
    surfaces: [
      {
        surface: 'GPT',
        fullSurface: 'ChatGPT',
        ultrahuman: 68,
        citation: 39,
        oura: 84,
        whoop: 58,
        ringconn: 34,
      },
      {
        surface: 'PPLX',
        fullSurface: 'Perplexity',
        ultrahuman: 75,
        citation: 61,
        oura: 88,
        whoop: 63,
        ringconn: 41,
      },
      {
        surface: 'GEM',
        fullSurface: 'Gemini',
        ultrahuman: 61,
        citation: 27,
        oura: 78,
        whoop: 56,
        ringconn: 39,
      },
      {
        surface: 'MODE',
        fullSurface: 'Google AI Mode',
        ultrahuman: 56,
        citation: 34,
        oura: 73,
        whoop: 49,
        ringconn: 33,
      },
      {
        surface: 'AIO',
        fullSurface: 'Google AI Overviews',
        ultrahuman: 52,
        citation: 36,
        oura: 66,
        whoop: 45,
        ringconn: 29,
      },
    ],
    prominence: [
      { tier: 'lead', share: 31 },
      { tier: 'body', share: 44 },
      { tier: 'list', share: 25 },
    ],
    sentiment: [
      { stance: 'positive', share: 68 },
      { stance: 'neutral', share: 28 },
      { stance: 'negative', share: 4 },
    ],
    change: {
      title: 'Ultrahuman gained visibility on high-intent comparison prompts',
      body: 'Mention rate rose 4.6 points, led by smart-ring subscription and metabolic-health questions.',
      detail:
        'Compared with the previous 7-day window across 10 shared prompts and five AI surfaces.',
    },
  },
  '30d': {
    label: 'Last 30 days',
    answerCount: 800,
    runCount: 8,
    tiles: {
      mention: {
        value: 58.7,
        delta: 6.8,
        spark: [46, 48, 50, 51, 54, 56, 57, 59],
      },
      sov: {
        value: 25.9,
        delta: 3.4,
        spark: [20, 21, 22, 22, 23, 24, 25, 26],
      },
      position: {
        value: 2.2,
        delta: -0.4,
        spark: [2.9, 2.8, 2.7, 2.6, 2.5, 2.4, 2.3, 2.2],
      },
      citation: {
        value: 33.4,
        delta: 5.1,
        spark: [23, 25, 26, 27, 29, 30, 32, 33],
      },
    },
    trend: trend(
      [
        '01 Jul',
        '05 Jul',
        '09 Jul',
        '13 Jul',
        '17 Jul',
        '21 Jul',
        '25 Jul',
        '28 Jul',
      ],
      [46, 48, 50, 51, 54, 56, 57, 59],
      [82, 81, 80, 80, 79, 78, 78, 77],
      [50, 51, 51, 52, 53, 53, 54, 55],
      [27, 28, 29, 30, 31, 32, 34, 36],
      [20, 21, 22, 22, 23, 24, 25, 26],
      [38, 37, 36, 36, 35, 34, 34, 33],
      [25, 25, 25, 25, 25, 25, 25, 24],
      [11, 12, 12, 13, 14, 15, 16, 17],
    ),
    surfaces: [
      {
        surface: 'GPT',
        fullSurface: 'ChatGPT',
        ultrahuman: 64,
        citation: 38,
        oura: 82,
        whoop: 55,
        ringconn: 32,
      },
      {
        surface: 'PPLX',
        fullSurface: 'Perplexity',
        ultrahuman: 71,
        citation: 56,
        oura: 86,
        whoop: 61,
        ringconn: 39,
      },
      {
        surface: 'GEM',
        fullSurface: 'Gemini',
        ultrahuman: 57,
        citation: 24,
        oura: 76,
        whoop: 52,
        ringconn: 36,
      },
      {
        surface: 'MODE',
        fullSurface: 'Google AI Mode',
        ultrahuman: 51,
        citation: 31,
        oura: 71,
        whoop: 47,
        ringconn: 31,
      },
      {
        surface: 'AIO',
        fullSurface: 'Google AI Overviews',
        ultrahuman: 43,
        citation: 29,
        oura: 64,
        whoop: 41,
        ringconn: 27,
      },
    ],
    prominence: [
      { tier: 'lead', share: 27 },
      { tier: 'body', share: 48 },
      { tier: 'list', share: 25 },
    ],
    sentiment: [
      { stance: 'positive', share: 65 },
      { stance: 'neutral', share: 30 },
      { stance: 'negative', share: 5 },
    ],
    change: {
      title: 'Citation visibility improved faster than mentions',
      body: 'Citation rate rose 5.1 points. Perplexity and ChatGPT increasingly referenced Ultrahuman product pages.',
      detail:
        'Compared with the previous 30-day window across 10 shared prompts and five AI surfaces.',
    },
  },
  '90d': {
    label: 'Last 90 days',
    answerCount: 1200,
    runCount: 12,
    tiles: {
      mention: {
        value: 52.1,
        delta: 9.7,
        spark: [35, 37, 39, 42, 43, 46, 48, 51, 53, 55, 57, 59],
      },
      sov: {
        value: 23.8,
        delta: 5.9,
        spark: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
      },
      position: {
        value: 2.5,
        delta: -0.8,
        spark: [3.7, 3.6, 3.5, 3.4, 3.2, 3.1, 3, 2.9, 2.8, 2.6, 2.5, 2.3],
      },
      citation: {
        value: 29.6,
        delta: 8.2,
        spark: [17, 18, 19, 21, 22, 24, 25, 26, 28, 30, 31, 33],
      },
    },
    trend: trend(
      [
        '08 May',
        '16 May',
        '24 May',
        '01 Jun',
        '09 Jun',
        '17 Jun',
        '25 Jun',
        '03 Jul',
        '11 Jul',
        '19 Jul',
        '25 Jul',
        '28 Jul',
      ],
      [35, 37, 39, 42, 43, 46, 48, 51, 53, 55, 57, 59],
      [85, 85, 84, 84, 83, 82, 82, 81, 80, 79, 78, 77],
      [47, 48, 49, 49, 50, 50, 51, 52, 52, 53, 54, 55],
      [19, 20, 22, 23, 24, 25, 27, 29, 30, 32, 34, 36],
      [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26],
      [43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 34, 33],
      [27, 27, 27, 27, 26, 26, 26, 26, 25, 25, 25, 24],
      [8, 9, 10, 11, 12, 13, 14, 15, 17, 17, 16, 17],
    ),
    surfaces: [
      {
        surface: 'GPT',
        fullSurface: 'ChatGPT',
        ultrahuman: 57,
        citation: 33,
        oura: 81,
        whoop: 52,
        ringconn: 27,
      },
      {
        surface: 'PPLX',
        fullSurface: 'Perplexity',
        ultrahuman: 65,
        citation: 49,
        oura: 85,
        whoop: 59,
        ringconn: 34,
      },
      {
        surface: 'GEM',
        fullSurface: 'Gemini',
        ultrahuman: 51,
        citation: 20,
        oura: 75,
        whoop: 49,
        ringconn: 31,
      },
      {
        surface: 'MODE',
        fullSurface: 'Google AI Mode',
        ultrahuman: 46,
        citation: 26,
        oura: 69,
        whoop: 44,
        ringconn: 27,
      },
      {
        surface: 'AIO',
        fullSurface: 'Google AI Overviews',
        ultrahuman: 37,
        citation: 23,
        oura: 61,
        whoop: 38,
        ringconn: 22,
      },
    ],
    prominence: [
      { tier: 'lead', share: 23 },
      { tier: 'body', share: 50 },
      { tier: 'list', share: 27 },
    ],
    sentiment: [
      { stance: 'positive', share: 62 },
      { stance: 'neutral', share: 32 },
      { stance: 'negative', share: 6 },
    ],
    change: {
      title: 'Ultrahuman moved from occasional mention to consistent contender',
      body: 'Mention rate improved 9.7 points while average first-mention position improved by 0.8.',
      detail:
        'Compared with the previous 90-day window across 10 shared prompts and five AI surfaces.',
    },
  },
};

export const DEMO_SURFACES: DemoSurface[] = [
  'ChatGPT',
  'Perplexity',
  'Gemini',
  'Google AI Mode',
  'Google AI Overviews',
];

export const DEMO_PROMPTS: DemoPromptResult[] = [
  {
    id: 'sleep-ring',
    prompt: 'What is the best smart ring for sleep tracking?',
    category: 'comparison',
    surface: 'ChatGPT',
    mentioned: true,
    cited: true,
    position: 2,
    sentiment: 'positive',
    summary:
      'Ultrahuman is presented as the strongest subscription-free alternative to Oura.',
    answer:
      'For sleep-first smart rings, Oura Ring 4 is usually the safest default because its sleep staging and readiness guidance are mature. Ultrahuman Ring AIR is a strong second choice for buyers who want detailed recovery and circadian insights without a recurring membership. RingConn is the budget-oriented option, while Samsung Galaxy Ring is most compelling inside the Samsung ecosystem.',
    citations: [
      {
        domain: 'ultrahuman.com',
        url: 'https://www.ultrahuman.com/',
        note: 'Product features and membership model',
      },
      {
        domain: 'ouraring.com',
        url: 'https://ouraring.com/',
        note: 'Sleep and readiness feature comparison',
      },
    ],
  },
  {
    id: 'metabolic-health',
    prompt: 'Which wearable is best for metabolic health insights?',
    category: 'discovery',
    surface: 'Perplexity',
    mentioned: true,
    cited: true,
    position: 1,
    sentiment: 'positive',
    summary:
      'Ultrahuman leads because the answer connects Ring AIR recovery signals with the wider metabolic-health product story.',
    answer:
      'Ultrahuman is the clearest fit for people prioritizing metabolic context over workout strain alone. Ring AIR tracks sleep, movement, temperature, and recovery, while the broader Ultrahuman platform is positioned around metabolism and lifestyle timing. WHOOP is stronger for training load and coaching, and Oura remains the most established general wellness ring.',
    citations: [
      {
        domain: 'ultrahuman.com',
        url: 'https://www.ultrahuman.com/',
        note: 'Metabolic health and Ring AIR product information',
      },
      {
        domain: 'whoop.com',
        url: 'https://www.whoop.com/',
        note: 'Training strain and recovery comparison',
      },
    ],
  },
  {
    id: 'no-subscription',
    prompt: 'What are the best smart rings without a subscription?',
    category: 'purchase',
    surface: 'Gemini',
    mentioned: true,
    cited: true,
    position: 1,
    sentiment: 'positive',
    summary:
      'The lack of a mandatory membership gives Ultrahuman a clear category advantage.',
    answer:
      'Ultrahuman Ring AIR and RingConn are the two strongest options if avoiding a monthly fee is the priority. Ultrahuman offers the more polished recovery and lifestyle experience, while RingConn usually competes on price and battery life. Oura has deeper long-term software maturity but requires a membership for the full experience.',
    citations: [
      {
        domain: 'ultrahuman.com',
        url: 'https://www.ultrahuman.com/',
        note: 'Ring AIR product and pricing information',
      },
      {
        domain: 'ringconn.com',
        url: 'https://ringconn.com/',
        note: 'Alternative subscription-free smart ring',
      },
    ],
  },
  {
    id: 'oura-alternatives',
    prompt: 'What are the best Oura Ring alternatives for recovery tracking?',
    category: 'comparison',
    surface: 'Google AI Mode',
    mentioned: true,
    cited: false,
    position: 2,
    sentiment: 'positive',
    summary:
      'Ultrahuman is named early, but the answer cites category publications rather than the brand.',
    answer:
      'WHOOP is the best Oura alternative for athletes who want training strain and coaching. Ultrahuman Ring AIR is the leading ring-shaped alternative for people who prefer no recurring fee and want recovery, movement, and circadian guidance. Garmin is worth considering when GPS sport tracking matters more than ring comfort.',
    citations: [
      {
        domain: 'whoop.com',
        url: 'https://www.whoop.com/',
        note: 'Primary recovery-tracking alternative',
      },
    ],
  },
  {
    id: 'strength-training',
    prompt: 'What is the best fitness tracker for strength training?',
    category: 'purchase',
    surface: 'ChatGPT',
    mentioned: false,
    cited: false,
    position: null,
    sentiment: 'neutral',
    summary:
      'The answer favors wrist-based training tools and does not include Ultrahuman.',
    answer:
      'For strength training, WHOOP is useful for recovery and overall strain, while Garmin devices provide broader workout logging and sport tracking. Apple Watch is the most flexible option when paired with a dedicated lifting app. Smart rings are less useful during barbell work because grip pressure can make them uncomfortable.',
    citations: [
      {
        domain: 'whoop.com',
        url: 'https://www.whoop.com/',
        note: 'Recovery and strain tracking',
      },
      {
        domain: 'garmin.com',
        url: 'https://www.garmin.com/',
        note: 'Strength activity tracking',
      },
    ],
  },
  {
    id: 'ring-vs-band',
    prompt: 'Is a smart ring or fitness band better for sleep tracking?',
    category: 'education',
    surface: 'Google AI Overviews',
    mentioned: true,
    cited: true,
    position: 3,
    sentiment: 'neutral',
    summary:
      'Ultrahuman appears as an example after Oura and WHOOP in a format-led answer.',
    answer:
      'Smart rings are usually more comfortable for sleep and can capture temperature and overnight recovery with less screen distraction. Fitness bands are better for workout displays and real-time training feedback. Oura and Ultrahuman are common ring choices, while WHOOP is a screen-free band focused on strain and recovery.',
    citations: [
      {
        domain: 'ultrahuman.com',
        url: 'https://www.ultrahuman.com/',
        note: 'Smart-ring recovery features',
      },
      {
        domain: 'ouraring.com',
        url: 'https://ouraring.com/',
        note: 'Smart-ring sleep features',
      },
    ],
  },
  {
    id: 'women-smart-ring',
    prompt: 'Which smart ring is best for women?',
    category: 'comparison',
    surface: 'Gemini',
    mentioned: true,
    cited: false,
    position: 3,
    sentiment: 'neutral',
    summary:
      'The answer recognizes Ultrahuman but gives Oura the strongest category association.',
    answer:
      'Oura Ring 4 is the most established all-round option, especially for cycle-related insights. Samsung Galaxy Ring works well for Samsung phone owners. Ultrahuman Ring AIR is a strong subscription-free choice with recovery and circadian coaching, but fit and sizing should be tested before purchase.',
    citations: [
      {
        domain: 'ouraring.com',
        url: 'https://ouraring.com/',
        note: 'Cycle and wellness features',
      },
    ],
  },
  {
    id: 'glucose-insights',
    prompt: 'Which wearables provide continuous glucose insights?',
    category: 'discovery',
    surface: 'Perplexity',
    mentioned: true,
    cited: true,
    position: 2,
    sentiment: 'positive',
    summary:
      'Ultrahuman is connected to metabolic insights, behind dedicated medical CGM platforms.',
    answer:
      'Continuous glucose data comes from a CGM sensor rather than a ring or watch. Platforms such as Dexcom and Abbott provide medical glucose monitoring. Ultrahuman has also offered a consumer metabolic-health experience that combines glucose data with activity and lifestyle context, making it relevant for non-clinical behavior insights where available.',
    citations: [
      {
        domain: 'ultrahuman.com',
        url: 'https://www.ultrahuman.com/',
        note: 'Consumer metabolic-health platform',
      },
      {
        domain: 'dexcom.com',
        url: 'https://www.dexcom.com/',
        note: 'Medical continuous glucose monitoring',
      },
    ],
  },
  {
    id: 'frequent-travel',
    prompt: 'Which wellness wearable is best for frequent travelers?',
    category: 'discovery',
    surface: 'Google AI Mode',
    mentioned: true,
    cited: true,
    position: 2,
    sentiment: 'positive',
    summary:
      'Ultrahuman earns visibility through circadian guidance and a screen-free form factor.',
    answer:
      'Oura is the most established option for tracking sleep disruption across trips, while Ultrahuman Ring AIR is a strong alternative for travelers who want circadian guidance without a monthly membership. Garmin is better for GPS activities, and WHOOP suits athletes who want training strain and recovery coaching on the road.',
    citations: [
      {
        domain: 'ultrahuman.com',
        url: 'https://www.ultrahuman.com/',
        note: 'Circadian and recovery guidance',
      },
      {
        domain: 'garmin.com',
        url: 'https://www.garmin.com/',
        note: 'Travel and outdoor activity features',
      },
    ],
  },
  {
    id: 'battery-life',
    prompt: 'Which smart ring has the best battery life?',
    category: 'purchase',
    surface: 'Google AI Overviews',
    mentioned: false,
    cited: false,
    position: null,
    sentiment: 'neutral',
    summary:
      'RingConn owns this attribute in the sample answer, creating a clear visibility gap for Ultrahuman.',
    answer:
      'RingConn Gen 2 is commonly highlighted for long battery life, with Oura Ring 4 and Samsung Galaxy Ring also offering multi-day use. Actual battery performance varies with sizing, enabled features, charging habits, and battery age.',
    citations: [
      {
        domain: 'ringconn.com',
        url: 'https://ringconn.com/',
        note: 'Battery-life specifications',
      },
      {
        domain: 'samsung.com',
        url: 'https://www.samsung.com/',
        note: 'Galaxy Ring product information',
      },
    ],
  },
];
