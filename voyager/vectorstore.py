"""Tiny local vector store (replaces chromadb + OpenAI embeddings).

Embeddings come from a small model run on your own CPU via fastembed (BAAI/bge-small-en-v1.5,
~70 MB, downloaded once), so skill search costs nothing and works with providers that have no
embeddings API (DeepSeek). Data is a plain JSON file per collection.

Scores returned by `similarity_search_with_score` are squared L2 distances between unit vectors
(0 = identical), the same scale chromadb used, so the original thresholds still apply.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np

_MODEL = None
EMBED_MODEL = os.environ.get("VOYAGER_EMBED_MODEL", "BAAI/bge-small-en-v1.5")


def embed(texts: List[str]) -> np.ndarray:
    global _MODEL
    if _MODEL is None:
        from fastembed import TextEmbedding

        _MODEL = TextEmbedding(model_name=EMBED_MODEL)
    vecs = np.array(list(_MODEL.embed(texts)), dtype=np.float32)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    return vecs / np.clip(norms, 1e-12, None)


@dataclass
class Document:
    page_content: str
    metadata: Dict = field(default_factory=dict)


class _Collection:
    def __init__(self, store: "LocalVectorStore"):
        self._s = store

    def count(self) -> int:
        return len(self._s.ids)

    def delete(self, ids: List[str]):
        self._s.delete(ids)


class LocalVectorStore:
    def __init__(self, collection_name: str, persist_directory: str):
        os.makedirs(persist_directory, exist_ok=True)
        self.path = os.path.join(persist_directory, f"{collection_name}.json")
        self.ids: List[str] = []
        self.texts: List[str] = []
        self.metas: List[Dict] = []
        self.vecs = np.zeros((0, 0), dtype=np.float32)
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                d = json.load(f)
            if d.get("model") not in (None, EMBED_MODEL):
                raise RuntimeError(
                    f"{self.path} was built with embedding model {d.get('model')}, not {EMBED_MODEL}"
                )
            self.ids, self.texts, self.metas = d["ids"], d["texts"], d["metas"]
            self.vecs = np.array(d["vecs"], dtype=np.float32)
        self._collection = _Collection(self)

    def add_texts(self, texts: List[str], ids: Optional[List[str]] = None,
                  metadatas: Optional[List[Dict]] = None):
        ids = ids or [f"id{len(self.ids) + i}" for i in range(len(texts))]
        metadatas = metadatas or [{} for _ in texts]
        new = embed(texts)
        self.vecs = new if self.vecs.size == 0 else np.vstack([self.vecs, new])
        self.ids += list(ids)
        self.texts += list(texts)
        self.metas += list(metadatas)

    def delete(self, ids: List[str]):
        keep = [i for i, x in enumerate(self.ids) if x not in set(ids)]
        self.ids = [self.ids[i] for i in keep]
        self.texts = [self.texts[i] for i in keep]
        self.metas = [self.metas[i] for i in keep]
        self.vecs = self.vecs[keep] if keep else np.zeros((0, 0), dtype=np.float32)

    def similarity_search_with_score(self, query: str, k: int = 4) -> List[Tuple[Document, float]]:
        if not self.ids:
            return []
        q = embed([query])[0]
        dist = 2.0 - 2.0 * (self.vecs @ q)  # squared L2 between unit vectors
        order = np.argsort(dist)[:k]
        return [(Document(self.texts[i], self.metas[i]), float(dist[i])) for i in order]

    def persist(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"model": EMBED_MODEL, "ids": self.ids, "texts": self.texts,
                       "metas": self.metas, "vecs": self.vecs.tolist()}, f)
        os.replace(tmp, self.path)
