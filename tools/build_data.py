"""작업지시서 원본 엑셀 4개를 읽어 app/data.js 로 변환한다.

사용법:
    python tools/build_data.py "<엑셀 폴더>"
엑셀 폴더를 생략하면 바탕화면을 사용한다.
"""
import glob
import json
import os
import sys
from collections import defaultdict

import shutil

import openpyxl
from PIL import Image

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(PROJECT, "app", "data.js")
IMG_OUT = os.path.join(PROJECT, "app", "img")


def find_excel(folder, prefix):
    hits = [p for p in glob.glob(os.path.join(folder, prefix + "*.xlsx"))
            if not os.path.basename(p).startswith("~$")]
    if len(hits) != 1:
        raise SystemExit(f"'{prefix}' 파일을 찾지 못했거나 여러 개입니다: {hits}")
    return hits[0]


def read_sample(ws, cols, first_row=4):
    """샘플 한 블록(파트, 순번, 주작업항목, 작업구분 좌/우, 도장구분 좌/우)을 읽는다."""
    part_i, _no_i, item_i, wl_i, wr_i, pl_i, pr_i = cols
    # 가운데맞춤(병합) 여부 판단용 병합 범위
    center_work, center_paint = set(), set()
    for rng in ws.merged_cells.ranges:
        if rng.min_col == wl_i + 1 and rng.max_col == wr_i + 1:
            center_work.update(range(rng.min_row, rng.max_row + 1))
        if rng.min_col == pl_i + 1 and rng.max_col == pr_i + 1:
            center_paint.update(range(rng.min_row, rng.max_row + 1))

    items, part = [], None
    for row_no in range(first_row, ws.max_row + 1):
        vals = [ws.cell(row=row_no, column=c + 1).value for c in range(len(cols) + 0)]
        p = ws.cell(row=row_no, column=part_i + 1).value
        if p:
            part = " ".join(str(p).split())
        name = ws.cell(row=row_no, column=item_i + 1).value
        if not name:
            continue
        items.append({
            "part": part,
            "item": str(name).strip(),
            "centerWork": row_no in center_work,
            "centerPaint": row_no in center_paint,
        })
    return items


# 사용자 지시: 이 주작업항목은 모든 차량에서 제외한다 (샘플의 실제 표기대로 적음).
EXCLUDED_ITEMS = {"프런트패널(볼트식)(좌, 우)"}


def vehicle_category(group, name):
    """4번 파일의 그룹명(C열)을 화면의 구분값으로 바꾼다."""
    if group == "승용":
        return "승용"
    if group == "RV1":
        return "RV1"
    if group in ("RV2", "승합"):
        return "RV2"
    if group == "화물":
        # 사용자 지시: 화물1 = 포터, 화물2 = 봉고. 나머지 화물 차종은 화물1로 둔다.
        return "화물2" if "봉고" in name else "화물1"
    return group


# 업로드 파일.xlsx 의 '매핑' 시트 구분값 -> 착안점 묶음 키 ("1" 승용계, "2" 화물계)
REPAIR_GROUP = {"1. 승용, RV1, RV2": "1", "2. 화물1, 화물2": "2"}
DEFAULT_EXCEL_FOLDER = os.environ.get("WORKORDER_EXCEL_DIR", "")   # 1~5번 원본 엑셀 폴더 (또는 인자로 지정)
DEFAULT_REPAIR_XLSX = os.environ.get("WORKORDER_REPAIR_XLSX", "")   # 매핑·작업지시서 시트 (또는 인자로 지정)
# 그림코드(USER…) 파일 폴더. 앞에 있는 폴더를 먼저 찾고, 없으면 뒤의 폴더를 찾는다.
DEFAULT_IMAGE_DIRS = [os.environ["WORKORDER_IMAGE_DIR"]] if os.environ.get("WORKORDER_IMAGE_DIR") else []   # 그림코드(USER...) 파일 폴더


def read_no_maps(ws):
    """작업지시서 시트의 순번 -> 주작업항목 (구분별). 매핑 시트의 NO는 이 순번이다."""
    maps = {"1": {}, "2": {}}
    for r in ws.iter_rows(min_row=3, values_only=True):
        if isinstance(r[1], (int, float)) and r[2]:
            maps["1"][int(r[1])] = str(r[2]).strip()
        if isinstance(r[10], (int, float)) and r[11]:
            maps["2"][int(r[10])] = str(r[11]).strip()
    return maps


def parse_no(value):
    """NO 칸: 숫자, '1,34' 같은 목록은 번호 목록으로, x/ㅁ 같은 표시는 빈 목록으로 본다."""
    if isinstance(value, (int, float)):
        return [int(value)]
    if not value:
        return []
    return [int(p) for p in str(value).replace(" ", "").split(",") if p.isdigit()]


