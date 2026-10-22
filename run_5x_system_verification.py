#!/usr/bin/env python3
"""Run Qatfah's five real Chromium accounting cycles and inspect actual PDFs.

The browser exercises the shipped HTML, event handlers, IndexedDB, projections,
and canvas/PDF generator. Android transport is an explicit test double: no
WhatsApp account, customer message, GitHub upload, or publication is performed.
This distinction is preserved in every machine-readable report.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def source_manifest() -> dict[str, str]:
    paths = [ROOT / name for name in ["package.json", "package-lock.json", "requirements-verification.txt", "run_5x_system_verification.py", "README.md"]]
    for directory in ["apps", "assets", "native", "server", "scripts", "tests", "docs", ".github"]:
        paths.extend(p for p in (ROOT / directory).rglob("*") if p.is_file())
    return {
        str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(paths) if p.exists() and "__pycache__" not in str(p)
    }


def execute(label: str, command: list[str], output: Path, env: dict[str, str]) -> dict:
    print(f"[{now()}] {label}", flush=True)
    log = output / (label.replace(" ", "-").lower() + ".log")
    with log.open("w", encoding="utf-8") as stream:
        process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, bufsize=1)
        assert process.stdout is not None
        for line in process.stdout:
            stream.write(line)
            stream.flush()
            # Stream stage progress while retaining detailed Node test evidence.
            if (label != "Unit and integration tests" or
                line.startswith(("✖", "not ok", "ℹ tests", "ℹ pass", "ℹ fail", "# tests", "# pass", "# fail"))):
                print(line.rstrip(), flush=True)
        code = process.wait()
    return {"status": "PASS" if code == 0 else "FAIL", "exitCode": code,
            "log": str(log), "command": command}


def fixture_logos(output: Path, cycles: int) -> None:
    from PIL import Image, ImageDraw, ImageFont
    fixtures = output / "fixtures"
    fixtures.mkdir(exist_ok=True)
    colors = [(20, 112, 74), (17, 85, 141), (141, 79, 14), (107, 48, 128), (9, 115, 126)]
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    font = ImageFont.truetype(font_path, 96) if Path(font_path).exists() else ImageFont.load_default()
    for i in range(cycles):
        image = Image.new("RGB", (240, 240), "white")
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((10, 10, 230, 230), radius=38, fill=colors[i])
        draw.text((120, 120), str(i + 1), fill="white", font=font, anchor="mm")
        image.save(fixtures / f"logo-{i + 1}.png")


def inspect_pdfs(browser: dict, output: Path) -> list[dict]:
    from pypdf import PdfReader
    from PIL import Image, ImageStat
    renderer = shutil.which("pdftoppm")
    rendered = output / "rendered-pdfs"
    rendered.mkdir(exist_ok=True)
    checks = []
    for document in browser.get("documents", []):
        path = Path(document["path"])
        check = {"path": str(path), "cycle": document["cycle"], "kind": document["kind"]}
        try:
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != document["sha256"]:
                raise ValueError("PDF bytes changed after the button send assertion")
            reader = PdfReader(path, strict=True)
            if not reader.pages:
                raise ValueError("Empty PDF")
            for page in reader.pages:
                if float(page.mediabox.width) <= 0 or float(page.mediabox.height) <= 0:
                    raise ValueError("Invalid page dimensions")
                images = list(page.images)
                if not images:
                    raise ValueError("Actual canvas image is missing")
                for image in images:
                    image.image.load()
                    variance = ImageStat.Stat(image.image.convert("RGB")).var
                    if max(variance) < 50:
                        raise ValueError("Blank or nearly blank PDF page")
            if not renderer:
                raise RuntimeError("pdftoppm is required for real PDF rendering")
            prefix = rendered / path.stem
            render = subprocess.run([renderer, "-r", "85", "-png", str(path), str(prefix)],
                                    capture_output=True, text=True, timeout=60)
            if render.returncode:
                raise ValueError(render.stderr)
            pages = sorted(rendered.glob(path.stem + "-*.png"))
            if len(pages) != len(reader.pages):
                raise ValueError("Not every PDF page was rendered")
            for png in pages:
                with Image.open(png) as image:
                    image.verify()
            check.update(status="PASS", pages=len(reader.pages), renderedPages=[str(p) for p in pages],
                         sha256=document["sha256"], bytes=len(data))
        except Exception as error:
            check.update(status="FAIL", error=str(error))
        checks.append(check)
    return checks


def markdown_report(report: dict) -> str:
    sections = [
        ("identity", "الإعدادات والهوية في كل مستند"),
        ("catalog", "العملاء والأصناف والقوائم الفورية"),
        ("cash_sales", "المبيعات النقدية والصندوق"),
        ("credit_sales", "المبيعات الآجلة وذمم العملاء"),
        ("purchases_vouchers", "المشتريات وسندات القبض والصرف والمصروف"),
        ("journals", "عليه / له / تحويل لكل من YER وSAR وUSD"),
        ("cash_reports", "الصندوق والتقارير اليومية والسنوية"),
        ("whatsapp_contract", "استدعاء الإرسال الصامت ومنع النوافذ"),
        ("persistence", "استمرار الحفظ في IndexedDB بعد إعادة فتح الصفحة"),
    ]
    cycles = report.get("browser", {}).get("cycles", [])
    lines = ["# نتائج تدقيق قطفة: خمس دورات فعلية من الواجهة", "",
             f"بدء الفحص: {report['startedAt']}", "",
             "الاختبار يشغّل واجهة التطبيق الفعلية في Chromium مع IndexedDB وتوليد PDF الحقيقي. بيانات التجربة مصطنعة ومتنوعة. لا يرسل رسائل إلى أي شخص.", "",
             "**حد التحقق:** جسر أندرويد للإرسال ممثل باختبار محلي يعيد إقراراً مضبوطاً؛ هذه النتائج لا تثبت اتصال WhatsApp الحي أو وصول ملف إلى هاتف العميل.", "",
             "| القسم | دورة 1 | دورة 2 | دورة 3 | دورة 4 | دورة 5 |",
             "|---|---|---|---|---|---|"]
    labels = {"PASS": "نجح", "FAIL": "فشل", "BLOCKED": "تعذر", "NOT_RUN": "لم ينفذ"}
    for key, title in sections:
        values = []
        for i in range(1, 6):
            cycle = next((c for c in cycles if c["cycle"] == i), {})
            value = cycle.get("sections", {}).get(key, {}).get("status", "NOT_RUN")
            values.append(labels.get(value, value))
        lines.append("| " + " | ".join([title, *values]) + " |")
    lines.extend(["", "## الأدلة", "",
                  f"- الاختبارات الآلية الكاملة المطلوبة: {'نجحت' if report['requiredAutomationPassed'] else 'لم تنجح كاملة'}.",
                  f"- ملفات PDF التي فُحصت ورُسمت فعلياً: {sum(p['status']=='PASS' for p in report['pdfChecks'])}/{len(report['pdfChecks'])}.",
                  f"- تطابق ملفات المصدر قبل الفحص وبعده: {report['sourceUnchangedDuringRun']}.",
                  "- إقرار واتساب في هذا الاختبار مصطنع عند حدود الجسر فقط؛ لم يجر اختبار إرسال حي.",
                  "- لم ينفذ السكربت رفعاً أو دمجاً أو إصدار APK، ولا يمنح شهادة جاهزية إنتاجية.", "",
                  "تتضمن المخرجات سجل الاختبارات، أحداث كل دورة، حساباً متوقعاً مستقلاً، بصمات المصدر، ملفات PDF ونسخاً مصورة لكل صفحة.", ""])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "verification-output")
    parser.add_argument("--cycles", type=int, choices=range(1, 6), default=5,
                        help="Less than five is diagnostic only and never a passed full gate")
    parser.add_argument("--skip-unit", action="store_true", help="Diagnostic only")
    parser.add_argument("--chromium", type=Path, help="Optional existing Chromium executable")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env["QATFAH_VERIFICATION_OUTPUT"] = str(output)
    env["QATFAH_VERIFICATION_CYCLES"] = str(args.cycles)
    if args.chromium:
        env["QATFAH_CHROMIUM_EXECUTABLE"] = str(args.chromium.resolve())
    node = env.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required")
    report = {"schema": 1, "startedAt": now(), "requestedCycles": args.cycles,
              "commands": {}}
    # A clean Git checkout stores the original branding as encoded source assets.
    # Restore it before taking the snapshot, just as the APK build does. Both the
    # encoded inputs and the reconstructed images are then covered by the hashes.
    report["commands"]["branding"] = execute(
        "Restore source branding", [node, "scripts/restore-assets.mjs"], output, env)
    report["sourceBefore"] = source_manifest()
    save_json(output / "source-manifest.json", report["sourceBefore"])
    fixture_logos(output, args.cycles)
    if args.skip_unit:
        report["commands"]["unit"] = {"status": "NOT_RUN", "reason": "Diagnostic --skip-unit"}
    else:
        tests = [str(p) for p in sorted((ROOT / "tests").glob("*.test.mjs"))]
        report["commands"]["unit"] = execute("Unit and integration tests", [node, "--test", *tests], output, env)
    report["commands"]["build"] = execute("Build tested web sources", [node, "scripts/build-web.mjs"], output, env)
    report["commands"]["browser"] = execute("Chromium accounting cycles", [node, "scripts/system-verification.mjs"], output, env)
    browser_path = output / "browser-results.json"
    report["browser"] = json.loads(browser_path.read_text()) if browser_path.exists() else {"cycles": [], "errors": ["Browser report is missing"]}
    print("Inspecting and rendering every generated PDF page", flush=True)
    report["pdfChecks"] = inspect_pdfs(report["browser"], output)
    # Do not leave a green section in the human-readable table if the independent
    # PDF parser or renderer found a problem after the browser assertions passed.
    for check in report["pdfChecks"]:
        if check["status"] == "PASS":
            continue
        cycle = next((c for c in report["browser"].get("cycles", [])
                      if c["cycle"] == check["cycle"]), None)
        if cycle is None:
            continue
        affected = ["identity"]
        if check["kind"] in ["cashbook", "daily-sales", "yearly-report"]:
            affected.append("cash_reports")
        if check["kind"] in ["simple-journal", "transfer-source", "transfer-destination"]:
            affected.append("journals")
        for section in affected:
            cycle.setdefault("sections", {})[section] = {
                "status": "FAIL", "error": f"PDF {check['kind']}: {check.get('error', 'inspection failed')}"}
        cycle["status"] = "FAIL"
    report["sourceAfter"] = source_manifest()
    report["sourceUnchangedDuringRun"] = report["sourceBefore"] == report["sourceAfter"]
    report["requiredAutomationPassed"] = (
        args.cycles == 5 and not args.skip_unit and
        all(v["status"] == "PASS" for v in report["commands"].values()) and
        report["browser"].get("allAutomatedCyclesPassed") is True and
        len(report["pdfChecks"]) == 45 and all(x["status"] == "PASS" for x in report["pdfChecks"]) and
        report["sourceUnchangedDuringRun"]
    )
    report["liveWhatsappVerified"] = False
    report["productionReadinessCertified"] = False
    report["finishedAt"] = now()
    save_json(output / "verification-report.json", report)
    (output / "verification-report.md").write_text(markdown_report(report), encoding="utf-8")
    print(json.dumps({"requiredAutomationPassed": report["requiredAutomationPassed"],
                      "liveWhatsappVerified": False,
                      "pdfChecksPassed": sum(x["status"] == "PASS" for x in report["pdfChecks"]),
                      "report": str(output / "verification-report.json")}, indent=2), flush=True)
    if args.cycles < 5 or args.skip_unit:
        return 0 if report["commands"]["browser"]["status"] == "PASS" and all(x["status"] == "PASS" for x in report["pdfChecks"]) else 1
    return 0 if report["requiredAutomationPassed"] else 1


if __name__ == "__main__":
    sys.exit(main())
