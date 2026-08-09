import type { DataConnector } from "./types";
import { detectMaterialQualifiers } from "./query-capabilities";
import { fetchWithTransientRetry } from "./http";
import {
  isChineseQuery,
  requestedCalculation,
  requestedMonthlyPeriods,
  requestedQuarterlyPeriods,
  toFixedCell,
  wantsUnsupportedDailyFrequency,
} from "./query-utils";

const WDS_URL = "https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods";

const PROVINCES = {
  Canada: "v1",
  "Newfoundland and Labrador": "v2",
  "Prince Edward Island": "v8",
  "Nova Scotia": "v9",
  "New Brunswick": "v10",
  Quebec: "v11",
  Ontario: "v12",
  Manitoba: "v13",
  Saskatchewan: "v14",
  Alberta: "v15",
  "British Columbia": "v3",
} as const;

const CPI_VECTORS = {
  Canada: "v41690973",
  "Newfoundland and Labrador": "v41691244",
  "Prince Edward Island": "v41691379",
  "Nova Scotia": "v41691513",
  "New Brunswick": "v41691648",
  Quebec: "v41691783",
  Ontario: "v41691919",
  Manitoba: "v41692055",
  Saskatchewan: "v41692191",
  Alberta: "v41692327",
  "British Columbia": "v41692462",
  "St. John's, Newfoundland and Labrador": "v41692846",
  "Halifax, Nova Scotia": "v41692858",
  "Saint John, New Brunswick": "v41692864",
  "Québec, Quebec": "v41692870",
  "Montréal, Quebec": "v41692876",
  "Ottawa-Gatineau, Ontario part, Ontario/Quebec": "v41692882",
  "Toronto, Ontario": "v41692888",
  "Thunder Bay, Ontario": "v41692894",
  "Winnipeg, Manitoba": "v41692900",
  "Regina, Saskatchewan": "v41692906",
  "Saskatoon, Saskatchewan": "v41692912",
  "Edmonton, Alberta": "v41692918",
  "Calgary, Alberta": "v41692924",
  "Vancouver, British Columbia": "v41692930",
  "Victoria, British Columbia": "v41692936",
  "Whitehorse, Yukon": "v41692598",
  "Yellowknife, Northwest Territories": "v41692722",
  "Iqaluit, Nunavut": "v41713432",
} as const;

const UNEMPLOYMENT_VECTORS = {
  Canada: "v2062815",
  "Newfoundland and Labrador": "v2063004",
  "Prince Edward Island": "v2063193",
  "Nova Scotia": "v2063382",
  "New Brunswick": "v2063571",
  Quebec: "v2063760",
  Ontario: "v2063949",
  Manitoba: "v2064138",
  Saskatchewan: "v2064327",
  Alberta: "v2064516",
  "British Columbia": "v2064705",
} as const;

const EMPLOYMENT_RATE_VECTORS = {
  Canada: "v2062817",
  "Newfoundland and Labrador": "v2063006",
  "Prince Edward Island": "v2063195",
  "Nova Scotia": "v2063384",
  "New Brunswick": "v2063573",
  Quebec: "v2063762",
  Ontario: "v2063951",
  Manitoba: "v2064140",
  Saskatchewan: "v2064329",
  Alberta: "v2064518",
  "British Columbia": "v2064707",
} as const;

const PARTICIPATION_VECTORS = {
  Canada: "v2062816",
  "Newfoundland and Labrador": "v2063005",
  "Prince Edward Island": "v2063194",
  "Nova Scotia": "v2063383",
  "New Brunswick": "v2063572",
  Quebec: "v2063761",
  Ontario: "v2063950",
  Manitoba: "v2064139",
  Saskatchewan: "v2064328",
  Alberta: "v2064517",
  "British Columbia": "v2064706",
} as const;

const EMPLOYMENT_VECTORS = {
  Canada: "v2062811",
  "Newfoundland and Labrador": "v2063000",
  "Prince Edward Island": "v2063189",
  "Nova Scotia": "v2063378",
  "New Brunswick": "v2063567",
  Quebec: "v2063756",
  Ontario: "v2063945",
  Manitoba: "v2064134",
  Saskatchewan: "v2064323",
  Alberta: "v2064512",
  "British Columbia": "v2064701",
} as const;

const WAGE_VECTORS = {
  Canada: "v2132579",
  "Newfoundland and Labrador": "v2135999",
  "Prince Edward Island": "v2139419",
  "Nova Scotia": "v2142839",
  "New Brunswick": "v2146259",
  Quebec: "v2149679",
  Ontario: "v2153099",
  Manitoba: "v2156519",
  Saskatchewan: "v2159939",
  Alberta: "v2163359",
  "British Columbia": "v2166779",
} as const;

const POPULATION_VECTORS = {
  ...PROVINCES,
  Yukon: "v4",
  "Northwest Territories": "v6",
  Nunavut: "v7",
} as const;

