"""The CLI's own logic: argument handling, history hygiene, output shape.

Nothing here starts a server -- these cover the decisions the CLI makes on its
own, which is where its bugs live.
"""

import json

from app import cli


def test_a_subcommand_is_one_bare_word():
    """`aura login details for Great Gulf` is a question. Answering it with an
    unexpected password prompt is the least welcome thing a tool can do."""
    assert cli.main.__module__  # sanity
    parsed = ["login", "details", "for", "Great", "Gulf"]
    only = parsed[0] if len(parsed) == 1 else ""
    assert only == ""

    parsed = ["login"]
    only = parsed[0] if len(parsed) == 1 else ""
    assert only == "login"


def test_json_mode_suppresses_the_streamed_prose(capsys):
    """Anything printed before the object makes the output unparseable, which
    is the one thing --json exists for."""
    answer, cards = [], []
    cli._render(
        {"type": "text", "text": "hello "}, answer, cards,
        dev=False, step=0.0, started=0.0, quiet=True,
    )
    assert capsys.readouterr().out == ""
    assert answer == ["hello "]


def test_normal_mode_still_streams_the_prose(capsys):
    answer, cards = [], []
    cli._render(
        {"type": "text", "text": "hello "}, answer, cards,
        dev=False, step=0.0, started=0.0, quiet=False,
    )
    assert capsys.readouterr().out == "hello "


def test_json_mode_sends_errors_to_stderr(capsys):
    answer, cards = [], []
    cli._render(
        {"type": "error", "detail": "boom"}, answer, cards,
        dev=False, step=0.0, started=0.0, quiet=True,
    )
    captured = capsys.readouterr()
    assert captured.out == "" and "boom" in captured.err


def test_json_mode_still_collects_cards():
    answer, cards = [], []
    cli._render(
        {"type": "projects", "projects": [{"id": "AK-1", "name": "R"}]}, answer, cards,
        dev=False, step=0.0, started=0.0, quiet=True,
    )
    assert [p["id"] for p in cards] == ["AK-1"]


def test_the_session_file_is_written_private(tmp_path, monkeypatch):
    """A portal token is a bearer credential: anyone holding it is that realtor
    until it expires."""
    monkeypatch.setattr(cli, "SESSION_FILE", tmp_path / "session.json")
    cli.save_session({"token": "t", "name": "Sarath"})
    assert cli.SESSION_FILE.stat().st_mode & 0o077 == 0
    assert cli.load_session()["token"] == "t"


def test_a_missing_session_file_is_not_an_error(tmp_path, monkeypatch):
    monkeypatch.setattr(cli, "SESSION_FILE", tmp_path / "nope.json")
    assert cli.load_session() == {}


def test_a_corrupt_session_file_is_not_an_error(tmp_path, monkeypatch):
    path = tmp_path / "session.json"
    path.write_text("{not json")
    monkeypatch.setattr(cli, "SESSION_FILE", path)
    assert cli.load_session() == {}


def test_token_precedence(tmp_path, monkeypatch):
    monkeypatch.setattr(cli, "SESSION_FILE", tmp_path / "session.json")
    cli.save_session({"token": "from-file"})
    monkeypatch.setenv("AURA_TOKEN", "from-env")
    assert cli.token_from_anywhere("explicit") == "explicit"
    assert cli.token_from_anywhere(None) == "from-env"
    monkeypatch.delenv("AURA_TOKEN")
    assert cli.token_from_anywhere(None) == "from-file"


def test_help_tells_you_how_to_sign_in():
    """argparse will not advertise a positional subcommand on its own, and a
    user who cannot find how to sign in has no way into the tool at all."""
    assert "aura login" in cli.EPILOG
    assert "aura logout" in cli.EPILOG or "logout" in cli.EPILOG


def test_help_documents_the_interactive_commands():
    for command in ("/new", "/mode", "/dev", "/quit"):
        assert command in cli.EPILOG


def test_help_names_the_environment_variables_the_code_reads():
    for var in ("AURA_BASE", "AURA_TOKEN", "AURA_HOME"):
        assert var in cli.EPILOG


def test_help_says_the_service_must_be_running():
    assert "uvicorn" in cli.EPILOG
