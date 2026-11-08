"""Prepare only this service's volume, then run the server as an unprivileged UID."""
import os
from pathlib import Path
import sys

path = Path("/data/math-workspace")
if os.geteuid() == 0:
    path.mkdir(parents=True, exist_ok=True)
    os.chown(path, 10001, 10001)
    os.chmod(path, 0o700)
    os.setgroups([])
    os.setgid(10001)
    os.setuid(10001)
os.umask(0o077)
os.execv(sys.executable, [sys.executable, "/app/serve.py"])