const NHPI_VECTORS = {
  Canada: "v111955442",
  "Atlantic Region": "v111955445",
  "Newfoundland and Labrador": "v111955448",
  "St. John's, Newfoundland and Labrador": "v111955451",
  "Prince Edward Island": "v111955454",
  "Charlottetown, Prince Edward Island": "v111955457",
  "Nova Scotia": "v111955460",
  "Halifax, Nova Scotia": "v111955463",
  "New Brunswick": "v111955466",
  "Saint John, Fredericton, and Moncton, New Brunswick": "v111955469",
  Quebec: "v111955472",
  "Québec, Quebec": "v111955475",
  "Sherbrooke, Quebec": "v111955478",
  "Trois-Rivières, Quebec": "v111955481",
  "Montréal, Quebec": "v111955484",
  "Ottawa-Gatineau, Quebec part, Ontario/Quebec": "v111955487",
  Ontario: "v111955490",
  "Ottawa-Gatineau, Ontario part, Ontario/Quebec": "v111955493",
  "Oshawa, Ontario": "v111955496",
  "Toronto, Ontario": "v111955499",
  "Hamilton, Ontario": "v111955502",
  "St. Catharines-Niagara, Ontario": "v111955505",
  "Kitchener-Cambridge-Waterloo, Ontario": "v111955508",
  "Guelph, Ontario": "v111955511",
  "London, Ontario": "v111955514",
  "Windsor, Ontario": "v111955517",
  "Greater Sudbury, Ontario": "v111955520",
  "Prairie Region": "v111955523",
  Manitoba: "v111955526",
  "Winnipeg, Manitoba": "v111955529",
  Saskatchewan: "v111955532",
  "Regina, Saskatchewan": "v111955535",
  "Saskatoon, Saskatchewan": "v111955538",
  Alberta: "v111955541",
  "Calgary, Alberta": "v111955544",
  "Edmonton, Alberta": "v111955547",
  "British Columbia": "v111955550",
  "Kelowna, British Columbia": "v111955553",
  "Vancouver, British Columbia": "v111955556",
  "Victoria, British Columbia": "v111955559",
} as const;

const RETAIL_VECTORS = {
  Canada: "v1446859483",
  "Newfoundland and Labrador": "v1446859543",
  "Prince Edward Island": "v1446859574",
  "Nova Scotia": "v1446859605",
  "New Brunswick": "v1446859636",
  Quebec: "v1446859667",
  "Montréal, Quebec": "v1446859698",
  Ontario: "v1446859789",
  "Toronto, Ontario": "v1446859820",
  Manitoba: "v1446859881",
  Saskatchewan: "v1446859942",
  Alberta: "v1446859973",
  "British Columbia": "v1446860064",
  "Vancouver, British Columbia": "v1446860095",
  Yukon: "v1446860126",
  "Northwest Territories": "v1446860157",
  Nunavut: "v1446860188",
} as const;

const INDUSTRY_UNEMPLOYMENT_VECTORS = {
  "Accommodation and food services [72]": "v2710271",
  "Agriculture [111-112, 1100, 1151-1152]": "v2710248",
  "Business, building and other support services [55, 56]": "v2710267",
  "Construction [23]": "v2710254",
  "Educational services [61]": "v2710268",
  "Finance and insurance [52]": "v2710264",
  "Health care and social assistance [62]": "v2710269",
  "Information, culture and recreation [51, 71]": "v2710270",
  "Manufacturing [31-33]": "v2710255",
  "Other services (except public administration) [81]": "v2710272",
  "Professional, scientific and technical services [54]": "v2710266",
  "Public administration [91]": "v2710273",
  "Real estate and rental and leasing [53]": "v2710265",
  "Retail trade [44-45]": "v2710261",
  "Transportation and warehousing [48-49]": "v2710262",
  "Utilities [22]": "v2710253",
  "Wholesale trade [41]": "v2710260",
} as const;

type IndustryDefinition = {
  name: keyof typeof INDUSTRY_UNEMPLOYMENT_VECTORS;
  zh: string;
  aliases: RegExp[];
};

const INDUSTRIES: IndustryDefinition[] = [
  { name: "Professional, scientific and technical services [54]", zh: "专业、科学和技术服务业 [54]", aliases: [/professional,? scientific and technical services/i, /professional services industry/i, /naics\s*54/i, /专业.*科学.*技术服务/] },
  { name: "Information, culture and recreation [51, 71]", zh: "信息、文化和娱乐业 [51, 71]", aliases: [/information,? culture and recreation/i, /naics\s*(?:51.*71|51\s*and\s*71)/i, /信息.*文化.*娱乐/] },
  { name: "Finance and insurance [52]", zh: "金融和保险业 [52]", aliases: [/finance and insurance/i, /financial services industry/i, /金融.*保险/] },
  { name: "Real estate and rental and leasing [53]", zh: "房地产、租赁和出租业 [53]", aliases: [/real estate.*(?:rental|leasing)/i, /房地产.*(?:租赁|出租)/] },
  { name: "Manufacturing [31-33]", zh: "制造业 [31-33]", aliases: [/manufacturing industry/i, /\bmanufacturing\b/i, /制造业/] },
  { name: "Construction [23]", zh: "建筑业 [23]", aliases: [/construction industry/i, /\bconstruction\b/i, /建筑业/] },
  { name: "Health care and social assistance [62]", zh: "医疗保健和社会援助业 [62]", aliases: [/health care and social assistance/i, /healthcare industry/i, /医疗保健.*社会援助|医疗行业/] },
  { name: "Educational services [61]", zh: "教育服务业 [61]", aliases: [/educational services/i, /education industry/i, /教育服务业|教育行业/] },
  { name: "Accommodation and food services [72]", zh: "住宿和餐饮服务业 [72]", aliases: [/accommodation and food services/i, /hospitality industry/i, /住宿.*餐饮|酒店餐饮业/] },
  { name: "Retail trade [44-45]", zh: "零售业 [44-45]", aliases: [/retail trade industry/i, /retail industry/i, /零售业|零售行业/] },
  { name: "Wholesale trade [41]", zh: "批发业 [41]", aliases: [/wholesale trade industry/i, /wholesale industry/i, /批发业|批发行业/] },
  { name: "Transportation and warehousing [48-49]", zh: "运输和仓储业 [48-49]", aliases: [/transportation and warehousing/i, /logistics industry/i, /运输.*仓储|物流行业/] },
  { name: "Public administration [91]", zh: "公共行政 [91]", aliases: [/public administration/i, /公共行政/] },
  { name: "Agriculture [111-112, 1100, 1151-1152]", zh: "农业 [111-112]", aliases: [/agriculture industry/i, /agricultural sector/i, /农业/] },
  { name: "Utilities [22]", zh: "公用事业 [22]", aliases: [/utilities industry/i, /utility sector/i, /公用事业/] },
  { name: "Business, building and other support services [55, 56]", zh: "企业、楼宇和其他支持服务业 [55, 56]", aliases: [/business,? building and other support services/i, /企业.*楼宇.*支持服务/] },
  { name: "Other services (except public administration) [81]", zh: "其他服务业（公共行政除外）[81]", aliases: [/other services.*except public administration/i, /其他服务业.*公共行政/] },
];

