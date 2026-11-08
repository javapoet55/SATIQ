"""Compatibility fixes for the pinned 0.12.5 package.

Allow a configured volume path and pass decoded PNG bytes to FastMCP Image.
Math computation remains upstream. Fail on an unexpected implementation.
"""
from importlib.metadata import version
from pathlib import Path
import sysconfig

assert version("math-mcp-learning-server") == "0.12.5"
path = Path(sysconfig.get_path("purelib")) / "math_mcp/persistence/storage.py"
original = 'return Path.home() / ".math-mcp"'
replacement = 'return Path(os.environ.get("MATH_MCP_WORKSPACE_DIR", str(Path.home() / ".math-mcp")))'
source = path.read_text()
if original in source:
    assert source.count(original) == 1
    path.write_text(source.replace(original, replacement))
else:
    assert replacement in source, "Upstream workspace implementation changed."

path = Path(sysconfig.get_path("purelib")) / "math_mcp/tools/visualization.py"
source = path.read_text()
original = 'return Image(data=image_bytes, format="png")'
replacement = 'return Image(data=base64.b64decode(image_bytes), format="png")'
if original in source:
    assert source.count(original) == 6
    source = source.replace("import logging\n", "import base64\nimport logging\n", 1)
    path.write_text(source.replace(original, replacement))
else:
    assert source.count(replacement) == 6, "Upstream image implementation changed."
