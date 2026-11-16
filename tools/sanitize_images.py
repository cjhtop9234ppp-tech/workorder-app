"""작업지시서 그림을 외부 제공용으로 가공한다. 원본은 읽기만 하고 덮어쓰지 않는다.

가리는 것 (무조건):
  - 얼굴: OpenCV YuNet 얼굴 검출 + Haar 정면/측면 보조 검출
  - 차량번호판·업체명·숫자·글자: EasyOCR 로 글자 영역을 찾아 전부 모자이크
  - 사람 형상: HOG 사람 검출 영역 모자이크

원본 찾는 순서: 공유폴더 '6. 이미지검색…' 하위의 그림 → 없으면 app/img 의 이전 축소본.
결과는 SANITIZED_DIR 에 그림코드 이름(JPG)으로 저장한다. build_data.py 는 이 폴더만 읽는다.

사용법:  python tools/sanitize_images.py [시작] [끝]    (0부터, 생략하면 전부)
"""
import os
import re
import sys

# 이 파이썬에 깔린 opencv 5.0 은 얼굴·사람 검출 모듈이 빠져 있어서, 4.10 을 임시 폴더에 따로 쓴다.
# 설치:  pip install --target "%TEMP%\cv2lib" --no-deps opencv-python-headless==4.10.0.84
# 얼굴 모델 yunet.onnx 는 %TEMP%\yunet.onnx 에 둔다 (opencv_zoo: face_detection_yunet_2023mar.onnx)
CV2_LIB = os.path.join(os.environ.get("TEMP", ""), "cv2lib")
if os.path.isdir(CV2_LIB):
    sys.path.insert(0, CV2_LIB)

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

SANITIZED_DIR = os.environ.get("WORKORDER_SANITIZED_DIR", "")
SHARE_ROOT = os.environ.get("WORKORDER_SHARE_ROOT", "")
PREVIOUS_COPY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "img")
YUNET_MODEL = os.path.join(os.environ.get("TEMP", ""), "yunet.onnx")
MAX_SIDE = 1000


def used_codes():
    """작업지시서 매핑 시트에서 쓰는 그림코드 목록."""
    import openpyxl
    wb = openpyxl.load_workbook(os.path.join(os.path.expanduser("~"), "Desktop", "업로드 파일.xlsx"),
                                read_only=True, data_only=True)
    return sorted({str(r[0]).strip() for r in wb["매핑"].iter_rows(min_row=2, min_col=11, max_col=11, values_only=True)
                   if r[0] and str(r[0]).strip().startswith("USER")})


def source_index():
    """그림코드 -> 원본 파일 경로. 공유폴더 6.* 를 먼저, 없으면 이전 축소본을 쓴다."""
    index = {}
    if os.path.isdir(SHARE_ROOT):
        for top in sorted(os.listdir(SHARE_ROOT)):
            if not top.startswith("6."):
                continue
            for dp, _dn, fn in os.walk(os.path.join(SHARE_ROOT, top)):
                for f in fn:
                    code = os.path.splitext(f)[0]
                    if code.startswith("USER"):
                        index.setdefault(code, os.path.join(dp, f))
    if os.path.isdir(PREVIOUS_COPY):
        for f in os.listdir(PREVIOUS_COPY):
            index.setdefault(os.path.splitext(f)[0], os.path.join(PREVIOUS_COPY, f))
    return index


def load_rgb(path):
    """원본을 열어 흰 배경에 펴고 MAX_SIDE 이하로 줄인다 (RGB 배열)."""
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        base = Image.new("RGB", im.size, (255, 255, 255))
        base.paste(im, mask=im.split()[-1])
        im = base
    else:
        im = im.convert("RGB")
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    return np.array(im)


