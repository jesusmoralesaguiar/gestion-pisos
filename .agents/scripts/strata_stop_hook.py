"""
Stop hook for Antigravity: verifies scoped workspace diffs against local Strata.

Reads the Stop hook JSON payload from stdin and writes a single JSON decision
object to stdout (`{}` to allow stop, or `{"decision": "continue", "reason": ...}`).
Fails open on any unexpected error so offline/busy local LLM never blocks work.
"""

from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "http://127.0.0.1:18500"
DEFAULT_MODEL = "iq3_s"
HTTP_TIMEOUT_S = 90
MAX_DIFF_CHARS = 30_000
MAX_UNTRACKED_FILE_CHARS = 8_000

WATCHED_PATHS = [
    "src",
    "drizzle",
    "app.json",
    "package.json",
    "babel.config.js",
    "metro.config.js",
    "drizzle.config.ts",
    "tsconfig.json",
]

UNTRACKED_DIRS = ["src", "drizzle"]
UNTRACKED_EXTS = (".ts", ".tsx", ".js", ".sql", ".json")

STATE_DIR = os.path.join(tempfile.gettempdir(), "strata-verifier-gestion-pisos")
STATE_FILE = os.path.join(STATE_DIR, "state.json")
LAST_REPORT_FILE = os.path.join(STATE_DIR, "last_report.json")
LOG_FILE = os.path.join(STATE_DIR, "hook.log")

SYSTEM_PROMPT = """Eres el agente verificador estricto del proyecto `gestion-pisos` (Expo SDK 58, React Native 0.88, TypeScript, Expo Router en `src/app/`, `react-native-paper`, `expo-sqlite` + Drizzle ORM, `jszip`, `xlsx`, offline-first).

Tu trabajo es auditar el diff proporcionado y detectar SOLO problemas reales y accionables.

Reglas clave del proyecto:
1. Expo Router: solo pantallas y `_layout.tsx` en `src/app/`. Componentes, hooks, servicios y DB fuera de `src/app/`. Nunca tocar `ios/` ni `android/` manualmente.
2. Drizzle ORM / SQLite: si cambia `src/db/schema.ts`, debe existir migración SQL en `drizzle/` y actualización en `drizzle/meta/_journal.json` / `drizzle/migrations.js`; revisar integridad de FKs (`ON DELETE CASCADE`/`SET NULL`) y compatibilidad con datos existentes.
3. Reglas fiscales (IRPF / IGIC / IVA):
   - `residencial` y `vacacional` Canarias `repep`: IRPF computa `amount` (importe total).
   - `vacacional` Canarias `general_420`: IRPF computa `base_amount` (base imponible), IGIC aparte.
   - Fianzas recibidas excluidas del cómputo IRPF salvo retención.
4. Copias de seguridad (`src/services/backup.ts`): cerrar SQLite (`closeDatabase()`) antes de restaurar `.zip`, validar `gestion_pisos.db`, restaurar `attachments/` y reabrir/migrar.
5. Calidad móvil y TypeScript: errores en `async/await`, posibles crashes por `null`/`undefined`/`NaN` en importes o fechas (`YYYY-MM-DD`), compatibilidad Android/iOS y tema claro/oscuro.

Criterio de severidad:
- `blockers`: SOLO bugs genuinos, regresiones, migraciones rotas o faltantes, errores de cálculo fiscal, pérdida de datos/corrupción de backup, crashes probables o violaciones claras de arquitectura.
- `warnings`: mejoras menores, edge cases poco probables o sugerencias de estilo (NO bloquean).

Responde EXCLUSIVAMENTE con un objeto JSON válido (sin markdown adicional si es posible) con exactamente esta estructura:
{
  "verdict": "APPROVE" | "REQUEST_CHANGES",
  "summary": "Resumen breve de la revisión",
  "blockers": [{"file": "ruta", "issue": "descripción del problema", "fix": "cómo corregirlo"}],
  "warnings": [{"file": "ruta", "issue": "descripción"}]
}

Si no hay blockers reales, devuelve `"verdict": "APPROVE"` y `"blockers": []`."""


def log_msg(message: str) -> None:
    """Append a timestamped line to hook.log outside the repository."""
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, "a", encoding="utf-8") as fh:
            fh.write(f"[{ts}] {message}\n")
    except Exception:
        pass


