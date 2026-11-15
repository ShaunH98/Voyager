# Voyager (fork): runs on DeepSeek or any OpenAI-compatible model

This fork updates the 2023 research code so it installs and runs today, cheaply.

| Change | Why |
|---|---|
| **No more langchain / chromadb / OpenAI lock-in.** New `voyager/llm.py` talks to any OpenAI-compatible API: DeepSeek (default), OpenAI, OpenRouter, local Ollama. | The old langchain 0.0.x imports no longer work, and GPT-4 is expensive. |
| **Local, free skill search.** `voyager/vectorstore.py` uses a small on-CPU embedding model (fastembed, bge-small) and a JSON file instead of OpenAI embeddings + chromadb. | DeepSeek has no embeddings API; chromadb 0.3 no longer installs cleanly. |
| **Spending cap and cost meter.** Every call's tokens and estimated cost are logged to `ckpt/usage.json`; the run stops cleanly at `--budget` (default $2). | Voyager makes many LLM calls; this stops a runaway bill. |
| **Peak-hours guard** (on by default): pauses LLM calls Mon–Fri 11:30–14:30 and 16:30–20:30 Adelaide time. Turn off with `--no-peak-guard`. | Avoids DeepSeek peak times. |
| **Retries with backoff** on rate limits / network errors. | Long unattended runs used to die on one API blip. |
| **`run.py` command line** with `--resume`, `--task`, `--model`, `--action-model`. | No need to write Python to start a run. |
| **Works on Python 3.10+ / Node 24 / Babel 8**, and `pkg_resources` removed. | Upstream pins broke on current toolchains. |
| **Bundled skill libraries re-indexed** (`tools/rebuild_index.py`), plus `tests/smoke_test.py`. | The paper's pre-learned skills work out of the box. |
| **Much stronger built-in skills** (see below): a recursive `obtainItem` planner, safe digging, survival, combat, fishing and farming, plus a new curated `skill_library/core`. | The paper's skills pass 2–8 of 32 benchmark tasks; the new library passes 28–30. |

## Stronger skills

### New primitives (`voyager/control_primitives/`)

These are the building blocks every generated program can call:

- **`obtainItem(bot, name, count)`** works out how to get almost any survival item and does it, recursively. It gathers, mines (digging a safe staircase down to the right ore depth), smelts, hunts or crafts, chooses the cheapest recipe, and makes the tools it needs on the way. For example, `obtainItem(bot, "diamond_pickaxe")` from an empty inventory goes wood → stone → iron → diamonds.
- **Safety and reliability**:
  - every move, collect and dig is time-boxed, so the bot can't hang;
  - it won't dig into lava or water;
  - it re-digs falling gravel;
  - an anti-drowning reflex is built in;
  - crafting retries cope with the server lagging behind.
- **Survival**:
  - `eatIfHungry`, `getFood` (hunt and cook);
  - `equipBestGear` (armour, shield, best weapon);
  - `defendSelf` (backs away from creepers);
  - `buildShelter` (dig in and seal the hole);
  - `surviveNight` (sleeps if it has a bed, otherwise shelters and waits).
- **Farming and fishing**: `collectWater`, `catchFish`, `farmWheat` (till, plant, bone-meal, harvest).
- **Upgrades to the originals**:
  - `craftItem` and `smeltItem` place their own crafting table and furnace, and pick them back up afterwards; `smeltItem` picks fuel automatically.
  - `mineBlock` handles deepslate ore variants.
  - `killMob` uses the best weapon and a shield, and backs off to eat when health is low.

### Curated skill library (`skill_library/core`)

46 short, readable skills in place of the three ~50-skill libraries from the paper. Those had 120 distinct names, many near-duplicates, and 1.18-era bugs such as smelting `iron_ore`. The new library covers:

- wood and stone tools
- coal, torches, iron, copper, lapis, redstone and diamonds
- buckets, shields, armour, beds, compasses, glass and bows
- food, fishing and farming
- zombies, spiders and skeletons
- surviving the night

Rebuild it with `python tools/build_core_library.py && python tools/rebuild_index.py skill_library/core`.
Use it with `--ckpt skill_library\core`.

### Benchmark (`tests/skill_bench.py`, 32 tasks)