const GEO_ALIASES: Record<string, string[]> = {
  Canada: ["canada", "canadian", "加拿大", "全国"],
  "Newfoundland and Labrador": ["newfoundland", "labrador", "纽芬兰"],
  "Prince Edward Island": ["prince edward island", "pei", "爱德华王子岛"],
  "Nova Scotia": ["nova scotia", "新斯科舍"],
  "New Brunswick": ["new brunswick", "新不伦瑞克"],
  Quebec: ["quebec", "québec", "quebec province", "province of quebec", "魁北克省", "魁省"],
  Ontario: ["ontario", "安大略", "安省"],
  Manitoba: ["manitoba", "曼尼托巴"],
  Saskatchewan: ["saskatchewan", "萨斯喀彻温", "萨省"],
  Alberta: ["alberta", "阿尔伯塔", "阿省"],
  "British Columbia": ["british columbia", "b.c.", "bc", "不列颠哥伦比亚", "卑诗"],
  Yukon: ["yukon", "育空"],
  "Northwest Territories": ["northwest territories", "西北地区"],
  Nunavut: ["nunavut", "努纳武特"],
  "Atlantic Region": ["atlantic region", "atlantic canada", "大西洋地区"],
  "St. John's, Newfoundland and Labrador": ["st. john's", "st john's", "圣约翰斯"],
  "Charlottetown, Prince Edward Island": ["charlottetown", "夏洛特敦"],
  "Halifax, Nova Scotia": ["halifax", "哈利法克斯"],
  "Saint John, Fredericton, and Moncton, New Brunswick": ["fredericton", "moncton", "弗雷德里克顿", "蒙克顿"],
  "Saint John, New Brunswick": ["saint john", "圣约翰"],
  "Québec, Quebec": ["quebec city", "québec city", "魁北克市"],
  "Montréal, Quebec": ["montreal", "montréal", "蒙特利尔"],
  "Sherbrooke, Quebec": ["sherbrooke", "舍布鲁克"],
  "Trois-Rivières, Quebec": ["trois-rivières", "trois-rivieres", "三河市"],
  "Ottawa-Gatineau, Ontario part, Ontario/Quebec": ["ottawa", "ottawa-gatineau", "渥太华"],
  "Ottawa-Gatineau, Quebec part, Ontario/Quebec": ["gatineau", "加蒂诺"],
  "Toronto, Ontario": ["toronto", "多伦多"],
  "Oshawa, Ontario": ["oshawa", "奥沙瓦"],
  "Hamilton, Ontario": ["hamilton", "汉密尔顿"],
  "St. Catharines-Niagara, Ontario": ["st. catharines", "niagara", "尼亚加拉"],
  "Kitchener-Cambridge-Waterloo, Ontario": ["kitchener", "waterloo", "滑铁卢"],
  "Guelph, Ontario": ["guelph", "圭尔夫"],
  "London, Ontario": ["london ontario", "安省伦敦"],
  "Windsor, Ontario": ["windsor", "温莎"],
  "Greater Sudbury, Ontario": ["sudbury", "萨德伯里"],
  "Thunder Bay, Ontario": ["thunder bay", "桑德贝"],
  "Winnipeg, Manitoba": ["winnipeg", "温尼伯"],
  "Regina, Saskatchewan": ["regina", "里贾纳"],
  "Saskatoon, Saskatchewan": ["saskatoon", "萨斯卡通"],
  "Calgary, Alberta": ["calgary", "卡尔加里"],
  "Edmonton, Alberta": ["edmonton", "埃德蒙顿"],
  "Kelowna, British Columbia": ["kelowna", "基洛纳"],
  "Vancouver, British Columbia": ["vancouver", "温哥华"],
  "Victoria, British Columbia": ["victoria", "维多利亚"],
  "Whitehorse, Yukon": ["whitehorse", "白马市"],
  "Yellowknife, Northwest Territories": ["yellowknife", "黄刀镇"],
  "Iqaluit, Nunavut": ["iqaluit", "伊魁特"],
};

