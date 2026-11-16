"""Learning that compounds instead of piling up.

Plain Voyager learns by saving every successful program as a new skill. Over a long run that gives
a cluttered library (mineThreeIronOre, mineFourIronOre, mineFiveIronOre...), the same mistakes made
again and again, and no way to tell a skill that works from one that got lucky once. This module
adds four things on top:

1. Fitness  - every time a program calls a library skill, record whether that attempt succeeded.
              Retrieval prefers reliable skills, and the LLM is shown each skill's track record.
2. Merging  - skills that differ only by a hard-coded amount are merged by the LLM into one
              general skill with a `count` parameter. Variants of a core skill are not added at all.
              Removed skills are "retired": still callable by old code, no longer offered to the LLM.
3. Lessons  - after a failed task (or a success that took several tries) the LLM writes down a
              short general lesson. Relevant lessons are shown to the action agent on later tasks.
4. Repair   - skills that keep failing are periodically rewritten as their own task, and the new
              version replaces the old one only if the critic confirms it works.
"""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
from typing import Dict, List, Optional

import voyager.utils as U
from voyager.llm import ChatModel, HumanMessage, SystemMessage
from voyager.vectorstore import LocalVectorStore

NUMBER_WORDS = {
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
    "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "twenty", "thirty", "sixtyfour",
    "a", "an", "some", "several", "few", "more", "single", "x",
}
NUMBER_VALUES = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
                 "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "sixteen": 16,
                 "twenty": 20, "thirty": 30, "single": 1}


def _tokens(name: str) -> List[str]:
    name = re.sub(r"V\d+$", "", name)
    return re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+", name)


def _singular(tok: str) -> str:
    t = tok.lower()
    if t.endswith("ies") and len(t) > 4:
        return t[:-3] + "y"
    if t.endswith("s") and not t.endswith("ss") and len(t) > 3:
        return t[:-1]
    return t


def skill_family(name: str) -> str:
    """mineThreeIronOre, mineFiveIronOres and mine4IronOre all map to 'mine-iron-ore'."""
    toks = [_singular(t) for t in _tokens(name)]
    toks = [t for t in toks if t not in NUMBER_WORDS and not t.isdigit() and t not in ("task", "item")]
    return "-".join(toks)


def generic_name(name: str) -> str:
    """mineThreeIronOre -> mineIronOre"""
    toks = [t for t in _tokens(name)
            if t.lower() not in NUMBER_WORDS and not t.isdigit() and t.lower() not in ("task",)]
    if not toks:
        return name
    return toks[0][0].lower() + toks[0][1:] + "".join(t[0].upper() + t[1:] for t in toks[1:])


def name_count(name: str) -> Optional[int]:
    for t in _tokens(name):
        if t.isdigit():
            return int(t)
        if t.lower() in NUMBER_VALUES:
            return NUMBER_VALUES[t.lower()]
    return None


def called_skills(code: str, names) -> List[str]:
    """Library skills a program calls (not counting the function it defines itself)."""
    defined = set(re.findall(r"async\s+function\s+(\w+)\s*\(", code))
    found = []
    for n in names:
        if n in defined:
            continue
        if re.search(r"(?<![\w.])" + re.escape(n) + r"\s*\(", code):
            found.append(n)
    return found


def js_syntax_ok(code: str) -> bool:
    """Ask Node whether the code parses. If Node is missing, assume yes."""
    fd, path = tempfile.mkstemp(suffix=".js")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(code)
        r = subprocess.run(["node", "--check", path], capture_output=True, text=True, timeout=30)
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return True
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def extract_js(text: str) -> str:
    m = re.findall(r"```(?:javascript|js)?\s*\n(.*?)```", text, re.S)
    return (max(m, key=len) if m else text).strip()


# --------------------------------------------------------------------------- fitness
class SkillStats:
    def __init__(self, path: str, resume: bool):
        self.path = path
        self.d: Dict[str, Dict] = U.load_json(path) if resume and os.path.exists(path) else {}

    def _s(self, n):
        return self.d.setdefault(n, {"uses": 0, "wins": 0, "fails": 0, "notes": [], "repairs": 0})

    def record(self, names: List[str], success: bool, note: str = ""):
        for n in names:
            s = self._s(n)
            s["uses"] += 1
            if success:
                s["wins"] += 1
            else:
                s["fails"] += 1
                if note:
                    s["notes"] = (s["notes"] + [note[:240]])[-3:]
        if names:
            self.save()

    def reset(self, n: str, keep_repairs: bool = True):
        repairs = self.d.get(n, {}).get("repairs", 0) if keep_repairs else 0
        self.d[n] = {"uses": 0, "wins": 0, "fails": 0, "notes": [], "repairs": repairs}
        self.save()

    def drop(self, n: str):
        if self.d.pop(n, None) is not None:
            self.save()

    def reliability(self, n: str) -> float:
        s = self.d.get(n)
        if not s:
            return 0.5
        return (s["wins"] + 1) / (s["uses"] + 2)  # Laplace: new skills start at 0.5

    def label(self, n: str) -> str:
        s = self.d.get(n)
        if not s or not s["uses"]:
            return "// track record: not used yet"
        return f"// track record: {s['wins']} of {s['uses']} uses succeeded"

    def weakest(self, candidates, min_uses=3, max_rate=0.45, max_repairs=2) -> Optional[str]:
        weak = []
        for n in candidates:
            s = self.d.get(n)
            if s and s["uses"] >= min_uses and s["repairs"] < max_repairs:
                rate = s["wins"] / s["uses"]
                if rate <= max_rate:
                    weak.append((rate, -s["uses"], n))
        return min(weak)[2] if weak else None

    def save(self):
        U.dump_json(self.d, self.path)