def index_images(image_dirs):
    """그림코드(파일 이름) -> 파일 경로. 앞 폴더가 우선이고, 같은 폴더 안에서는 JPG를 쓴다."""
    index = {}
    for folder in image_dirs:
        if not os.path.isdir(folder):
            continue
        for f in sorted(os.listdir(folder), key=lambda f: os.path.splitext(f)[1].lower() != ".jpg"):
            code = os.path.splitext(f)[0]
            index.setdefault(code, os.path.join(folder, f))
    return index


def save_web_image(src, code):
    """그림을 가볍게 줄여 app/img 에 JPG로 저장한다 (바탕화면 원본은 약 950MB라 그대로 쓸 수 없다)."""
    img = Image.open(src)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        base = Image.new("RGB", img.size, (255, 255, 255))
        base.paste(img, mask=img.split()[-1])
        img = base
    else:
        img = img.convert("RGB")
    img.thumbnail((1000, 1000))
    name = f"{code}.jpg"
    img.save(os.path.join(IMG_OUT, name), "JPEG", quality=78, optimize=True)
    return "img/" + name


def read_repair_items(repair_xlsx, image_dirs):
    """업로드 파일.xlsx 의 매핑 시트를 주작업항목별 착안점 목록(작업내역 + 그림)으로 바꾼다."""
    wb = openpyxl.load_workbook(repair_xlsx, data_only=True)
    no_maps = read_no_maps(wb["작업지시서"])
    images = index_images(image_dirs)

    shutil.rmtree(IMG_OUT, ignore_errors=True)
    os.makedirs(IMG_OUT, exist_ok=True)

    repair = {"1": defaultdict(list), "2": defaultdict(list)}
    image_of = {}      # 그림코드 -> 웹 경로 또는 None (같은 그림은 한 번만 변환)
    stat = {"rows": 0, "placed": 0, "unplaced": 0, "conflict": 0}
    for r in wb["매핑"].iter_rows(min_row=2, max_col=11, values_only=True):
        text = str(r[5]).strip() if r[5] else ""
        if not text:
            continue
        stat["rows"] += 1
        group = REPAIR_GROUP.get(str(r[1]).strip()) if r[1] else None
        item = str(r[3]).strip() if r[3] else None
        nos = parse_no(r[4])

        if group and item:
            targets = [(group, item)]
            # 순번과 주작업항목 이름이 어긋나는 행은 이름을 따르고 개수만 센다
            if any(no_maps[group].get(n) not in (None, item) for n in nos):
                stat["conflict"] += 1
        else:
            # 구분이 비어 있는 행은 승용계 순번으로 본다 (사용자 규칙: NO = 구분별 작업지시서 순번)
            g = group or "1"
            targets = [(g, no_maps[g][n]) for n in nos if n in no_maps[g]]

        if not targets:
            stat["unplaced"] += 1
            continue
        stat["placed"] += 1

        code = str(r[10]).strip() if r[10] else ""
        if code not in image_of:
            src = images.get(code) if code else None
            image_of[code] = save_web_image(src, code) if src else None
        for g, name in targets:
            repair[g][name].append({"text": text, "image": image_of[code]})

    print(f"착안점 매핑 {stat['rows']}행: 주작업항목에 배치 {stat['placed']}행, 배치 못함 {stat['unplaced']}행, "
          f"순번·이름 불일치 {stat['conflict']}행")
    print(f"그림 {sum(1 for v in image_of.values() if v)}개 변환, 그림 파일 없음 {sum(1 for v in image_of.values() if not v)}개")
    return {g: {k: v for k, v in d.items()} for g, d in repair.items()}


