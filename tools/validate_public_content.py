#!/usr/bin/env python3
"""Validate OpenTurbine public content before and after the Jekyll build."""
from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
PUBLIC_ORIGIN = "https://elia179.github.io/OpenTurbine-ESP32-Gas-Turbine-ECU/"
PUBLIC_PAGES = [
    "index.md", "get-started.md", "hardware.md", "user-guide.md", "troubleshooting.md",
    "safety.md", "faq.md", "developers.md", "about.md", "404.html",
]
PUBLIC_ROUTES = [
    "index.html", "get-started/index.html", "hardware/index.html", "user-guide/index.html",
    "troubleshooting/index.html", "safety/index.html", "faq/index.html", "developers/index.html",
    "about/index.html", "404.html",
]
MARKDOWN_SOURCES = [
    ROOT / "README.md",
    ROOT / "docs/README.md",
    ROOT / "docs/USER_GUIDE.md",
    ROOT / "docs/V2_MIGRATION.md",
    ROOT / "docs/SETUP_TOOL.md",
    ROOT / "docs/OTC_CLUSTER_PROTOCOL.md",
    ROOT / "docs/BETA_USER_GUIDE.md",
    ROOT / "docs/WINDOWS_FLASHER_INSTALL.md",
    ROOT / "examples/README.md",
    ROOT / "examples/cluster/README.md",
    ROOT / "pcb_profiles/README.md",
]
CURRENT_GUIDANCE_SOURCES = [
    *MARKDOWN_SOURCES,
    ROOT / "hardware_profile.h",
    ROOT / "examples/OTCClusterClient.h",
]
REQUIRED_IMAGES = [
    "hero-dashboard.png", "hardware-page.png", "controllers-page.png", "system-page.png",
    "calibration-page.png", "sequence-page.png", "tools-page.png",
    "social-preview.png", "system-overview.svg",
]


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.titles: list[str] = []
        self.descriptions: list[str] = []
        self.canonicals: list[str] = []
        self.robots: list[str] = []
        self.links: list[str] = []
        self.images: list[str] = []
        self.ids: set[str] = set()
        self.json_ld: list[str] = []
        self._in_title = False
        self._in_json_ld = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            self.ids.add(values["id"] or "")
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            if values.get("name", "").lower() == "description":
                self.descriptions.append(values.get("content", "") or "")
            if values.get("name", "").lower() == "robots":
                self.robots.append(values.get("content", "") or "")
        elif tag == "link" and values.get("rel", "").lower() == "canonical":
            self.canonicals.append(values.get("href", "") or "")
        elif tag == "a" and values.get("href"):
            self.links.append(values["href"] or "")
        elif tag == "img" and values.get("src"):
            self.images.append(values["src"] or "")
        elif tag == "script" and values.get("type", "").lower() == "application/ld+json":
            self._in_json_ld = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "script":
            self._in_json_ld = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.titles.append(data.strip())
        if self._in_json_ld:
            self.json_ld.append(data)


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def front_matter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not match:
        return {}
    metadata: dict[str, str] = {}
    for key, value in re.findall(r"^(title|description):\s*(.+)$", match.group(1), re.MULTILINE):
        value = value.strip()
        if ": " in value and not value.startswith(('"', "'")):
            raise ValueError(f"{path.relative_to(ROOT)} has an unquoted colon in {key} front matter")
        metadata[key] = value.strip('"')
    return metadata


def check_local_links(path: Path, errors: list[str]) -> None:
    for target in re.findall(r"\]\(([^)#]+)", path.read_text(encoding="utf-8")):
        if "://" in target or target.startswith(("mailto:", "{{", "/")):
            continue
        target_path = (path.parent / target).resolve()
        if not target_path.exists():
            fail(errors, f"broken local Markdown link in {path.relative_to(ROOT)}: {target}")


