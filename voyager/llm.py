"""Provider-agnostic chat models for Voyager (replaces the old langchain/OpenAI-only code).

Any OpenAI-compatible API works: DeepSeek (default), OpenAI, OpenRouter, a local Ollama server, ...
Every call is retried with backoff, its token use is added to a shared cost meter, and a run can be
given a spending cap and a "no DeepSeek in Adelaide peak hours" guard.
"""
from __future__ import annotations

import json
import os
import random
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Tuple

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None


# ---------------------------------------------------------------- messages
@dataclass
class BaseMessage:
    content: str
    role: str = field(default="user", init=False)


@dataclass
class SystemMessage(BaseMessage):
    role: str = field(default="system", init=False)


@dataclass
class HumanMessage(BaseMessage):
    role: str = field(default="user", init=False)


@dataclass
class AIMessage(BaseMessage):
    role: str = field(default="assistant", init=False)


# ---------------------------------------------------------------- providers
# base_url, env var holding the key, default model
PROVIDERS: Dict[str, Tuple[str, str, str]] = {
    "deepseek": ("https://api.deepseek.com", "DEEPSEEK_API_KEY", "deepseek-chat"),
    "openai": ("https://api.openai.com/v1", "OPENAI_API_KEY", "gpt-4o"),
    "openrouter": ("https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", "anthropic/claude-sonnet-4"),
    "ollama": ("http://localhost:11434/v1", "OLLAMA_API_KEY", "qwen2.5-coder:14b"),
}

# USD per 1M tokens (input, output). Estimates only - edit to match your provider's price list.
PRICES: Dict[str, Tuple[float, float]] = {
    "deepseek-chat": (0.28, 0.42),
    "deepseek-reasoner": (0.28, 0.42),
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
}


class BudgetExceeded(RuntimeError):
    pass


class CostMeter:
    """Shared token/cost counter for a whole run. Persists to <ckpt>/usage.json."""

    def __init__(self):
        self.budget_usd: Optional[float] = None
        self.path: Optional[str] = None
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.cost_usd = 0.0
        self.by_agent: Dict[str, Dict[str, float]] = {}

    def attach(self, path: str, budget_usd: Optional[float], resume: bool):
        self.path, self.budget_usd = path, budget_usd
        if resume and os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
            self.calls = d.get("calls", 0)
            self.input_tokens = d.get("input_tokens", 0)
            self.output_tokens = d.get("output_tokens", 0)
            self.cost_usd = d.get("cost_usd", 0.0)
            self.by_agent = d.get("by_agent", {})

    def add(self, agent: str, model: str, tin: int, tout: int):
        pin, pout = PRICES.get(model, (0.0, 0.0))
        cost = tin / 1e6 * pin + tout / 1e6 * pout
        self.calls += 1
        self.input_tokens += tin
        self.output_tokens += tout
        self.cost_usd += cost
        a = self.by_agent.setdefault(agent, {"calls": 0, "cost_usd": 0.0})
        a["calls"] += 1
        a["cost_usd"] += cost
        if self.path:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self.summary(), f, indent=2)

    def check_budget(self):
        if self.budget_usd is not None and self.cost_usd >= self.budget_usd:
            raise BudgetExceeded(
                f"Spending cap reached: ${self.cost_usd:.3f} of ${self.budget_usd:.2f}"
            )

    def summary(self) -> dict:
        return {
            "calls": self.calls,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": round(self.cost_usd, 4),
            "budget_usd": self.budget_usd,
            "by_agent": self.by_agent,
        }

    def line(self) -> str:
        cap = f" / ${self.budget_usd:.2f}" if self.budget_usd is not None else ""
        return f"{self.calls} LLM calls, ${self.cost_usd:.3f}{cap} spent"


METER = CostMeter()


# ---------------------------------------------------------------- peak-hours guard
class PeakGuard:
    """Blocks before each LLM call while inside configured peak windows.

    Default windows (owner's DeepSeek rule): Mon-Fri 11:30-14:30 and 16:30-20:30, Adelaide time.
    """

    def __init__(self, enabled=False, tz="Australia/Adelaide",
                 windows=(("11:30", "14:30"), ("16:30", "20:30")), weekdays_only=True):
        self.enabled = enabled
        self.tz = ZoneInfo(tz) if (ZoneInfo and enabled) else None
        self.windows = [(self._m(a), self._m(b)) for a, b in windows]
        self.weekdays_only = weekdays_only

    @staticmethod
    def _m(hhmm: str) -> int:
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)

    def minutes_until_clear(self, now: Optional[datetime] = None) -> int:
        if not self.enabled:
            return 0
        now = now or datetime.now(self.tz)
        if self.weekdays_only and now.weekday() >= 5:
            return 0
        cur = now.hour * 60 + now.minute
        for start, end in self.windows:
            if start <= cur < end:
                return end - cur
        return 0

    def wait(self):
        mins = self.minutes_until_clear()
        while mins > 0:
            print(f"\033[33m[peak guard] Peak hours - pausing LLM calls for {mins} min "
                  f"(the Minecraft world is paused too)\033[0m")
            time.sleep(min(mins, 5) * 60)
            mins = self.minutes_until_clear()


PEAK = PeakGuard(enabled=False)


# ---------------------------------------------------------------- chat model
class ChatModel:
    """Drop-in for the old `ChatOpenAI`: `llm(messages) -> AIMessage`, with `.model_name`."""

    def __init__(self, model_name: Optional[str] = None, temperature: float = 0,
                 request_timeout: int = 240, provider: Optional[str] = None,
                 agent: str = "llm", max_retries: int = 6):
        from openai import OpenAI

        provider = provider or os.environ.get("VOYAGER_PROVIDER", "deepseek")
        if provider not in PROVIDERS:
            raise ValueError(f"Unknown provider {provider!r}; choose from {list(PROVIDERS)}")
        base_url, key_env, default_model = PROVIDERS[provider]
        base_url = os.environ.get("VOYAGER_BASE_URL", base_url)
        api_key = os.environ.get(key_env) or ("ollama" if provider == "ollama" else None)
        if not api_key:
            raise RuntimeError(f"Set {key_env} (environment variable or .env) to use provider {provider!r}")
        self.provider = provider
        self.model_name = model_name or default_model
        self.temperature = temperature
        self.agent = agent
        self.max_retries = max_retries
        self.client = OpenAI(api_key=api_key, base_url=base_url, timeout=request_timeout, max_retries=0)

    def __call__(self, messages: List[BaseMessage]) -> AIMessage:
        METER.check_budget()
        PEAK.wait()
        payload = [{"role": m.role, "content": m.content} for m in messages]
        delay = 2.0
        for attempt in range(self.max_retries + 1):
            try:
                resp = self.client.chat.completions.create(
                    model=self.model_name, messages=payload, temperature=self.temperature
                )
                u = resp.usage
                if u is not None:
                    METER.add(self.agent, self.model_name, u.prompt_tokens or 0, u.completion_tokens or 0)
                return AIMessage(content=resp.choices[0].message.content or "")
            except Exception as e:  # network blips, 429s, 5xx
                status = getattr(e, "status_code", None)
                if status in (400, 401, 403, 404) or attempt == self.max_retries:
                    raise
                wait = delay + random.uniform(0, 1)
                print(f"\033[33m[{self.agent}] API error ({type(e).__name__}: {e}); retry in {wait:.0f}s\033[0m")
                time.sleep(wait)
                delay = min(delay * 2, 60)
        raise RuntimeError("unreachable")