Each task runs the library's best-matching skill in fresh terrain on a headless 1.19 server, then checks the inventory or world state. There are no LLM calls, so it is free and repeatable.

```bash
.venv\Scripts\python tests\skill_bench.py --library skill_library\core --mc-port 25599
```

| Skill library | Tasks passed (of 32) |
|---|---|
| Paper `trial1` | 8 |
| Paper `trial2` | 3 |
| Paper `trial3` | 2 |
| **New `core`** | **28** (final full run; 27 on the run before). Every task has passed at least once. |

The failures that remain are mostly bad luck with terrain:

- dying while digging for diamonds
- no animals within 6 minutes
- nowhere to put a furnace in a cramped tunnel
- fishing that sometimes fails to land a catch

The paper libraries failed mainly on 1.18→1.19 changes, hard-coded counts, and hangs while pathfinding or digging. Raw results are in `tests/results/`.

## Quick start (Windows)

```bash
py -3.10 -m venv .venv
.venv\Scripts\python -m pip install -e .
cd voyager\env\mineflayer && npm install && cd mineflayer-collectblock && npx tsc && cd ..\..\..\..
copy .env.example .env      # then put your DEEPSEEK_API_KEY in it (or set it as an environment variable)
.venv\Scripts\python tests\smoke_test.py
```

Minecraft side: Java Edition **1.19** with Fabric and the mods in `installation/fabric_mods_install.md`.
Create a world, **Open to LAN** (cheats on), note the port, then:

```bash
.venv\Scripts\python run.py --mc-port <port>                 # explore and learn, $2 cap
.venv\Scripts\python run.py --mc-port <port> --resume        # continue
.venv\Scripts\python run.py --mc-port <port> --ckpt skill_library\core --task "Craft a diamond pickaxe"
```

The original README follows.

---

# Voyager: An Open-Ended Embodied Agent with Large Language Models
<div align="center">