const GEO_ZH: Record<string, string> = {
  Canada: "加拿大",
  Ontario: "安大略省",
  Quebec: "魁北克省",
  Alberta: "阿尔伯塔省",
  "British Columbia": "不列颠哥伦比亚省",
  Manitoba: "曼尼托巴省",
  Saskatchewan: "萨斯喀彻温省",
  "Nova Scotia": "新斯科舍省",
  "New Brunswick": "新不伦瑞克省",
  "Newfoundland and Labrador": "纽芬兰与拉布拉多省",
  "Prince Edward Island": "爱德华王子岛省",
  Yukon: "育空地区",
  "Northwest Territories": "西北地区",
  Nunavut: "努纳武特地区",
  "Toronto, Ontario": "多伦多",
  "Ottawa-Gatineau, Ontario part, Ontario/Quebec": "渥太华—加蒂诺（安省部分）",
  "Ottawa-Gatineau, Quebec part, Ontario/Quebec": "渥太华—加蒂诺（魁省部分）",
  "Montréal, Quebec": "蒙特利尔",
  "Québec, Quebec": "魁北克市",
  "Vancouver, British Columbia": "温哥华",
  "Calgary, Alberta": "卡尔加里",
  "Edmonton, Alberta": "埃德蒙顿",
  "Winnipeg, Manitoba": "温尼伯",
  "Halifax, Nova Scotia": "哈利法克斯",
  "Victoria, British Columbia": "维多利亚",
};

type Frequency = "monthly" | "quarterly";
type Calculation = "level" | "mom" | "yoy";
type VectorMap = Readonly<Record<string, string>>;

type Metric = {
  id: string;
  title: string;
  zh: string;
  aliases: RegExp[];
  vectors: VectorMap;
  tableId: string;
  tableTitle: string;
  frequency: Frequency;
  unit: string;
  decimals: number;
  transform?: (value: number) => number;
  forceLevel?: boolean;
  demographicScope?: {
    en: string;
    zh: string;
  };
};

const METRICS: Metric[] = [
  { id: "nhpi", title: "New Housing Price Index", zh: "新房价格指数", aliases: [/new housing price index/i, /\bnhpi\b/i, /新房价格指数|新屋价格指数|新房价指数/], vectors: NHPI_VECTORS, tableId: "18100205", tableTitle: "New Housing Price Indexes", frequency: "monthly", unit: "index (201612=100)", decimals: 1 },
  { id: "unemployment", title: "Unemployment rate", zh: "失业率", aliases: [/unemployment rate/i, /失业率/], vectors: UNEMPLOYMENT_VECTORS, tableId: "14100287", tableTitle: "Labour force characteristics", frequency: "monthly", unit: "%", decimals: 1, forceLevel: true },
  { id: "employment_rate", title: "Employment rate", zh: "就业率", aliases: [/employment rate/i, /就业率/], vectors: EMPLOYMENT_RATE_VECTORS, tableId: "14100287", tableTitle: "Labour force characteristics", frequency: "monthly", unit: "%", decimals: 1, forceLevel: true },
  { id: "participation", title: "Labour force participation rate", zh: "劳动参与率", aliases: [/participation rate/i, /labour force participation/i, /劳动参与率|劳动力参与率/], vectors: PARTICIPATION_VECTORS, tableId: "14100287", tableTitle: "Labour force characteristics", frequency: "monthly", unit: "%", decimals: 1, forceLevel: true },
  { id: "employment", title: "Employment", zh: "就业人数", aliases: [/\bemployment\b/i, /就业人数|就业人口/], vectors: EMPLOYMENT_VECTORS, tableId: "14100287", tableTitle: "Labour force characteristics", frequency: "monthly", unit: "thousand persons", decimals: 1 },
  { id: "wages", title: "Average hourly wage", zh: "平均时薪", aliases: [/average hourly wage/i, /hourly wage/i, /employee wages?/i, /平均时薪|小时工资|工资水平/], vectors: WAGE_VECTORS, tableId: "14100063", tableTitle: "Employee wages by industry", frequency: "monthly", unit: "CAD/hour", decimals: 2 },
  { id: "cpi", title: "Consumer Price Index", zh: "消费者价格指数", aliases: [/consumer price index/i, /\bcpi\b/i, /inflation/i, /消费者?物价指数|消费价格指数|通胀/], vectors: CPI_VECTORS, tableId: "18100004", tableTitle: "Consumer Price Index, monthly", frequency: "monthly", unit: "index (2002=100)", decimals: 1 },
  { id: "gdp", title: "Real GDP", zh: "实际 GDP", aliases: [/gross domestic product/i, /\bgdp\b/i, /国内生产总值/], vectors: { Canada: "v65201210" }, tableId: "36100434", tableTitle: "GDP by industry, monthly", frequency: "monthly", unit: "CAD millions", decimals: 0 },
  { id: "population", title: "Population estimate", zh: "人口估计", aliases: [/population/i, /人口/], vectors: POPULATION_VECTORS, tableId: "17100009", tableTitle: "Population estimates, quarterly", frequency: "quarterly", unit: "persons", decimals: 0 },
  { id: "retail", title: "Retail sales", zh: "零售销售额", aliases: [/retail sales?/i, /retail trade/i, /零售销售|零售额/], vectors: RETAIL_VECTORS, tableId: "20100056", tableTitle: "Monthly retail trade sales", frequency: "monthly", unit: "CAD millions", decimals: 1, transform: (value) => value / 1_000 },
];