def output_path(built: Path, href: str, current: Path) -> Path | None:
    parsed = urlparse(href)
    if parsed.scheme or parsed.netloc or href.startswith(("mailto:", "tel:", "javascript:")):
        return None
    path = unquote(parsed.path)
    if not path:
        return current
    public_path = urlparse(PUBLIC_ORIGIN).path.rstrip("/")
    if path.startswith(f"{public_path}/"):
        path = path.removeprefix(f"{public_path}/")
    elif path == public_path:
        path = ""
    elif path.startswith("/"):
        return None
    target = (current.parent / path).resolve() if not href.startswith("/") else (built / path).resolve()
    if target.is_dir() or not target.suffix:
        target /= "index.html"
    return target


def check_built_site(built: Path, errors: list[str]) -> None:
    # Resolve once so diagnostics remain valid when callers pass the normal
    # relative `_site` path while discovered pages are stored as absolute paths.
    built = built.resolve()
    pages: dict[Path, PageParser] = {}
    title_set: set[str] = set()
    for route in PUBLIC_ROUTES:
        page = built / route
        if not page.is_file():
            fail(errors, f"missing generated route: {route}")
            continue
        parser = PageParser()
        parser.feed(page.read_text(encoding="utf-8"))
        pages[page.resolve()] = parser
        title = "".join(parser.titles).strip()
        if len(parser.titles) != 1 or not title:
            fail(errors, f"{route} must contain exactly one non-empty title")
        elif title in title_set:
            fail(errors, f"duplicate generated title: {title}")
        else:
            title_set.add(title)
        if len(parser.descriptions) != 1 or not parser.descriptions[0].strip():
            fail(errors, f"{route} must contain exactly one non-empty meta description")
        if len(parser.canonicals) != 1 or not parser.canonicals[0].startswith(PUBLIC_ORIGIN):
            fail(errors, f"{route} must contain one HTTPS canonical under {urlparse(PUBLIC_ORIGIN).path}")
        if route != "404.html" and any("noindex" in value.lower() for value in parser.robots):
            fail(errors, f"public route is accidentally noindexed: {route}")

    home = pages.get((built / "index.html").resolve())
    if not home or not home.json_ld:
        fail(errors, "home page is missing JSON-LD structured data")
    elif not any(_valid_source_code(item) for item in home.json_ld):
        fail(errors, "home JSON-LD is invalid or missing SoftwareSourceCode facts")

    sitemap = built / "sitemap.xml"
    if not sitemap.is_file():
        fail(errors, "generated sitemap.xml is missing")
    else:
        try:
            sitemap_urls = [node.text or "" for node in ET.parse(sitemap).iter() if node.tag.endswith("loc")]
        except ET.ParseError as exc:
            fail(errors, f"generated sitemap.xml is invalid XML: {exc}")
            sitemap_urls = []
        expected = {PUBLIC_ORIGIN, *(PUBLIC_ORIGIN + route + "/" for route in ("get-started", "hardware", "user-guide", "troubleshooting", "safety", "faq", "developers", "about"))}
        if not expected.issubset(set(sitemap_urls)):
            fail(errors, "generated sitemap.xml is missing one or more public routes")
        for url in sitemap_urls:
            parsed = urlparse(url)
            route = parsed.path.removeprefix(urlparse(PUBLIC_ORIGIN).path)
            target = built / ("index.html" if not route else f"{route.rstrip('/')}/index.html")
            if not target.is_file():
                fail(errors, f"sitemap URL does not map to a built page: {url}")

    robots = built / "robots.txt"
    if not robots.is_file() or "Sitemap: https://elia179.github.io/OpenTurbine-ESP32-Gas-Turbine-ECU/sitemap.xml" not in robots.read_text(encoding="utf-8"):
        fail(errors, "robots.txt is missing or does not reference the public sitemap")

    for page, parser in pages.items():
        for src in parser.images:
            target = output_path(built, src, page)
            if target and not target.is_file():
                fail(errors, f"broken image in {page.relative_to(built)}: {src}")
        for href in parser.links:
            target = output_path(built, href, page)
            if target is None:
                continue
            fragment = urlparse(href).fragment
            if not target.is_file():
                fail(errors, f"broken internal link in {page.relative_to(built)}: {href}")
            elif fragment:
                target_parser = pages.get(target.resolve())
                if target_parser is None:
                    target_parser = PageParser()
                    target_parser.feed(target.read_text(encoding="utf-8"))
                    pages[target.resolve()] = target_parser
                if fragment not in target_parser.ids:
                    fail(errors, f"broken fragment in {page.relative_to(built)}: {href}")


