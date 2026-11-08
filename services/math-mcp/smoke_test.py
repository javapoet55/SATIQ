"""Exercise the actual HTTP MCP protocol; never print tokens or student data."""
import argparse
import asyncio
import base64
import io
import json
import math
import os
from pathlib import Path
import time

from fastmcp import Client
import httpx
import jwt
from PIL import Image


def token(**changes):
    now = int(time.time())
    claims = {"iss": "preporbit-ai", "aud": "preporbit-math-mcp", "sub": "qa-smoke-test",
              "client_id": "preporbit-qa", "scope": "math:tools", "iat": now, "exp": now + 300}
    claims.update(changes)
    return jwt.encode(claims, os.environ["MATH_MCP_JWT_SECRET"], algorithm="HS256")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8080/mcp")
    parser.add_argument("--output-dir", default="/tmp/math-mcp-smoke")
    parser.add_argument("--check-persistence", action="store_true")
    args = parser.parse_args()
    checks = []

    def passed(label):
        checks.append(label)
        print(f"PASS: {label}", flush=True)

    directory = Path(args.output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(timeout=20, trust_env=False) as http:
        health = await http.get(args.url.rsplit("/mcp", 1)[0] + "/health")
        assert health.status_code == 200 and health.json()["version"] == "0.12.5"
        passed("Health and pinned package version")
        init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "qa", "version": "1"}}}
        for label, credential in [("Missing token", None), ("Invalid token", "invalid"), ("Expired token", token(exp=int(time.time())-60)), ("Wrong audience", token(aud="wrong")), ("Missing scope", token(scope=""))]:
            headers = {"Accept": "application/json, text/event-stream"}
            if credential:
                headers["Authorization"] = "Bearer " + credential
            response = await http.post(args.url, headers=headers, json=init)
            assert response.status_code in (401, 403), (label, response.status_code)
            passed(label + " rejected")

    async with Client(args.url, auth=token(), timeout=45) as client:
        tools = await client.list_tools()
        names = {tool.name for tool in tools}
        assert len(names) == 17, names
        passed("Authenticated MCP initialization and discovery of all 17 tools")

        async def call(name, arguments):
            result = await client.call_tool(name, arguments)
            assert not result.is_error
            return result.structured_content or result.data

        if args.check_persistence:
            result = await call("workspace_load", {"name": "preporbit_qa_restart_probe"})
            assert result["success"] and result["result"] == 14
            passed("Workspace calculation survived service restart")
        else:
            for label, expression, expected in [("Arithmetic", "2 + 3 * 4", 14), ("SAT cost-equation calculation", "(60 - 18) / 7", 6), ("Square root", "sqrt(81)", 9), ("Trigonometry", "sin(0)", 0)]:
                result = await call("calc_expression", {"expression": expression})
                assert math.isclose(result["result"], expected)
                passed(label)
            for operation, numbers, expected in [("mean", [2, 4, 6, 8], 5), ("median", [9, 1, 2], 2)]:
                result = await call("calc_statistics", {"numbers": numbers, "operation": operation})
                assert result["result"] == expected
                passed("Statistics: " + operation)
            result = await call("calc_units", {"value": 5, "from_unit": "mi", "to_unit": "km", "unit_type": "length"})
            assert math.isclose(result["converted_value"], 8.04672, rel_tol=0.0001)
            passed("Unit conversion")
            result = await call("calc_interest", {"principal": 1000, "rate": 0.05, "time": 2, "compounds_per_year": 1})
            assert math.isclose(result["final_amount"], 1102.5)
            passed("Compound-growth calculation")
            result = await call("matrix_multiply", {"matrix_a": [[1, 2], [3, 4]], "matrix_b": [[5, 6], [7, 8]]})
            assert result["result_matrix"] == [[19, 22], [43, 50]]
            passed("Matrix multiplication")
            result = await call("matrix_transpose", {"matrix": [[1, 2], [3, 4]]})
            assert result["result_matrix"] == [[1, 3], [2, 4]]
            passed("Matrix transpose")
            result = await call("matrix_determinant", {"matrix": [[1, 2], [3, 4]]})
            assert math.isclose(result["determinant"], -2)
            passed("Matrix determinant")
            result = await call("matrix_inverse", {"matrix": [[2, 0], [0, 4]]})
            assert result["success"] and result["result_matrix"] == [[0.5, 0], [0, 0.25]]
            passed("Matrix inverse")
            result = await call("matrix_eigenvalues", {"matrix": [[2, 0], [0, 3]]})
            assert result["success"] and sorted(result["eigenvalues"]) == [2, 3]
            passed("Matrix eigenvalues")

            for name, arguments, filename in [
                ("plot_function", {"expression": "x**2 - 4", "x_range": [-5, 5], "num_points": 100}, "function.png"),
                ("plot_histogram", {"data": [1, 2, 2, 3, 3, 3, 4, 5], "bins": 5}, "histogram.png"),
                ("plot_scatter", {"x_data": [1, 2, 3, 4], "y_data": [2, 4, 5, 8]}, "scatter.png"),
                ("plot_line_chart", {"x_data": [1, 2, 3], "y_data": [1, 4, 9]}, "line.png"),
                ("plot_box_plot", {"data_groups": [[1, 2, 3, 4], [2, 4, 6, 8]], "group_labels": ["A", "B"]}, "box.png"),
                ("plot_financial_line", {"days": 20, "trend": "bullish", "start_price": 100}, "synthetic-series.png"),
            ]:
                result = await client.call_tool(name, arguments)
                images = [block for block in result.content if block.type == "image"]
                assert len(images) == 1, (name, result.structured_content)
                png = base64.b64decode(images[0].data)
                assert png.startswith(b"\x89PNG\r\n\x1a\n")
                with Image.open(io.BytesIO(png)) as picture:
                    assert picture.width >= 300 and picture.height >= 200
                    picture.verify()
                (directory / filename).write_bytes(png)
                passed(name + " produced a valid PNG")

            saved = await call("workspace_save", {"name": "preporbit_qa_restart_probe", "expression": "2 + 3 * 4", "result": 14})
            assert saved["success"]
            loaded = await call("workspace_load", {"name": "preporbit_qa_restart_probe"})
            assert loaded["success"] and loaded["result"] == 14
            passed("Workspace save and load")
            resource = await client.read_resource("math://workspace")
            assert any("preporbit_qa_restart_probe" in getattr(block, "text", "") for block in resource)
            passed("Workspace resource")
            for label, name, arguments in [
                ("Unsafe expression", "calc_expression", {"expression": "__import__('os')"}),
                ("Division by zero", "calc_expression", {"expression": "1/0"}),
                ("Large exponent", "calc_expression", {"expression": "9**99999999"}),
                ("Path traversal", "workspace_save", {"name": "../../outside", "expression": "2+2", "result": 4}),
                ("Too many plot points", "plot_function", {"expression": "x**2", "x_range": [0, 1], "num_points": 1001}),
            ]:
                result = await client.call_tool(name, arguments, raise_on_error=False)
                assert result.is_error, label
                passed(label + " rejected")
    report = {"ok": True, "package": "math-mcp-learning-server", "version": "0.12.5", "checks": checks, "count": len(checks)}
    (directory / ("persistence-report.json" if args.check_persistence else "test-report.json")).write_text(json.dumps(report, indent=2))
    print(f"PASS: {len(checks)} checks completed; no student data, LLM calls, or database credentials used.")


if __name__ == "__main__":
    asyncio.run(main())