type AgeGroupDefinition = {
  id: string;
  label: string;
  zh: string;
  aliases: RegExp[];
  vectorOffset: number;
};

// Table 14-10-0287-01 publishes the same labour-force measures for each age
// group in stable WDS vectors. Keeping the dimension identity here prevents a
// qualified request from ever falling through to an all-ages aggregate.
const AGE_GROUPS: AgeGroupDefinition[] = [
  { id: "15_24", label: "ages 15 to 24", zh: "15至24岁青年", aliases: [/\byouth\b/i, /young people/i, /ages?\s*15\s*(?:to|-|–)\s*24/i, /15\s*(?:to|-|–|至)\s*24\s*(?:years? old|岁)?/i, /青年|年轻人/], vectorOffset: 27 },
  { id: "15_19", label: "ages 15 to 19", zh: "15至19岁", aliases: [/ages?\s*15\s*(?:to|-|–)\s*19/i, /15\s*(?:to|-|–|至)\s*19\s*(?:years? old|岁)?/i], vectorOffset: 54 },
  { id: "20_24", label: "ages 20 to 24", zh: "20至24岁", aliases: [/ages?\s*20\s*(?:to|-|–)\s*24/i, /20\s*(?:to|-|–|至)\s*24\s*(?:years? old|岁)?/i], vectorOffset: 81 },
  { id: "25_plus", label: "ages 25 and over", zh: "25岁及以上", aliases: [/ages?\s*25\s*(?:and over|\+)/i, /25\s*岁(?:及|以)上/i], vectorOffset: 108 },
  { id: "25_54", label: "ages 25 to 54", zh: "25至54岁", aliases: [/ages?\s*25\s*(?:to|-|–)\s*54/i, /25\s*(?:to|-|–|至)\s*54\s*(?:years? old|岁)?/i], vectorOffset: 135 },
  { id: "55_plus", label: "ages 55 and over", zh: "55岁及以上", aliases: [/ages?\s*55\s*(?:and over|\+)/i, /55\s*岁(?:及|以)上/i, /older workers?/i], vectorOffset: 162 },
];

const AGE_SUPPORTED_METRICS = new Set(["unemployment", "employment_rate", "participation", "employment"]);

function offsetVectorMap(vectors: VectorMap, offset: number): VectorMap {
  return Object.fromEntries(Object.entries(vectors).map(([geography, vector]) => [
    geography,
    `v${Number(vector.replace(/^v/i, "")) + offset}`,
  ]));
}

function selectedAgeGroup(query: string) {
  return AGE_GROUPS.find((group) => group.aliases.some((alias) => alias.test(query))) ?? null;
}

function requestsSpecificGender(query: string) {
  return /(?:\bmale\b|\bfemale\b|\bmen\b|\bwomen\b|男性|女性|男青年|女青年)/i.test(query);
}

function ageAdjustedMetric(query: string): Metric | null {
  const ageGroup = selectedAgeGroup(query);
  if (!ageGroup || requestsSpecificGender(query)) return null;
  const baseMetric = METRICS.find((candidate) =>
    AGE_SUPPORTED_METRICS.has(candidate.id)
    && candidate.aliases.some((alias) => alias.test(query))
  );
  if (!baseMetric) return null;
  return {
    ...baseMetric,
    id: `${baseMetric.id}__age_${ageGroup.id}`,
    title: `${baseMetric.title} · ${ageGroup.label}`,
    zh: `${ageGroup.zh}${baseMetric.zh}`,
    vectors: offsetVectorMap(baseMetric.vectors, ageGroup.vectorOffset),
    demographicScope: {
      en: `Age: ${ageGroup.label.replace(/^ages /, "")} · Gender: total · Seasonally adjusted`,
      zh: `年龄：${ageGroup.zh.replace(/青年$/, "")} · 性别：合计 · 季节调整`,
    },
  };
}

type WdsPoint = { refPer?: string; value?: number | string | null };
type WdsItem = {
  status?: string;
  object?: {
    vectorId?: number;
    vectorDataPoint?: WdsPoint[];
  };
};

function includesAlias(query: string, alias: string) {
  const normalizedQuery = query.toLocaleLowerCase("en-CA");
  const normalizedAlias = alias.toLocaleLowerCase("en-CA");
  if (/^[a-z]{1,3}$/.test(normalizedAlias)) {
    return new RegExp(`(?:^|[^a-z])${normalizedAlias.replace(".", "\\.")}(?:$|[^a-z])`, "i").test(query);
  }
  return normalizedQuery.includes(normalizedAlias);
}

function requestedGeographies(query: string) {
  let selected = Object.keys(GEO_ALIASES).filter((geo) => {
    const aliases = GEO_ALIASES[geo];
    return aliases.some((alias) => includesAlias(query, alias));
  });
  if (/(qu[eé]bec city|魁北克市)/i.test(query) && !/(qu[eé]bec province|province of qu[eé]bec|魁北克省|魁省)/i.test(query)) {
    selected = selected.filter((geo) => geo !== "Quebec");
  }
  return selected;
}

function selectGeographies(query: string, vectors: VectorMap) {
  const requested = requestedGeographies(query);
  if (requested.length) {
    if (requested.some((geo) => !vectors[geo])) return [];
    return requested.slice(0, 5);
  }
  return (vectors.Canada ? ["Canada"] : Object.keys(vectors).slice(0, 1)).slice(0, 5);
}