# --------------------------------------------------------------------------- lessons
LESSON_SYSTEM = """You help a Minecraft bot (Mineflayer JavaScript) learn from experience.
You get a task and what happened on each attempt: the code, errors, chat log and the critic's verdict.
Write at most 2 lessons that would help on FUTURE, SIMILAR tasks. Each lesson:
- is general and actionable (what to do or avoid, which function or approach works),
- is under 30 words,
- never mentions coordinates, never just says "try again" or "be careful".
If there is nothing general worth remembering, reply exactly NONE.
Write one lesson per line, each starting with "- "."""


class LessonBook:
    def __init__(self, ckpt_dir: str, resume: bool, llm: ChatModel):
        self.dir = f"{ckpt_dir}/lessons"
        U.f_mkdir(self.dir)
        self.path = f"{self.dir}/lessons.json"
        self.lessons: List[Dict] = U.load_json(self.path) if resume and os.path.exists(self.path) else []
        self.store = LocalVectorStore("lessons", f"{self.dir}/vectordb")
        if self.store._collection.count() != len(self.lessons):  # rebuild if out of sync
            self.store.delete(list(self.store.ids))
            if self.lessons:
                self.store.add_texts([l["text"] for l in self.lessons],
                                     ids=[str(i) for i in range(len(self.lessons))])
            self.store.persist()
        self.llm = llm

    def relevant(self, query: str, k: int = 4, max_dist: float = 0.75) -> List[str]:
        hits = self.store.similarity_search_with_score(query, k=k)
        return [d.page_content for d, dist in hits if dist <= max_dist]

    def render(self, query: str) -> str:
        found = self.relevant(query)
        if not found:
            return ""
        return "Lessons from past experience:\n" + "\n".join(f"- {t}" for t in found)

    def learn(self, task: str, attempts: List[Dict], success: bool) -> List[str]:
        if not attempts:
            return []
        parts = [f"Task: {task}", f"Final result: {'succeeded' if success else 'FAILED'} "
                                  f"after {len(attempts)} attempt(s)", ""]
        for i, a in enumerate(attempts[-3:], 1):
            parts.append(f"--- attempt {i} ---\nCode:\n{a['code'][:2500]}\n"
                         f"Errors: {a['errors'] or 'none'}\nChat log: {a['chat'][-600:] or 'none'}\n"
                         f"Critic: {'success' if a['success'] else a['critique'] or 'failed'}")
        try:
            reply = self.llm([SystemMessage(content=LESSON_SYSTEM),
                              HumanMessage(content="\n".join(parts))]).content.strip()
        except Exception as e:  # lessons are a bonus; never break the run over one
            print(f"\033[31mLesson writing failed: {e}\033[0m")
            return []
        if reply.upper().startswith("NONE"):
            return []
        added = []
        for line in reply.splitlines():
            text = line.strip().lstrip("-*• ").strip()
            if len(text) < 12 or len(text) > 300:
                continue
            near = self.store.similarity_search_with_score(text, k=1)
            if near and near[0][1] < 0.12:  # already know this
                continue
            self.lessons.append({"text": text, "task": task, "from": "success" if success else "failure"})
            self.store.add_texts([text], ids=[str(len(self.lessons) - 1)])
            added.append(text)
        if added:
            U.dump_json(self.lessons, self.path)
            self.store.persist()
        return added


# --------------------------------------------------------------------------- merging
MERGE_SYSTEM = """You maintain a library of Mineflayer JavaScript skills for a Minecraft bot.
Several skills below do the same job and differ only in hard-coded amounts.
Write ONE general skill that replaces them all:
- one main function: `async function {name}(bot, count = {default})` (use `count` wherever the old skills used a fixed amount),
- keep the most robust logic from the versions you see; you may call the same functions they call
  (obtainItem, mineBlock, craftItem, smeltItem, killMob, exploreUntil, placeItem, eatIfHungry, other skills...),
- no other top-level functions or variables; no `require`; report progress with bot.chat,
- reply with a single ```javascript code block and nothing else."""


def merge_family(llm: ChatModel, name: str, default: int, codes: Dict[str, str]) -> Optional[str]:
    listing = "\n\n".join(f"// {n}\n{c}" for n, c in codes.items())
    try:
        reply = llm([SystemMessage(content=MERGE_SYSTEM.replace("{name}", name).replace("{default}", str(default))),
                     HumanMessage(content=listing)]).content
    except Exception as e:
        print(f"\033[31mSkill merge failed: {e}\033[0m")
        return None
    code = extract_js(reply)
    if not re.search(r"async\s+function\s+" + re.escape(name) + r"\s*\(\s*bot\s*,", code):
        print(f"\033[31mSkill merge for {name}: reply did not define {name}(bot, count)\033[0m")
        return None
    if not js_syntax_ok(code):
        print(f"\033[31mSkill merge for {name}: syntax error, keeping the originals\033[0m")
        return None
    return code
