#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ass_ruby_fix.py
Subtitle Edit 등으로 변환된 ASS 파일의 <ruby>/<rt> 태그를 ASS 태그로 치환.

<ruby>, </ruby> 태그는 제거하고 <rt> 태그만 감지해 ruby 텍스트를 ASS 크기 태그로 변환한다.
닫는 </ruby>가 누락된 비정상 마크업도 처리할 수 있다.

사용법:
    python3 ass_ruby_fix.py input.ass -o output.ass
    ffmpeg -i video.mp4 -vf "subtitles=output.ass" -c:v libx264 -crf 18 -c:a copy out.mp4
"""

import re
import argparse
from pathlib import Path


def fix_ass_line(line):
    """Dialogue 라인의 텍스트 내 <rt> 태그를 ASS 태그로 치환.

    <ruby>, </ruby> 태그는 제거하고 <rt>~</rt> 구간만 ASS 크기 태그로 변환한다.
    """
    if not line.startswith('Dialogue:'):
        return line

    # ASS Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    # 쉼표 9개로 분리 → 10개 필드. 마지막이 텍스트.
    parts = line.split(',', 9)
    if len(parts) < 10:
        return line

    prefix = ','.join(parts[:9]) + ','
    text = parts[9]

    # <ruby>, </ruby> 태그는 아무 의미 없이 제거
    new_text = re.sub(r'</?ruby>', '', text, flags=re.IGNORECASE)

    # <rt>ruby_text</rt> → {\fscx50}{\fscy50}ruby_text{\fscx100}{\fscy100}
    new_text = re.sub(
        r'<rt>(.*?)</rt>',
        r'{\\fscx50}{\\fscy50}\1{\\fscx100}{\\fscy100}',
        new_text,
        flags=re.IGNORECASE | re.DOTALL
    )

    if new_text == text:
        return line

    return prefix + new_text


def main():
    parser = argparse.ArgumentParser(
        description="ASS 파일의 <ruby>/<rt> 태그를 ASS 태그로 치환"
    )
    parser.add_argument("input", help="입력 ASS 파일")
    parser.add_argument(
        "-o", "--output",
        help="출력 ASS 파일 (기본: input_fixed.ass)"
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = (
        Path(args.output)
        if args.output
        else input_path.with_stem(input_path.stem + "_fixed")
    )

    content = input_path.read_text(encoding="utf-8")
    lines = content.splitlines()

    new_lines = []
    changed = 0
    for line in lines:
        new_line = fix_ass_line(line)
        if new_line != line:
            changed += 1
        new_lines.append(new_line)

    output_path.write_text("\n".join(new_lines), encoding="utf-8")
    print(f"처리 완료: {changed}개 라인 변경 → {output_path}")


if __name__ == "__main__":
    main()
