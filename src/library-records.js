import { fields } from "./data.js";

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function values(value) {
  if (Array.isArray(value)) return value.map(String);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch { /* Older exports use semicolon-separated text. */ }
  return String(value).split(/\s*;\s*|\r?\n/).filter(Boolean);
}

const truthy = (value) => value === true || /^(true|yes|1)$/i.test(String(value));

// Preview decisions describe only the saved artifact. Missing evidence stays
// unavailable; opening a saved row never starts research or fabricates claims.
export function libraryRecordsJob(page) {
  const file = page.file;
  return {
    id: `library:${file.file_id}`, kind: "file", label: file.filename, status: "completed",
    resultsState: page.records.length ? "ready" : "empty",
    results: { people: page.records.map((row, index) => ({
      person_id: `saved:${page.offset + index + 1}`,
      row_index: page.offset + index + 1,
      status: row.status || (truthy(row.review_required) ? "review_required" : "completed"),
      error_code: row.error_code || null,
      original_row: {},
      result: {
        claims: [], sources: [], usage: [],
        profile: {
          input_name: row.full_name || "", coverage: number(row.coverage),
          legacy_coverage: number(row.legacy_coverage), profile_confidence: number(row.profile_confidence),
          review_required: truthy(row.review_required), record_status: row.record_status,
          saved_row_sources: values(row.source_urls),
          seed_attributes: [],
          fields: Object.fromEntries(fields.map(([key]) => {
            const confidence = number(row[`${key}_confidence`]);
            const provenance = row[`${key}_provenance_status`] || null;
            return [key, {
              value: row[key] == null ? null : String(row[key]),
              confidence, research_confidence: confidence,
              input_confidence: number(row[`${key}_input_confidence`]),
              provenance_status: provenance,
              supplied_values: values(row[`${key}_supplied_values`]),
              review_required: row[`${key}_review_required`] != null && row[`${key}_review_required`] !== ""
                ? truthy(row[`${key}_review_required`])
                : Boolean(row[key]) && (provenance === "supplied" || provenance === "conflicting" || (confidence !== null && confidence < 50)),
              review_reason_codes: values(row[`${key}_review_reasons`]) || [],
              sources: values(row[`${key}_source_urls`]),
            }];
          })),
        },
      },
    })) },
  };
}