def encode_names(by_vehicle):
    """{차명: {작업항목, ...}} -> {"names": [작업항목...], "by": {차명: [번호...]}}"""
    names = sorted({x for v in by_vehicle.values() for x in v})
    index = {n: i for i, n in enumerate(names)}
    return {"names": names, "by": {k: [index[x] for x in sorted(v)] for k, v in by_vehicle.items()}}


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_EXCEL_FOLDER
    repair_xlsx = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_REPAIR_XLSX
    image_dirs = [sys.argv[3]] if len(sys.argv) > 3 else DEFAULT_IMAGE_DIRS

    # 1번: 작업지시서 샘플 (왼쪽 = 승용/RV1/RV2, 오른쪽 = 화물)
    wb1 = openpyxl.load_workbook(find_excel(folder, "1. "), data_only=True)
    ws1 = wb1.worksheets[0]
    sample_left = [r for r in read_sample(ws1, (0, 1, 2, 3, 4, 5, 6)) if r["item"] not in EXCLUDED_ITEMS]
    sample_right = [r for r in read_sample(ws1, (9, 10, 11, 12, 13, 14, 15)) if r["item"] not in EXCLUDED_ITEMS]

    # 2번: 작업항목 그룹 (C열 그룹명, D열 작업항목)
    wb2 = openpyxl.load_workbook(find_excel(folder, "2. "), data_only=True)
    groups = []      # [C열 그룹명, D열 작업항목] (동의어 묶음·도장 판단용)
    group_rows = []  # [B열 그룹NO, C열, D열] (작업항목 그룹 NO 기준 묶음용)
    for r in wb2.worksheets[0].iter_rows(min_row=2, values_only=True):
        if r[2] and r[3]:
            groups.append([str(r[2]).strip(), str(r[3]).strip()])
            if r[1] is not None:
                no = int(r[1]) if isinstance(r[1], (int, float)) else str(r[1]).strip()
                group_rows.append([no, str(r[2]).strip(), str(r[3]).strip()])

    # 3번: 결과도출리스트 DB의 '전체' 시트 (C열 차명, K열 작업항목)
    # 자동 필터로 숨긴 행(파트명 필터에서 빠진 도장·사용자공임·방청 등)은 제외하고, 화면에 보이는 행만 쓴다
    wb3 = openpyxl.load_workbook(find_excel(folder, "3. "), data_only=True)
    ws3 = wb3["전체"]
    work_items = defaultdict(set)
    for row_no, r in enumerate(ws3.iter_rows(min_row=3, values_only=True), start=3):
        if ws3.row_dimensions[row_no].hidden:
            continue
        if r[2] and r[10]:
            work_items[str(r[2]).strip()].add(str(r[10]).strip())

    # 5번: 비교분석 도장DB의 '비교분석 도장DB' 시트 (D열 차명, E열 작업항목1)
    #      -> 도장구분을 누를 수 있는 작업항목(도장 적용 가능 목록)
    wb5 = openpyxl.load_workbook(find_excel(folder, "5. "), read_only=True, data_only=True)
    ws5 = wb5["비교분석 도장DB"]
    paint_items = defaultdict(set)
    for r in ws5.iter_rows(min_row=3, values_only=True):
        if r[3] and r[4]:
            paint_items[str(r[3]).strip()].add(str(r[4]).strip())

    # 4번: 차량명 정의 (B열 차량명, C열 그룹명, E열 차량급, F열 제작사, I열 작업항목수)
    wb4 = openpyxl.load_workbook(find_excel(folder, "4. "), data_only=True)
    vehicles, seen = [], set()
    for r in wb4.worksheets[0].iter_rows(min_row=2, values_only=True):
        if not r[1] or not r[2]:
            continue
        name = str(r[1]).strip()
        if name in seen:
            continue
        seen.add(name)
        vehicles.append({
            "name": name,
            "group": str(r[2]).strip(),
            "category": vehicle_category(str(r[2]).strip(), name),
            "cls": str(r[4]).strip() if r[4] else "",
            "maker": str(r[5]).strip() if r[5] else "",
            "count": int(r[8]) if isinstance(r[8], (int, float)) else 0,
        })

    repair_items = read_repair_items(repair_xlsx, image_dirs)

    unmatched = [v["name"] for v in vehicles if v["name"] not in work_items and v["name"] not in paint_items]
    data = {
        "sampleLeft": sample_left,
        "sampleRight": sample_right,
        "groups": groups,
        "groupRows": group_rows,
        "vehicles": vehicles,
        # 작업항목 이름은 한 번만 적고 차량별로 번호만 담는다 (파일이 작아져 화면이 빨리 열린다)
        "vehicleItems": encode_names(work_items),
        "paintItems": {k: sorted(v) for k, v in paint_items.items()},
        "repairItems": repair_items,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # 샘플 나열 순서 (보기순서 기본값에 쓴다)
    sample_order = {"left": list(dict.fromkeys(r["item"] for r in sample_left)),
                    "right": list(dict.fromkeys(r["item"] for r in sample_right))}
    with open(os.path.join(PROJECT, "app", "sample-order.js"), "w", encoding="utf-8") as f:
        f.write("window.SAMPLE_ORDER = " + json.dumps(sample_order, ensure_ascii=False) + ";\n")
    # 파일을 더블클릭만 해도 열리도록 JSON 대신 JS 변수로 저장한다.
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.WORK_DATA = ")
        json.dump(data, f, ensure_ascii=False)
        f.write(";\n")

    print(f"샘플 왼쪽 {len(sample_left)}행 / 오른쪽 {len(sample_right)}행")
    print(f"작업항목 그룹 {len(groups)}행, 차량 {len(vehicles)}대, DB 차명 {len(work_items)}개")
    print(f"도장DB 차명 {len(paint_items)}개, 두 DB 모두 없는 차량 {len(unmatched)}대")
    print("저장:", OUT)


if __name__ == "__main__":
    main()
