import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fields } from "../src/data.js";
import { libraryRecordsJob } from "../src/library-records.js";

let server;
let components;

before(async () => {
  // Transform the real JSX components with the existing build tool. No browser,
  // research service, or additional test dependency is needed for these fixtures.
  server = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true, watch: null },
    esbuild: { jsx: "automatic" },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  components = await server.ssrLoadModule("/src/App.jsx");
});

after(async () => {
  await server?.close();
});

const expectedLabels = [
  "Full Name", "Organisation", "Job Title",
  "University Name", "Degree Type", "Subject", "Profile Link",
];

const request = { kind: "person", label: "Test Person" };
const universityDecision = {
  value: "Lake University",
  confidence: 87,
  review_required: true,
  review_reason_codes: ["conflicting_evidence"],
  selected_claim_id: "university-claim",
  supporting_claim_ids: ["university-claim"],
  supporting_source_ids: ["university-source"],
  sources: ["https://example.org/biography"],
};

function personWithUniversity(decision = universityDecision) {
  return {
    person_id: "test-person",
    row_index: 1,
    status: "review_required",
    original_row: { full_name: "Test Person" },
    result: {
      profile: { fields: {
        full_name: { value: "Test Person", confidence: 99 },
        university_name: decision,
      } },
      claims: [{
        claim_id: "university-claim",
        source_id: "university-source",
        normalised_value: "Lake University",
        evidence_text: "The biography explicitly states their university.",
        directness: "explicit",
      }],
      sources: [{
        source_id: "university-source",
        final_url: "https://example.org/biography",
        title: "Test biography",
        domain: "example.org",
        source_type: "official_profile",
      }],
    },
  };
}

function render(name, props = {}) {
  return renderToStaticMarkup(createElement(components[name], props));
}

