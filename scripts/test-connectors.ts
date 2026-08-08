import assert from "node:assert/strict";
import {
  inspectOfficialConnectorBoundary,
  resolveWithOfficialConnector,
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

const softwareBoundary = inspectOfficialConnectorBoundary("加拿大IT行业最近10年月度失业率");
assert.equal(softwareBoundary?.status, "cannot_answer", "unsupported software-industry unemployment must be blocked explicitly");
assert.match(softwareBoundary?.message ?? "", /不能诚实地用全国总体失业率代替/, "the boundary should explain why the overall rate is invalid");

const incorrectSoftwareFallback = await resolveWithOfficialConnector("加拿大软件行业最近10年月度失业率");
assert.equal(incorrectSoftwareFallback, null, "software-industry qualifiers must never fall back to Canada's overall unemployment vector");

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

const unsupportedYouthRate = await resolveWithOfficialConnector("加拿大青年最近24个月失业率");
assert.equal(unsupportedYouthRate, null, "an age qualifier must not fall back to the all-ages unemployment rate");

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

const population = await resolveWithOfficialConnector("过去五年加拿大和阿尔伯塔省每季度人口变化");
assert.ok(population, "Statistics Canada connector should answer population queries");
assert.equal(population.widget.dataQuality?.frequency, "quarterly");

const usCpi = await resolveWithOfficialConnector("显示美国过去24个月的CPI同比通胀率");
assert.ok(usCpi, "BLS connector should answer U.S. CPI queries");
assert.equal(usCpi.widget.dataQuality?.sourceName, "U.S. Bureau of Labor Statistics");
assert.equal(usCpi.widget.rows.length, 24);

console.log("Polaris live official-connector tests passed (Statistics Canada, Bank of Canada, World Bank, and U.S. BLS).");