def _valid_source_code(raw: str) -> bool:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return False
    required = {"name", "description", "url", "codeRepository", "downloadUrl", "softwareHelp", "license", "operatingSystem"}
    return data.get("@type") == "SoftwareSourceCode" and required.issubset(data) and all(data[key] for key in required)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--built", type=Path)
    args = parser.parse_args()
    errors: list[str] = []
    version_header = (ROOT / "src/system/version.h").read_text(encoding="utf-8")
    version_match = re.search(r'#define\s+OT_VERSION\s+"([^"]+)"', version_header)
    if not version_match:
        fail(errors, "firmware version is missing from src/system/version.h")
        firmware_version = ""
    else:
        firmware_version = version_match.group(1)
    project_data = (SITE / "_data/project.yml").read_text(encoding="utf-8")
    site_version_match = re.search(r'(?m)^version:\s*["\']?([^"\'\s]+)', project_data)
    if not site_version_match or site_version_match.group(1) != firmware_version:
        fail(errors, "site project version does not match the firmware version")
    if firmware_version:
        display_version = firmware_version.rsplit(".", 1)[0]
        if f"OpenTurbine {display_version}" not in (ROOT / "README.md").read_text(encoding="utf-8"):
            fail(errors, "root README does not identify the current firmware version")
        if f"## [{firmware_version}]" not in (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"):
            fail(errors, "changelog has no entry for the current firmware version")
    for name in PUBLIC_PAGES:
        path = SITE / name
        if not path.is_file():
            fail(errors, f"missing required site page: {name}")
            continue
        if name != "404.html":
            try:
                metadata = front_matter(path)
            except ValueError as exc:
                fail(errors, str(exc))
                metadata = {}
            if not metadata.get("title") or not metadata.get("description"):
                fail(errors, f"public page needs title and description front matter: {name}")
    config = (SITE / "_config.yml").read_text(encoding="utf-8")
    for plugin in ("jekyll-seo-tag", "jekyll-sitemap"):
        if plugin not in config:
            fail(errors, f"site config is missing {plugin}")
    layout = (SITE / "_layouts/default.html").read_text(encoding="utf-8")
    if "{% seo %}" not in layout or "google-site-verification" not in layout:
        fail(errors, "default layout is missing SEO or optional Search Console verification support")
    public_text = "\n".join(p.read_text(encoding="utf-8") for p in SITE.rglob("*") if p.is_file() and p.suffix in {".md", ".html", ".yml", ".txt"})
    for placeholder in ("TODO", "TBD", "example.com", "OpenTurbine#first-setup", "OpenTurbine#electrical-and-wiring-basics", "openturbine-logo.svg"):
        if placeholder in public_text:
            fail(errors, f"public content contains forbidden placeholder or obsolete reference: {placeholder}")
    for banned in ("google-analytics", "googletagmanager", "plausible.io", "matomo.js", "facebook pixel", "hotjar"):
        if banned in public_text.lower():
            fail(errors, f"public content contains tracking reference: {banned}")
    current_guidance = public_text + "\n" + "\n".join(
        path.read_text(encoding="utf-8") for path in CURRENT_GUIDANCE_SOURCES
    )
    for obsolete in (
        "Config > Cluster > Enable",
        "first public release has not been published",
        "N16R8",
    ):
        if obsolete in current_guidance:
            fail(errors, f"current guidance contains obsolete v1-era instruction: {obsolete}")
    for image in REQUIRED_IMAGES:
        if not (SITE / "assets/images" / image).is_file():
            fail(errors, f"required public image is missing: {image}")
    for image in (SITE / "assets/images").glob("*.png"):
        if image.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
            fail(errors, f"PNG extension does not match image encoding: {image.name}")
    for markdown in MARKDOWN_SOURCES:
        check_local_links(markdown, errors)
    if args.built:
        check_built_site(args.built, errors)
    if errors:
        print("Public content validation failed:", *[f"- {error}" for error in errors], sep="\n", file=sys.stderr)
        return 1
    print("Public content validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
