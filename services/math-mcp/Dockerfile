FROM python:3.14-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 MPLBACKEND=Agg MPLCONFIGDIR=/tmp/matplotlib MATH_MCP_WORKSPACE_DIR=/data/math-workspace MATH_TIMEOUT=3 MAX_EXPRESSION_LENGTH=200 MAX_ARRAY_SIZE=1000 MAX_GROUPS_COUNT=20 MAX_DAYS_FINANCIAL=365 PORT=8080
COPY requirements.txt patch_workspace.py ./
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt && python patch_workspace.py && useradd --uid 10001 --create-home math
COPY serve.py boot.py smoke_test.py ./
EXPOSE 8080
CMD ["python", "boot.py"]