function periodLabel(date: string, frequency: Frequency) {
  if (frequency === "monthly") return date.slice(0, 7);
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return `${parsed.getUTCFullYear()}-Q${Math.floor(parsed.getUTCMonth() / 3) + 1}`;
}

async function fetchVectors(vectors: string[], latestN: number) {
  const response = await fetchWithTransientRetry(WDS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(vectors.map((vector) => ({
      vectorId: Number(vector.replace(/^v/i, "")),
      latestN,
    }))),
  }, { timeoutMs: 15_000 });
  if (!response.ok) throw new Error(`Statistics Canada WDS returned ${response.status}`);
  const payload = await response.json() as WdsItem[];
  if (!Array.isArray(payload)) throw new Error("Statistics Canada WDS returned an invalid payload");
  return payload;
}

function calculateRows(
  payload: WdsItem[],
  vectors: string[],
  frequency: Frequency,
  periods: number,
  calculation: Calculation,
  transform: (value: number) => number,
) {
  const byVector = new Map<string, Map<string, number | null>>();
  payload.forEach((item) => {
    const id = item.object?.vectorId;
    if (!id) return;
    const observations = new Map<string, number | null>();
    for (const point of item.object?.vectorDataPoint ?? []) {
      if (!point.refPer) continue;
      const raw = Number(point.value);
      observations.set(periodLabel(point.refPer, frequency), Number.isFinite(raw) ? transform(raw) : null);
    }
    byVector.set(String(id), observations);
  });

  const dates = Array.from(new Set(
    Array.from(byVector.values()).flatMap((observations) => Array.from(observations.keys())),
  )).sort();
  const rawRows = dates.map((date) => ({
    date,
    values: vectors.map((vector) => byVector.get(vector.replace(/^v/i, ""))?.get(date) ?? null),
  }));
  const offset = calculation === "yoy" ? (frequency === "monthly" ? 12 : 4) : calculation === "mom" ? 1 : 0;
  return rawRows.slice(offset).map((row, index) => ({
    date: row.date,
    values: row.values.map((current, seriesIndex) => {
      if (calculation === "level") return current;
      const previous = rawRows[index]?.values[seriesIndex] ?? null;
      if (current === null || previous === null || previous === 0) return null;
      return ((current / previous) - 1) * 100;
    }),
  })).slice(-periods);
}

function buildSummary(labels: string[], rows: Array<{ date: string; values: Array<number | null> }>, chinese: boolean) {
  return labels.flatMap((label, index) => {
    const available = rows.flatMap((row) => row.values[index] === null ? [] : [{ date: row.date, value: row.values[index]! }]);
    if (available.length < 2) return [];
    const first = available[0];
    const last = available.at(-1)!;
    const delta = last.value - first.value;
    return chinese
      ? [`${label}从 ${first.date} 的 ${toFixedCell(first.value)} 变为 ${last.date} 的 ${toFixedCell(last.value)}（${delta >= 0 ? "+" : ""}${toFixedCell(delta)}）。`]
      : [`${label} moved from ${toFixedCell(first.value)} in ${first.date} to ${toFixedCell(last.value)} in ${last.date} (${delta >= 0 ? "+" : ""}${toFixedCell(delta)}).`];
  }).join(" ").slice(0, 500);
}

function selectIndustries(query: string) {
  return INDUSTRIES.filter((industry) => industry.aliases.some((alias) => alias.test(query))).slice(0, 5);
}

function hasIndustryQualifier(query: string) {
  return /(?:\bindustry\b|\bsector\b|\bnaics\b|行业|产业|软件公司|information technology|\bit\s*行业|计算机行业|科技行业)/i.test(query);
}

function hasOccupationQualifier(query: string) {
  return /(?:\boccupation\b|\bprofession\b|software developers?|programmers?|职业|工种|软件开发者|程序员)/i.test(query);
}

function isSoftwareIndustryUnemploymentQuery(query: string) {
  const unemployment = /(unemployment|失业)/i.test(query);
  const softwareIndustry = /(?:software (?:industry|sector|publishers?)|information technology (?:industry|sector)|computer (?:industry|sector)|\bit\s*(?:industry|sector|行业)|软件行业|软件产业|软件公司|信息技术行业|计算机行业|科技行业)/i.test(query);
  return unemployment && softwareIndustry && !hasOccupationQualifier(query);
}

