"""Test-wide isolation.

Many arz modules compute ``Path.home() / ".arz" / ...`` at import time, so
HOME must point at a throwaway directory *before* any arz module is
imported — otherwise tests like the dashboard suite write sessions,
memories and config into the developer's real ``~/.arz``.
"""

from __future__ import annotations

import atexit
import os
import shutil
import tempfile

_TEST_HOME = tempfile.mkdtemp(prefix="arz-test-home-")
os.environ["HOME"] = _TEST_HOME
os.environ.pop("ARZ_HOME", None)
atexit.register(shutil.rmtree, _TEST_HOME, ignore_errors=True)
