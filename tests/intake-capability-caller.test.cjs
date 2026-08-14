const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const page = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("parent intake caller clears fragment capabilities before analytics loads", () => {
  assert.match(page, /<meta name="referrer" content="no-referrer"\/>/);
  assert.ok(page.indexOf("window.__KZ_INTAKE_CAPS") < page.indexOf("googletagmanager.com"));
  assert.match(page, /history\.replaceState\(null,"",location\.pathname\+location\.search\)/);
  assert.doesNotMatch(page, /<script async src="https:\/\/www\.googletagmanager\.com/);
  assert.match(page, /if\(!window\.__KZ_INTAKE_REQUESTED\).*googletagmanager\.com/);
  assert.match(page, /delete window\.__KZ_INTAKE_CAPS/);
  assert.match(page, /sessionStorage\.setItem\(key,JSON\.stringify\(c\)\)/);
  assert.match(page, /sessionStorage\.getItem\(key\)/);
  assert.match(page, /window\.__KZ_CLEAR_INTAKE_CAPS/);
  assert.match(page, /else\{\s*sessionStorage\.removeItem\(key\)/);
  assert.match(page, /604800000/);
  assert.match(page, /value\.exp>now/);
  assert.match(page, /keys="aud\\nexp\\niat\\niss\\njti\\npar\\npur\\nsid\\nsub\\nv"/);
  assert.match(page, /\[-_A-Za-z0-9\]\{43\}/);
  assert.match(page, /INTAKE\.valid/);
  assert.match(page, /claims\(efCap,"ef-child-report"\).*claims\(statusCap,"intake-status"\)/s);
  assert.match(page, /INTAKE_INVALID = INTAKE_REQUESTED && !INTAKE_MODE/);
  assert.match(page, /This intake task link is no longer valid/);
  assert.match(page, /var INTAKE_MODE = INTAKE_REQUESTED/);
  assert.match(page, /test\(INTAKE\.efCap\).*test\(INTAKE\.statusCap\)/);
});

test("parent report and status calls use capability-bound POST bodies", () => {
  assert.match(page, /capability:INTAKE\.efCap/);
  assert.match(page, /intakeReportState\.serialized=JSON\.stringify\(intakeReportPayload\(\)\)/);
  assert.match(page, /body:intakeReportState\.serialized/);
  assert.match(page, /new Blob\(\[intakeReportState\.serialized\]/);
  assert.match(page, /body:JSON\.stringify\(\{capability:INTAKE\.statusCap\}\)/);
  assert.doesNotMatch(page, /INTAKE_STATUS\+"\?parentId=/);
  assert.match(page, /r\.status===200 && result && result\.ok===true/);
  assert.match(page, /window\.__KZ_CLEAR_INTAKE_CAPS\(\)/);
});