def mosaic(img, x0, y0, x1, y1, pad=0.15):
    """영역을 굵은 모자이크로 가린다. 셀 크기가 글자 높이보다 커서 읽을 수 없게 한다."""
    h, w = img.shape[:2]
    bw, bh = x1 - x0, y1 - y0
    x0, y0 = max(0, int(x0 - bw * pad)), max(0, int(y0 - bh * pad))
    x1, y1 = min(w, int(x1 + bw * pad)), min(h, int(y1 + bh * pad))
    if x1 <= x0 or y1 <= y0:
        return
    roi = img[y0:y1, x0:x1]
    cell = max(10, (y1 - y0) // 2)
    small = cv2.resize(roi, (max(1, (x1 - x0) // cell), max(1, (y1 - y0) // cell)), interpolation=cv2.INTER_LINEAR)
    img[y0:y1, x0:x1] = cv2.resize(small, (x1 - x0, y1 - y0), interpolation=cv2.INTER_NEAREST)


class Detectors:
    def __init__(self):
        base = cv2.data.haarcascades
        self.haar = [cv2.CascadeClassifier(os.path.join(base, n)) for n in
                     ("haarcascade_frontalface_default.xml", "haarcascade_profileface.xml")]
        self.hog = cv2.HOGDescriptor()
        self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        self.yunet = None
        if os.path.isfile(YUNET_MODEL):
            self.yunet = cv2.FaceDetectorYN.create(YUNET_MODEL, "", (320, 320), 0.3, 0.3, 5000)
        import easyocr
        self.reader = easyocr.Reader(["ko", "en"], gpu=False)


def ocr_boxes(reader, bgr, scale):
    """EasyOCR 글자 영역 (원본 크기 좌표). 1.0배와 확대본을 함께 본다."""
    h, w = bgr.shape[:2]
    big = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_CUBIC)
    boxes = []
    for box, text, _conf in reader.readtext(cv2.cvtColor(big, cv2.COLOR_BGR2RGB)):
        if not re.search(r"[0-9A-Za-z가-힣]", text):
            continue
        xs = [p[0] / scale for p in box]
        ys = [p[1] / scale for p in box]
        boxes.append((min(xs), min(ys), max(xs), max(ys)))
    return boxes


def sanitize(rgb, det):
    """RGB 배열을 받아 가공한 RGB 배열과 처리 내역을 돌려준다."""
    img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    counts = {"face": 0, "person": 0, "text": 0}

    faces = []
    if det.yunet is not None:
        det.yunet.setInputSize((img.shape[1], img.shape[0]))
        _, found = det.yunet.detect(img)
        for f in (found if found is not None else []):
            x, y, w, h = f[:4]
            faces.append((x, y, x + w, y + h))
    for cascade in det.haar:
        for (x, y, w, h) in cascade.detectMultiScale(gray, scaleFactor=1.05, minNeighbors=3, minSize=(20, 20)):
            faces.append((x, y, x + w, y + h))
    for (x0, y0, x1, y1) in faces:
        mosaic(img, x0, y0, x1, y1, pad=0.35)
        counts["face"] += 1

    people, _ = det.hog.detectMultiScale(img, winStride=(8, 8), padding=(8, 8), scale=1.05)
    for (x, y, w, h) in people:
        mosaic(img, x, y, x + w, y + h, pad=0.02)
        counts["person"] += 1

    for (x0, y0, x1, y1) in ocr_boxes(det.reader, img, 1.0) + ocr_boxes(det.reader, img, 1.6):
        mosaic(img, x0, y0, x1, y1, pad=0.2)
        counts["text"] += 1

    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB), counts


def main():
    os.makedirs(SANITIZED_DIR, exist_ok=True)
    index = source_index()
    codes = used_codes()
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    end = int(sys.argv[2]) if len(sys.argv) > 2 else len(codes)
    codes = codes[start:end]

    det = Detectors()
    total = {"face": 0, "person": 0, "text": 0}
    done, skipped = 0, []
    for code in codes:
        src = index.get(code)
        if src is None:
            skipped.append(code)
            continue
        out, counts = sanitize(load_rgb(src), det)
        os.makedirs(SANITIZED_DIR, exist_ok=True)
        Image.fromarray(out).save(os.path.join(SANITIZED_DIR, f"{code}.jpg"), "JPEG", quality=82, optimize=True)
        for k in total:
            total[k] += counts[k]
        done += 1
        if done % 20 == 0:
            print(f"{done}장 완료", flush=True)
    print(f"완료 {done}장 · 얼굴 {total['face']} · 사람 {total['person']} · 글자 {total['text']}")
    if skipped:
        print("원본 없음(가공 안 됨):", ", ".join(skipped))


if __name__ == "__main__":
    main()
