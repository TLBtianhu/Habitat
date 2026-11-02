"""把 Habitat 运行时发布到魔搭数据集（唯一正源）。

    python tools/publish-runtime.py --check
    python tools/publish-runtime.py runtime/manifest.json artifacts/habitat-runtime-minimal.tar.gz

需要：MODELSCOPE_API_TOKEN，以及数据集 TLBtianhu/Habitat-Dist 已创建并设为公开。
"""
from __future__ import annotations

import argparse
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

DATASET = "TLBtianhu/Habitat-Dist"
REPO_TYPE = "dataset"
PUBLIC_BASE = f"https://www.modelscope.cn/datasets/{DATASET}/resolve/master/"


def token() -> str:
    for path in (os.environ.get("MODELSCOPE_API_TOKEN"),):
        if path:
            return path
    for file in ("/etc/habitat/modelscope.token", "C:/MediaForge/.dev-data/dev.env"):
        if os.path.exists(file):
            text = Path(file).read_text(encoding="utf-8")
            if file.endswith(".env"):
                for line in text.splitlines():
                    if line.startswith("MODELSCOPE_API_TOKEN="):
                        value = line.split("=", 1)[1].strip()
                        if value and value != "PASTE_TOKEN_HERE":
                            return value
            else:
                return text.strip()
    raise RuntimeError("未配置 MODELSCOPE_API_TOKEN；先创建 Habitat-Dist 数据集并配置令牌")


def head_matches(remote: str, expected: int) -> bool:
    url = PUBLIC_BASE + remote
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Habitat/0.2"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            return int(resp.headers.get("Content-Length") or 0) == expected
    except urllib.error.HTTPError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", type=Path)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--remote-prefix", default="runtime/")
    args = parser.parse_args()

    if args.check:
        try:
            token()
            print("令牌已配置")
            return 0
        except RuntimeError as exc:
            print(f"未就绪: {exc}")
            return 1

    if not args.files:
        parser.error("没有指定要上传的文件")

    try:
        sdk_path = os.environ.get("MODELSCOPE_SDK_PATH") or "C:/MediaForge/.dev-data/tools/modelscope-sdk"
        if os.path.isdir(sdk_path):
            sys.path.insert(0, sdk_path)
        from modelscope.hub.api import HubApi
    except ImportError:
        print("缺少 modelscope SDK；请设置 MODELSCOPE_SDK_PATH 或安装 modelscope")
        return 1

    api = HubApi()
    api.login(token())
    failures = 0
    for path in args.files:
        if not path.is_file():
            print(f"[skip] {path} 不存在")
            failures += 1
            continue
        remote = args.remote_prefix + path.name
        print(f"[upload] {path.name} -> {DATASET}/{remote}")
        try:
            api.upload_file(path_or_fileobj=str(path.resolve()), path_in_repo=remote, repo_id=DATASET, token=token(), repo_type=REPO_TYPE)
        except Exception as exc:
            print(f"  FAILED: {type(exc).__name__}: {exc}")
            failures += 1
            continue
        if not head_matches(remote, path.stat().st_size):
            failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
