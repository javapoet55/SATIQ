# PrepOrbit AI private math MCP service

Deploys **math-mcp-learning-server 0.12.5** with scientific and plotting extras in the existing Railway project. Source: [PyPI](https://pypi.org/project/math-mcp-learning-server/), [upstream repository](https://github.com/clouatre-labs/math-mcp-learning-server) (Apache-2.0).

## Boundaries

- Railway service: `preporbit-math-mcp` (`9d9d6569-f1db-41f5-9317-5f21ce2acf42`). Project: `ff7c016b-3e75-4524-b237-0565185ea0f2`, production environment.
- Private endpoint: `http://preporbit-math-mcp.railway.internal:8080/mcp`. No public domain or TCP proxy is created.
- Health: `/health` returns only the service name and package version. MCP requests require a short-lived HS256 JWT, issuer `preporbit-ai`, audience `preporbit-math-mcp`, scope `math:tools`.
- Signing secret: `MATH_MCP_JWT_SECRET`, generated randomly and stored only in this Railway service. Never put it in Git, browser code, tool arguments, logs, or chat. Future backend clients must obtain a short-lived token through trusted server-side configuration.
- **No PrepOrbit student database, OpenAI key, or other app credentials are supplied to this service.** There are no LLM calls or email requests in its tests.
- The shared calculation workspace is administrative test storage, **not isolated per student**. A separate volume mounted at `/data` holds `/data/math-workspace/workspace.json`. Do not put personal student data here or connect these workspace tools directly to student chat.
- One replica only: the upstream workspace file has process-local locking and is not a distributed datastore. PrepOrbit student records continue to belong in PostgreSQL.
- Installed and tested as a separate backend service. The existing PrepOrbit AI Assistant and student screens do not call it automatically. Tool selection, student authorization, and rendering chart results require a subsequent app integration.

## Deployment

The runtime is Python 3.14 with pinned package, FastMCP, numerical and plotting versions in `requirements.txt`. Docker startup prepares only this service's workspace directory, drops to UID/GID 10001, and starts a dual-stack HTTP listener on `$PORT` (8080). Requests are rate limited to 120/minute. Tool calls are serialized to protect matplotlib's process-wide state. Inputs have array, matrix, expression, exponent and plot-size bounds; these intentionally reject some expressions supported by the raw upstream package.

The wrapper mounts the upstream tool components rather than the upstream root server, avoiding its full-request logging middleware. Upstream application logging is suppressed. Health checks contain no workspace content.

`patch_workspace.py` contains two narrow, version-checked compatibility patches:

1. Enable `MATH_MCP_WORKSPACE_DIR` instead of hardcoding the user home directory. This places calculations on the Railway volume and lets isolated local tests avoid the real home directory.
2. Decode the upstream plotting functions' base64 output into PNG bytes before passing it to FastMCP `Image`. Unpatched 0.12.5 double-encodes chart output: the advertised PNG's decoded content is base64 text rather than a PNG file. All six chart types are validated by decoding their MCP response and opening the actual PNG with Pillow.

These patches do not change the math algorithms. Assertions stop the build if the expected upstream implementation changes. Review both patches before updating the pinned package.

From the existing `waypoint-sat/` directory, where the Railway project is linked:

```sh
railway up ../services/math-mcp --path-as-root --service preporbit-math-mcp --detach
railway deployment list --service preporbit-math-mcp --limit 1
```

The math service uses `/` as its source root, independently of the web service's `/waypoint-sat` root. Its volume and secret must be configured before startup. Do not generate a public Railway domain for this internal service.

## Tests

Run inside its Railway container; credentials stay in its environment:

```sh
railway ssh --service preporbit-math-mcp 'python /app/smoke_test.py'
railway service restart --service preporbit-math-mcp --yes
# After the instance is healthy:
railway ssh --service preporbit-math-mcp 'python /app/smoke_test.py --check-persistence'
```

`smoke_test.py` performs **33 checks** against the actual HTTP MCP protocol: health/version, rejected missing/invalid/expired/wrong-audience/insufficient-scope credentials, discovery of all 17 tools, arithmetic and the SAT rental calculation, statistics, unit conversion, compound growth, five matrix operations, six real PNG charts, workspace save/load/resource access, and rejection of unsafe expressions, zero division, excessive exponents, path traversal and oversized plots. Restart verification loads the existing QA probe without saving a new one.

Reports and chart images are written to `/tmp/math-mcp-smoke`; only the workspace probe is persistent. Tests use synthetic inputs. No production student account is read or modified. The synthetic financial chart is dummy data, not a market feed.

For local testing, use an isolated Python 3.14 virtual environment, install `requirements.txt`, run `patch_workspace.py`, and configure a **test-only** secret plus a temporary `MATH_MCP_WORKSPACE_DIR` and `MPLCONFIGDIR`. Start `serve.py` directly and pass its local URL to `smoke_test.py --url http://127.0.0.1:PORT/mcp`.
