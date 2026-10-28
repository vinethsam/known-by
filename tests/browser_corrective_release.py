"""Offline browser regression, using an existing Playwright + Chrome installation.

Run with the backend .venv Python. All research/library API responses are fixtures;
external requests are blocked. The app itself is served by the real Vite server.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".qa" / "corrective-release"
OUT.mkdir(parents=True, exist_ok=True)
PORT = 5197
ORIGIN = f"http://127.0.0.1:{PORT}"
FIELDS = ["full_name", "country_of_origin", "organisation", "job_title", "university_name", "degree_type", "subject", "profile_link"]
VALUES = ["Anna María McGill", "Ghana", "UNESCO", "Senior Research Analyst", "University of Ghana", "PhD", "Architecture", "https://example.org/a-very-long-biography-and-research-profile/anna-maria-mcgill"]
saved = {"file_id": "fixture-file", "filename": "Research_2026-10-26.csv", "format": "csv", "saved_at": "2026-10-26T12:00:00Z", "research_started_at": "2026-10-26T11:59:00Z", "size_bytes": 128, "saved_by": "QA User"}

def decision(value, field):
    return dict(value=value, confidence=42 if field == "organisation" else 87, research_confidence=42 if field == "organisation" else 87,
                input_confidence=100, provenance_status="conflicting" if field == "organisation" else "corroborated",
                supplied_values=["Earlier Organisation" if field == "organisation" else value], selected_claim_id=None,
                supporting_claim_ids=[], supporting_source_ids=[], conflicting_claim_ids=[], alternative_claim_ids=[],
                sources=["https://example.org/bio"], review_required=field == "organisation", review_reason_codes=[], scoring_components={})

person = dict(person_id="person", row_index=1, status="review_required", original_row={}, error_code=None,
              result=dict(profile=dict(fields={field: decision(value, field) for field, value in zip(FIELDS, VALUES)},
                                       input_name=VALUES[0], profile_confidence=77, coverage=100, sources_used=1, review_required=True), claims=[], sources=[], usage=[]))
row = {field: value for field, value in zip(FIELDS, VALUES)}
for field in FIELDS:
    row.update({f"{field}_confidence": 42 if field == "organisation" else 87,
                f"{field}_provenance_status": "conflicting" if field == "organisation" else "corroborated",
                f"{field}_input_confidence": 100, f"{field}_supplied_values": "Earlier Organisation" if field == "organisation" else row[field],
                f"{field}_source_urls": "https://example.org/bio"})
row.update(status="review_required", record_status="review_required", review_required=True, source_urls="https://example.org/bio")

def run():
    log = (OUT / "vite.log").open("w", encoding="utf-8")
    server = subprocess.Popen([shutil.which("node"), "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(PORT), "--strictPort"], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        for _ in range(100):
            try:
                with urlopen(ORIGIN, timeout=1): break
            except OSError: time.sleep(.1)
        with sync_playwright() as p:
            executable = os.environ.get("KNOWNBY_TEST_BROWSER", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
            browser = p.chromium.launch(executable_path=executable, headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
            state = {"results": 0, "saves": 0, "deletes": 0, "files": [], "previews": [], "denied": False}
            def route(request):
                url = urlsplit(request.request.url)
                path = url.path
                if not request.request.url.startswith(ORIGIN):
                    request.abort(); return
                if not path.startswith("/api/"):
                    request.continue_(); return
                def send(data, status=200): request.fulfill(status=status, content_type="application/json", body=json.dumps(data))
                if state["denied"]: send({"detail": "Authorization required"}, 401); return
                if path == "/api/v1/research/batch": send({"job_id": "fixture-job", "status": "queued", "total_people": 2}); return
                if path == "/api/v1/jobs/fixture-job": send({"job_id": "fixture-job", "status": "partial", "total_people": 2, "counts": {"review_required": 1, "failed": 1}, "created_at": "2026-10-26T12:00:00Z"}); return
                if path.endswith("/results"):
                    state["results"] += 1
                    if state["results"] > 1: time.sleep(.5)
                    send({"job_id": "fixture-job", "status": "partial", "people": [] if state["results"] == 1 else [person]}); return
                if path.endswith("/library"):
                    state["saves"] += 1; state["files"] = [saved]; send(saved, 201); return
                if path == "/api/v1/library/files": send(state["files"]); return
                if path.endswith("/records"):
                    query = parse_qs(url.query); offset = int(query.get("offset", [0])[0]); q = query.get("q", [""])[0]
                    state["previews"].append((offset, q))
                    records = [] if q == "missing" else [row] * (1 if offset else 50)
                    send({"file": saved, "records": records, "total": 0 if q else 51, "limit": 50, "offset": offset, "has_more": not offset and not q}); return
                if path.endswith("/fixture-file") and request.request.method == "DELETE":
                    state["deletes"] += 1; state["files"] = []; request.fulfill(status=204); return
                if path.endswith("/fixture-file"):
                    request.fulfill(status=200, content_type="text/csv", headers={"Content-Disposition": 'attachment; filename="Research_2026-10-26.csv"'}, body="Full Name\nAnna María McGill\n"); return
                raise AssertionError(f"Unexpected API request: {path}")
            context.route("**/*", route)
            page = context.new_page()
            page.goto(ORIGIN)
            page.wait_for_selector(".startup-sequence", state="detached", timeout=15000)
            page.locator('input[type="file"]').set_input_files({"name": "offline.csv", "mimeType": "text/csv", "buffer": b"Full Name\nAnna Example\nAnother Example\n"})
            page.evaluate("window.emptyFlashes=[]; new MutationObserver(()=>{if(/No person results were returned|No profile was returned/.test(document.body.innerText))window.emptyFlashes.push(document.body.innerText)}).observe(document.body,{subtree:true,childList:true,characterData:true})")
            page.get_by_role("button", name="Enrich file", exact=True).click()
            expect(page.get_by_role("button", name="Save to Database", exact=True)).to_be_visible(timeout=20000)
            assert page.evaluate("window.emptyFlashes.length") == 0
            assert state["results"] == 2
            expect(page.get_by_text("Completed with Issues", exact=True)).to_be_visible()
            page.get_by_label("Inspect organisation details for row 1").click()
            badge = page.locator(".source-dialog .status-badge")
            dimensions = badge.evaluate("e=>{let a=e.querySelector('svg').getBoundingClientRect(),b=e.querySelector('.status-badge-label').getBoundingClientRect();return {display:getComputedStyle(e).display,height:e.getBoundingClientRect().height,delta:Math.abs(a.y+a.height/2-b.y-b.height/2),overflow:e.scrollWidth>e.clientWidth}}")
            assert dimensions["display"] == "inline-flex" and dimensions["delta"] < 2 and dimensions["height"] < 30 and not dimensions["overflow"], dimensions
            page.screenshot(path=str(OUT / "desktop-field-details.png"), full_page=True)
            page.get_by_label("Close field details").click()
            page.get_by_label("Library file type").select_option("csv")
            page.get_by_role("button", name="Save to Database", exact=True).click()
            expect(page.get_by_role("button", name="Saved to Database", exact=True)).to_be_disabled()
            assert state["saves"] == 1
            page.get_by_label("Dismiss save confirmation").click()
            page.get_by_role("button", name="Database", exact=True).click()
            page.get_by_role("button", name="View records", exact=True).click()
            expect(page.get_by_text("1–50 of 51 records", exact=True)).to_be_visible()
            assert len(page.locator(".file-results tbody tr").all()) == 50
            page.get_by_role("button", name="Next", exact=True).click()
            expect(page.get_by_text("51–51 of 51 records", exact=True)).to_be_visible()
            page.get_by_label("Inspect organisation details for row 51").click()
            expect(page.get_by_text("Earlier Organisation", exact=True).first).to_be_visible()
            page.get_by_label("Close field details").click()
            page.get_by_label("Search saved records").fill("missing")
            page.locator(".library-preview__search").get_by_role("button", name="Search", exact=True).click()
            expect(page.get_by_text("No matching records", exact=True)).to_be_visible()
            page.get_by_label("Search saved records").fill("")
            page.locator(".library-preview__search").get_by_role("button", name="Search", exact=True).click()
            expect(page.get_by_text("1–50 of 51 records", exact=True)).to_be_visible()
            page.set_viewport_size({"width": 390, "height": 844})
            page.get_by_label("Inspect profile link details for row 1", exact=True).click()
            assert page.locator(".source-dialog").evaluate("e=>e.scrollWidth<=e.clientWidth")
            page.screenshot(path=str(OUT / "mobile-field-details.png"), full_page=False)
            page.get_by_label("Close field details").click()
            page.locator(".table-scroll").evaluate("e=>e.scrollLeft=0")
            page.screenshot(path=str(OUT / "mobile-saved-records.png"), full_page=False)
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            with page.expect_download() as download:
                page.get_by_role("button", name="Download original", exact=True).click()
            assert download.value.suggested_filename == saved["filename"]
            page.get_by_role("button", name="Back to files", exact=True).click()
            expect(page.get_by_role("button", name=saved["filename"], exact=True)).to_be_visible()
            page.get_by_role("button", name="Delete", exact=True).click()
            expect(page.get_by_text("Delete this saved result?", exact=True)).to_be_visible()
            page.get_by_role("button", name="Delete", exact=True).click()
            expect(page.get_by_text("No saved research yet", exact=True)).to_be_visible()
            assert state["deletes"] == 1
            state["denied"] = True
            page.reload()
            expect(page.get_by_text("Shared Library access requires authorization. Contact your administrator.", exact=True)).to_be_visible()
            print(json.dumps({"passed": True, "result_fetches": state["results"], "save_requests": state["saves"], "delete_requests": state["deletes"], "preview_requests": state["previews"], "badge": dimensions, "screenshots": str(OUT)}, indent=2))
            browser.close()
    finally:
        server.terminate()
        try: server.wait(timeout=10)
        except subprocess.TimeoutExpired: server.kill()
        log.close()

if __name__ == "__main__": run()
