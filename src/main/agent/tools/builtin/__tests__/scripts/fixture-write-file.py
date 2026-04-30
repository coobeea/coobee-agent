#!/usr/bin/env python3
"""
exec 工具测试 fixture：接收参数，创建文件并写入一段文字。

用法：
    python3 fixture-write-file.py --output <path> --message <text>
    python3 fixture-write-file.py -o <path> -m <text>

行为：
- 若目标文件的父目录不存在，自动创建（parents=True, exist_ok=True）。
- 将 message 写入目标文件（UTF-8，覆盖写）。
- 固定在当前工作目录下额外创建一个 auto-note.txt，写入一段固定话术，
  用于验证脚本相对 cwd 的写入能力（不依赖命令行参数）。
- 向 stdout 打印 "WROTE <abs_path> (<bytes> bytes)" 和
  "EXTRA <abs_path> (<bytes> bytes)" 两行，便于测试断言。
- 参数缺失或写入失败时，exit code 非 0，错误信息写到 stderr。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# 附加文件：不走命令行参数，脚本直接在 cwd 下创建，用于验证 exec 工具的 cwd 契约。
EXTRA_FILENAME = "auto-note.txt"
EXTRA_MESSAGE = "This note is created automatically by fixture-write-file.py"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="fixture-write-file",
        description="Create a file and write a message into it.",
    )
    parser.add_argument(
        "-o",
        "--output",
        required=True,
        help="Target file path (absolute or relative to cwd).",
    )
    parser.add_argument(
        "-m",
        "--message",
        required=True,
        help="Text content to write into the target file.",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        help="Append instead of overwrite (default: overwrite).",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    target = Path(args.output).expanduser().resolve()
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if args.append else "w"
        with target.open(mode, encoding="utf-8") as f:
            f.write(args.message)
    except OSError as exc:
        print(f"ERROR: failed to write {target}: {exc}", file=sys.stderr)
        return 1

    size = target.stat().st_size
    print(f"WROTE {target} ({size} bytes)")

    # 额外文件：相对 cwd 创建，不接收任何参数，固定内容。
    extra = Path(EXTRA_FILENAME).resolve()
    try:
        extra.write_text(EXTRA_MESSAGE, encoding="utf-8")
    except OSError as exc:
        print(f"ERROR: failed to write {extra}: {exc}", file=sys.stderr)
        return 1
    extra_size = extra.stat().st_size
    print(f"EXTRA {extra} ({extra_size} bytes)")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
