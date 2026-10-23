import json
import subprocess
import sys
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parent
BAT_FILE = BOT_DIR / "run_mortal.bat"


def run_test(title: str, lines: list[str]) -> list[dict]:
    print(f"\n=== {title} ===")
    for i, line in enumerate(lines, 1):
        print(f"  [IN {i}] {line}")

    proc = subprocess.Popen(
        ["cmd.exe", "/c", str(BAT_FILE), "0"],
        cwd=str(BOT_DIR),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    payload = ("\n".join(lines) + "\n").encode("utf-8")
    out_b, err_b = proc.communicate(input=payload, timeout=60)
    out = out_b.decode("utf-8", errors="replace").strip()
    err = err_b.decode("utf-8", errors="replace").strip()
    print(f"  [EXIT CODE] {proc.returncode}")
    print(f"  [STDOUT]\n{out or '(empty)'}")
    if err:
        print(f"  [STDERR]\n{err}")

    parsed = []
    for line in out.splitlines():
        line = line.strip()
        if line:
            try:
                parsed.append(json.loads(line))
            except Exception:
                pass
    return parsed


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    import model
    resolved_weights = model._resolve_state_file()
    print(f"[모델 가중치 경로 확인] {resolved_weights} ({resolved_weights.stat().st_size:,} bytes)")

    # 1. 요청된 4개 메시지 그대로 주입
    # 참고: 123m 456p 789s 11z 22z 상태에서 1z 쯔모 시 4몸통 1머리(천화/쯔모 화료)가 성립하여
    # Mortal(enable_rule_based_agari_guard=True)은 최우선으로 hora(화료) 및 후보 타패(meta.show)를 반환함.
    test1_msgs = [
        '{"type":"hello","protocol":"mjai","version":3}',
        '{"type":"start_game","names":["Mortal","P1","P2","P3"],"id":"test"}',
        '{"type":"start_kyoku","bakaze":"E","kyoku":1,"honba":0,"kyotaku":0,"oya":0,"dora_marker":"1m","tehais":[["1m","2m","3m","4p","5p","6p","7s","8s","9s","1z","1z","2z","2z"],["?"],["?"],["?"]]}',
        '{"type":"tsumo","actor":0,"pai":"1z"}',
    ]
    run_test("Test 1: 요청된 4개 표준 mjai 메시지 테스트 (123m 456p 789s 11z 22z + 1z -> 화료 성립 패)", test1_msgs)

    # 2. 일반 타패(dahai) 검증 (불완전 패 또는 비화료 패 쯔모 시 dahai 출력 확인)
    test2_msgs = [
        '{"type":"hello","protocol":"mjai","version":3}',
        '{"type":"start_game","names":["Mortal","P1","P2","P3"],"id":"test"}',
        '{"type":"start_kyoku","bakaze":"E","kyoku":1,"honba":0,"kyotaku":0,"oya":0,"dora_marker":"1m","tehais":[["1m","2m","3m","4p","5p","6p","7s","8s","9s","1z","1z","2z","3z"],["?"],["?"],["?"]]}',
        '{"type":"tsumo","actor":0,"pai":"4z"}',
    ]
    run_test("Test 2: 일반 타패(dahai) 추론 검증 (비화료 상태 쯔모)", test2_msgs)
