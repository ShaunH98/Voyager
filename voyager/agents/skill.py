import os
from pathlib import Path

import voyager.utils as U
from voyager.evolution import (SkillStats, called_skills, generic_name, merge_family,
                               name_count, skill_family)
from voyager.llm import ChatModel, HumanMessage, SystemMessage
from voyager.vectorstore import LocalVectorStore

from voyager.prompts import load_prompt
from voyager.control_primitives import load_control_primitives


class SkillManager:
    def __init__(
        self,
        model_name="gpt-3.5-turbo",
        temperature=0,
        retrieval_top_k=5,
        request_timout=120,
        ckpt_dir="ckpt",
        resume=False,
    ):
        self.llm = ChatModel(
            model_name=model_name,
            temperature=temperature,
            request_timeout=request_timout,
            agent="skill",
        )
        U.f_mkdir(f"{ckpt_dir}/skill/code")
        U.f_mkdir(f"{ckpt_dir}/skill/description")
        U.f_mkdir(f"{ckpt_dir}/skill/vectordb")
        # programs for env execution
        self.control_primitives = load_control_primitives()
        if resume:
            print(f"\033[33mLoading Skill Manager from {ckpt_dir}/skill\033[0m")
            self.skills = U.load_json(f"{ckpt_dir}/skill/skills.json")
        else:
            self.skills = {}
        self.retrieval_top_k = retrieval_top_k
        self.ckpt_dir = ckpt_dir
        # evolution: per-skill track record, retired skills (still callable, no longer offered),
        # and the core skills that merging never touches
        self.stats = SkillStats(f"{ckpt_dir}/skill/fitness.json", resume)
        retired_path = f"{ckpt_dir}/skill/retired.json"
        self.retired = U.load_json(retired_path) if resume and os.path.exists(retired_path) else {}
        core = Path(__file__).resolve().parents[2] / "skill_library" / "core" / "skill" / "skills.json"
        self.protected = set(U.load_json(str(core))) if core.exists() else set()
        self.vectordb = LocalVectorStore(
            collection_name="skill_vectordb",
            persist_directory=f"{ckpt_dir}/skill/vectordb",
        )
        assert self.vectordb._collection.count() == len(self.skills), (
            f"Skill Manager's vectordb is not synced with skills.json.\n"
            f"There are {self.vectordb._collection.count()} skills in vectordb but {len(self.skills)} skills in skills.json.\n"
            f"Did you set resume=False when initializing the manager?\n"
            f"You may need to manually delete the vectordb directory for running from scratch."
        )

    @property
    def programs(self):
        programs = ""
        for skill_name, code in self.retired.items():  # old code may still call these
            if skill_name not in self.skills:
                programs += f"{code}\n\n"
        for skill_name, entry in self.skills.items():
            programs += f"{entry['code']}\n\n"
        for primitives in self.control_primitives:
            programs += f"{primitives}\n\n"
        return programs

    def add_new_skill(self, info):
        if info["task"].startswith("Deposit useless items into the chest at"):
            # No need to reuse the deposit skill
            return
        program_name = info["program_name"]
        program_code = info["program_code"]
        repair = info.get("repair", False)
        if program_name in self.protected and program_name in self.skills and not repair:
            print(f"[33m{program_name} is a core skill; keeping the tested version[0m")
            return
        if program_name not in self.skills:
            fam = skill_family(program_name)
            same = [n for n in self.skills if skill_family(n) == fam]
            core = [n for n in same if n in self.protected]
            if core:
                print(f"[33m{program_name} is a variant of core skill {core[0]}; not adding it[0m")
                return
            if same and self._merge(same + [program_name], {program_name: program_code}, info):
                return
        self._store(program_name, program_code, info.get("task"))

    def _merge(self, names, extra_code, info=None):
        """Replace skills that differ only by amounts with one skill that takes `count`."""
        codes = {n: self.skills[n]["code"] for n in names if n in self.skills}
        codes.update(extra_code)
        target = generic_name(names[-1])
        if target in self.skills and target not in names:
            target += "Count"
        counts = [c for c in (name_count(n) for n in names) if c]
        default = max(set(counts), key=counts.count) if counts else 1
        print(f"[33mMerging {', '.join(codes)} into {target}(bot, count)[0m")
        merged = merge_family(self.llm, target, default, codes)
        if not merged:
            return False
        for n in names:
            if n in self.skills:
                self._retire(n)
        self._store(target, merged, (info or {}).get("task"), origin="merged")
        return True

    def _retire(self, name):
        entry = self.skills.pop(name)
        self.retired[name] = entry["code"]
        self.vectordb._collection.delete(ids=[name])
        self.stats.drop(name)
        U.dump_json(self.retired, f"{self.ckpt_dir}/skill/retired.json")
        U.dump_json(self.skills, f"{self.ckpt_dir}/skill/skills.json")
        self.vectordb.persist()
        print(f"[33mRetired skill {name}[0m")

    def consolidate(self):
        """One pass over the library: drop learned variants of core skills, merge amount-variants."""
        families = {}
        for n in list(self.skills):
            families.setdefault(skill_family(n), []).append(n)
        for fam, names in families.items():
            if len(names) < 2:
                continue
            learned = [n for n in names if n not in self.protected]
            if len(learned) < len(names):  # a core skill already covers this family
                for n in learned:
                    self._retire(n)
            elif len(learned) >= 2:
                self._merge(learned, {})

    def _store(self, program_name, program_code, task=None, origin="learned"):
        self.retired.pop(program_name, None)
        skill_description = self.generate_skill_description(program_name, program_code)
        print(
            f"\033[33mSkill Manager generated description for {program_name}:\n{skill_description}\033[0m"
        )
        if program_name in self.skills:
            print(f"\033[33mSkill {program_name} already exists. Rewriting!\033[0m")
            self.vectordb._collection.delete(ids=[program_name])
            i = 2
            while f"{program_name}V{i}.js" in os.listdir(f"{self.ckpt_dir}/skill/code"):
                i += 1
            dumped_program_name = f"{program_name}V{i}"
        else:
            dumped_program_name = program_name
        self.vectordb.add_texts(
            texts=[skill_description],
            ids=[program_name],
            metadatas=[{"name": program_name}],
        )
        self.skills[program_name] = {
            "code": program_code,
            "description": skill_description,
            "task": task,
            "origin": origin,
        }
        self.stats.reset(program_name)
        U.dump_json(self.retired, f"{self.ckpt_dir}/skill/retired.json")
        assert self.vectordb._collection.count() == len(
            self.skills
        ), "vectordb is not synced with skills.json"
        U.dump_text(
            program_code, f"{self.ckpt_dir}/skill/code/{dumped_program_name}.js"
        )
        U.dump_text(
            skill_description,
            f"{self.ckpt_dir}/skill/description/{dumped_program_name}.txt",
        )
        U.dump_json(self.skills, f"{self.ckpt_dir}/skill/skills.json")
        self.vectordb.persist()

    def generate_skill_description(self, program_name, program_code):
        messages = [
            SystemMessage(content=load_prompt("skill")),
            HumanMessage(
                content=program_code
                + "\n\n"
                + f"The main function is `{program_name}`."
            ),
        ]
        skill_description = f"    // { self.llm(messages).content}"
        return f"async function {program_name}(bot) {{\n{skill_description}\n}}"

    def retrieve_skills(self, query):
        k = min(self.vectordb._collection.count(), self.retrieval_top_k)
        if k == 0:
            return []
        print(f"\033[33mSkill Manager retrieving for {k} skills\033[0m")
        docs_and_scores = self.vectordb.similarity_search_with_score(query, k=k)
        print(
            f"\033[33mSkill Manager retrieved skills: "
            f"{', '.join([doc.metadata['name'] for doc, _ in docs_and_scores])}\033[0m"
        )
        skills = []
        for doc, _ in docs_and_scores:
            name = doc.metadata["name"]
            skills.append(self.stats.label(name) + "\n" + self.skills[name]["code"])
        return skills

    def used_in(self, code):
        return called_skills(code, self.skills.keys())
