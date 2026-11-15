import os as _os
import voyager.utils as U


def load_prompt(prompt):
    package_path = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
    return U.load_text(f"{package_path}/prompts/{prompt}.txt")
