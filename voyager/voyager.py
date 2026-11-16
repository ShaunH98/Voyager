import copy
import json
import re
import os
import time
from typing import Dict

import voyager.utils as U
from .env import VoyagerEnv

from .agents import ActionAgent
from .agents import CriticAgent
from .agents import CurriculumAgent
from .agents import SkillManager
from .llm import METER, PEAK, BudgetExceeded, ChatModel
from .evolution import LessonBook


# TODO: remove event memory
class Voyager:
    def __init__(
        self,
        mc_port: int = None,
        azure_login: Dict[str, str] = None,
        server_port: int = 3000,
        openai_api_key: str = None,
        provider: str = None,
        budget_usd: float = None,
        peak_guard: bool = False,
        evolve: bool = True,
        repair_every: int = 6,
        env_wait_ticks: int = 20,
        env_request_timeout: int = 600,
        max_iterations: int = 160,
        reset_placed_if_failed: bool = False,
        action_agent_model_name: str = None,
        action_agent_temperature: float = 0,
        action_agent_task_max_retries: int = 4,
        action_agent_show_chat_log: bool = True,
        action_agent_show_execution_error: bool = True,
        curriculum_agent_model_name: str = None,
        curriculum_agent_temperature: float = 0,
        curriculum_agent_qa_model_name: str = None,
        curriculum_agent_qa_temperature: float = 0,
        curriculum_agent_warm_up: Dict[str, int] = None,
        curriculum_agent_core_inventory_items: str = r".*_log|.*_planks|stick|crafting_table|furnace"
        r"|cobblestone|dirt|coal|.*_pickaxe|.*_sword|.*_axe",
        curriculum_agent_mode: str = "auto",
        critic_agent_model_name: str = None,
        critic_agent_temperature: float = 0,
        critic_agent_mode: str = "auto",
        skill_manager_model_name: str = None,
        skill_manager_temperature: float = 0,
        skill_manager_retrieval_top_k: int = 5,
        openai_api_request_timeout: int = 240,
        ckpt_dir: str = "ckpt",
        skill_library_dir: str = None,
        resume: bool = False,
    ):
        """
        The main class for Voyager.
        Action agent is the iterative prompting mechanism in paper.
        Curriculum agent is the automatic curriculum in paper.
        Critic agent is the self-verification in paper.
        Skill manager is the skill library in paper.
        :param mc_port: minecraft in-game port
        :param azure_login: minecraft login config
        :param server_port: mineflayer port
        :param openai_api_key: openai api key (only for provider="openai"; otherwise use env vars / .env)
        :param provider: deepseek (default) | openai | openrouter | ollama; model names default per provider
        :param budget_usd: stop the run once estimated LLM spend reaches this many US dollars
        :param peak_guard: pause LLM calls Mon-Fri 11:30-14:30 and 16:30-20:30 Adelaide time
        :param env_wait_ticks: how many ticks at the end each step will wait, if you found some chat log missing,
        you should increase this value
        :param env_request_timeout: how many seconds to wait for each step, if the code execution exceeds this time,
        python side will terminate the connection and need to be resumed
        :param reset_placed_if_failed: whether to reset placed blocks if failed, useful for building task
        :param action_agent_model_name: action agent model name
        :param action_agent_temperature: action agent temperature
        :param action_agent_task_max_retries: how many times to retry if failed
        :param curriculum_agent_model_name: curriculum agent model name
        :param curriculum_agent_temperature: curriculum agent temperature
        :param curriculum_agent_qa_model_name: curriculum agent qa model name
        :param curriculum_agent_qa_temperature: curriculum agent qa temperature
        :param curriculum_agent_warm_up: info will show in curriculum human message
        if completed task larger than the value in dict, available keys are:
        {
            "context": int,
            "biome": int,
            "time": int,
            "other_blocks": int,
            "nearby_entities": int,
            "health": int,
            "hunger": int,
            "position": int,
            "equipment": int,
            "chests": int,
            "optional_inventory_items": int,
        }
        :param curriculum_agent_core_inventory_items: only show these items in inventory before optional_inventory_items
        reached in warm up
        :param curriculum_agent_mode: "auto" for automatic curriculum, "manual" for human curriculum
        :param critic_agent_model_name: critic agent model name
        :param critic_agent_temperature: critic agent temperature
        :param critic_agent_mode: "auto" for automatic critic ,"manual" for human critic
        :param skill_manager_model_name: skill manager model name
        :param skill_manager_temperature: skill manager temperature
        :param skill_manager_retrieval_top_k: how many skills to retrieve for each task
        :param openai_api_request_timeout: how many seconds to wait for openai api
        :param ckpt_dir: checkpoint dir
        :param skill_library_dir: skill library dir
        :param resume: whether to resume from checkpoint
        """
        # init env
        self.env = VoyagerEnv(
            mc_port=mc_port,
            azure_login=azure_login,
            server_port=server_port,
            request_timeout=env_request_timeout,
        )
        self.env_wait_ticks = env_wait_ticks
        self.reset_placed_if_failed = reset_placed_if_failed
        self.max_iterations = max_iterations

        # set openai api key
        if openai_api_key:
            os.environ["OPENAI_API_KEY"] = openai_api_key
        if provider:
            os.environ["VOYAGER_PROVIDER"] = provider
        U.f_mkdir(ckpt_dir)
        METER.attach(f"{ckpt_dir}/usage.json", budget_usd, resume)
        PEAK.__init__(enabled=peak_guard)

        # init agents
        self.action_agent = ActionAgent(
            model_name=action_agent_model_name,
            temperature=action_agent_temperature,
            request_timout=openai_api_request_timeout,
            ckpt_dir=ckpt_dir,
            resume=resume,
            chat_log=action_agent_show_chat_log,
            execution_error=action_agent_show_execution_error,
        )
        self.action_agent_task_max_retries = action_agent_task_max_retries
        self.curriculum_agent = CurriculumAgent(
            model_name=curriculum_agent_model_name,
            temperature=curriculum_agent_temperature,
            qa_model_name=curriculum_agent_qa_model_name,
            qa_temperature=curriculum_agent_qa_temperature,
            request_timout=openai_api_request_timeout,
            ckpt_dir=ckpt_dir,
            resume=resume,
            mode=curriculum_agent_mode,
            warm_up=curriculum_agent_warm_up,
            core_inventory_items=curriculum_agent_core_inventory_items,
        )
        self.critic_agent = CriticAgent(
            model_name=critic_agent_model_name,
            temperature=critic_agent_temperature,
            request_timout=openai_api_request_timeout,
            mode=critic_agent_mode,
        )
        self.skill_manager = SkillManager(
            model_name=skill_manager_model_name,
            temperature=skill_manager_temperature,
            retrieval_top_k=skill_manager_retrieval_top_k,
            request_timout=openai_api_request_timeout,
            ckpt_dir=skill_library_dir if skill_library_dir else ckpt_dir,
            resume=True if resume or skill_library_dir else False,
        )
        self.recorder = U.EventRecorder(ckpt_dir=ckpt_dir, resume=resume)
        self.resume = resume

        # evolution (see voyager/evolution.py): lessons live next to the skill library
        self.evolve = evolve
        # home base memory (what the bot has built, where home is), kept per world
        self.base_path = f"{ckpt_dir}/base.json"
        self.base = U.load_json(self.base_path) if resume and os.path.exists(self.base_path) else None
        self.repair_every = repair_every
        self._since_repair = 0
        self._attempts = []
        self.lesson_text = ""
        self.lessons = (
            LessonBook(
                ckpt_dir=skill_library_dir if skill_library_dir else ckpt_dir,
                resume=True if resume or skill_library_dir else False,
                llm=ChatModel(model_name=skill_manager_model_name, temperature=0,
                              request_timeout=openai_api_request_timeout, agent="lessons"),
            )
            if evolve
            else None
        )

        # init variables for rollout
        self.action_agent_rollout_num_iter = -1
        self.task = None
        self.context = ""
        self.messages = None
        self.conversations = []
        self.last_events = None

    def reset(self, task, context="", reset_env=True):
        self.action_agent_rollout_num_iter = 0
        self.task = task
        self.context = context
        if reset_env:
            self.env.reset(
                options={
                    "mode": "soft",
                    "wait_ticks": self.env_wait_ticks,
                }
            )
        difficulty = (
            "easy" if len(self.curriculum_agent.completed_tasks) > 15 else "peaceful"
        )
        # step to peek an observation
        events = self.env.step(
            "bot.chat(`/time set ${getNextTime()}`);\n"
            + f"bot.chat('/difficulty {difficulty}');"
        )
        skills = self.skill_manager.retrieve_skills(query=self.context)
        print(
            f"\033[33mRender Action Agent system message with {len(skills)} skills\033[0m"
        )
        self._attempts = []
        self.lesson_text = self.lessons.render(f"{task}. {context}") if self.lessons else ""
        if self.lesson_text:
            print(f"\033[36m{self.lesson_text}\033[0m")
        system_message = self.action_agent.render_system_message(skills=skills)
        human_message = self.action_agent.render_human_message(
            events=events, code="", task=self.task, context=self._context_with_lessons(), critique=""
        )
        self.messages = [system_message, human_message]
        print(
            f"\033[32m****Action Agent human message****\n{human_message.content}\033[0m"
        )
        assert len(self.messages) == 2
        self.conversations = []
        return self.messages

    def _programs(self):
        base = json.dumps(self.base) if self.base else "null"
        return (
            f"var _V_BASE_SAVED = {base};\n"
            + self.skill_manager.programs
            + "\ntry { getBase(bot); } catch (e) {}\n"
        )

    def _absorb_base(self, events):
        for t, e in events:
            s = e.get("onSave") if t == "onSave" else None
            if s and s.startswith("base:"):
                try:
                    self.base = json.loads(s[5:])
                except json.JSONDecodeError:
                    continue
                U.dump_json(self.base, self.base_path)

    @staticmethod
    def _verification_marker(task):
        t = (task or "").lower()
        if "sleep" in t and "home" in t:
            return "slept"
        if ("store" in t or "deposit" in t) and "home" in t:
            return "stored"
        if not re.search(r"\b(build|construct|make|set up)\b", t):
            return None
        if "storage" in t:
            return "built:storage"
        if "farm" in t:
            return "built:farm"
        if re.search(r"\bpen\b", t):
            m = re.search(r"\b(cow|sheep|pig|chicken|rabbit|goat|mooshroom)s?\b", t)
            return f"penned:{m.group(1)}" if m else "built:pen"
        if re.search(r"\b(home|house|hut|cottage|cabin|base)\b", t):
            return "built:hut"
        return None

    def _base_summary(self):
        b = self.base or {}
        built = [s for s in b.get("structures", []) if s.get("ok")]
        if not built:
            return "Home base: none yet\n\n"
        names = {"hut": "home (hut with bed, chest, crafting table, furnace)", "storage": "storage chests",
                 "farm": "wheat farm", "pen": "animal pen"}
        have = sorted({names.get(s["type"], s["type"]) for s in built})
        h = b.get("home") or {}
        where = f" at x={h.get('x')}, y={h.get('y')}, z={h.get('z')}" if h else ""
        missing = [names[k] for k in ("hut", "storage", "farm", "pen") if k not in {s["type"] for s in built}]
        return (f"Home base{where}: built {', '.join(have)}"
                + (f"; not built yet: {', '.join(missing)}" if missing else "") + "\n\n")

    def _context_with_lessons(self):
        if not self.lesson_text:
            return self.context
        return (self.context + "\n\n" if self.context else "") + self.lesson_text

    def _record_attempt(self, code, events, success, critique):
        errors = "\n".join(e["onError"] for t, e in events if t == "onError")
        chat = "\n".join(e["onChat"] for t, e in events if t == "onChat")
        self._attempts.append(
            {"code": code, "errors": errors, "chat": chat, "success": success, "critique": critique}
        )
        if self.evolve:
            used = self.skill_manager.used_in(code)
            self.skill_manager.stats.record(used, success, note=errors or critique)

    def close(self):
        self.env.close()

    def step(self):
        if self.action_agent_rollout_num_iter < 0:
            raise ValueError("Agent must be reset before stepping")
        ai_message = self.action_agent.llm(self.messages)
        print(f"\033[34m****Action Agent ai message****\n{ai_message.content}\033[0m")
        self.conversations.append(
            (self.messages[0].content, self.messages[1].content, ai_message.content)
        )
        parsed_result = self.action_agent.process_ai_message(message=ai_message)
        success = False
        if isinstance(parsed_result, dict):
            code = parsed_result["program_code"] + "\n" + parsed_result["exec_code"]
            events = self.env.step(
                code,
                programs=self._programs(),
            )
            self.recorder.record(events, self.task)
            self.action_agent.update_chest_memory(events[-1][1]["nearbyChests"])
            success, critique = self.critic_agent.check_task_success(
                events=events,
                task=self.task,
                context=self.context,
                chest_observation=self.action_agent.render_chest_observation(),
                max_retries=5,
            )
            self._absorb_base(events)
            marker = self._verification_marker(self.task)
            if marker:
                # building / home tasks are checked by the builder itself, block by block
                saves = [e["onSave"] for t, e in events if t == "onSave" and e.get("onSave")]
                success = any(s == marker or s.startswith(marker) for s in saves)
                critique = "" if success else (
                    f"Not confirmed: the code never reported '{marker}'. Use the building functions "
                    f"(buildHome, buildStorage, storeItems, buildWheatFarm, buildAnimalPen, sleepAtHome) "
                    f"and read their chat messages to see what was missing."
                )
            self._record_attempt(code, events, success, critique)

            if self.reset_placed_if_failed and not success:
                # revert all the placing event in the last step
                blocks = []
                positions = []
                for event_type, event in events:
                    if event_type == "onSave" and event["onSave"].endswith("_placed"):
                        block = event["onSave"].split("_placed")[0]
                        position = event["status"]["position"]
                        blocks.append(block)
                        positions.append(position)
                new_events = self.env.step(
                    f"await givePlacedItemBack(bot, {U.json_dumps(blocks)}, {U.json_dumps(positions)})",
                    programs=self._programs(),
                )
                events[-1][1]["inventory"] = new_events[-1][1]["inventory"]
                events[-1][1]["voxels"] = new_events[-1][1]["voxels"]
            new_skills = self.skill_manager.retrieve_skills(
                query=self.context
                + "\n\n"
                + self.action_agent.summarize_chatlog(events)
            )
            system_message = self.action_agent.render_system_message(skills=new_skills)
            human_message = self.action_agent.render_human_message(
                events=events,
                code=parsed_result["program_code"],
                task=self.task,
                context=self._context_with_lessons(),
                critique=critique,
            )
            self.last_events = copy.deepcopy(events)
            self.messages = [system_message, human_message]
        else:
            assert isinstance(parsed_result, str)
            self.recorder.record([], self.task)
            print(f"\033[34m{parsed_result} Trying again!\033[0m")
        assert len(self.messages) == 2
        self.action_agent_rollout_num_iter += 1
        done = (
            self.action_agent_rollout_num_iter >= self.action_agent_task_max_retries
            or success
        )
        info = {
            "task": self.task,
            "success": success,
            "conversations": self.conversations,
        }
        if success:
            assert (
                "program_code" in parsed_result and "program_name" in parsed_result
            ), "program and program_name must be returned when success"
            info["program_code"] = parsed_result["program_code"]
            info["program_name"] = parsed_result["program_name"]
        else:
            print(
                f"\033[32m****Action Agent human message****\n{self.messages[-1].content}\033[0m"
            )
        return self.messages, 0, done, info

    def rollout(self, *, task, context, reset_env=True):
        self.reset(task=task, context=context, reset_env=reset_env)
        while True:
            messages, reward, done, info = self.step()
            if done:
                break
        return messages, reward, done, info

    def learn(self, reset_env=True):
        if self.resume:
            # keep the inventory
            self.env.reset(
                options={
                    "mode": "soft",
                    "wait_ticks": self.env_wait_ticks,
                }
            )
        else:
            # clear the inventory
            self.env.reset(
                options={
                    "mode": "hard",
                    "wait_ticks": self.env_wait_ticks,
                }
            )
            self.resume = True
        self.last_events = self.env.step("")
        if self.evolve:
            self.skill_manager.consolidate()

        while True:
            if self.recorder.iteration > self.max_iterations:
                print("Iteration limit reached")
                break
            if self.evolve and self._since_repair >= self.repair_every:
                self._since_repair = 0
                if self.repair_weakest_skill(reset_env):
                    continue
            task, context = self._propose_task()
            print(
                f"\033[35mStarting task {task} for at most {self.action_agent_task_max_retries} times\033[0m"
            )
            try:
                messages, reward, done, info = self.rollout(
                    task=task,
                    context=context,
                    reset_env=reset_env,
                )
            except BudgetExceeded:
                raise
            except Exception as e:
                time.sleep(3)  # wait for mineflayer to exit
                info = {
                    "task": task,
                    "success": False,
                }
                # reset bot status here
                self.last_events = self.env.reset(
                    options={
                        "mode": "hard",
                        "wait_ticks": self.env_wait_ticks,
                        "inventory": self.last_events[-1][1]["inventory"],
                        "equipment": self.last_events[-1][1]["status"]["equipment"],
                        "position": self.last_events[-1][1]["status"]["position"],
                    }
                )
                # use red color background to print the error
                print("Your last round rollout terminated due to error:")
                print(f"\033[41m{e}\033[0m")

            if info["success"]:
                self.skill_manager.add_new_skill(info)
            self._learn_lessons(task, info["success"])
            self._since_repair += 1

            self.curriculum_agent.update_exploration_progress(info)
            print(
                f"\033[35mCompleted tasks: {', '.join(self.curriculum_agent.completed_tasks)}\033[0m"
            )
            print(
                f"\033[35mFailed tasks: {', '.join(self.curriculum_agent.failed_tasks)}\033[0m"
            )
            print(f"\033[36m[usage] {METER.line()}\033[0m")

        return {
            "completed_tasks": self.curriculum_agent.completed_tasks,
            "failed_tasks": self.curriculum_agent.failed_tasks,
            "skills": self.skill_manager.skills,
        }

    # ------------------------------------------------------------------ evolution helpers
    def _propose_task(self):
        """Ask the curriculum for a task, refusing ones that already failed twice."""
        cur = self.curriculum_agent
        task = context = None
        cur.base_note = self._base_summary()
        inv_used = self.last_events[-1][1]["status"]["inventoryUsed"] if self.last_events else 0
        has_home = any(s.get("type") == "hut" and s.get("ok") for s in (self.base or {}).get("structures", []))
        if has_home and inv_used >= 30 and cur.failed_tasks.count("Store items at home") < 2:
            return "Store items at home", (
                f"My inventory has {inv_used}/36 slots used. Call `await storeItems(bot);` to take junk and "
                "surplus blocks to the storage chests at home (it builds them if needed)."
            )
        for _ in range(3):
            task, context = cur.propose_next_task(
                events=self.last_events,
                chest_observation=self.action_agent.render_chest_observation(),
                max_retries=5,
            )
            if not self.evolve or cur.failed_tasks.count(task) < 2:
                break
            print(f"\033[35mSkipping '{task}': it has already failed {cur.failed_tasks.count(task)} times\033[0m")
            hopeless = sorted({t for t in cur.failed_tasks if cur.failed_tasks.count(t) >= 2})
            cur.extra_note = (
                "These tasks failed repeatedly; do NOT propose them or close variants of them: "
                + "; ".join(hopeless) + "\n\n"
            )
        cur.extra_note = ""
        return task, context

    def _learn_lessons(self, task, success):
        if not self.lessons or not self._attempts:
            return
        if success and len(self._attempts) < 2:
            return  # first-try successes rarely teach anything new
        for lesson in self.lessons.learn(task, self._attempts, success):
            print(f"\033[36mLearned lesson: {lesson}\033[0m")

    def repair_weakest_skill(self, reset_env=True):
        """Rewrite the skill with the worst track record; keep the new version only if it works."""
        sm = self.skill_manager
        name = sm.stats.weakest(sm.skills)
        if not name:
            return False
        stats = sm.stats.d[name]
        stats["repairs"] += 1
        sm.stats.save()
        entry = sm.skills[name]
        task = entry.get("task")
        if not task:
            desc = entry["description"].split("//", 1)[-1].rsplit("}", 1)[0].strip()
            task = desc.split(". ")[0].rstrip(".")
        problems = "\n".join(f"- {n}" for n in stats["notes"]) or "- (no details recorded)"
        context = (
            f"This task rewrites the existing skill `{name}`, which failed {stats['fails']} of its "
            f"{stats['uses']} recent uses. Recent problems:\n{problems}\n\nCurrent code:\n{entry['code']}\n\n"
            f"Write a more reliable version. Name the main function exactly `{name}` and do not call `{name}` itself."
        )
        print(f"\033[35mRepairing weak skill {name} via task: {task}\033[0m")
        try:
            _, _, _, info = self.rollout(task=task, context=context, reset_env=reset_env)
        except BudgetExceeded:
            raise
        except Exception as e:
            print(f"\033[41mRepair of {name} crashed: {e}\033[0m")
            self.last_events = self.env.reset(options={"mode": "soft", "wait_ticks": self.env_wait_ticks})
            return True
        if info["success"]:
            code = info["program_code"]
            if info["program_name"] != name:
                code = re.sub(r"async\s+function\s+" + re.escape(info["program_name"]) + r"\s*\(",
                              f"async function {name}(", code, count=1)
            sm.add_new_skill({"task": task, "program_name": name, "program_code": code, "repair": True})
            print(f"\033[35mRepaired skill {name}\033[0m")
        else:
            print(f"\033[35mCould not repair {name}; keeping the current version\033[0m")
        self._learn_lessons(task, info["success"])
        return True

    def decompose_task(self, task):
        if not self.last_events:
            self.last_events = self.env.reset(
                options={
                    "mode": "hard",
                    "wait_ticks": self.env_wait_ticks,
                }
            )
        return self.curriculum_agent.decompose_task(task, self.last_events)

    def inference(self, task=None, sub_goals=[], reset_mode="hard", reset_env=True):
        if not task and not sub_goals:
            raise ValueError("Either task or sub_goals must be provided")
        if not sub_goals:
            sub_goals = self.decompose_task(task)
        self.env.reset(
            options={
                "mode": reset_mode,
                "wait_ticks": self.env_wait_ticks,
            }
        )
        self.curriculum_agent.completed_tasks = []
        self.curriculum_agent.failed_tasks = []
        self.last_events = self.env.step("")
        while self.curriculum_agent.progress < len(sub_goals):
            next_task = sub_goals[self.curriculum_agent.progress]
            context = self.curriculum_agent.get_task_context(next_task)
            print(
                f"\033[35mStarting task {next_task} for at most {self.action_agent_task_max_retries} times\033[0m"
            )
            messages, reward, done, info = self.rollout(
                task=next_task,
                context=context,
                reset_env=reset_env,
            )
            self.curriculum_agent.update_exploration_progress(info)
            print(
                f"\033[35mCompleted tasks: {', '.join(self.curriculum_agent.completed_tasks)}\033[0m"
            )
            print(
                f"\033[35mFailed tasks: {', '.join(self.curriculum_agent.failed_tasks)}\033[0m"
            )