function labelsIn(html, pattern) {
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

test("saved record text is escaped and source links reject active URL schemes", () => {
  const job = libraryRecordsJob({ file: { file_id: "safe", filename: "legacy.csv" }, offset: 0, records: [{
    full_name: '<img src=x onerror="alert(1)">',
    profile_link: "javascript:alert(1)", profile_link_source_urls: "javascript:alert(2);https://example.org/real-source",
    source_urls: "data:text/html,<script>alert(3)</script>;https://example.org/record",
  }] });
  const person = job.results.people[0];
  const table = render("BatchTable", { job, onSelect() {} });
  assert.doesNotMatch(table, /<img src=x/);
  assert.match(table, /&lt;img/);
  const detail = render("EvidenceDrawer", { selection: { field: "profile_link", person, request: job }, onClose() {} });
  assert.doesNotMatch(detail, /href="(?:javascript|data):/);
  assert.match(detail, /href="https:\/\/example.org\/real-source"/);
  const aggregate = render("EvidenceDrawer", { selection: { field: "full_name", person, request: job }, onClose() {} });
  assert.doesNotMatch(aggregate, /href="(?:javascript|data):|<script>/);
  assert.match(aggregate, /Support for this individual field is unavailable/);
  assert.match(aggregate, /href="https:\/\/example.org\/record"/);
});

test("connection recovery keeps committed batch counts and avoids empty or failure messages", () => {
  const job = { id: "recover", jobId: "job", kind: "file", status: "running", totalPeople: 100,
    counts: { completed: 37, researching: 3, queued: 60 }, results: null };
  for (const [connectionState, message] of [
    ["reconnecting", "Connection interrupted. Research will resume automatically."],
    ["resuming", "Connection restored. Resuming research."],
  ]) {
    const html = render("Results", { job: { ...job, connectionState }, regionRef: { current: null } });
    assert.ok(html.includes(message));
    assert.match(html, /37 of 100 finished/);
    assert.doesNotMatch(html, /No records found|Status checks paused|Research failed/);
  }
});

test("the shared schema and person skeleton show all seven fields in backend order", () => {
  assert.deepEqual(fields.map(([, label]) => label), expectedLabels);
  assert.equal(fields.length, 7);
  assert.deepEqual(
    labelsIn(render("PersonSkeleton"), /class="field-label-text">([^<]+)</g),
    expectedLabels,
  );
});

test("university card and field details preserve backend confidence, review, and provenance", () => {
  const person = personWithUniversity();
  const card = render("FieldCard", {
    field: "university_name", label: "University Name", person, request,
  });
  assert.match(card, /Lake University/);
  assert.match(card, /87% confidence/);
  assert.match(card, /1 source/);
  assert.match(card, /class="review-dot">Review/);

  const drawer = render("EvidenceDrawer", {
    selection: { field: "university_name", person, request },
  });
  assert.match(drawer, /id="evidence-title">University Name/);
  assert.match(drawer, /<strong>87%<\/strong>/);
  assert.match(drawer, /Review Required/);
  assert.match(drawer, /Supporting evidence/);
  assert.match(drawer, /The biography explicitly states their university\./);
  assert.match(drawer, /href="https:\/\/example.org\/biography"/);
  assert.match(drawer, /Test biography/);
});

test("null university stays missing while retaining real confidence and review metadata", () => {
  const person = personWithUniversity({
    value: null, confidence: 0, review_required: true, sources: [],
  });
  const card = render("FieldCard", {
    field: "university_name", label: "University Name", person, request,
  });
  assert.match(card, /Not found/);
  assert.match(card, /0% confidence/);
  assert.match(card, /0 sources/);
  assert.match(card, /class="review-dot">Review/);
  assert.doesNotMatch(card, /Lake University|undefined|NaN/);

  const drawer = render("EvidenceDrawer", {
    selection: { field: "university_name", person, request },
  });
  assert.match(drawer, /class="field-value missing">Not found/);
  assert.match(drawer, /No supporting evidence was returned for this field/);
});

test("legacy results without university render safely without inferring university from uploaded data", () => {
  const person = personWithUniversity();
  delete person.result.profile.fields.university_name;
  person.original_row.university_name = "Unverified input university";

  const card = render("FieldCard", {
    field: "university_name", label: "University Name", person, request,
  });
  assert.match(card, /Not found/);
  assert.doesNotMatch(card, /% confidence|— confidence/);
  assert.doesNotMatch(card, /Unverified input university|Lake University|undefined|NaN/);

  const drawer = render("EvidenceDrawer", {
    selection: { field: "university_name", person, request },
  });
  assert.match(drawer, /No field result/);
  assert.doesNotMatch(drawer, /Unverified input university|Lake University|undefined|NaN/);

  const table = render("BatchTable", {
    job: { kind: "file", status: "completed", results: { people: [person] } },
  });
  assert.match(table, /Test Person/);
  assert.doesNotMatch(table, /Unverified input university|Lake University|undefined|NaN/);
});

test("batch results and batch skeleton retain all seven columns in the same order", () => {
  const table = render("BatchTable", {
    job: { kind: "file", status: "completed", results: { people: [personWithUniversity()] } },
  });
  const loading = render("BatchTable", {
    job: { kind: "file", status: "running", totalPeople: 2 },
  });
  for (const html of [table, loading]) {
    assert.deepEqual(labelsIn(html, /<th scope="col">([^<]+)</g), expectedLabels);
  }
  assert.match(table, /Lake University/);
  assert.match(table, /87% confidence/);
  assert.match(table, /class="review-dot">Review/);
  assert.match(table, /Review Required/);
  assert.doesNotMatch(table, /input certainty/);
  assert.equal((table.match(/<td>/g) || []).length, 7);
  assert.equal((loading.match(/<td>/g) || []).length, 14);
});

test("batch rows retain input order in state while displaying ascending row numbers", () => {
  const later = personWithUniversity();
  later.row_index = 2;
  later.person_id = "later";
  later.result.profile.fields.full_name.value = "Later Person";
  const earlier = personWithUniversity();
  earlier.person_id = "earlier";
  earlier.result.profile.fields.full_name.value = "Earlier Person";
  const people = [later, earlier];
  const table = render("BatchTable", {
    job: { kind: "file", status: "completed", results: { people } },
  });
  assert.ok(table.indexOf("Earlier Person") < table.indexOf("Later Person"));
  assert.deepEqual(people.map((person) => person.row_index), [2, 1]);
});

test("table confidence stays field-specific and review uses explicit backend flags", () => {
  const person = personWithUniversity();
  person.result.profile.fields.organisation = { value: "Example Organisation", confidence: 100, research_confidence: 62, review_required: true };
  person.result.profile.fields.job_title = { value: "Analyst", confidence: 24, review_required: false };
  person.result.profile.fields.degree_type = { value: "Master's Degree", confidence: null, review_required: false };
  person.result.profile.fields.subject = { value: null, confidence: null, review_required: false };
  person.result.profile.fields.profile_link = { value: "https://example.org/profile", research_confidence: 91, review_required: false };
  const table = render("BatchTable", { job: { status: "completed", results: { people: [person] } } });
  const cells = [...table.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
  assert.equal(cells.length, 7);
  assert.match(cells[1], /Example Organisation[\s\S]*62% confidence[\s\S]*class="review-dot">Review/);
  assert.doesNotMatch(cells[1], /100%/);
  assert.match(cells[2], /24% confidence/);
  assert.doesNotMatch(cells[2], /review-dot/);
  assert.doesNotMatch(cells[4], /confidence|review-dot/);
  assert.match(cells[5], /Not found/);
  assert.doesNotMatch(cells[5], /confidence|review-dot/);
  assert.match(cells[6], /91% confidence/);
});

test("saved previews retain review metadata without inventing low-confidence review flags", () => {
  const job = libraryRecordsJob({ file: { file_id: "scores", filename: "legacy.csv" }, offset: 0, records: [{
    full_name: "Person", status: "failed", organisation: "Employer", organisation_confidence: 22,
    job_title: "Director", job_title_confidence: 99, job_title_review_required: true,
    university_name: "University", university_name_confidence: 100, university_name_research_confidence: 73,
    full_name_confidence: 100, full_name_input_confidence: 100, full_name_provenance_status: "supplied",
  }] });
  const person = job.results.people[0];
  assert.equal(person.result.profile.fields.organisation.review_required, false);
  assert.equal(person.result.profile.fields.job_title.review_required, true);
  const cells = [...render("BatchTable", { job }).matchAll(/<td>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
  assert.match(cells[0], /Failed/);
  assert.doesNotMatch(cells[0], /100% confidence/);
  assert.match(cells[1], /22% confidence/);
  assert.doesNotMatch(cells[1], /review-dot/);
  assert.match(cells[2], /99% confidence[\s\S]*review-dot/);
  assert.match(cells[3], /73% confidence/);
});

test("diagnostic details retain long labels and identifiers without dropping data", () => {
  const person = personWithUniversity({ ...universityDecision, scoring_components: {
    seed_corroborating_claim_ids: ["2f0b95f6-d3c8-4eae-905d-4c00cfd7476c", "365efca0-aa7d-4bcc-8d03-d9fa17d575a0"],
  } });
  const drawer = render("EvidenceDrawer", { selection: { field: "university_name", person, request } });
  assert.match(drawer, /<dt>Seed Corroborating Claim Ids<\/dt>/);
  assert.match(drawer, /2f0b95f6-d3c8-4eae-905d-4c00cfd7476c/);
  assert.match(drawer, /365efca0-aa7d-4bcc-8d03-d9fa17d575a0/);
});

test("supplied university stays distinct from missing independent research", () => {
  const person = personWithUniversity();
  person.result.profile.fields.university_name = {
    value: null, confidence: 0, research_confidence: 0,
    supplied_values: ["Example University"], input_confidence: 100,
    provenance_status: "supplied", review_required: true,
  };
  person.result.profile.seed_attributes = [
    { column: "Educational Institution", value: "Example University", field: "university_name", category: "biographical", input_confidence: 100 },
    { column: "LIST_NAME", value: "Original batch", field: null, category: "administrative", input_confidence: 100 },
    { column: "Personal Email", value: "private@example.test", field: null, category: "sensitive", input_confidence: 100 },
    { column: "Custom Attribute", value: { exact: 1.23456789 }, field: null, category: "unknown", input_confidence: 100 },
  ];
  const card = render("FieldCard", {
    field: "university_name", label: "University Name", person, request,
  });
  assert.match(card, /Not found/);
  assert.match(card, /0% confidence/);
  assert.match(card, /Supplied input; not independently verified/);
  assert.doesNotMatch(card, /100%.*confidence|Original batch|private@example/);

  const drawer = render("EvidenceDrawer", { selection: { field: "university_name", person, request } });
  assert.match(drawer, /Supplied information/);
  assert.match(drawer, /Example University/);
  assert.match(drawer, /Educational Institution/);
  assert.match(drawer, /100% input certainty/);
  assert.match(drawer, /It is not independent verification/);
  assert.match(drawer, /<span>Research Confidence<\/span><strong>0%<\/strong>/);
  assert.match(drawer, /<details class="scoring-details"><summary>View all supplied input/);
  assert.doesNotMatch(drawer, /<details[^>]+open/);
  assert.match(drawer, /LIST_NAME/);
  assert.match(drawer, /1\.23456789/);
});

test("corroborated and conflicting seed values retain both provenance and evidence confidence", () => {
  for (const provenance_status of ["corroborated", "conflicting", "superseded"]) {
    const person = personWithUniversity({
      ...universityDecision, confidence: 87, research_confidence: 87,
      supplied_values: ["Supplied university"], input_confidence: 100, provenance_status,
    });
    const card = render("FieldCard", { field: "university_name", label: "University Name", person, request });
    assert.match(card, /87% confidence/);
    assert.doesNotMatch(card, /100%.*confidence/);
    const drawer = render("EvidenceDrawer", { selection: { field: "university_name", person, request } });
    assert.match(drawer, /Supplied university/);
    assert.match(drawer, /100% input certainty/);
    assert.match(drawer, /Lake University/);
    assert.match(drawer, /<strong>87%<\/strong>/);
    assert.match(drawer, /Supporting evidence/);
    assert.match(drawer, /href="https:\/\/example.org\/biography"/);
    assert.match(drawer, new RegExp({ corroborated: "corroborated by research", conflicting: "conflicts with research", superseded: "superseded by research" }[provenance_status]));
  }
});

test("immutable supplied name keeps input certainty only in the detailed record", () => {
  const person = personWithUniversity();
  person.result.profile.fields.full_name = {
    value: "Test Person", confidence: 100, input_confidence: 100,
    research_confidence: 0, provenance_status: "supplied", supplied_values: ["Test Person"],
    scoring_components: { confidence_kind: "seed_input_certainty" },
  };
  const card = render("FieldCard", { field: "full_name", label: "Full Name", person, request });
  assert.match(card, /0% confidence/);
  assert.doesNotMatch(card, /100%|input certainty/);
  const table = render("BatchTable", {
    job: { kind: "file", status: "completed", results: { people: [person] } },
  });
  assert.deepEqual(labelsIn(table, /<th scope="col">([^<]+)</g), expectedLabels);
  assert.doesNotMatch(table, /100% input certainty|research confidence/);
  const drawer = render("EvidenceDrawer", { selection: { field: "full_name", person, request } });
  assert.match(drawer, /Research confidence<\/span><strong>0%/);
});

test("a different researched university never inherits supplied input certainty", () => {
  const person = personWithUniversity();
  person.result.profile.fields.university_name = {
    value: "Researched University", confidence: 83, research_confidence: 83,
    supplied_values: ["Supplied University"], input_confidence: 100,
    provenance_status: "supplied", scoring_components: {}, review_required: true,
  };
  const card = render("FieldCard", { field: "university_name", label: "University Name", person, request });
  assert.match(card, /Researched University/);
  assert.match(card, /83% confidence/);
  assert.doesNotMatch(card, /100%/);
  const drawer = render("EvidenceDrawer", { selection: { field: "university_name", person, request } });
  assert.match(drawer, /Supplied University/);
  assert.match(drawer, /100% input certainty/);
  assert.match(drawer, /<h3>Researched value<\/h3><p class="field-value">Researched University/);
  assert.doesNotMatch(drawer, /<h3>Supplied value/);
});

test("historical employment remains original input and does not populate a current role", () => {
  const person = personWithUniversity();
  person.result.profile.seed_attributes = [
    { column: "Previous Employer", value: "Historical Company", field: "historical_employer", category: "biographical", input_confidence: 100 },
  ];
  const table = render("BatchTable", { job: { kind: "file", status: "completed", results: { people: [person] } } });
  assert.doesNotMatch(table, /Historical Company/);
  const drawer = render("EvidenceDrawer", { selection: { field: "organisation", person, request } });
  assert.match(drawer, /No field result/);
  assert.doesNotMatch(drawer, /<h3>Supplied information/);
  assert.match(drawer, /<dt>Previous Employer<\/dt><dd>Historical Company/);
});

test("terminal rendering never flashes an empty message before results hydrate", () => {
  const job = { kind: "file", status: "completed", jobId: "job", totalPeople: 1, results: null };
  const pending = render("BatchTable", { job });
  assert.match(pending, /File research fields loading/);
  assert.doesNotMatch(pending, /No person results|job ended/);
  assert.match(render("BatchTable", { job: { ...job, resultsState: "empty", results: { people: [] } } }), /No person results/);
  assert.doesNotMatch(render("BatchTable", { job: { ...job, resultsState: "error", error: "Unable to load" } }), /No person results/);
});

test("failed research still renders all supplied fields and separate certainty in details", () => {
  const person = { status: "failed", row_index: 1, person_id: "failed", result: null, error_code: "PROVIDER_ERROR",
    supplied_fields: { organisation: { value: "6a architects", confidence: 0, research_confidence: 0, input_confidence: 100,
      provenance_status: "supplied", supplied_values: ["6a architects"], review_required: true } }, seed_attributes: [] };
  assert.match(render("BatchTable", { job: { status: "failed", results: { people: [person] } } }), /6a architects.*?<\/span>/);
  const drawer = render("EvidenceDrawer", { selection: { field: "organisation", person, request } });
  assert.match(drawer, /100% input certainty/);
  assert.match(drawer, /Research confidence<\/span><strong>0%/);
  assert.doesNotMatch(drawer, /No field result/);
});

test("Save to Database is present for useful completed-with-issues results", () => {
  const job = { id: 1, jobId: "job", kind: "file", status: "partial", totalPeople: 2,
    counts: { completed: 1, failed: 1 }, results: { people: [personWithUniversity()] } };
  const html = render("Results", { job, regionRef: { current: null } });
  assert.match(html, /Save to Database/);
  assert.match(html, /Completed with Issues/);
  assert.doesNotMatch(render("Results", { job: { ...job, results: null }, regionRef: { current: null } }), /Save to Database/);
});

test("failed and cancelled supplied-only profiles preserve outcome without inventing review or completion", () => {
  for (const status of ["failed", "cancelled"]) {
    const person = { person_id: "seed", row_index: 1, status, result: null, original_row: {},
      supplied_fields: { full_name: { value: "Anna Example", confidence: 0, research_confidence: 0,
        provenance_status: "supplied", input_confidence: 100, review_required: false } } };
    const html = render("Results", { job: { id: "seed", jobId: "job", kind: "person", status,
      results: { people: [person] } }, regionRef: { current: null } });
    assert.match(html, new RegExp(`Research ${status}; supplied information retained`));
    assert.doesNotMatch(html, /Review recommended|Research complete|Save to Database/);
  }
});

test("historical professional context is visible in field details and never labeled current", () => {
  const person = personWithUniversity();
  person.result.profile.fields.organisation = { value: "Established Practice", confidence: 91, review_required: true,
    review_reason_codes: ["HISTORICAL_PROFESSIONAL_AFFILIATION"], scoring_components: {
      relationship_temporal_status: "historical", relationship_type: "principal_professional_practice",
    } };
  const drawer = render("EvidenceDrawer", { selection: { field: "organisation", person, request } });
  assert.match(drawer, /Principal professional practice · Historical/);
  assert.doesNotMatch(drawer, /· Current/);
});

test("canonical API display casing agrees across table, card and details without changing raw input", () => {
  for (const value of ["IBM", "UNESCO", "McGill", "PwC", "ETH Zürich", "RPBW", "University of Ghana", "Universidade de São Paulo"]) {
    const person = personWithUniversity();
    person.result.profile.fields.organisation = { value, confidence: 87, review_required: false };
    const card = render("FieldCard", { field: "organisation", label: "Organisation", person, request });
    const table = render("BatchTable", { job: { status: "completed", results: { people: [person] } } });
    const drawer = render("EvidenceDrawer", { selection: { field: "organisation", person, request } });
    for (const html of [card, table, drawer]) assert.ok(html.includes(value));
  }
});
