"""Private, authenticated deployment of the upstream math tools for PrepOrbit AI."""
import ast
import asyncio
import logging
import math
import os
import socket
from importlib.metadata import version

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.auth.providers.jwt import JWTVerifier
from fastmcp.server.middleware import Middleware
from fastmcp.server.middleware.rate_limiting import SlidingWindowRateLimitingMiddleware
from starlette.responses import JSONResponse
import uvicorn

secret = os.environ.get("MATH_MCP_JWT_SECRET", "")
if len(secret) < 64:
    raise RuntimeError("Set a random MATH_MCP_JWT_SECRET of at least 64 characters.")
if not os.environ.get("MATH_MCP_WORKSPACE_DIR"):
    raise RuntimeError("MATH_MCP_WORKSPACE_DIR must be configured.")

# Import only tool components: the upstream root server logs full payloads.
from math_mcp.tools import calculate_mcp, matrix_mcp, persistence_mcp, visualization_mcp
from math_mcp.resources import resources_mcp

logging.getLogger("math_mcp").setLevel(logging.CRITICAL)
JWT_ISSUER = "preporbit-ai"
JWT_AUDIENCE = "preporbit-math-mcp"
JWT_SCOPE = "math:tools"


def numeric_literal(node):
    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        value = numeric_literal(node.operand)
        return -value if isinstance(node.op, ast.USub) else value
    raise ToolError("Use a numeric literal for an exponent, between -16 and 16.")


def check_expression(expression):
    """Bound arithmetic work before the package evaluates an expression."""
    try:
        tree = ast.parse(expression, mode="eval")
    except (SyntaxError, ValueError, RecursionError):
        raise ToolError("Use a valid mathematical expression.") from None
    nodes = list(ast.walk(tree))
    if len(nodes) > 100:
        raise ToolError("The expression is too complex for this learning service.")
    for node in nodes:
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            if not math.isfinite(node.value) or abs(node.value) > 1e12:
                raise ToolError("Use finite numbers with magnitude at most 1 trillion.")
        exponent = None
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
            exponent = node.right
            if any(isinstance(n, ast.Pow) for n in ast.walk(node.left)):
                raise ToolError("Nested powers are not supported.")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "pow":
            if len(node.args) != 2:
                raise ToolError("pow requires two arguments.")
            exponent = node.args[1]
            if any(isinstance(n, (ast.Pow, ast.Call)) for n in ast.walk(node.args[0])):
                raise ToolError("Nested powers are not supported.")
        if exponent is not None and abs(numeric_literal(exponent)) > 16:
            raise ToolError("Exponents must be between -16 and 16.")


def check_arguments(arguments):
    count = 0

    def visit(value, depth=0):
        nonlocal count
        count += 1
        if count > 6000 or depth > 8:
            raise ToolError("The request is too large or deeply nested.")
        if isinstance(value, str) and len(value) > 200:
            raise ToolError("Text inputs are limited to 200 characters.")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and not math.isfinite(value):
            raise ToolError("Use finite numeric inputs.")
        if isinstance(value, list):
            if len(value) > 1000:
                raise ToolError("Arrays are limited to 1,000 items.")
            for item in value:
                visit(item, depth + 1)
        if isinstance(value, dict):
            for item in value.values():
                visit(item, depth + 1)

    visit(arguments)
    if "expression" in arguments and isinstance(arguments["expression"], str):
        check_expression(arguments["expression"])
    for key, limit in (("num_points", 1000), ("days", 365)):
        if key in arguments and isinstance(arguments[key], (int, float)) and arguments[key] > limit:
            raise ToolError(f"{key} is limited to {limit}.")
    if isinstance(arguments.get("data_groups"), list) and len(arguments["data_groups"]) > 20:
        raise ToolError("Use at most 20 data groups.")
    for key in ("matrix_a", "matrix_b", "matrix"):
        if key in arguments:
            matrix = arguments[key]
            if isinstance(matrix, list) and (len(matrix) > 20 or any(isinstance(row, list) and len(row) > 20 for row in matrix)):
                raise ToolError("Matrices are limited to 20 × 20.")


class BoundedTools(Middleware):
    def __init__(self):
        self.lock = asyncio.Semaphore(1)  # matplotlib's pyplot state is process-wide

    async def on_call_tool(self, context, call_next):
        check_arguments(context.message.arguments or {})
        async with self.lock:
            return await call_next(context)


mcp = FastMCP(
    name="PrepOrbit AI Math Tools",
    instructions="Internal math calculation, charting and administrative workspace tools. No student database access. Not a symbolic proof or SAT scoring engine.",
    auth=JWTVerifier(public_key=secret, algorithm="HS256", issuer=JWT_ISSUER,
                     audience=JWT_AUDIENCE, required_scopes=[JWT_SCOPE]),
)
for component in (calculate_mcp, matrix_mcp, persistence_mcp, visualization_mcp, resources_mcp):
    mcp.mount(component)
mcp.add_middleware(BoundedTools())
mcp.add_middleware(SlidingWindowRateLimitingMiddleware(max_requests=120, window_minutes=1))


@mcp.custom_route("/health", methods=["GET"])
async def health(_request):
    return JSONResponse({"ok": True, "service": "preporbit-math-mcp",
                         "package": "math-mcp-learning-server", "version": version("math-mcp-learning-server")})


if __name__ == "__main__":
    # IPv6 + IPv4 supports Railway's private networking and local health checks.
    sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("::", int(os.environ.get("PORT", "8080"))))
    app = mcp.http_app(path="/mcp", stateless_http=True, json_response=True,
                       allowed_hosts=["preporbit-math-mcp.railway.internal"])
    uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False)).run(sockets=[sock])
