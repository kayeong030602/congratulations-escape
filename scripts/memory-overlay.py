"""
(11/19 추가) 옛 녹화 글씨 그림 만들기 — scripts/build-assets.ts의 'memory' 줄이 불러요.

장면마다 640×480 투명 PNG 하나.
(11/19 2차 변경, 사용자 의견) 가운데에 크게 → 캠코더 날짜 도장 자리로:
  - 3글자 메모(O U R): 왼쪽 아래 구석
  - "2024. 07 -" + 색깔 동그라미: 오른쪽 아래(캠코더가 날짜를 찍는 자리)
  - 색깔 표시는 손바닥 그림 → 속까지 채운 동그라미(손바닥은 너무 대놓고라서)
  - 위쪽은 비워 둬요(화면 위 안내 문구와 겹치지 않게). 맨 아래는 녹화 화면의 줌 막대·12:00 자리라 그보다 조금 위에
캠코더 날짜 도장처럼 흰 글씨 + 검은 그림자(VCR OSD Mono).

사용법: python -I memory-overlay.py <결과 폴더> <글꼴.ttf> <안 씀(예전 손바닥 그림)> '<장면 JSON>'
"""
import json
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 640, 480
MARGIN = 38  # 화면 가장자리에서
BASE = 398   # 글씨 아래쪽 줄(맨 아래 줌 막대·12:00 자리보다 위)


def hex_rgb(c):
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def stamp(draw, xy, text, font):
    """흰 글씨 + 오른쪽 아래로 2px 검은 그림자(캠코더 날짜 도장)."""
    x, y = xy
    for dx, dy in ((2, 2), (1, 2), (2, 1)):
        draw.text((x + dx, y + dy), text, font=font, fill=(0, 0, 0, 200))
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 255))


def main():
    out, font_path, _hand, shots = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4])
    memo_font = ImageFont.truetype(font_path, 34)
    date_font = ImageFont.truetype(font_path, 28)

    for i, s in enumerate(shots):
        img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)

        # 왼쪽 아래 구석: 메모
        memo = ' '.join(s['memo'])  # O U R
        mb = d.textbbox((0, 0), memo, font=memo_font)
        stamp(d, (MARGIN, BASE - mb[3]), memo, memo_font)

        # 오른쪽 아래: 날짜 + 색깔 동그라미(오른쪽 끝을 화면 가장자리에 맞춰요)
        date = s['date']
        db = d.textbbox((0, 0), date, font=date_font)
        r = 12
        gap = 10
        right = W - MARGIN
        cx = right - r
        x0 = cx - r - gap - (db[2] - db[0])
        ty = BASE - db[3]
        stamp(d, (x0, ty), date, date_font)
        cy = ty + (db[1] + db[3]) / 2
        # 그림자 → 얇은 흰 테두리 → 색(바쁜 배경에서도 색이 또렷하게)
        d.ellipse((cx - r + 2, cy - r + 2, cx + r + 2, cy + r + 2), fill=(0, 0, 0, 190))
        d.ellipse((cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2), fill=(255, 255, 255, 255))
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=hex_rgb(s['color']) + (255,))
        img.save(f'{out}/{i}.png')


if __name__ == '__main__':
    main()
