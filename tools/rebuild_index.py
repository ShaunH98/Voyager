"""Rebuild the local skill / QA-cache search indexes from the JSON files Voyager keeps.

Use it on the paper's bundled skill libraries (their indexes were made for chromadb + OpenAI)
or if an index ever gets out of sync with skills.json.

    python tools/rebuild_index.py skill_library/trial1 skill_library/trial2 skill_library/trial3
    python tools/rebuild_index.py ckpt
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from voyager.vectorstore import LocalVectorStore  # noqa: E402


def rebuild(root: Path):
    skills_json = root / "skill" / "skills.json"
    if skills_json.exists():
        skills = json.loads(skills_json.read_text(encoding="utf-8"))
        vdir = root / "skill" / "vectordb"
        target = vdir / "skill_vectordb.json"
        if target.exists():
            target.unlink()
        vs = LocalVectorStore("skill_vectordb", str(vdir))
        names = list(skills)
        if names:
            vs.add_texts([skills[n]["description"] for n in names], ids=names,
                         metadatas=[{"name": n} for n in names])
        vs.persist()
        print(f"{root}: {len(names)} skills indexed")
    qa_json = root / "curriculum" / "qa_cache.json"
    if qa_json.exists():
        qa = json.loads(qa_json.read_text(encoding="utf-8"))
        vdir = root / "curriculum" / "vectordb"
        target = vdir / "qa_cache_questions_vectordb.json"
        if target.exists():
            target.unlink()
        vs = LocalVectorStore("qa_cache_questions_vectordb", str(vdir))
        if qa:
            vs.add_texts(list(qa))
        vs.persist()
        print(f"{root}: {len(qa)} cached questions indexed")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for arg in sys.argv[1:]:
        rebuild(Path(arg))
