# Akagi Custom (`custom` 브랜치)

공식 Akagi v3 레포지토리 기반의 개인 커스텀 빌드 및 패치 저장소입니다.

- **공식 원본 레포지토리 (`upstream`)**: [https://github.com/shinkuan/Akagi](https://github.com/shinkuan/Akagi)
- **커스텀 프라이빗 레포지토리 (`origin`)**: [https://github.com/14EE4/Akagi-custom](https://github.com/14EE4/Akagi-custom)

---

## 1. 적용된 커스텀 수정 사항

작혼 첫 판 시작 시 Python/PyTorch/Mortal 가중치(`mortal.pth`) 콜드 스타트로 인해 봇이 타임아웃으로 죽는 현상 및 저사양/노트북 CPU 환경에서의 추론/리플레이 지연을 해결하기 위해 다음 패치가 적용되어 있습니다.

1. **백그라운드 사전 워밍업 (`spawn_bot_prewarm`)**
   - 파일: `src/bot/supervisor.rs`, `src/ipc/commands.rs`
   - 아카기 실행 시 및 UI에서 봇 활성화 시 로비에서 미리 `bot.py 0`에 더미 `start_game` + `end_game`을 보내 Python, PyTorch DLL, `libriichi`, `mortal.pth`를 Windows RAM 캐시에 적재합니다.
2. **Mortal 모델 로드 직후 더미 1회 추론 워밍업**
   - 파일: `mjai_bot/mortal/model.py` (`_build_engine`)
   - `MortalEngine` 생성 직후 더미 입력으로 1회 추론을 미리 수행하여 PyTorch 초기 연산 커널 초기화를 스폰 단계에서 끝냅니다.
3. **콜드 스타트 타임아웃(`30초`) 분리 및 일반 턴 타임아웃(`15초`) 확대**
   - 파일: `src/bot/runner.rs` (`SubprocessBot`)
   - 스폰 직후 첫 `react()` 호출에는 최대 `30초`(`DEFAULT_FIRST_REACT_TIMEOUT_MS`)를 부여하고, 이후 일반 턴에는 `15초`(`DEFAULT_REACT_TIMEOUT_MS`)를 부여하여 노트북 CPU에서도 단일 추론 지연으로 봇이 종료되지 않도록 합니다.
4. **대국 중 `react()` 오류/타임아웃 발생 시 자동 재스폰 및 현재 국 리플레이 복구**
   - 파일: `src/bot/manager.rs` (`BotManager::recover_runner_after_error`)
   - 대국 도중 타임아웃/오류가 발생해도 그 판 전체에서 봇을 포기하지 않고 즉시 재스폰한 뒤, 보관된 `start_game` 및 현재 국 이벤트(`kyoku_events`)를 재주입하여 다음 턴부터 자동 복구합니다.
5. **배치/리플레이 처리 시 중간 이벤트 추론 생략 (`can_act=False`)**
   - 파일: `mjai_bot/mortal/bot.py` (`Bot.react`)
   - 여러 이벤트가 한 배치(`events`)로 전달될 때(재스폰 리플레이 시 100+ 이벤트 또는 리치 선언 에코 포함 배치), 마지막 이벤트(`idx == last_idx`)에서만 신경망 추론을 수행하고 이전 이벤트들은 `can_act=False`로 상태만 갱신하여 리플레이 지연을 `30초+` → `수 ms`로 단축합니다.
6. **유일 합법수(리치 후 강제 쯔모기리 등) Fast-Path 및 CPU 스레드 제한**
   - 파일: `mjai_bot/mortal/model.py` (`MortalEngine._react_batch`, `_build_engine`)
   - 가능한 행동(`masks[0]`)이 단 1개뿐인 경우 40블록 ResNet을 실행하지 않고 즉시(`~0.4ms`) 확률 `100%`로 해당 행동을 반환합니다.
   - CPU 모드에서 PyTorch OpenMP 스레드 수를 최대 4개로 제한하여 Chromium(WebGL) 프로세스와의 CPU 코어 경합을 방지합니다.

---

## 2. 노트북 동기화 방법 (`custom` 브랜치)

빌드 완료된 `akagi.exe`와 `mjai_bot/mortal` 스크립트(Windows용 `libriichi` `.pyd` 포함)가 레포지토리에 포함되어 있으므로, 노트북에서는 별도 빌드 없이 `git pull`만으로 동기화할 수 있습니다 (`mortal.pth` 가중치 파일만 `mjai_bot/mortal/mortal.pth`에 위치하면 됩니다).

### 최초 1회 설정 (노트북 아카기 폴더)
```powershell
# 기존에 .git이 없는 일반 폴더인 경우:
git init
git remote add origin https://github.com/14EE4/Akagi-custom.git

# 이미 .git이 있는 폴더인 경우:
git remote set-url origin https://github.com/14EE4/Akagi-custom.git

# custom 브랜치 받아오기 (mortal.pth, configs/, chrome-profile/ 등은 유지됨):
git fetch origin
git checkout -f -B custom origin/custom
```

### 이후 업데이트 시
```powershell
Stop-Process -Name "akagi" -Force -ErrorAction SilentlyContinue
git pull
```

---

## 3. 데스크톱에서 공식(`upstream/v3`) 업데이트 병합 및 빌드 방법

> **주의**: 앱 내 UI의 자동 업데이트 버튼을 누르면 공식 순정 `akagi.exe`가 덮어씌워져 커스텀 패치가 사라집니다. 업데이트는 반드시 아래 Git 병합 및 로컬 빌드로 진행하세요.

```powershell
git checkout custom
git pull upstream v3
npm --prefix frontend run build
$env:PROTOC = "C:\Users\pyeon\.gemini\antigravity-cli\brain\e09dcb65-b75c-45dc-9ccd-1b8d0157081b\scratch\protoc\bin\protoc.exe"
Stop-Process -Name "akagi" -Force -ErrorAction SilentlyContinue
cargo build --release --features custom-protocol
Copy-Item -Path "target\release\akagi.exe" -Destination "akagi.exe" -Force
git add -A
git commit -m "chore: merge upstream/v3 and rebuild akagi.exe"
git push origin custom
```
