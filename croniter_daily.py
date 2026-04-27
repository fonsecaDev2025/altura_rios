#!/usr/bin/env python3
"""
Daemon que ejecuta una tarea una vez al día a la hora configurada (HH:MM).
Comprueba el reloj cada CHECK_INTERVAL segundos; usa un intervalo ≤ 60 s
para no saltarse el minuto objetivo.
"""

from __future__ import annotations

import logging
import os
import shlex
import signal
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

# -----------------------------------------------------------------------------
# Configuración
# -----------------------------------------------------------------------------

CHECK_INTERVAL = 60  # segundos; debe ser ≤ 60 para garantizar el minuto objetivo
DAILY_TIME = "16:55"  # HH:MM (24 h); cámbialo a la hora que necesites
DAILY_COMMAND = os.getenv("DAILY_COMMAND", "npm run sync:paraguay")

SCRIPT_DIR = Path(__file__).resolve().parent
LOG_FILE = SCRIPT_DIR / "croniter_daily.log"
PID_FILE = SCRIPT_DIR / "croniter.pid"
STATE_FILE = SCRIPT_DIR / ".croniter_daily_last_run"


def parse_time(time_str: str) -> tuple[int, int]:
    parts = time_str.strip().split(":")
    if len(parts) != 2:
        raise ValueError(f"Hora inválida: {time_str!r} (use HH:MM)")
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError(f"Hora fuera de rango: {time_str}")
    return hour, minute


def _pid_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def ensure_single_instance() -> None:
    """Si otra instancia está viva, termina; si no, escribe el PID actual."""
    my_pid = os.getpid()
    if PID_FILE.exists():
        try:
            old = int(PID_FILE.read_text(encoding="utf-8").strip())
        except ValueError:
            old = -1
        if old != my_pid and _pid_is_alive(old):
            print(
                f"Ya hay una instancia en ejecución (PID {old}). Saliendo.",
                file=sys.stderr,
            )
            sys.exit(1)
    PID_FILE.write_text(str(my_pid), encoding="utf-8")


def remove_pid_if_mine() -> None:
    if not PID_FILE.exists():
        return
    try:
        if PID_FILE.read_text(encoding="utf-8").strip() == str(os.getpid()):
            PID_FILE.unlink()
    except OSError:
        pass


def read_last_run_day() -> date | None:
    if not STATE_FILE.exists():
        return None
    try:
        return date.fromisoformat(STATE_FILE.read_text(encoding="utf-8").strip())
    except ValueError:
        return None


def write_last_run_day(d: date) -> None:
    STATE_FILE.write_text(d.isoformat(), encoding="utf-8")


def is_target_minute(now: datetime, target_hour: int, target_minute: int) -> bool:
    return now.hour == target_hour and now.minute == target_minute


def seconds_until_next_tick(target_hour: int, target_minute: int, now: datetime) -> float:
    """Tiempo hasta la próxima ocurrencia de target en el mismo día (o mañana)."""
    today_run = now.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
    if now <= today_run:
        next_run = today_run
    else:
        next_run = today_run + timedelta(days=1)
    return max(0.0, (next_run - now).total_seconds())


def execute_daily_task() -> dict[str, str]:
    """
    Ejecuta el comando diario que sincroniza alturas de ríos en AMBAS bases SQLite:
      - data/paraguay_dmh.sqlite  (tabla paraguay_dmh)
      - data/alturas.sqlite       (tabla extracciones_dia)
    Comando por defecto: `npm run sync:paraguay`.
    """
    started_at = datetime.now().isoformat(timespec="seconds")
    command = shlex.split(DAILY_COMMAND)
    logging.info("Ejecutando tarea diaria: %s", DAILY_COMMAND)

    try:
        proc = subprocess.run(
            command,
            cwd=str(SCRIPT_DIR),
            check=False,
            capture_output=True,
            text=True,
        )
    except Exception as exc:  # pragma: no cover (defensivo)
        return {
            "timestamp": started_at,
            "status": "failed",
            "message": f"Error al ejecutar comando diario: {exc}",
        }

    if proc.stdout.strip():
        logging.info("Salida comando diario:\n%s", proc.stdout.strip())
    if proc.stderr.strip():
        logging.warning("Error estándar comando diario:\n%s", proc.stderr.strip())

    if proc.returncode == 0:
        return {
            "timestamp": started_at,
            "status": "completed",
            "message": (
                "Sincronización diaria completada en ambas bases "
                "(paraguay_dmh.sqlite y alturas.sqlite)"
            ),
        }

    return {
        "timestamp": started_at,
        "status": "failed",
        "message": (
            f"Sincronización diaria fallida (exit code {proc.returncode}). "
            "Revisa paraguay_dmh.sqlite y alturas.sqlite."
        ),
    }


def log_execution_summary(result: dict[str, str]) -> None:
    logging.info(
        "Registro — hora objetivo %s — %s — %s",
        DAILY_TIME,
        result["status"],
        result["message"],
    )


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            logging.FileHandler(LOG_FILE, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )


def main() -> None:
    setup_logging()
    target_hour, target_minute = parse_time(DAILY_TIME)

    logging.info(
        "Inicio — comprobación cada %ss — hora objetivo %s — log %s",
        CHECK_INTERVAL,
        DAILY_TIME,
        LOG_FILE.resolve(),
    )

    ensure_single_instance()

    def stop_cleanly(signum: int | None = None, frame=None) -> None:
        logging.info("Deteniendo (señal %s)", signum if signum is not None else "interrupt")
        remove_pid_if_mine()
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop_cleanly)
    signal.signal(signal.SIGINT, stop_cleanly)

    try:
        while True:
            now = datetime.now()
            today = now.date()

            if is_target_minute(now, target_hour, target_minute):
                last = read_last_run_day()
                if last != today:
                    result = execute_daily_task()
                    log_execution_summary(result)
                    if result["status"] == "completed":
                        write_last_run_day(today)
                # Dormir el resto del minuto para no repetir en el mismo minuto si CHECK_INTERVAL es bajo
                time.sleep(max(1.0, 60.0 - now.second))
            else:
                if CHECK_INTERVAL > 60:
                    wait = min(
                        float(CHECK_INTERVAL),
                        seconds_until_next_tick(target_hour, target_minute, now),
                    )
                    time.sleep(max(1.0, wait))
                else:
                    time.sleep(float(CHECK_INTERVAL))

    except Exception:
        logging.exception("Error en el bucle principal")
        raise
    finally:
        remove_pid_if_mine()


if __name__ == "__main__":
    main()
