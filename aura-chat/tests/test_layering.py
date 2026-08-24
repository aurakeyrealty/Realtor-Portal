"""The three rules from architecture.md section 4.5, enforced rather than remembered.

Every one of these was cheap to write and would be expensive to discover the
hard way: a single adapter import in tools.py turns the "swap the data source"
migration from one file into an archaeology exercise.
"""

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"


def _imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text())
    out: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module:
            out.append(node.module)
    return out


def _py(sub: str) -> list[Path]:
    return sorted((APP / sub).rglob("*.py")) if (APP / sub).exists() else []


FORBIDDEN_IN_DOMAIN = ("fastapi", "httpx", "asyncpg", "pydantic_ai", "openai", "app.adapters")


def test_domain_imports_nothing_external():
    """domain/ is the shape of the business. A vendor type in here leaks into
    every layer above and pins them to today's stack."""
    for f in _py("domain"):
        for mod in _imports(f):
            assert not mod.startswith(FORBIDDEN_IN_DOMAIN), f"{f.name} imports {mod}"


def test_ports_declare_only_protocols():
    """A port that imports an adapter is not a seam, it is a redirect."""
    for f in _py("ports"):
        for mod in _imports(f):
            assert not mod.startswith("app.adapters"), f"{f.name} imports {mod}"
            assert not mod.startswith(("httpx", "asyncpg", "pydantic_ai")), f"{f.name} imports {mod}"


def test_only_the_container_constructs_adapters():
    """The rule that makes PROJECT_SOURCE a one-line change."""
    allowed = {"container.py"}
    for f in sorted(APP.rglob("*.py")):
        if f.name in allowed or "adapters" in f.parts:
            continue
        for mod in _imports(f):
            assert not mod.startswith("app.adapters"), f"{f.relative_to(APP)} imports {mod}"


def test_tools_depend_only_on_domain_and_ports():
    """Written before tools.py exists, so it can never be true-by-accident."""
    tools = APP / "tools.py"
    if not tools.exists():
        return
    for mod in _imports(tools):
        if mod.startswith("app."):
            assert mod.startswith(("app.domain", "app.ports")), f"tools.py imports {mod}"