def get_base_url() -> str:
    """Resolve Strata active URL from runtime ready file, env var, or default."""
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        rdir = os.path.join(local_app_data, "Strata", "runtime")
        if os.path.isdir(rdir):
            readies = sorted(
                glob.glob(os.path.join(rdir, "app-1-*.ready.json")),
                key=os.path.getmtime,
                reverse=True,
            )
            for rf in readies:
                try:
                    with open(rf, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if data.get("api_url") and data.get("api_state") == "ready":
                            return str(data["api_url"]).rstrip("/")
                except Exception:
                    pass
    env_url = os.environ.get("STRATA_BASE_URL", "").strip()
    return (env_url or DEFAULT_BASE_URL).rstrip("/")


def get_api_key() -> str:
    """Resolve Strata API key from profile config, env var, or global mcp_config.json."""
    appdata = os.environ.get("APPDATA")
    if appdata:
        prof = os.path.join(appdata, "Strata", "profiles", "app-1.json")
        if os.path.isfile(prof):
            try:
                with open(prof, "r", encoding="utf-8") as f:
                    pdata = json.load(f)
                src = pdata.get("source_config")
                if src and os.path.isfile(src):
                    with open(src, "r", encoding="utf-8") as sf:
                        sdata = json.load(sf)
                    if sdata.get("api_key"):
                        return str(sdata["api_key"]).strip()
            except Exception:
                pass

    env_key = os.environ.get("STRATA_API_KEY", "").strip()
    if env_key:
        return env_key

    mcp_cfg = os.path.join(os.path.expanduser("~"), ".gemini", "config", "mcp_config.json")
    if os.path.isfile(mcp_cfg):
        try:
            with open(mcp_cfg, "r", encoding="utf-8") as f:
                cdata = json.load(f)
            key = (
                cdata.get("mcpServers", {})
                .get("strata-local", {})
                .get("env", {})
                .get("STRATA_API_KEY", "")
            )
            if key:
                return str(key).strip()
        except Exception:
            pass
    return ""


def get_model() -> str:
    """Return configured Strata verifier model alias/id."""
    return (
        os.environ.get("STRATA_VERIFIER_MODEL", "").strip()
        or os.environ.get("STRATA_MODEL", "").strip()
        or DEFAULT_MODEL
    )


def resolve_repo_dir(payload: dict) -> str:
    """Determine repository directory from hook payload or script location."""
    cwd = payload.get("cwd")
    if isinstance(cwd, str) and os.path.isdir(cwd):
        return cwd
    ws = payload.get("workspacePaths")
    if isinstance(ws, list) and ws and isinstance(ws[0], str) and os.path.isdir(ws[0]):
        return ws[0]
    script_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(script_dir, "..", ".."))