[[Website]](https://voyager.minedojo.org/)
[[Arxiv]](https://arxiv.org/abs/2305.16291)
[[PDF]](https://voyager.minedojo.org/assets/documents/voyager.pdf)
[[Tweet]](https://twitter.com/DrJimFan/status/1662115266933972993?s=20)

[![Python Version](https://img.shields.io/badge/Python-3.9-blue.svg)](https://github.com/MineDojo/Voyager)
[![GitHub license](https://img.shields.io/github/license/MineDojo/Voyager)](https://github.com/MineDojo/Voyager/blob/main/LICENSE)
______________________________________________________________________


https://github.com/MineDojo/Voyager/assets/25460983/ce29f45b-43a5-4399-8fd8-5dd105fd64f2

![](images/pull.png)


</div>

We introduce Voyager, the first LLM-powered embodied lifelong learning agent
in Minecraft that continuously explores the world, acquires diverse skills, and
makes novel discoveries without human intervention. Voyager consists of three
key components: 1) an automatic curriculum that maximizes exploration, 2) an
ever-growing skill library of executable code for storing and retrieving complex
behaviors, and 3) a new iterative prompting mechanism that incorporates environment
feedback, execution errors, and self-verification for program improvement.
Voyager interacts with GPT-4 via blackbox queries, which bypasses the need for
model parameter fine-tuning. The skills developed by Voyager are temporally
extended, interpretable, and compositional, which compounds the agent’s abilities
rapidly and alleviates catastrophic forgetting. Empirically, Voyager shows
strong in-context lifelong learning capability and exhibits exceptional proficiency
in playing Minecraft. It obtains 3.3× more unique items, travels 2.3× longer
distances, and unlocks key tech tree milestones up to 15.3× faster than prior SOTA.
Voyager is able to utilize the learned skill library in a new Minecraft world to
solve novel tasks from scratch, while other techniques struggle to generalize.

In this repo, we provide Voyager code. This codebase is under [MIT License](LICENSE).

# Installation
Voyager requires Python ≥ 3.9 and Node.js ≥ 16.13.0. We have tested on Ubuntu 20.04, Windows 11, and macOS. You need to follow the instructions below to install Voyager.

## Python Install
```
git clone https://github.com/MineDojo/Voyager
cd Voyager
pip install -e .
```

## Node.js Install
In addition to the Python dependencies, you need to install the following Node.js packages:
```
cd voyager/env/mineflayer
npm install -g npx
npm install
cd mineflayer-collectblock
npx tsc
cd ..
npm install
```

## Minecraft Instance Install

Voyager depends on Minecraft game. You need to install Minecraft game and set up a Minecraft instance.

Follow the instructions in [Minecraft Login Tutorial](installation/minecraft_instance_install.md) to set up your Minecraft Instance.

## Fabric Mods Install

You need to install fabric mods to support all the features in Voyager. Remember to use the correct Fabric version of all the mods. 

Follow the instructions in [Fabric Mods Install](installation/fabric_mods_install.md) to install the mods.

# Getting Started
Voyager uses OpenAI's GPT-4 as the language model. You need to have an OpenAI API key to use Voyager. You can get one from [here](https://platform.openai.com/account/api-keys).

After the installation process, you can run Voyager by:
```python
from voyager import Voyager

# You can also use mc_port instead of azure_login, but azure_login is highly recommended
azure_login = {
    "client_id": "YOUR_CLIENT_ID",
    "redirect_url": "https://127.0.0.1/auth-response",
    "secret_value": "[OPTIONAL] YOUR_SECRET_VALUE",
    "version": "fabric-loader-0.14.18-1.19", # the version Voyager is tested on
}
openai_api_key = "YOUR_API_KEY"

voyager = Voyager(
    azure_login=azure_login,
    openai_api_key=openai_api_key,
)

# start lifelong learning
voyager.learn()
```

* If you are running with `Azure Login` for the first time, it will ask you to follow the command line instruction to generate a config file.
* For `Azure Login`, you also need to select the world and open the world to LAN by yourself. After you run `voyager.learn()` the game will pop up soon, you need to:
  1. Select `Singleplayer` and press `Create New World`.
  2. Set Game Mode to `Creative` and Difficulty to `Peaceful`.
  3. After the world is created, press `Esc` key and press `Open to LAN`.
  4. Select `Allow cheats: ON` and press `Start LAN World`. You will see the bot join the world soon. 

# Resume from a checkpoint during learning

If you stop the learning process and want to resume from a checkpoint later, you can instantiate Voyager by:
```python
from voyager import Voyager

voyager = Voyager(
    azure_login=azure_login,
    openai_api_key=openai_api_key,
    ckpt_dir="YOUR_CKPT_DIR",
    resume=True,
)
```

# Run Voyager for a specific task with a learned skill library

If you want to run Voyager for a specific task with a learned skill library, you should first pass the skill library directory to Voyager:
```python
from voyager import Voyager

# First instantiate Voyager with skill_library_dir.
voyager = Voyager(
    azure_login=azure_login,
    openai_api_key=openai_api_key,
    skill_library_dir="./skill_library/trial1", # Load a learned skill library.
    ckpt_dir="YOUR_CKPT_DIR", # Feel free to use a new dir. Do not use the same dir as skill library because new events will still be recorded to ckpt_dir. 
    resume=False, # Do not resume from a skill library because this is not learning.
)
```
Then, you can run task decomposition. Notice: Occasionally, the task decomposition may not be logical. If you notice the printed sub-goals are flawed, you can rerun the decomposition.
```python
# Run task decomposition
task = "YOUR TASK" # e.g. "Craft a diamond pickaxe"
sub_goals = voyager.decompose_task(task=task)
```
Finally, you can run the sub-goals with the learned skill library:
```python
voyager.inference(sub_goals=sub_goals)
```

For all valid skill libraries, see [Learned Skill Libraries](skill_library/README.md).

# FAQ
If you have any questions, please check our [FAQ](FAQ.md) first before opening an issue.

# Paper and Citation

If you find our work useful, please consider citing us! 

```bibtex
@article{wang2023voyager,
  title   = {Voyager: An Open-Ended Embodied Agent with Large Language Models},
  author  = {Guanzhi Wang and Yuqi Xie and Yunfan Jiang and Ajay Mandlekar and Chaowei Xiao and Yuke Zhu and Linxi Fan and Anima Anandkumar},
  year    = {2023},
  journal = {arXiv preprint arXiv: Arxiv-2305.16291}
}
```

Disclaimer: This project is strictly for research purposes, and not an official product from NVIDIA.
