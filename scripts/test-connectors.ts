import assert from "node:assert/strict";
import {
  resolveOfficialConnector,
  resolveWithOfficialConnector,
  resolveWithOfficialRecoveryAlternative,
  resolveWithOfficialProxy,
} from "../lib/data-connectors/index";

const gold = await resolveWithOfficialConnector("过去两年的金价，按月画折线图");
assert.ok(gold, "World Bank commodity connector should answer gold queries");
assert.equal(gold.widget.rows.length, 24, "two years of monthly gold data should contain 24 rows");
assert.equal(gold.widget.dataQuality?.method, "official_connector");
assert.equal(gold.widget.dataQuality?.missingPoints, 0, "latest gold series should be complete");

const policyRate = await resolveWithOfficialConnector("加拿大过去12个月的政策利率");
assert.ok(policyRate, "Bank of Canada connector should answer policy-rate queries");
assert.equal(policyRate.widget.dataQuality?.method, "official_connector");
assert.ok(policyRate.widget.rows.length >= 10, "monthly policy rate series should have useful coverage");

const unemployment = await resolveWithOfficialConnector("比较过去两年加拿大和安大略省每月失业率");
assert.ok(unemployment, "Statistics Canada connector should answer unemployment queries");
assert.equal(unemployment.widget.dataQuality?.sourceName, "Statistics Canada WDS");
assert.equal(unemployment.widget.columns.length, 3, "Canada/Ontario comparison should contain two series");
assert.equal(unemployment.widget.rows.length, 24);

const incorrectSoftwareFallback = await resolveWithOfficialConnector("加拿大软件行业最近10年月度失业率");
assert.equal(incorrectSoftwareFallback, null, "software-industry qualifiers must never fall back to Canada's overall unemployment vector");

const softwareProxy = await resolveWithOfficialProxy("加拿大IT行业最近10年月度失业率");
assert.ok(softwareProxy, "a researched software-industry gap should have an explicit official proxy fallback");
assert.equal(softwareProxy.widget.rows.length, 120);
assert.equal(softwareProxy.widget.columns.length, 3, "the proxy should show both relevant broad NAICS series");
assert.match(softwareProxy.widget.title, /代理指标/);
assert.match(softwareProxy.widget.dataQuality?.scope ?? "", /不等同于加拿大 IT 行业/);

const industryUnemployment = await resolveWithOfficialConnector("加拿大专业、科学和技术服务业最近10年月度失业率");
assert.ok(industryUnemployment, "Statistics Canada should answer supported broad-industry unemployment queries");
assert.equal(industryUnemployment.widget.rows.length, 120);
assert.match(industryUnemployment.widget.columns[1].label, /专业、科学和技术服务业/);
assert.match(industryUnemployment.widget.subtitle, /14-10-0022-01/);

const unsupportedIndustryWage = await resolveWithOfficialConnector("加拿大IT行业最近10年平均时薪");
assert.equal(unsupportedIndustryWage, null, "an industry qualifier must not be discarded by the general wage connector");

const unsupportedRegionalGdp = await resolveWithOfficialConnector("比较加拿大和安大略省最近24个月GDP");
assert.equal(unsupportedRegionalGdp, null, "an unsupported subnational geography must not fall back to Canada-only GDP");

const unsupportedRegionalMortgage = await resolveWithOfficialConnector("安大略省最近12个月五年期房贷利率");
assert.equal(unsupportedRegionalMortgage, null, "a national Bank of Canada series must not be labelled as an Ontario series");

const youthRate = await resolveWithOfficialConnector("加拿大青年失业率数据表格 过去10年月度");
assert.ok(youthRate, "Statistics Canada should answer an exact youth unemployment request without Web Search");
assert.equal(youthRate.widget.rows.length, 120, "ten years of monthly youth unemployment should contain 120 rows");
assert.equal(youthRate.widget.visualization, "table", "an explicit table request should preserve the requested presentation");
assert.match(youthRate.widget.title, /青年|15至24岁/);
assert.match(youthRate.widget.dataQuality?.scope ?? "", /年龄：15至24岁/);
assert.match(youthRate.widget.dataQuality?.scope ?? "", /性别：合计/);
assert.equal(youthRate.widget.dataQuality?.missingPoints, 0, "the official youth series should expose complete trailing coverage");

const youthWomenRate = await resolveWithOfficialConnector("加拿大15至24岁女性最近24个月失业率");
assert.equal(youthWomenRate, null, "a total-gender youth vector must not be relabelled as a women-only series");

const coreAgeRate = await resolveWithOfficialConnector("加拿大25至54岁最近24个月失业率");
assert.ok(coreAgeRate, "the age-dimension catalog should support another official labour-force age group");
assert.match(coreAgeRate.widget.dataQuality?.scope ?? "", /25至54岁/);

