export type MaterialQualifier = "industry" | "occupation" | "demographic" | "category";

export function detectMaterialQualifiers(query: string): MaterialQualifier[] {
  const qualifiers: MaterialQualifier[] = [];
  if (/(?:\bindustry\b|\bsector\b|\bnaics\b|行业|产业|软件公司|information technology|\bit\s*行业|计算机行业|科技行业)/i.test(query)) {
    qualifiers.push("industry");
  }
  if (/(?:\boccupation\b|\bprofession\b|software developers?|programmers?|职业|工种|软件开发者|程序员)/i.test(query)) {
    qualifiers.push("occupation");
  }
  if (/(?:\bgender\b|\bmale\b|\bfemale\b|\bmen\b|\bwomen\b|\byouth\b|\bteen(?:ager)?s?\b|\bage[ds]?\b|\b(?:15|18|20|25|55|65)\s*(?:to|-|–|\+)\s*\d*|性别|男性|女性|青年|年轻人|年龄|\d+\s*岁)/i.test(query)) {
    qualifiers.push("demographic");
  }
  if (/(?:food cpi|shelter cpi|energy cpi|gasoline cpi|rent cpi|食品.*(?:cpi|物价)|住房.*(?:cpi|物价)|能源.*(?:cpi|物价)|汽油.*(?:cpi|物价)|房租.*(?:cpi|物价))/i.test(query)) {
    qualifiers.push("category");
  }
  return qualifiers;
}

export function hasSubnationalGeography(query: string) {
  return /(?:ontario|qu[eé]bec|alberta|british columbia|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|prince edward island|yukon|northwest territories|nunavut|toronto|ottawa|montr[eé]al|vancouver|calgary|edmonton|winnipeg|halifax|安大略|安省|魁北克|魁省|阿尔伯塔|阿省|不列颠哥伦比亚|卑诗|曼尼托巴|萨斯喀彻温|萨省|新斯科舍|新不伦瑞克|纽芬兰|爱德华王子岛|育空|西北地区|努纳武特|多伦多|渥太华|蒙特利尔|温哥华|卡尔加里|埃德蒙顿|温尼伯|哈利法克斯|\bcalifornia\b|\btexas\b|\bflorida\b|\bnew york\b|\bstate of\b|\bprovince of\b)/i.test(query);
}