async function resolveIndustryUnemployment(query: string, industries: IndustryDefinition[]) {
  const selectedRegions = selectGeographies(query, UNEMPLOYMENT_VECTORS);
  if (!selectedRegions.length || selectedRegions.some((region) => region !== "Canada")) return null;

  const chinese = isChineseQuery(query);
  const requested = requestedMonthlyPeriods(query);
  const vectors = industries.map((industry) => INDUSTRY_UNEMPLOYMENT_VECTORS[industry.name]);
  const payload = await fetchVectors(vectors, requested);
  const rows = calculateRows(payload, vectors, "monthly", requested, "level", (value) => value);
  if (rows.length < 2) return null;

  const labels = industries.map((industry) => chinese ? industry.zh : industry.name);
  const numericCells = rows.flatMap((row) => row.values);
  const availablePoints = numericCells.filter((value) => value !== null).length;
  const missingPoints = numericCells.length - availablePoints;

  return {
    message: chinese
      ? `已读取加拿大统计局按行业发布的月度失业率，校验 ${availablePoints}/${numericCells.length} 个数据点。该序列未经季节调整。`
      : `Validated ${availablePoints}/${numericCells.length} monthly industry-unemployment observations from Statistics Canada. The series is not seasonally adjusted.`,
    widget: {
      title: chinese ? "加拿大行业失业率" : "Canadian industry unemployment rate",
      subtitle: `${rows[0].date} – ${rows.at(-1)!.date} · unadjusted · Statistics Canada 14-10-0022-01`,
      visualization: "line_chart" as const,
      columns: [
        { key: "date", label: chinese ? "月份" : "Month", dataType: "date" as const, unit: null },
        ...labels.map((label, index) => ({ key: `series_${index + 1}`, label, dataType: "number" as const, unit: "%" })),
      ],
      rows: rows.map((row) => ({ cells: [row.date, ...row.values.map((value) => toFixedCell(value, 1))] })),
      summary: `${buildSummary(labels, rows, chinese)} ${chinese ? "行业分类采用 Statistics Canada 公布的 NAICS 宽口径，不等同于具体职业。" : "Industries use Statistics Canada's broad NAICS groups and are not occupations."}`.trim().slice(0, 500),
      sources: [
        { title: "Statistics Canada Table 14-10-0022-01", url: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1410002201" },
        { title: "Statistics Canada Web Data Service", url: "https://www.statcan.gc.ca/en/developers/wds/user-guide" },
      ],
      dataQuality: {
        method: "official_connector" as const,
        sourceName: "Statistics Canada WDS",
        requestedPoints: numericCells.length,
        availablePoints,
        missingPoints,
        coverageStart: rows[0].date,
        coverageEnd: rows.at(-1)!.date,
        frequency: "monthly" as const,
        verifiedAt: new Date().toISOString(),
        scope: (chinese
          ? `地区：加拿大 · 行业：${labels.join("、")} · 未经季节调整`
          : `Geography: Canada · Industry: ${labels.join(", ")} · Not seasonally adjusted`).slice(0, 240),
      },
    },
  };
}

function tradeMetric(query: string): Metric | null {
  if (!/(merchandise trade|imports?|exports?|进出口|进口|出口|贸易额)/i.test(query)) return null;
  const wantsImport = /(imports?|进口)/i.test(query);
  const wantsExport = /(exports?|出口)/i.test(query);
  const vectors: Record<string, string> = {};
  if (wantsImport || (!wantsImport && !wantsExport)) vectors.Imports = "v1566910429";
  if (wantsExport || (!wantsImport && !wantsExport)) vectors.Exports = "v1566911035";
  return {
    id: "trade",
    title: "Canadian merchandise trade",
    zh: "加拿大商品贸易",
    aliases: [],
    vectors,
    tableId: "12100163",
    tableTitle: "Canadian international merchandise trade",
    frequency: "monthly",
    unit: "CAD millions",
    decimals: 1,
  };
}

export const statisticsCanadaConnector: DataConnector = {
  id: "statistics-canada-wds",
  supportsQuery(query) {
    const qualifiers = detectMaterialQualifiers(query);
    if (!qualifiers.length) return true;
    if (qualifiers.every((qualifier) => qualifier === "demographic")) {
      return Boolean(ageAdjustedMetric(query));
    }
    return qualifiers.every((qualifier) => qualifier === "industry")
      && selectIndustries(query).length > 0
      && /(unemployment rate|unemployment|失业率|失业数据)/i.test(query);
  },
  async tryResolve(query) {
    if (wantsUnsupportedDailyFrequency(query)) return null;
    if (/(united states|\bu\.?s\.?a?\b|美国|china|中国|united kingdom|英国|japan|日本|australia|澳大利亚)/i.test(query)) return null;

    const industries = selectIndustries(query);
    if (industries.length && /(unemployment rate|unemployment|失业率|失业数据)/i.test(query)) {
      return resolveIndustryUnemployment(query, industries);
    }

    const metric = ageAdjustedMetric(query)
      ?? METRICS.find((candidate) => candidate.aliases.some((alias) => alias.test(query)))
      ?? tradeMetric(query);
    if (!metric) return null;
    if (industries.length || hasIndustryQualifier(query) || hasOccupationQualifier(query)) return null;

    const chinese = isChineseQuery(query);
    const trade = metric.id === "trade";
    const selectedGeographies = trade ? Object.keys(metric.vectors) : selectGeographies(query, metric.vectors);
    const vectors = selectedGeographies.map((geo) => metric.vectors[geo]);
    if (!vectors.length) return null;

    const requested = metric.frequency === "quarterly"
      ? requestedQuarterlyPeriods(query)
      : requestedMonthlyPeriods(query);
    let calculation: Calculation = metric.forceLevel ? "level" : requestedCalculation(query);
    const rootMetricId = metric.id.split("__")[0];
    if (rootMetricId === "cpi" && calculation === "level" && /(inflation|通胀|涨幅)/i.test(query)) calculation = "yoy";
    const offset = calculation === "yoy" ? (metric.frequency === "monthly" ? 12 : 4) : calculation === "mom" ? 1 : 0;
    const payload = await fetchVectors(vectors, Math.min(requested + offset, 132));
    const rows = calculateRows(payload, vectors, metric.frequency, requested, calculation, metric.transform ?? ((value) => value));
    if (rows.length < 2) return null;

    const labels = selectedGeographies.map((geo) => {
      if (trade) return chinese ? (geo === "Imports" ? "进口" : "出口") : geo;
      return chinese ? (GEO_ZH[geo] ?? geo) : geo;
    });
    const calculationLabel = calculation === "mom" ? (chinese ? "环比" : "MoM")
      : calculation === "yoy" ? (chinese ? "同比" : "YoY")
        : null;
    const numericCells = rows.flatMap((row) => row.values);
    const availablePoints = numericCells.filter((value) => value !== null).length;
    const missingPoints = numericCells.length - availablePoints;
    const sourceUrl = `https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=${metric.tableId}01`;
    const titleMetric = chinese ? metric.zh : metric.title;
    const aggregateIndustry = ["unemployment", "employment_rate", "participation", "employment", "wages", "gdp"].includes(rootMetricId);
    const scope = (chinese
      ? `地区：${trade ? "加拿大" : labels.join("、")}${metric.demographicScope ? ` · ${metric.demographicScope.zh}` : aggregateIndustry ? " · 行业：全部行业" : ""}`
      : `Geography: ${trade ? "Canada" : labels.join(", ")}${metric.demographicScope ? ` · ${metric.demographicScope.en}` : aggregateIndustry ? " · Industry: total, all industries" : ""}`).slice(0, 240);

    return {
      message: chinese
        ? `已通过加拿大统计局 WDS 官方接口校验 ${availablePoints}/${numericCells.length} 个数据点；数据检索阶段未使用模型或网页搜索。`
        : `Validated ${availablePoints}/${numericCells.length} observations through Statistics Canada WDS; data retrieval used no model or Web Search.`,
      widget: {
        title: `${titleMetric}${calculationLabel ? ` · ${calculationLabel}` : ""}`,
        subtitle: `${rows[0].date} – ${rows.at(-1)!.date} · ${metric.tableTitle} (${metric.tableId.slice(0, 2)}-${metric.tableId.slice(2, 4)}-${metric.tableId.slice(4)}-01)`,
        visualization: /(?:\btable\b|表格)/i.test(query) ? "table" : "line_chart",
        columns: [
          { key: "date", label: chinese ? (metric.frequency === "monthly" ? "月份" : "季度") : (metric.frequency === "monthly" ? "Month" : "Quarter"), dataType: "date", unit: null },
          ...labels.map((label, index) => ({
            key: `series_${index + 1}`,
            label,
            dataType: "number" as const,
            unit: calculation === "level" ? metric.unit : "%",
          })),
        ],
        rows: rows.map((row) => ({ cells: [row.date, ...row.values.map((value) => toFixedCell(value, calculation === "level" ? metric.decimals : 2))] })),
        summary: buildSummary(labels, rows, chinese),
        sources: [
          { title: `Statistics Canada Table ${metric.tableId.slice(0, 2)}-${metric.tableId.slice(2, 4)}-${metric.tableId.slice(4)}-01`, url: sourceUrl },
          { title: "Statistics Canada Web Data Service", url: "https://www.statcan.gc.ca/en/developers/wds/user-guide" },
        ],
        dataQuality: {
          method: "official_connector",
          sourceName: "Statistics Canada WDS",
          requestedPoints: numericCells.length,
          availablePoints,
          missingPoints,
          coverageStart: rows[0].date,
          coverageEnd: rows.at(-1)!.date,
          frequency: metric.frequency,
          verifiedAt: new Date().toISOString(),
          scope,
        },
      },
    };
  },
  async tryResolveProxy(query) {
    if (!isSoftwareIndustryUnemploymentQuery(query)) return null;
    const proxyIndustries = INDUSTRIES.filter((industry) =>
      industry.name === "Professional, scientific and technical services [54]"
      || industry.name === "Information, culture and recreation [51, 71]"
    );
    const result = await resolveIndustryUnemployment(query, proxyIndustries);
    if (!result) return null;

    const chinese = isChineseQuery(query);
    return {
      ...result,
      message: chinese
        ? "未找到可核验的加拿大 IT 行业独立月度失业率；已改用加拿大统计局两条最接近的 NAICS 宽口径官方序列作为代理，并明确保留口径差异。"
        : "No verifiable standalone monthly Canadian IT-industry unemployment rate was found. This widget uses two clearly labelled broad NAICS proxy series from Statistics Canada.",
      widget: {
        ...result.widget,
        title: chinese ? "加拿大 IT 行业失业率代理指标" : "Canadian IT-industry unemployment proxies",
        subtitle: `${result.widget.subtitle} · ${chinese ? "代理口径，并非 IT 行业独立序列" : "Proxy scope, not a standalone IT-industry series"}`,
        summary: `${chinese
          ? "代理 1 覆盖专业、科学和技术服务业（含计算机系统设计）；代理 2 覆盖信息、文化和娱乐业（含软件出版，但同时包含大量非 IT 活动）。两条线均不能视为 IT 行业本身的失业率。"
          : "Proxy 1 covers professional, scientific and technical services, including computer systems design. Proxy 2 covers information, culture and recreation, including software publishing but substantial non-IT activity. Neither series is the IT industry's own unemployment rate."} ${result.widget.summary}`.slice(0, 500),
        dataQuality: result.widget.dataQuality
          ? {
              ...result.widget.dataQuality,
              scope: (chinese
                ? "代理口径：NAICS 54 与合并 NAICS 51/71；不等同于加拿大 IT 行业"
                : "Proxy scope: NAICS 54 and combined NAICS 51/71; not the Canadian IT industry").slice(0, 240),
            }
          : undefined,
      },
    };
  },
};