const unsupportedFoodCpi = await resolveWithOfficialConnector("加拿大最近24个月食品CPI");
assert.equal(unsupportedFoodCpi, null, "a CPI category qualifier must not fall back to all-items CPI");

const housing = await resolveWithOfficialConnector("过去两年多伦多和渥太华新房价格指数每月环比");
assert.ok(housing, "Statistics Canada connector should answer new-housing price queries");
assert.equal(housing.widget.columns.length, 3, "Toronto/Ottawa comparison should contain two series");
assert.equal(housing.widget.rows.length, 24);

const wages = await resolveWithOfficialConnector("比较最近12个月加拿大、安大略省和BC省的平均时薪");
assert.ok(wages, "Statistics Canada connector should answer wage queries");
assert.equal(wages.widget.columns.length, 4, "wage query should contain three regional series");

const globalGdp = await resolveWithOfficialConnector("比较过去10年加拿大、美国和中国的GDP");
assert.ok(globalGdp, "World Bank Indicators connector should answer cross-country GDP queries");
assert.equal(globalGdp.widget.dataQuality?.sourceName, "World Bank Indicators API");
assert.equal(globalGdp.widget.columns.length, 4, "GDP query should contain three country series");

const migrationRecovery = await resolveWithOfficialRecoveryAlternative("加拿大和美国过去10年月度净移民数量对比 line chart");
assert.ok(migrationRecovery, "incompatible monthly net migration should prepare a standardized annual alternative");
assert.equal(migrationRecovery.result.widget.dataQuality?.frequency, "annual");
assert.equal(migrationRecovery.result.widget.dataQuality?.sourceName, "World Bank Indicators downloadable CSV");
assert.equal(migrationRecovery.result.widget.columns.length, 3, "migration recovery should compare Canada and the United States");
assert.ok(migrationRecovery.result.widget.rows.length >= 10, "migration recovery should retain a useful 10-year annual window");

const population = await resolveWithOfficialConnector("过去五年加拿大和阿尔伯塔省每季度人口变化");
assert.ok(population, "Statistics Canada connector should answer population queries");
assert.equal(population.widget.dataQuality?.frequency, "quarterly");

const permanentResidents = await resolveWithOfficialConnector("加拿大新增永久居民过去20年按月趋势");
assert.ok(permanentResidents, "IRCC connector should parse the official monthly permanent-resident workbook");
assert.ok(permanentResidents.widget.rows.length >= 130, "IRCC connector should return the full published monthly coverage rather than fail on XLSX");
assert.equal(permanentResidents.widget.dataQuality?.requestedPoints, 240, "20-year monthly intent should remain visible in quality metadata");
assert.ok((permanentResidents.widget.dataQuality?.missingPoints ?? 0) > 0, "months predating IRCC's monthly file should be disclosed, not invented");
assert.equal(permanentResidents.widget.dataQuality?.sourceName, "IRCC Monthly Permanent Residents");

const nationalAverageHomePrice = await resolveWithOfficialConnector("加拿大过去20年平均房价");
assert.ok(nationalAverageHomePrice, "CREA connector should parse the official monthly national average-price workbook");
assert.equal(nationalAverageHomePrice.widget.rows.length, 240, "twenty years of monthly national average prices should contain 240 rows");
assert.equal(nationalAverageHomePrice.widget.dataQuality?.requestedPoints, 240);
assert.equal(nationalAverageHomePrice.widget.dataQuality?.availablePoints, 240);
assert.equal(nationalAverageHomePrice.widget.dataQuality?.missingPoints, 0);
assert.equal(nationalAverageHomePrice.widget.dataQuality?.sourceName, "Canadian Real Estate Association");
assert.match(nationalAverageHomePrice.widget.dataQuality?.scope ?? "", /未经季节调整/);

const unsupportedTorontoAveragePrice = await resolveWithOfficialConnector("多伦多过去20年月度平均房价");
assert.equal(unsupportedTorontoAveragePrice, null, "the national CREA connector must not relabel national prices as Toronto prices");

const usCpiResolution = await resolveOfficialConnector("显示美国过去24个月的CPI同比通胀率");
assert.notEqual(usCpiResolution.status, "unsupported", "BLS CPI queries must remain owned by the exact connector even during an upstream outage");
if (usCpiResolution.status === "success") {
  assert.equal(usCpiResolution.result.widget.dataQuality?.sourceName, "U.S. Bureau of Labor Statistics");
  assert.equal(usCpiResolution.result.widget.rows.length, 24);
} else if (usCpiResolution.status === "unavailable") {
  assert.equal(usCpiResolution.sourceName, "U.S. Bureau of Labor Statistics", "BLS outages should return typed source identity without a misleading fallback");
} else {
  assert.fail("BLS CPI queries must not be classified as unsupported");
}

console.log("Polaris live official-connector tests passed (Statistics Canada, IRCC, CREA, Bank of Canada, World Bank, and U.S. BLS).");
