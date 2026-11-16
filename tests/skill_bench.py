"""Skill benchmark: runs skills against a real (headless) Minecraft 1.19 server and checks results.

Each task gives the bot a starting kit, drops it on fresh terrain far from earlier tasks, runs some
code (usually one skill call) and checks the outcome inside the game. No LLM calls, no cost.

    testserver/start.sh                                   # offline-mode 1.19 server on port 25599
    python tests/skill_bench.py --library skill_library/trial1 --out tests/results/baseline_trial1.json
    python tests/skill_bench.py --library skill_library/core --only iron_pickaxe,kill_zombie

`--library` is a Voyager skill folder (has skill/skills.json). For each task the harness picks the first
of the task's candidate skill names that exists in that library; tasks with no matching skill are
reported as "missing" (that counts as a failure for the library).
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tests.bench_tasks import TASKS  # noqa: E402
from voyager.control_primitives import load_control_primitives  # noqa: E402
from voyager.env import VoyagerEnv  # noqa: E402


def load_library(path: Path):
    skills = json.loads((path / "skill" / "skills.json").read_text(encoding="utf-8"))
    return {name: entry["code"] for name, entry in skills.items()}


def build_code(task, call, slot):
    """Wrap the call: move to fresh terrain, set up the world, run, then report via chat."""
    x, z = 2000 + slot * 400, 2000
    setup = "\n".join(f"bot.chat({json.dumps(c)}); await bot.waitForTicks(4);" for c in task.get("commands", []))
    return f"""
let __died = false;
bot._V_base = null; globalThis.__slept = undefined; globalThis.__p = undefined;
bot.once("death", () => {{ __died = true; }});
const count = (re) => bot.inventory.slots.slice(5, 46).filter(i => i).filter(i => new RegExp("^(" + re + ")$").test(i.name)).reduce((a, i) => a + i.count, 0);
const armor = (s) => (bot.inventory.slots[{{head: 5, chest: 6, legs: 7, feet: 8}}[s]] || {{}}).name;
const near = (n, d) => Object.values(bot.entities).some(e => e.name === n && e.position.distanceTo(bot.entity.position) < d);
bot.chat("/difficulty {task.get('difficulty', 'peaceful')}");
bot.chat("/time set {task.get('time', 'day')}");
bot.chat("/weather clear");
bot.chat("/effect clear @s");
bot.chat("/spreadplayers {x} {z} 0 {task.get('spread', 160)} false @s");
await bot.waitForTicks(40);
await bot.waitForChunksToLoad();
await bot.waitForTicks(20);
{setup}
await bot.waitForTicks({task.get('settle', 0)} + 1);
const __foodBefore = bot.food;
const __t0 = Date.now();
let __err = null;
try {{
{call}
}} catch (e) {{ __err = String(e && e.message || e).slice(0, 140); }}
await bot.waitForTicks(10);
let __ok = false;
try {{ __ok = !!({task['check']}); }} catch (e) {{ __err = (__err || "") + " | check: " + e.message; }}
bot.chat("BENCH_RESULT " + JSON.stringify({{ ok: __ok && !__died, died: __died, secs: (Date.now() - __t0) / 1000, err: __err }}));
await bot.waitForTicks(10);
"""


def parse_result(events):
    for kind, ev in events:
        if kind == "onChat" and "BENCH_RESULT" in ev.get("onChat", ""):
            m = re.search(r"BENCH_RESULT (\{.*?\})(?=\s*$|BENCH|\S*$)", ev["onChat"])
            if m:
                try:
                    return json.loads(m.group(1))
                except json.JSONDecodeError:
                    pass
    errors = [ev["onError"] for kind, ev in events if kind == "onError"]
    return {"ok": False, "died": False, "secs": None, "err": ("no result; " + "; ".join(errors))[:300]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--library", required=True)
    ap.add_argument("--mc-port", type=int, default=25599)
    ap.add_argument("--server-port", type=int, default=3010)
    ap.add_argument("--only", default=None, help="comma-separated task ids")
    ap.add_argument("--out", default=None)
    ap.add_argument("--timeout", type=int, default=420, help="seconds per task")
    args = ap.parse_args()

    lib_path = Path(args.library)
    library = load_library(lib_path)
    programs = "\n\n".join(list(library.values()) + load_control_primitives())
    tasks = [t for t in TASKS if not args.only or t["id"] in args.only.split(",")]

    env = VoyagerEnv(mc_port=args.mc_port, server_port=args.server_port, request_timeout=args.timeout, username="benchbot",
                     log_path=str(ROOT / "logs" / "bench"))
    results = []
    try:
        for slot, task in enumerate(tasks):
            skill = next((s for s in task["skills"] if s in library), None)
            if task.get("call"):
                call = task["call"]
            elif skill:
                call = f"await {skill}(bot);"
            else:
                print(f"--   {task['id']:<22} missing (no matching skill)")
                results.append({"id": task["id"], "ok": False, "missing": True})
                continue
            env.reset(options={"mode": "hard", "inventory": task.get("inventory", {}),
                               "equipment": task.get("equipment", []), "wait_ticks": 10})
            env.request_timeout = task.get("timeout", args.timeout)
            t = time.time()
            try:
                events = env.step(build_code(task, call, slot + int(time.time()) % 50 * 37), programs=programs)
                r = parse_result(events)
            except Exception as e:  # timeout / crash
                r = {"ok": False, "died": False, "secs": None, "err": f"{type(e).__name__}: {e}"[:300]}
            r.update(id=task["id"], skill=skill or "call", wall=round(time.time() - t, 1))
            results.append(r)
            mark = "PASS" if r["ok"] else "FAIL"
            print(f"{mark} {task['id']:<22} {r['wall']:>6}s  {r.get('err') or ''}"[:200], flush=True)
    finally:
        env.close()

    passed = sum(r["ok"] for r in results)
    print(f"\n{lib_path}: {passed}/{len(results)} tasks passed")
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps({"library": str(lib_path), "passed": passed,
                                              "total": len(results), "results": results}, indent=2))


if __name__ == "__main__":
    main()
