"""Checks everything except Minecraft itself: LLM provider, local embeddings, code parsing, bot server.

    python tests/smoke_test.py            # includes one tiny LLM call (well under 1 cent)
    python tests/smoke_test.py --offline  # skip the LLM call
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from run import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")
offline = "--offline" in sys.argv
ok = True


def check(name, fn):
    global ok
    t = time.time()
    try:
        detail = fn()
        print(f"PASS  {name} ({time.time() - t:.1f}s) {detail or ''}")
    except Exception as e:
        ok = False
        print(f"FAIL  {name}: {type(e).__name__}: {e}")


def vectorstore():
    from voyager.vectorstore import LocalVectorStore
    d = tempfile.mkdtemp()
    try:
        vs = LocalVectorStore("t", d)
        vs.add_texts(["mine three logs with an axe", "kill a zombie with a sword", "smelt iron ore in a furnace"],
                     ids=["a", "b", "c"], metadatas=[{"name": "a"}, {"name": "b"}, {"name": "c"}])
        vs.persist()
        vs2 = LocalVectorStore("t", d)
        top, score = vs2.similarity_search_with_score("chop wood from trees", k=1)[0]
        assert top.metadata["name"] == "a", top
        same = vs2.similarity_search_with_score("kill a zombie with a sword", k=1)[0][1]
        assert same < 0.05, same
        vs2._collection.delete(["b"])
        assert vs2._collection.count() == 2
        return f"nearest='{top.page_content}' dist={score:.3f}"
    finally:
        shutil.rmtree(d, ignore_errors=True)


def parse_code():
    from voyager.agents.action import ActionAgent
    from voyager.llm import AIMessage
    agent = ActionAgent.__new__(ActionAgent)
    msg = AIMessage("Plan: chop\n```javascript\nasync function mineThreeLogs(bot) {\n"
                    "  await mineBlock(bot, 'oak_log', 3);\n}\n```")
    r = agent.process_ai_message(msg)
    assert isinstance(r, dict), r
    assert r["program_name"] == "mineThreeLogs" and r["exec_code"] == "await mineThreeLogs(bot);"
    return r["program_name"]


def system_prompt():
    from voyager.agents.action import ActionAgent
    agent = ActionAgent.__new__(ActionAgent)
    agent.llm = type("M", (), {"model_name": "deepseek-chat"})()
    m = agent.render_system_message(skills=["async function x(bot) { }"])
    assert "{programs}" not in m.content and "async function x(bot)" in m.content
    assert "pathfinder.goto" in m.content  # full mineflayer API reference included
    return f"{len(m.content)} chars"


def peak_guard():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from voyager.llm import PeakGuard
    g = PeakGuard(enabled=True)
    tz = ZoneInfo("Australia/Adelaide")
    assert g.minutes_until_clear(datetime(2026, 11, 16, 12, 0, tzinfo=tz)) == 150  # Mon noon
    assert g.minutes_until_clear(datetime(2026, 11, 16, 15, 0, tzinfo=tz)) == 0
    assert g.minutes_until_clear(datetime(2026, 11, 16, 20, 29, tzinfo=tz)) == 1
    assert g.minutes_until_clear(datetime(2026, 11, 15, 12, 0, tzinfo=tz)) == 0  # Sunday
    return f"now: {g.minutes_until_clear()} min until clear"


def llm():
    from voyager.llm import ChatModel, HumanMessage, SystemMessage, METER
    m = ChatModel(agent="smoke")
    r = m([SystemMessage("Answer with one word."), HumanMessage("What block do you mine to get cobblestone?")])
    assert r.content.strip()
    return f"{m.provider}/{m.model_name} said {r.content.strip()[:40]!r}; {METER.line()}"


def bot_server():
    env_dir = ROOT / "voyager" / "env" / "mineflayer"
    p = subprocess.Popen(["node", "index.js", "3917"], cwd=env_dir, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True)
    try:
        t = time.time()
        while time.time() - t < 30:
            line = p.stdout.readline()
            if "Server started on port" in line:
                return line.strip()
            if p.poll() is not None:
                raise RuntimeError(f"exited: {line.strip()}")
        raise TimeoutError("no 'Server started' line in 30s")
    finally:
        p.terminate()


check("local embeddings + vector store", vectorstore)
check("JS code parsing (babel)", parse_code)
check("action prompt rendering", system_prompt)
check("peak-hours guard", peak_guard)
check("mineflayer bot server starts", bot_server)
if not offline:
    check("LLM call", llm)
sys.exit(0 if ok else 1)
