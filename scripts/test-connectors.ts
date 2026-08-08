import assert from "node:assert/strict";
import { resolveWithOfficialConnector } from "../lib/data-connectors/index";

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
