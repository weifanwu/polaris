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

console.log("Polaris live official-connector tests passed (World Bank and Bank of Canada).");