def run_git(repo_dir: str, args: list[str]) -> str:
    """Run a git command in repo_dir and return stdout decoded safely."""
    proc = subprocess.run(
        ["git", *args],
        cwd=repo_dir,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=15,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {proc.stderr.strip()}")
    return proc.stdout


def collect_diff_bundle(repo_dir: str) -> tuple[str, str]:
    """Return (diff_stat, full_diff_bundle) for watched paths and new source files."""
    stat_out = run_git(repo_dir, ["diff", "--stat", "HEAD", "--", *WATCHED_PATHS]).strip()
    diff_out = run_git(repo_dir, ["diff", "--diff-filter=ACMR", "HEAD", "--", *WATCHED_PATHS]).strip()

    untracked_raw = run_git(
        repo_dir,
        ["ls-files", "--others", "--exclude-standard", "--", *UNTRACKED_DIRS],
    )
    untracked_parts: list[str] = []
    for rel_path in sorted(line.strip() for line in untracked_raw.splitlines() if line.strip()):
        if not rel_path.lower().endswith(UNTRACKED_EXTS):
            continue
        abs_path = os.path.join(repo_dir, rel_path)
        if not os.path.isfile(abs_path):
            continue
        try:
            with open(abs_path, "r", encoding="utf-8", errors="replace") as fh:
                content = fh.read()
        except Exception as exc:
            log_msg(f"Could not read untracked file {rel_path}: {exc}")
            continue
        if len(content) > MAX_UNTRACKED_FILE_CHARS:
            content = (
                content[:MAX_UNTRACKED_FILE_CHARS]
                + f"\n... [truncado a {MAX_UNTRACKED_FILE_CHARS} caracteres]"
            )
        untracked_parts.append(f"=== NUEVO ARCHIVO (untracked): {rel_path} ===\n{content}")

    sections: list[str] = []
    if diff_out:
        sections.append(diff_out)
    if untracked_parts:
        sections.append("\n\n".join(untracked_parts))

    combined = "\n\n".join(sections).strip()
    if not combined:
        return "", ""

    if not stat_out and untracked_parts:
        stat_out = f"Nuevos archivos sin trackear: {len(untracked_parts)}"

    return stat_out, combined


def load_state() -> dict:
    """Load persisted verifier state from temp directory."""
    if not os.path.isfile(STATE_FILE):
        return {}
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_json(path: str, data: dict) -> None:
    """Write JSON atomically-enough to temp state directory."""
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


def call_strata(base_url: str, api_key: str, model: str, user_prompt: str) -> str:
    """Call Strata /v1/chat/completions endpoint and return assistant text."""
    body: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.0,
        "max_tokens": 1536,
        "stream": False,
    }
    if os.environ.get("STRATA_VERIFIER_THINKING", "0").strip().lower() not in ("1", "true", "yes"):
        body["chat_template_kwargs"] = {"enable_thinking": False}

    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(
        f"{base_url}/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
        raw = resp.read().decode("utf-8", "replace")

    blob = json.loads(raw) if raw.strip() else {}
    choices = blob.get("choices") or []
    if not choices:
        raise ValueError(f"Strata returned no choices: {raw[:400]}")
    msg = choices[0].get("message") or {}
    content = msg.get("content") or ""
    if not content:
        raise ValueError("Strata returned empty message content")
    return str(content)


def parse_strata_json(raw_text: str) -> dict:
    """Extract and parse the JSON verdict object from Strata output."""
    cleaned = raw_text.strip()
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL)
    if fence_match:
        cleaned = fence_match.group(1)
    else:
        first = cleaned.find("{")
        last = cleaned.rfind("}")
        if first != -1 and last != -1 and last > first:
            cleaned = cleaned[first : last + 1]

    parsed = json.loads(cleaned)
    if not isinstance(parsed, dict):
        raise ValueError("Parsed Strata response is not a JSON object")
    return parsed


def format_continue_reason(report: dict) -> str:
    """Format blockers into a concise actionable system message for the agent."""
    lines = ["[Strata Verifier] Se detectaron problemas bloqueantes en los cambios actuales:"]
    summary = report.get("summary")
    if isinstance(summary, str) and summary.strip():
        lines.append(f"Resumen: {summary.strip()}")
    for idx, item in enumerate(report.get("blockers") or [], start=1):
        if isinstance(item, dict):
            file_ref = str(item.get("file") or "desconocido").strip()
            issue = str(item.get("issue") or "").strip()
            fix = str(item.get("fix") or "").strip()
            entry = f"{idx}. [{file_ref}] {issue}"
            if fix:
                entry += f" -> Fix sugerido: {fix}"
            lines.append(entry)
        else:
            lines.append(f"{idx}. {item}")
    lines.append(
        "Corrige estos bloqueantes (y ejecuta `npx tsc --noEmit` / `npx expo lint` si aplica) antes de finalizar."
    )
    return "\n".join(lines)


