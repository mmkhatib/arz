"""_recover_from_history — file-content recovery from session tool_calls.

When a file isn't on the local disk but the session log captured a
Write/Edit tool_call against the same path, we serve the captured
content. Covers the tool-input shape variants we've actually seen:

  - Plain JSON: '{"file_path": "...", "content": "..."}'
  - Python repr: "{'file_path': '...', 'content': '...'}"
  - claude-code wrapper: "{'raw': '<json>'}" (legitimately nested)
  - dict already parsed
"""

from __future__ import annotations

from types import SimpleNamespace

from arz.dashboard.routes.files import _recover_from_history


def _msg(tool_calls):
    return SimpleNamespace(tool_calls=tool_calls)


def _request_with_session(messages):
    session = SimpleNamespace(messages=messages)
    mgr = SimpleNamespace(get=lambda sid: session if sid == "S" else None)
    state = SimpleNamespace(session_manager=mgr)
    app = SimpleNamespace(state=state)
    return SimpleNamespace(app=app)


def test_recovers_plain_json_input():
    req = _request_with_session(
        [
            _msg(
                [
                    {
                        "name": "Write",
                        "input": '{"file_path": "/abs/hi.md", "content": "yo"}',
                    }
                ]
            )
        ]
    )
    assert _recover_from_history(req, "S", "/abs/hi.md") == "yo"


def test_recovers_python_repr_input():
    req = _request_with_session(
        [
            _msg(
                [
                    {
                        "name": "Write",
                        "input": "{'file_path': '/abs/hi.md', 'content': 'yo'}",
                    }
                ]
            )
        ]
    )
    assert _recover_from_history(req, "S", "/abs/hi.md") == "yo"


def test_recovers_claude_code_raw_wrapper():
    """claude-code persists tool inputs as ``{"raw": "<inner json>"}``,
    sometimes inside a python-repr outer."""
    req = _request_with_session(
        [
            _msg(
                [
                    {
                        "name": "Write",
                        "input": ('{\'raw\': \'{"file_path": "/abs/hi.md", "content": "yo"}\'}'),
                    }
                ]
            )
        ]
    )
    assert _recover_from_history(req, "S", "/abs/hi.md") == "yo"


def test_recovers_already_parsed_dict():
    req = _request_with_session(
        [
            _msg(
                [
                    {
                        "name": "Write",
                        "input": {"file_path": "/abs/hi.md", "content": "yo"},
                    }
                ]
            )
        ]
    )
    assert _recover_from_history(req, "S", "/abs/hi.md") == "yo"


def test_returns_none_when_no_match():
    req = _request_with_session(
        [
            _msg(
                [
                    {
                        "name": "Write",
                        "input": '{"file_path": "/abs/different.md", "content": "yo"}',
                    }
                ]
            )
        ]
    )
    assert _recover_from_history(req, "S", "/abs/hi.md") is None


def test_returns_none_for_non_artifact_tools():
    req = _request_with_session(
        [
            _msg([{"name": "Read", "input": '{"file_path": "/abs/hi.md"}'}]),
        ]
    )
    assert _recover_from_history(req, "S", "/abs/hi.md") is None


def test_walks_newest_first_so_latest_write_wins():
    req = _request_with_session(
        [
            _msg([{"name": "Write", "input": '{"file_path": "/abs/hi.md", "content": "v1"}'}]),
            _msg([{"name": "Edit", "input": '{"file_path": "/abs/hi.md", "new_string": "v2"}'}]),
        ]
    )
    assert _recover_from_history(req, "S", "/abs/hi.md") == "v2"


def test_returns_none_when_session_missing():
    state = SimpleNamespace(session_manager=SimpleNamespace(get=lambda sid: None))
    req = SimpleNamespace(app=SimpleNamespace(state=state))
    assert _recover_from_history(req, "missing", "/abs/hi.md") is None
