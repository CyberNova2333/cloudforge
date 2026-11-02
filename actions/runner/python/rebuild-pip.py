# Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
"""Rebuild a pinned pip wheel with a pinned, still self-contained urllib3.

Only Python's standard library and git are required. Inputs are verified before
extraction; no package resolution or network access happens in this program.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile


HERE = Path(__file__).resolve().parent
LOCK = json.loads((HERE / "sources.json").read_text(encoding="utf-8"))
CUSTOM_VERSION = LOCK["pip"]["custom_version"]


def verify(path: Path, expected: str) -> None:
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise ValueError(f"SHA256 mismatch: {path.name}")


def extract_wheel(path: Path, destination: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            relative = PurePosixPath(info.filename)
            if (
                relative.is_absolute()
                or ".." in relative.parts
                or "\\" in info.filename
                or stat.S_ISLNK(info.external_attr >> 16)
            ):
                raise ValueError(f"Unsafe wheel member: {info.filename}")
        archive.extractall(destination)


def rewrite_imports(directory: Path) -> None:
    # These three transformations follow vendoring 1.4.0's
    # tasks/vendor.py:rewrite_file_imports (MIT; see vendoring-LICENSE).
    # Apply pip's patches first: they eliminate dotted imports without aliases.
    for path in sorted(directory.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        text = re.sub(
            r"^(\s*)import urllib3(\s|$)",
            r"\1from pip._vendor import urllib3\2",
            text,
            flags=re.MULTILINE,
        )
        text = re.sub(
            r"^(\s*)import urllib3(\.\S+)(?=\s+as)",
            r"\1import pip._vendor.urllib3\2",
            text,
            flags=re.MULTILINE,
        )
        if re.search(r"^\s*import urllib3\.\S+", text, flags=re.MULTILINE):
            raise ValueError(f"Unrewritable urllib3 import in {path.name}")
        text = re.sub(
            r"^(\s*)from urllib3(\.|\s)",
            r"\1from pip._vendor.urllib3\2",
            text,
            flags=re.MULTILINE,
        )
        path.write_text(text, encoding="utf-8", newline="\n")


def replace_references(value: object, old: str, new: str) -> object:
    if isinstance(value, dict):
        return {key: replace_references(item, old, new) for key, item in value.items()}
    if isinstance(value, list):
        return [replace_references(item, old, new) for item in value]
    return new if value == old else value


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")


def update_metadata(root: Path) -> None:
    vendor = root / "pip" / "_vendor"
    old = LOCK["urllib3"]["previous_version"]
    new = LOCK["urllib3"]["version"]
    requirements = vendor / "vendor.txt"
    content = requirements.read_text(encoding="utf-8")
    previous = f"urllib3=={old}"
    if [line.strip() for line in content.splitlines()].count(previous) != 1:
        raise ValueError("Unexpected upstream urllib3 pin")
    requirements.write_text(content.replace(previous, f"urllib3=={new}"), encoding="utf-8", newline="\n")

    bom_path = vendor / "bom.cdx.json"
    bom = json.loads(bom_path.read_text(encoding="utf-8"))
    components = [item for item in bom["components"] if item["name"] == "urllib3"]
    if len(components) != 1 or components[0]["version"] != old:
        raise ValueError("Unexpected upstream urllib3 SBOM component")
    components[0]["version"] = new
    bom = replace_references(bom, f"pkg:pypi/urllib3@{old}", f"pkg:pypi/urllib3@{new}")
    for component in bom["components"]:
        if component["name"] == "pip":
            component["version"] = CUSTOM_VERSION
    bom["metadata"]["component"]["version"] = CUSTOM_VERSION
    bom["metadata"]["tools"].append({"name": "cloudforge-pip-vendor", "version": "1"})
    bom["version"] += 1
    write_json(bom_path, bom)

    init = root / "pip" / "__init__.py"
    content = init.read_text(encoding="utf-8")
    previous = f'__version__ = "{LOCK["pip"]["version"]}"'
    if content.count(previous) != 1:
        raise ValueError("Unexpected upstream pip version")
    init.write_text(content.replace(previous, f'__version__ = "{CUSTOM_VERSION}"'), encoding="utf-8", newline="\n")
    info = root / f'pip-{LOCK["pip"]["version"]}.dist-info'
    metadata = info / "METADATA"
    content = metadata.read_text(encoding="utf-8")
    previous = f'\nVersion: {LOCK["pip"]["version"]}\n'
    if content.count(previous) != 1:
        raise ValueError("Unexpected upstream pip package version")
    metadata.write_text(content.replace(previous, f"\nVersion: {CUSTOM_VERSION}\n"), encoding="utf-8", newline="\n")
    info.rename(root / f"pip-{CUSTOM_VERSION}.dist-info")

    (vendor / "README.rst").write_text(
        (vendor / "README.rst").read_text(encoding="utf-8")
        + "\n\nCloudForge downstream build\n==========================\n"
        + f"This pip {CUSTOM_VERSION} wheel replaces urllib3 {old} with the released "
        + f"urllib3 {new} wheel. The official pip urllib3 vendoring patches and "
        + "namespace transformations are retained. Other vendored components are unchanged.\n"
        + "Sources, SHA256 values and original patches are included in "
        + "cloudforge-vendor.json and tools/vendoring/patches/. The original MIT "
        + "licenses accompany urllib3 and the import transformations.\n",
        encoding="utf-8",
        newline="\n",
    )
    patch_dir = vendor / "tools" / "vendoring" / "patches"
    patch_dir.mkdir(parents=True)
    for patch in LOCK["patches"]:
        shutil.copyfile(HERE / "upstream-patches" / patch["filename"], patch_dir / patch["filename"])
    shutil.copyfile(HERE / "vendoring-LICENSE", vendor / "vendoring-LICENSE")
    write_json(vendor / "cloudforge-vendor.json", LOCK)


def pack_wheel(root: Path, output: Path) -> Path:
    record_path = f"pip-{CUSTOM_VERSION}.dist-info/RECORD"
    record = io.StringIO(newline="")
    writer = csv.writer(record, lineterminator="\n")
    files: dict[str, bytes] = {}
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        if not path.is_file():
            continue
        name = path.relative_to(root).as_posix()
        if name == record_path:
            continue
        value = path.read_bytes()
        digest = base64.urlsafe_b64encode(hashlib.sha256(value).digest()).rstrip(b"=").decode()
        writer.writerow((name, f"sha256={digest}", len(value)))
        files[name] = value
    writer.writerow((record_path, "", ""))
    files[record_path] = record.getvalue().encode()
    output.mkdir(parents=True, exist_ok=True)
    target = output / f"pip-{CUSTOM_VERSION}-py3-none-any.whl"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, value in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, value)
    return target


def rebuild(inputs: Path, output: Path) -> Path:
    for name in ("pip", "urllib3"):
        verify(inputs / LOCK[name]["filename"], LOCK[name]["sha256"])
    for patch in LOCK["patches"]:
        verify(HERE / "upstream-patches" / patch["filename"], patch["sha256"])
    with tempfile.TemporaryDirectory(prefix="cloudforge-pip-") as temporary:
        workspace = Path(temporary)
        root = workspace / "src"
        extract_wheel(inputs / LOCK["pip"]["filename"], root)
        replacement = workspace / "urllib3-wheel"
        extract_wheel(inputs / LOCK["urllib3"]["filename"], replacement)
        vendor = root / "pip" / "_vendor" / "urllib3"
        shutil.rmtree(vendor)
        shutil.copytree(replacement / "urllib3", vendor)
        license_path = replacement / f'urllib3-{LOCK["urllib3"]["version"]}.dist-info' / "licenses" / "LICENSE.txt"
        shutil.copyfile(license_path, vendor / "LICENSE.txt")
        shutil.copyfile(
            license_path,
            root / f'pip-{LOCK["pip"]["version"]}.dist-info' / "licenses" / "src" / "pip" / "_vendor" / "urllib3" / "LICENSE.txt",
        )
        for patch in LOCK["patches"]:
            subprocess.run(
                ["git", "apply", "--whitespace=error", str(HERE / "upstream-patches" / patch["filename"])],
                cwd=workspace,
                check=True,
            )
        rewrite_imports(vendor)
        update_metadata(root)
        return pack_wheel(root, output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = rebuild(args.inputs.resolve(), args.output.resolve())
    print(f"Built {result.name} sha256={hashlib.sha256(result.read_bytes()).hexdigest()}")
