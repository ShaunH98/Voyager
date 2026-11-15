"""Start Voyager from the command line.

Examples
  python run.py --mc-port 55916                      # new run, DeepSeek, $2 cap
  python run.py --mc-port 55916 --resume             # carry on from ckpt/
  python run.py --mc-port 55916 --budget 5 --no-peak-guard
  python run.py --mc-port 55916 --task "Craft a diamond pickaxe"   # one goal, using learned skills

Keys come from environment variables or a .env file next to this script
(DEEPSEEK_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY).
"""
import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load_dotenv(path: Path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main():
    load_dotenv(HERE / ".env")
    ap = argparse.ArgumentParser(description="Run the Voyager Minecraft agent")
    ap.add_argument("--mc-port", type=int, required=True,
                    help="port shown in Minecraft after 'Open to LAN'")
    ap.add_argument("--provider", default=os.environ.get("VOYAGER_PROVIDER", "deepseek"),
                    choices=["deepseek", "openai", "openrouter", "ollama"])
    ap.add_argument("--model", default=None, help="model for every agent (default: provider's default)")
    ap.add_argument("--action-model", default=None,
                    help="separate model for the code-writing agent, e.g. deepseek-reasoner")
    ap.add_argument("--budget", type=float, default=2.0, help="stop at this estimated spend in USD (0 = no cap)")
    ap.add_argument("--no-peak-guard", action="store_true",
                    help="allow LLM calls during Adelaide weekday peak hours")
    ap.add_argument("--resume", action="store_true", help="continue from the checkpoint folder")
    ap.add_argument("--ckpt", default="ckpt", help="checkpoint folder (skills, progress, usage)")
    ap.add_argument("--iterations", type=int, default=160, help="max tasks to attempt")
    ap.add_argument("--task", default=None,
                    help="instead of exploring, solve this one goal using an existing skill library")
    args = ap.parse_args()

    from voyager import Voyager
    from voyager.llm import BudgetExceeded, METER

    common = dict(
        mc_port=args.mc_port,
        provider=args.provider,
        budget_usd=args.budget or None,
        peak_guard=not args.no_peak_guard,
        action_agent_model_name=args.action_model or args.model,
        curriculum_agent_model_name=args.model,
        curriculum_agent_qa_model_name=args.model,
        critic_agent_model_name=args.model,
        skill_manager_model_name=args.model,
        max_iterations=args.iterations,
    )
    try:
        if args.task:
            v = Voyager(**common, ckpt_dir=args.ckpt + "_task", skill_library_dir=args.ckpt, resume=False)
            v.inference(task=args.task)
        else:
            v = Voyager(**common, ckpt_dir=args.ckpt, resume=args.resume)
            v.learn()
    except BudgetExceeded as e:
        print(f"\n{e}. Progress is saved; continue with --resume and a higher --budget.")
    except KeyboardInterrupt:
        print("\nStopped. Progress is saved; continue with --resume.")
    finally:
        print(f"[usage] {METER.line()}")
        try:
            v.close()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    sys.exit(main())