def run_check() -> int:
    """Run non-mutating connectivity check against local Strata gateway."""
    base_url = get_base_url()
    api_key = get_api_key()
    model = get_model()
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    print(f"Base URL: {base_url}")
    print(f"Model:    {model}")
    print(f"API Key:  {'present' if api_key else 'missing'}")
    print(f"StateDir: {STATE_DIR}")

    try:
        req = urllib.request.Request(f"{base_url}/v1/models", headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8", "replace")
        blob = json.loads(raw) if raw.strip() else {}
        ids = [m.get("id", "?") for m in blob.get("data", [])]
        print(f"Strata status: OK (models: {', '.join(ids) or 'none'})")
        return 0
    except Exception as exc:
        print(f"Strata status: UNREACHABLE ({exc})", file=sys.stderr)
        return 1


def emit_json(obj: dict) -> None:
    """Write single-line JSON output to stdout."""
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    if "--check" in sys.argv[1:]:
        return run_check()

    raw_stdin = ""
    try:
        try:
            sys.stdin.reconfigure(encoding="utf-8-sig", errors="replace")
        except Exception:
            pass
        raw_stdin = sys.stdin.read().lstrip("\ufeff")
    except Exception as exc:
        log_msg(f"Failed reading stdin: {exc}")
        emit_json({})
        return 0

    try:
        payload = json.loads(raw_stdin) if raw_stdin.strip() else {}
        if not isinstance(payload, dict):
            payload = {}
    except Exception as exc:
        log_msg(f"Invalid stdin JSON: {exc}")
        emit_json({})
        return 0

    if os.environ.get("STRATA_VERIFIER_DISABLE", "").strip() == "1":
        log_msg("Skipped: STRATA_VERIFIER_DISABLE=1")
        emit_json({})
        return 0

    termination_reason = payload.get("terminationReason")
    if termination_reason not in (None, "", "NO_TOOL_CALL"):
        log_msg(f"Skipped: terminationReason={termination_reason}")
        emit_json({})
        return 0

    if payload.get("continuationActive") is True:
        log_msg("Skipped: continuationActive=True")
        emit_json({})
        return 0

    try:
        repo_dir = resolve_repo_dir(payload)
        stat_out, diff_bundle = collect_diff_bundle(repo_dir)
        if not diff_bundle:
            log_msg("Skipped: empty scoped diff")
            emit_json({})
            return 0

        diff_hash = hashlib.sha256(diff_bundle.encode("utf-8")).hexdigest()
        state = load_state()
        if state.get("last_diff_hash") == diff_hash:
            log_msg(f"Skipped: duplicate diff_hash={diff_hash[:12]}")
            emit_json({})
            return 0

        diff_for_prompt = diff_bundle
        if len(diff_for_prompt) > MAX_DIFF_CHARS:
            diff_for_prompt = (
                diff_for_prompt[:MAX_DIFF_CHARS]
                + f"\n\n... [DIFF TRUNCADO a {MAX_DIFF_CHARS} caracteres; total {len(diff_bundle)}]"
            )

        last_user_input = str(payload.get("lastUserInput") or "").strip()
        prompt_parts = []
        if last_user_input:
            prompt_parts.append(f"Última petición del usuario:\n{last_user_input}")
        if stat_out:
            prompt_parts.append(f"Resumen de cambios (`git diff --stat`):\n{stat_out}")
        prompt_parts.append(f"Diff y archivos nuevos a auditar:\n{diff_for_prompt}")
        user_prompt = "\n\n".join(prompt_parts)

        base_url = get_base_url()
        api_key = get_api_key()
        model = get_model()

        t0 = time.time()
        raw_reply = call_strata(base_url, api_key, model, user_prompt)
        elapsed_ms = int((time.time() - t0) * 1000)

        report = parse_strata_json(raw_reply)
        verdict = str(report.get("verdict") or "APPROVE").upper()
        blockers = report.get("blockers")
        if not isinstance(blockers, list):
            blockers = []

        save_json(
            STATE_FILE,
            {
                "last_diff_hash": diff_hash,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "verdict": verdict,
                "elapsed_ms": elapsed_ms,
            },
        )
        save_json(
            LAST_REPORT_FILE,
            {
                "diff_hash": diff_hash,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "elapsed_ms": elapsed_ms,
                "model": model,
                "report": report,
            },
        )
        log_msg(
            f"Audited diff_hash={diff_hash[:12]} verdict={verdict} blockers={len(blockers)} elapsed_ms={elapsed_ms}"
        )

        if verdict == "REQUEST_CHANGES" and len(blockers) > 0:
            emit_json({"decision": "continue", "reason": format_continue_reason(report)})
            return 0

        emit_json({})
        return 0
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:300] if exc.fp else ""
        except Exception:
            pass
        log_msg(f"Fail-open HTTPError {exc.code}: {detail}")
        emit_json({})
        return 0
    except Exception as exc:
        log_msg(f"Fail-open error: {exc}")
        emit_json({})
        return 0


if __name__ == "__main__":
    sys.exit(main())
