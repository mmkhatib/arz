"""Skills — durable procedures the assistant learned from past sessions.

A skill is a self-contained markdown file describing *how* to do a thing:
when to use it, what steps to take, what to look out for. Skills live in
two namespaces:

  ~/.arz/skills/curated/   — hand-written, never modified by the runtime.
  ~/.arz/skills/auto/      — learned from past sessions by the
                              auto-skill consolidator (gated, opt-in).

Auto-skills (Hermes pipeline):
  After a session lands with ≥5 tool calls, the memory consolidator
  optionally asks the LLM to summarise the procedure as a reusable skill.
  Gates:
    1. Sensitive-session detection — skip if the transcript mentions
       secrets, tokens, ~/.ssh, .env, or auth headers.
    2. Output redaction — scrub the same patterns out of the generated
       skill body before writing it to disk.
    3. Similarity dedup — if a stored skill overlaps ≥70 % with the new
       one, update the existing record instead of creating a duplicate.
       The version counter on the updated skill increments.
    4. SEL audit — every create / update is appended to the audit log
       so the user can see what Hermes has been writing.

Skill file format:

    ---
    name: <slug>
    title: <human title>
    created: <iso ts>
    updated: <iso ts>
    source_session: <session id, or "" for curated>
    namespace: <"auto" | "curated">
    version: <int>
    tool_calls: <int>
    signature_hash: <sha256 of normalised step list>
    ---

    ## When to use

    <one-paragraph trigger description>

    ## Steps

    1. ...
    2. ...

    ## Watch for

    - …
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

import structlog

log = structlog.get_logger(__name__)

_SKILLS_ROOT = Path.home() / ".arz" / "skills"
_AUDIT_LOG = Path.home() / ".arz" / "skills_audit.jsonl"

# Patterns that, if present in a session transcript OR in the LLM's
# generated skill body, mark it as too sensitive to persist. Mirrors the
# redaction rules in the base prompt but operates AFTER the model
# produces output — defense in depth.
_SENSITIVE_PATTERNS = [
    re.compile(r"(?i)\b(api[_-]?key|access[_-]?token|bearer|authorization)\s*[:=]"),
    re.compile(r"(?i)\b(password|passwd|secret|client[_-]?secret)\s*[:=]"),
    re.compile(r"(?i)\bsk-[A-Za-z0-9_-]{20,}"),  # OpenAI / Anthropic-style keys
    re.compile(r"(?i)\bghp_[A-Za-z0-9]{20,}"),  # GitHub PAT
    re.compile(r"(?i)\baws_(secret_)?access_key"),
    re.compile(r"(?i)private[_-]?key\s*=|-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"~/\.ssh/|/\.ssh/"),
    re.compile(r"\.env\b|~?/\.aws/credentials"),
]

# Replacement patterns for the redaction pass. Each tuple is (regex,
# replacement). These run AFTER the sensitive-session check, on the
# generated skill body, so even if the model leaks something we scrub it.
_REDACT_PATTERNS = [
    (re.compile(r"(?i)sk-[A-Za-z0-9_-]{20,}"), "[REDACTED-KEY]"),
    (re.compile(r"(?i)ghp_[A-Za-z0-9]{20,}"), "[REDACTED-GH-PAT]"),
    (re.compile(r"(?i)bearer\s+[A-Za-z0-9._-]{20,}"), "Bearer [REDACTED]"),
    (
        re.compile(r"(?i)(api[_-]?key|access[_-]?token|password|secret)(\s*[:=]\s*)[^\s\"'`,;)]+"),
        lambda m: f"{m.group(1)}{m.group(2)}[REDACTED]",
    ),
]


@dataclass
class Skill:
    name: str
    title: str
    namespace: str  # "auto" | "curated"
    body: str  # the markdown body (without frontmatter)
    created: float
    updated: float
    source_session: str = ""
    version: int = 1
    tool_calls: int = 0
    signature_hash: str = ""
    tags: list[str] = field(default_factory=list)

    def to_markdown(self) -> str:
        fm_lines = [
            "---",
            f"name: {self.name}",
            f"title: {self.title}",
            f"created: {self.created}",
            f"updated: {self.updated}",
            f"source_session: {self.source_session}",
            f"namespace: {self.namespace}",
            f"version: {self.version}",
            f"tool_calls: {self.tool_calls}",
            f"signature_hash: {self.signature_hash}",
        ]
        if self.tags:
            fm_lines.append("tags: " + ", ".join(self.tags))
        fm_lines.append("---")
        return "\n".join(fm_lines) + "\n\n" + self.body.strip() + "\n"

    @classmethod
    def from_markdown(cls, name: str, namespace: str, content: str) -> Skill:
        body = content
        fm: dict[str, str] = {}
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                _, raw, body = parts
                for line in raw.strip().splitlines():
                    if ":" in line:
                        k, v = line.split(":", 1)
                        fm[k.strip()] = v.strip()
        return cls(
            name=fm.get("name") or name,
            title=fm.get("title") or name.replace("-", " ").title(),
            namespace=fm.get("namespace") or namespace,
            body=body.strip(),
            created=float(fm.get("created") or time.time()),
            updated=float(fm.get("updated") or time.time()),
            source_session=fm.get("source_session") or "",
            version=int(fm.get("version") or 1),
            tool_calls=int(fm.get("tool_calls") or 0),
            signature_hash=fm.get("signature_hash") or "",
            tags=[t.strip() for t in (fm.get("tags") or "").split(",") if t.strip()],
        )


def _safe_slug(s: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", (s or "").strip().lower())
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:80] or "skill"


def is_sensitive(text: str) -> bool:
    """True if any sensitive-pattern hit appears in the text."""
    if not text:
        return False
    return any(p.search(text) for p in _SENSITIVE_PATTERNS)


def redact(text: str) -> str:
    """Apply the redaction patterns to *text* and return the scrubbed result."""
    out = text or ""
    for pat, repl in _REDACT_PATTERNS:
        out = pat.sub(repl, out)
    return out


def _normalise_steps(body: str) -> list[str]:
    """Pull numbered / bulleted step lines out of a skill body for similarity hashing."""
    lines: list[str] = []
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = re.match(r"^(?:\d+[.)]\s+|[-*]\s+)(.+)$", line)
        if m:
            normal = re.sub(r"\s+", " ", m.group(1).lower())
            normal = re.sub(r"[^a-z0-9 ]+", "", normal)
            if normal:
                lines.append(normal)
    return lines


def signature_hash(body: str) -> str:
    steps = _normalise_steps(body)
    if not steps:
        return ""
    joined = "\n".join(steps[:30])
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def similarity(a_body: str, b_body: str) -> float:
    """Jaccard similarity over normalised step sets. Cheap, signature-friendly."""
    sa = set(_normalise_steps(a_body))
    sb = set(_normalise_steps(b_body))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def _audit(event: str, **fields: object) -> None:
    """Append a JSONL row to the skills audit log."""
    try:
        _AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with _AUDIT_LOG.open("a", encoding="utf-8") as f:
            payload = {"ts": time.time(), "event": event, **fields}
            f.write(json.dumps(payload) + "\n")
    except OSError as e:
        log.warning("skills audit append failed", error=str(e))


class SkillStore:
    """Read/write the two skill namespaces."""

    def __init__(self, root: Path | None = None) -> None:
        self._root = root or _SKILLS_ROOT
        (self._root / "auto").mkdir(parents=True, exist_ok=True)
        (self._root / "curated").mkdir(parents=True, exist_ok=True)

    def _dir(self, namespace: str) -> Path:
        if namespace not in {"auto", "curated"}:
            raise ValueError(f"unknown namespace {namespace!r}")
        return self._root / namespace

    def list(self, namespace: str | None = None) -> list[Skill]:
        spaces: Iterable[str] = (namespace,) if namespace else ("auto", "curated")
        out: list[Skill] = []
        for ns in spaces:
            for p in sorted(self._dir(ns).glob("*.md")):
                try:
                    out.append(Skill.from_markdown(p.stem, ns, p.read_text(encoding="utf-8")))
                except Exception:
                    log.warning("skill load failed", path=str(p))
        return out

    def get(self, name: str, namespace: str | None = None) -> Skill | None:
        spaces: Iterable[str] = (namespace,) if namespace else ("auto", "curated")
        for ns in spaces:
            p = self._dir(ns) / f"{_safe_slug(name)}.md"
            if p.exists():
                try:
                    return Skill.from_markdown(p.stem, ns, p.read_text(encoding="utf-8"))
                except Exception:
                    return None
        return None

    def save(self, skill: Skill) -> Path:
        skill.name = _safe_slug(skill.name)
        if not skill.signature_hash:
            skill.signature_hash = signature_hash(skill.body)
        skill.updated = time.time()
        path = self._dir(skill.namespace) / f"{skill.name}.md"
        path.write_text(skill.to_markdown(), encoding="utf-8")
        return path

    def delete(self, name: str, namespace: str) -> bool:
        path = self._dir(namespace) / f"{_safe_slug(name)}.md"
        if not path.exists():
            return False
        path.unlink()
        _audit("delete", name=name, namespace=namespace)
        return True

    def promote(self, name: str) -> Skill | None:
        """Move an auto-skill into the curated namespace. Curated skills
        never get auto-overwritten by the consolidator."""
        skill = self.get(name, "auto")
        if not skill:
            return None
        # If a curated skill already shares the slug, bail — user has to rename.
        if (self._dir("curated") / f"{_safe_slug(name)}.md").exists():
            return None
        skill.namespace = "curated"
        skill.updated = time.time()
        self.save(skill)
        try:
            (self._dir("auto") / f"{_safe_slug(name)}.md").unlink(missing_ok=True)
        except OSError:
            pass
        _audit("promote", name=name)
        return skill

    def upsert_auto(
        self,
        *,
        proposed: Skill,
        similarity_threshold: float = 0.7,
    ) -> tuple[Skill, str]:
        """Insert OR update an auto-skill, dedupe by step-set similarity.

        Returns ``(skill, action)`` where action ∈ ``"created" | "updated" | "skipped"``.
        Curated skills are never touched. If a curated skill matches by
        similarity we skip — the user's curated copy wins.
        """
        # 1. Redact body BEFORE any persistence.
        proposed.body = redact(proposed.body)
        proposed.signature_hash = signature_hash(proposed.body)

        # 2. Compare against curated first: if user already curated this
        # procedure (by similarity), do nothing.
        for existing in self.list("curated"):
            if similarity(existing.body, proposed.body) >= similarity_threshold:
                _audit(
                    "skipped",
                    name=proposed.name,
                    reason="curated-overlap",
                    overlap_with=existing.name,
                )
                return existing, "skipped"

        # 3. If an auto-skill with similar signature exists, update it
        # (bump version + freshen updated_at). Otherwise insert new.
        for existing in self.list("auto"):
            if similarity(existing.body, proposed.body) >= similarity_threshold:
                existing.version += 1
                existing.updated = time.time()
                existing.tool_calls = max(existing.tool_calls, proposed.tool_calls)
                existing.body = proposed.body
                existing.title = proposed.title or existing.title
                self.save(existing)
                _audit(
                    "updated",
                    name=existing.name,
                    version=existing.version,
                    source_session=proposed.source_session,
                )
                return existing, "updated"

        # New skill — assign a unique slug if collision exists.
        slug = _safe_slug(proposed.name or proposed.title)
        candidate = slug
        n = 2
        while (self._dir("auto") / f"{candidate}.md").exists():
            candidate = f"{slug}-{n}"
            n += 1
        proposed.name = candidate
        proposed.namespace = "auto"
        proposed.created = proposed.created or time.time()
        proposed.updated = time.time()
        self.save(proposed)
        _audit(
            "created",
            name=proposed.name,
            source_session=proposed.source_session,
            tool_calls=proposed.tool_calls,
        )
        return proposed, "created"

    def recent_audit(self, limit: int = 50) -> list[dict]:
        """Read the tail of the audit log for surfacing in the UI."""
        if not _AUDIT_LOG.exists():
            return []
        try:
            lines = _AUDIT_LOG.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        out: list[dict] = []
        for raw in lines[-limit:]:
            try:
                out.append(json.loads(raw))
            except json.JSONDecodeError:
                continue
        return out


_singleton: SkillStore | None = None


def get_skill_store() -> SkillStore:
    global _singleton
    if _singleton is None:
        _singleton = SkillStore()
    return _singleton
